import { describe, expect, it } from "vitest";
import { normalizeMatchKey, normalizeShopifySku } from "./normalize";

describe("normalizeShopifySku", () => {
  it.each([
    ["A-dr016fp-226", "DR016FP-226"],
    ["  a-HB2001  ", "HB2001"],
    ["BA-100", "BA-100"],
    ["", null],
    [null, null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeShopifySku(input)).toBe(expected);
  });
});

it("normalizes case-insensitive match keys without changing punctuation", () => {
  expect(normalizeMatchKey(" Holderness & Bourne ")).toBe("HOLDERNESS & BOURNE");
});
