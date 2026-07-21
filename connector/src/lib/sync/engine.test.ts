import { describe, expect, it } from "vitest";

import { isExcludedMapping } from "./engine";

describe("isExcludedMapping", () => {
  const inScope = { vendorIgnored: false, matchStatus: "auto", brandEnabled: true };

  it("keeps an in-scope mapping (enabled brand, matched, vendor not ignored)", () => {
    expect(isExcludedMapping(inScope)).toBe(false);
  });

  it("excludes a mapping whose Shopify vendor is ignored", () => {
    expect(isExcludedMapping({ ...inScope, vendorIgnored: true })).toBe(true);
  });

  it("excludes a mapping explicitly marked 'ignored'", () => {
    expect(isExcludedMapping({ ...inScope, matchStatus: "ignored" })).toBe(true);
  });

  it("excludes a mapping whose brand is disabled or absent (e.g. Ball Pro)", () => {
    expect(isExcludedMapping({ ...inScope, brandEnabled: false })).toBe(true);
  });

  it("does NOT exclude an in-scope but unmatched product (still reported as skipped)", () => {
    expect(isExcludedMapping({ ...inScope, matchStatus: "unmatched" })).toBe(false);
  });
});
