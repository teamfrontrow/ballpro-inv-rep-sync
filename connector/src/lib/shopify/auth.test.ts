import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  canonicalizeOAuthQuery,
  createOAuthState,
  validateOAuthHmac,
  validateOAuthState,
  validateOAuthTimestamp,
} from "./auth";

describe("Shopify OAuth", () => {
  it("creates signed, expiring state", () => {
    const now = Date.UTC(2026, 6, 15);
    const state = createOAuthState("secret", now);
    expect(validateOAuthState(state, "secret", now + 9 * 60_000)).toBe(true);
    expect(validateOAuthState(state, "wrong", now)).toBe(false);
    expect(validateOAuthState(state, "secret", now + 11 * 60_000)).toBe(false);
  });

  it("validates callback HMAC and timestamp", () => {
    const now = Date.UTC(2026, 6, 15);
    const params = new URLSearchParams({
      code: "code value",
      shop: "ballproplusdev.myshopify.com",
      state: "state",
      timestamp: String(Math.floor(now / 1_000)),
    });
    params.set("hmac", createHmac("sha256", "secret").update(canonicalizeOAuthQuery(params)).digest("hex"));
    expect(validateOAuthHmac(params, "secret")).toBe(true);
    expect(validateOAuthTimestamp(params, now)).toBe(true);
    params.set("code", "tampered");
    expect(validateOAuthHmac(params, "secret")).toBe(false);
  });

  it("builds an offline authorization URL without per-user grant options", () => {
    const url = buildAuthorizationUrl({
      appUrl: "https://connector.example.com",
      clientId: "client",
      clientSecret: "secret",
      scopes: "read_products,write_products",
      shopDomain: "ballproplusdev.myshopify.com",
    }, "signed-state");
    expect(url.origin).toBe("https://ballproplusdev.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://connector.example.com/api/shopify/callback");
    expect(url.searchParams.get("grant_options[]")).toBeNull();
  });
});
