<?php
/**
 * Ball Pro — Wholesale Customer Registration Endpoint
 * 
 * Receives registration data from the storefront form and creates
 * a customer in Shopify via the Admin GraphQL API with the
 * "pending-approval" tag and a note containing company details.
 *
 * Uses the Dev Dashboard client_credentials grant to obtain a
 * short-lived Admin API token (expires every 24 hours).
 *
 * Deployed to: https://mos.minnesotainteractive.com/webhooks/ballPro/registerCustomer.php
 */

// ─── Configuration ──────────────────────────────────────────────────────────
// Shared config — edit registerCustomer.php.config.php to set credentials
require_once __DIR__ . '/registerCustomer.php.config.php';


// ─── CORS Headers ───────────────────────────────────────────────────────────
$allowed_origins = [
    'https://ballproplusdev.myshopify.com',
    'https://www.ballpro.com',
    'http://127.0.0.1:9292'
];

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header("Access-Control-Allow-Origin: *");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// ─── Token Management ───────────────────────────────────────────────────────
/**
 * Get a valid Admin API access token, using cache when possible.
 * Tokens from the client_credentials grant expire after 24 hours.
 */
function getAccessToken() {
    // Check cache first
    if (file_exists(TOKEN_CACHE_FILE)) {
        $cache = json_decode(file_get_contents(TOKEN_CACHE_FILE), true);
        if ($cache && isset($cache['access_token'], $cache['expires_at'])) {
            // Use cached token if it has more than 5 minutes left
            if ($cache['expires_at'] > time() + 300) {
                return $cache['access_token'];
            }
        }
    }

    // Request a fresh token
    $url = 'https://' . SHOPIFY_STORE . '.myshopify.com/admin/oauth/access_token';

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/x-www-form-urlencoded',
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'client_id'     => SHOPIFY_CLIENT_ID,
        'client_secret' => SHOPIFY_CLIENT_SECRET,
        'grant_type'    => 'client_credentials'
    ]));

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError || $httpCode !== 200) {
        return null;
    }

    $data = json_decode($response, true);
    if (!isset($data['access_token'])) {
        return null;
    }

    // Cache the token. Default expiry is 24 hours; we store it conservatively.
    $expiresIn = isset($data['expires_in']) ? (int)$data['expires_in'] : 86400;
    $cacheData = [
        'access_token' => $data['access_token'],
        'expires_at'   => time() + $expiresIn
    ];
    file_put_contents(TOKEN_CACHE_FILE, json_encode($cacheData));

    return $data['access_token'];
}

// ─── Parse Input ────────────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || empty($data['email'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Email is required.']);
    exit;
}

$email = filter_var(trim($data['email']), FILTER_VALIDATE_EMAIL);
if (!$email) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid email address.']);
    exit;
}

$customerName   = trim($data['customer_name'] ?? '');
$companyName    = trim($data['company_name'] ?? '');
$companyAddress = trim($data['company_address'] ?? '');
$companyPhone   = trim($data['company_phone'] ?? '');
$companyEin     = trim($data['company_ein'] ?? '');
$customerAsi    = trim($data['customer_asi'] ?? '');
$customerPpai   = trim($data['customer_ppai'] ?? '');
$emailOptIn     = isset($data['email_opt_in']) ? (bool)$data['email_opt_in'] : true;

// ─── Build Note ─────────────────────────────────────────────────────────────
$noteLines = [];
if ($companyName)    $noteLines[] = "Company Name: $companyName";
if ($companyAddress) $noteLines[] = "Company Address: $companyAddress";
if ($companyPhone)   $noteLines[] = "Company Phone: $companyPhone";
if ($companyEin)     $noteLines[] = "Company EIN: $companyEin";
if ($customerAsi)    $noteLines[] = "Customer ASI: $customerAsi";
if ($customerPpai)   $noteLines[] = "Customer PPAI: $customerPpai";
$noteLines[] = "Email Communications: " . ($emailOptIn ? 'Opted In' : 'Opted Out');
$note = implode("\n", $noteLines);

