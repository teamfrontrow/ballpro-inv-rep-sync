import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { buildAuthorizationUrl, createOAuthState } from "@/lib/shopify/auth";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const config = env();
  if (!config.SHOPIFY_CLIENT_ID || !config.SHOPIFY_CLIENT_SECRET) {
    return NextResponse.json({ error: "Shopify OAuth client credentials are not configured" }, { status: 503 });
  }

  const state = createOAuthState(config.SHOPIFY_CLIENT_SECRET);
  const authorizationUrl = buildAuthorizationUrl({
    appUrl: config.APP_URL,
    clientId: config.SHOPIFY_CLIENT_ID,
    clientSecret: config.SHOPIFY_CLIENT_SECRET,
    scopes: config.SHOPIFY_SCOPES,
    shopDomain: config.SHOPIFY_SHOP_DOMAIN,
  }, state);
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: new URL(config.APP_URL).protocol === "https:",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/shopify/callback",
  });
  return response;
}
