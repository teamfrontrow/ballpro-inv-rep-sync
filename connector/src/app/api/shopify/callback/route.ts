import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  exchangeAuthorizationCode,
  validateOAuthHmac,
  validateOAuthState,
  validateOAuthTimestamp,
} from "@/lib/shopify/auth";
import { normalizeShopDomain } from "@/lib/shopify/constants";
import { saveOfflineInstallation } from "@/lib/shopify/installations";

export const runtime = "nodejs";

function failure(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = env();
  if (!config.SHOPIFY_CLIENT_ID || !config.SHOPIFY_CLIENT_SECRET || !config.TOKEN_ENCRYPTION_KEY) {
    return failure("Shopify OAuth and token encryption are not fully configured", 503);
  }

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? undefined;
  const stateCookie = request.cookies.get("shopify_oauth_state")?.value;
  if (!stateCookie || state !== stateCookie || !validateOAuthState(state, config.SHOPIFY_CLIENT_SECRET)) {
    return failure("Invalid or expired Shopify OAuth state");
  }
  if (!validateOAuthTimestamp(params) || !validateOAuthHmac(params, config.SHOPIFY_CLIENT_SECRET)) {
    return failure("Invalid Shopify OAuth callback signature");
  }

  const code = params.get("code");
  const shopParam = params.get("shop");
  if (!code || !shopParam) return failure("Shopify OAuth callback is missing code or shop");

  let shop: string;
  try {
    shop = normalizeShopDomain(shopParam);
  } catch {
    return failure("Invalid Shopify shop domain");
  }
  if (shop !== normalizeShopDomain(config.SHOPIFY_SHOP_DOMAIN)) {
    return failure("This connector can only be installed on its configured Shopify store", 403);
  }

  try {
    const token = await exchangeAuthorizationCode({
      clientId: config.SHOPIFY_CLIENT_ID,
      clientSecret: config.SHOPIFY_CLIENT_SECRET,
      shopDomain: shop,
    }, code);
    await saveOfflineInstallation(shop, token.access_token, token.scope, {
      encryptionKey: config.TOKEN_ENCRYPTION_KEY,
    });
  } catch (error) {
    console.error("Shopify OAuth callback failed", error);
    return failure("Unable to complete Shopify installation", 502);
  }

  const response = NextResponse.redirect(new URL("/", config.APP_URL));
  response.cookies.delete("shopify_oauth_state");
  return response;
}
