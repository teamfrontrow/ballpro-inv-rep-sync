import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "./middleware";

const originalUsername = process.env.ADMIN_USERNAME;
const originalPassword = process.env.ADMIN_PASSWORD;

afterEach(() => {
  process.env.ADMIN_USERNAME = originalUsername;
  process.env.ADMIN_PASSWORD = originalPassword;
});

function request(path: string, authorization?: string): NextRequest {
  return new NextRequest(`https://connector.example${path}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("connector middleware", () => {
  it("keeps only health and the Shopify callback public", () => {
    process.env.ADMIN_USERNAME = "operator";
    process.env.ADMIN_PASSWORD = "secret";

    expect(middleware(request("/api/health")).status).toBe(200);
    expect(middleware(request("/api/shopify/callback")).status).toBe(200);
    expect(middleware(request("/api/shopify/install")).status).toBe(401);
    expect(middleware(request("/api/runs")).status).toBe(401);
  });

  it("accepts valid Basic credentials for protected routes", () => {
    process.env.ADMIN_USERNAME = "operator";
    process.env.ADMIN_PASSWORD = "secret";
    const authorization = `Basic ${Buffer.from("operator:secret").toString("base64")}`;

    expect(middleware(request("/api/shopify/install", authorization)).status).toBe(200);
  });
});
