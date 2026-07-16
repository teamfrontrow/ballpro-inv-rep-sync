import { describe, expect, it } from "vitest";

import { decryptAccessToken, encryptAccessToken } from "./crypto";

describe("Shopify token encryption", () => {
  const key = "ab".repeat(32);

  it("round trips with AES-256-GCM and random nonces", () => {
    const first = encryptAccessToken("shpat_secret", key);
    const second = encryptAccessToken("shpat_secret", key);
    expect(first).not.toBe(second);
    expect(decryptAccessToken(first, key)).toBe("shpat_secret");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptAccessToken("shpat_secret", key);
    const replacement = encrypted.endsWith("A") ? "B" : "A";
    expect(() => decryptAccessToken(`${encrypted.slice(0, -1)}${replacement}`, key)).toThrow(
      "Unable to decrypt Shopify access token",
    );
  });

  it("requires an exact 256-bit key", () => {
    expect(() => encryptAccessToken("token", "abcd")).toThrow("exactly 32 bytes");
  });
});
