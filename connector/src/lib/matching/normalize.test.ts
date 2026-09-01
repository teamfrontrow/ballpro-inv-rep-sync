import { describe, expect, it } from "vitest";
import { normalizeMatchKey, normalizeShopifySku } from "./normalize";

describe("normalizeShopifySku", () => {
  it.each([
    ["A-dr016fp-226", "DR016FP-226"],
    ["  a-HB2001  ", "HB2001"],
    // Two letters is a style number, not a prefix — the boundary this rule
    // depends on, and the reason it is `^[A-Z]-` rather than `^[A-Z]+-`.
    ["BA-100", "BA-100"],
    ["", null],
    [null, null],
    // Flag & Anthem prefixes its RepSpark numbers where Shopify uses "A-".
    ["M-SP24OW1978", "SP24OW1978"],
    ["m-corekt1752", "COREKT1752"],
    ["B-COREHW290", "COREHW290"],
    // Only the first prefix goes; the rest of the style number is untouched.
    ["A-B-1234", "B-1234"],
    // A bare style number is already normalized.
    ["COREKT1752", "COREKT1752"],
    // Digits are not a prefix.
    ["1-2345", "1-2345"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeShopifySku(input)).toBe(expected);
  });

  it("maps a prefixed RepSpark number and its Shopify SKU onto one key", () => {
    // The whole point: reconcile runs this over both sides, so these must meet.
    expect(normalizeShopifySku("M-SP24OW1978")).toBe(normalizeShopifySku("A-SP24OW1978"));
  });

  it("collides a prefixed style with its bare twin, which reconcile treats as unmatched", () => {
    // The one real collision in the live catalog. Documented rather than fixed:
    // reconcileCatalog only auto-matches when exactly one source value maps to a
    // key, so this pair falls back to `unmatched` instead of publishing the
    // wrong style's inventory.
    expect(normalizeShopifySku("B-COREHW290")).toBe(normalizeShopifySku("COREHW290"));
  });
});

it("normalizes case-insensitive match keys without changing punctuation", () => {
  expect(normalizeMatchKey(" Holderness & Bourne ")).toBe("HOLDERNESS & BOURNE");
});
