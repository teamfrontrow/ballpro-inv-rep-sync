import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { normalizeShopDomain } from "./constants";

const STATE_TTL_SECONDS = 10 * 60;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createOAuthState(secret: string, now = Date.now()): string {
  const payload = `${randomBytes(24).toString("base64url")}.${Math.floor(now / 1000)}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function validateOAuthState(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload, secret))) return false;
  const issuedAt = Number(parts[1]);
  const age = Math.floor(now / 1000) - issuedAt;
  return Number.isFinite(issuedAt) && age >= 0 && age <= STATE_TTL_SECONDS;
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function canonicalizeOAuthQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`)
    .join("&");
}

export function validateOAuthHmac(params: URLSearchParams, secret: string): boolean {
  const received = params.get("hmac");
  if (!received || !/^[a-fA-F0-9]{64}$/.test(received)) return false;
  const expected = createHmac("sha256", secret).update(canonicalizeOAuthQuery(params)).digest("hex");
  return safeEqual(received.toLowerCase(), expected);
}

export function validateOAuthTimestamp(params: URLSearchParams, now = Date.now()): boolean {
  const timestamp = Number(params.get("timestamp"));
  if (!Number.isFinite(timestamp)) return false;
  const ageSeconds = Math.floor(now / 1_000) - timestamp;
  return ageSeconds >= 0 && ageSeconds <= STATE_TTL_SECONDS;
}

export interface OAuthConfig {
  appUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  shopDomain: string;
}

export function buildAuthorizationUrl(config: OAuthConfig, state: string): URL {
  const shop = normalizeShopDomain(config.shopDomain);
  const callback = new URL("/api/shopify/callback", config.appUrl).toString();
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  return url;
}

export interface OfflineAccessTokenResponse {
  access_token: string;
  scope: string;
}

export async function exchangeAuthorizationCode(
  config: Pick<OAuthConfig, "clientId" | "clientSecret" | "shopDomain">,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OfflineAccessTokenResponse> {
  const shop = normalizeShopDomain(config.shopDomain);
  const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as Partial<OfflineAccessTokenResponse> | null;
  if (!response.ok || !body?.access_token || typeof body.scope !== "string") {
    throw new Error(`Shopify OAuth token exchange failed (${response.status})`);
  }
  return { access_token: body.access_token, scope: body.scope };
}