// ─── Get Access Token ───────────────────────────────────────────────────────
$accessToken = getAccessToken();
if (!$accessToken) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Unable to authenticate with Shopify. Please try again later.']);
    exit;
}

// ─── GraphQL Mutation ───────────────────────────────────────────────────────
$mutation = <<<'GRAPHQL'
mutation customerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer {
      id
      email
      firstName
      tags
    }
    userErrors {
      field
      message
    }
  }
}
GRAPHQL;

$variables = [
    'input' => [
        'firstName' => $customerName ?: null,
        'email'     => $email,
        'tags'      => ['pending-approval'],
        'note'      => $note ?: null,
    ]
];

// ─── Make API Request ───────────────────────────────────────────────────────
$url = 'https://' . SHOPIFY_STORE . '.myshopify.com/admin/api/' . SHOPIFY_API_VERSION . '/graphql.json';

$payload = json_encode([
    'query'     => $mutation,
    'variables' => $variables
]);

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'X-Shopify-Access-Token: ' . $accessToken
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// ─── Handle Response ────────────────────────────────────────────────────────
if ($curlError) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not reach Shopify API.']);
    exit;
}

// If 401, the cached token may have expired — clear cache and retry once
if ($httpCode === 401) {
    if (file_exists(TOKEN_CACHE_FILE)) {
        unlink(TOKEN_CACHE_FILE);
    }
    $accessToken = getAccessToken();
    if ($accessToken) {
        // Retry the request with fresh token
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'X-Shopify-Access-Token: ' . $accessToken
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    }
}

if ($httpCode !== 200) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Shopify API returned HTTP ' . $httpCode]);
    exit;
}

$result = json_decode($response, true);

// Check for GraphQL-level errors
if (isset($result['errors']) && !empty($result['errors'])) {
    $firstError = $result['errors'][0]['message'] ?? 'Unknown GraphQL error';
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $firstError]);
    exit;
}

// Check for userErrors from the mutation
$userErrors = $result['data']['customerCreate']['userErrors'] ?? [];
if (!empty($userErrors)) {
    $messages = array_map(function ($e) { return $e['message']; }, $userErrors);
    $errorStr = implode('; ', $messages);

    // Check for duplicate email specifically
    if (stripos($errorStr, 'taken') !== false || stripos($errorStr, 'already') !== false) {
        echo json_encode([
            'success' => false,
            'error' => 'An account with this email already exists.',
            'error_code' => 'ALREADY_REGISTERED'
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => $errorStr]);
    }
    exit;
}

// Success — customer created
$customer = $result['data']['customerCreate']['customer'];
$customerId = $customer['id'];

// ─── Update Email Marketing Consent ─────────────────────────────────────────
// Marketing consent is now managed via a separate mutation in modern Shopify API.
if ($emailOptIn) {
    $consentMutation = <<<'GRAPHQL'
    mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
      customerEmailMarketingConsentUpdate(input: $input) {
        customer {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
    GRAPHQL;

    $consentVariables = [
        'input' => [
            'customerId' => $customerId,
            'emailMarketingConsent' => [
                'marketingState'     => 'SUBSCRIBED',
                'marketingOptInLevel' => 'SINGLE_OPT_IN',
                'consentUpdatedAt'   => gmdate('Y-m-d\TH:i:s\Z')
            ]
        ]
    ];

    $consentPayload = json_encode([
        'query'     => $consentMutation,
        'variables' => $consentVariables
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $consentPayload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-Shopify-Access-Token: ' . $accessToken
    ]);
    curl_exec($ch);
    curl_close($ch);
    // Note: If consent update fails, we still consider registration successful
    // since the customer was created. The note field still reflects their preference.
}

echo json_encode([
    'success'     => true,
    'customer_id' => $customerId
]);
