import { describe, expect, it } from "vitest";
import type { RepSparkCurrentRow, RepSparkFutureRow } from "@/lib/repspark/inventory";
import { buildInventoryPayload, payloadBusinessHash, stableStringify } from "./payload";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const FRESH = "2026-07-15T10:00:00.000Z";

function current(overrides: Partial<RepSparkCurrentRow> = {}): RepSparkCurrentRow {
  return {
    brandName: "Test Brand",
    productNumber: "STYLE-1",
    variantId: "1",
    color: "Black",
    size: "M",
    quantity: 10,
    sizeSequence: null,
    sourceUpdatedAt: FRESH,
    ...overrides,
  };
}

function future(overrides: Partial<RepSparkFutureRow> = {}): RepSparkFutureRow {
  return {
    brandName: "Test Brand",
    productNumber: "STYLE-1",
    variantId: "1",
    color: "Black",
    size: "M",
    quantity: 20,
    availabilityDate: "2026-08-01",
    sourceUpdatedAt: FRESH,
    ...overrides,
  };
}

describe("buildInventoryPayload", () => {
  it("aggregates mapped styles, deduplicates source rows, caps values, and uses stable ordering", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "STYLE-2" },
        { brandName: "Test Brand", productNumber: "STYLE-1" },
      ],
      current: [
        current({ quantity: 600 }),
        current({ quantity: 600 }),
        current({ variantId: "2", productNumber: "STYLE-2", quantity: 50 }),
        current({ variantId: "3", productNumber: "STYLE-2", color: "Navy", size: "XL", quantity: 4 }),
        current({ variantId: "4", productNumber: "STYLE-2", color: "Navy", size: "S", quantity: 3 }),
      ],
      future: [future({ quantity: 700 }), future({ quantity: 700 })],
      cap: 500,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload).toMatchObject({
      schema: 1,
      styles: ["STYLE-1", "STYLE-2"],
      size_order: ["S", "M", "XL"],
      dates: ["2026-08-01"],
    });
    expect(result.payload?.colors[0].sizes[0]).toEqual({
      size: "M",
      current: 500,
      capped: true,
      future: [{ date: "2026-08-01", qty: 500, capped: true }],
    });
  });

  it("fails readiness for stale rows, null colors, empty styles, and malformed future dates", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "STYLE-1" },
        { brandName: "Test Brand", productNumber: "MISSING" },
      ],
      current: [current({ color: null, sourceUpdatedAt: "2026-01-01" })],
      future: [future({ availabilityDate: "not-a-date" })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set(["source_missing", "source_stale", "null_color", "empty_sizes", "invalid_date"]),
    );
    expect(result.payload).toBeNull();
  });

  it("publishes fresh styles and warns about a stale one instead of failing the product", () => {
    // The AndersonOrd shape: a Shopify product maps one style per colorway, and
    // one colorway stopped being re-scraped. Every other colorway is current.
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "FRESH-1" },
        { brandName: "Test Brand", productNumber: "STALE-1" },
      ],
      current: [
        current({ productNumber: "FRESH-1", color: "Navy" }),
        current({ productNumber: "STALE-1", variantId: "9", color: "Lavender", sourceUpdatedAt: "2026-07-05T10:00:00.000Z" }),
      ],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload).not.toBeNull();
    // The stale colorway contributes nothing — neither its quantities nor its name.
    expect(result.payload?.styles).toEqual(["FRESH-1"]);
    expect(result.payload?.colors.map((color) => color.color)).toEqual(["Navy"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("source_stale");
    expect(result.warnings[0].detail).toContain("STALE-1");
  });

  it("names the style, its age and the limit in a staleness message", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "FRESH-1" },
        { brandName: "Test Brand", productNumber: "STALE-1" },
      ],
      current: [
        current({ productNumber: "FRESH-1" }),
        current({ productNumber: "STALE-1", variantId: "9", sourceUpdatedAt: "2026-07-05T10:00:00.000Z" }),
      ],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
      maxSourceAgeDays: 2,
    });

    expect(result.warnings[0].detail).toBe(
      "Test Brand/STALE-1: last refreshed 2026-07-05, 10 day(s) ago (limit 2)",
    );
  });

  it("reports a source row with no timestamp as stale, naming the style", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "FRESH-1" },
        { brandName: "Test Brand", productNumber: "UNDATED-1" },
      ],
      current: [
        current({ productNumber: "FRESH-1" }),
        current({ productNumber: "UNDATED-1", variantId: "9", sourceUpdatedAt: null }),
      ],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload?.styles).toEqual(["FRESH-1"]);
    expect(result.warnings[0].detail).toBe("Test Brand/UNDATED-1: 1 source row(s) carry no timestamp");
  });

  it("still fails the product when every mapped style is unusable", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STALE-1" }],
      current: [current({ productNumber: "STALE-1", sourceUpdatedAt: "2026-07-05T10:00:00.000Z" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(["source_stale"]);
  });

  it("keeps a mapped style that RepSpark has no rows for from failing its siblings", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "FRESH-1" },
        { brandName: "Test Brand", productNumber: "GONE-1" },
      ],
      current: [current({ productNumber: "FRESH-1" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload?.styles).toEqual(["FRESH-1"]);
    expect(result.warnings).toEqual([{ code: "source_missing", detail: "Test Brand/GONE-1" }]);
  });

  it("confines a malformed future date to its own style", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [
        { brandName: "Test Brand", productNumber: "FRESH-1" },
        { brandName: "Test Brand", productNumber: "BAD-DATE-1" },
      ],
      current: [
        current({ productNumber: "FRESH-1" }),
        current({ productNumber: "BAD-DATE-1", variantId: "9" }),
      ],
      future: [future({ productNumber: "BAD-DATE-1", variantId: "9", availabilityDate: "not-a-date" })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload?.styles).toEqual(["FRESH-1"]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(["invalid_date"]);
    expect(result.warnings[0].detail).toBe("Test Brand/BAD-DATE-1: not-a-date");
  });

  it("omits out-of-horizon dates and empty future arrays", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current()],
      future: [future({ availabilityDate: "2027-08-01" })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.dates).toEqual([]);
    expect(result.payload?.colors[0].sizes[0]).toEqual({ size: "M", current: 10 });
  });

  it("publishes the source colour code beside a mapped display name", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ color: "Black", colorCode: "BLK010" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("Black");
    expect(result.payload?.colors[0].color_code).toBe("BLK010");
  });

  it("omits the colour code when no display name replaced it", () => {
    // An unmapped feed colour arrives with the raw code already in `color`.
    // Emitting it again would render as "HA1464 (HA1464)".
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ color: "HA1464", colorCode: "HA1464" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("HA1464");
    expect(result.payload?.colors[0].color_code).toBeUndefined();
  });

  it("omits the colour code for scraped sources, which never carry one", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ color: "Black" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color_code).toBeUndefined();
  });

  it("takes the colour code from a colourway that has only future rows", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [],
      future: [future({ color: "Sail", colorCode: "SAL486" })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color_code).toBe("SAL486");
  });

  it("keeps colourways apart when the source reports no colour", () => {
    // Acushnet's Hybris site has no colour field, so every FootJoy style is
    // labelled "Default". Grouped on that string the colourways merge and their
    // quantities are summed -- this asserts they stay separate and honest.
    const result = buildInventoryPayload({
      brand: "FootJoy",
      styles: [
        { brandName: "FootJoy", productNumber: "33296", shopifyColor: "White" },
        { brandName: "FootJoy", productNumber: "33297", shopifyColor: "Navy" },
      ],
      current: [
        current({ brandName: "FootJoy", productNumber: "33296", variantId: "1", color: "Default", quantity: 5 }),
        current({ brandName: "FootJoy", productNumber: "33297", variantId: "2", color: "Default", quantity: 7 }),
      ],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors).toEqual([
      { color: "Navy", color_code: "33297", sizes: [{ size: "M", current: 7 }] },
      { color: "White", color_code: "33296", sizes: [{ size: "M", current: 5 }] },
    ]);
  });

  it("leaves a source-reported colour alone even when Shopify has one", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1", shopifyColor: "Shopify Navy" }],
      current: [current({ color: "Source Black" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("Source Black");
    expect(result.payload?.colors[0].color_code).toBeUndefined();
  });

  it("keeps the placeholder when Shopify has no colour for the style", () => {
    const result = buildInventoryPayload({
      brand: "FootJoy",
      styles: [{ brandName: "FootJoy", productNumber: "33296", shopifyColor: null }],
      current: [current({ brandName: "FootJoy", productNumber: "33296", color: "Default" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("Default");
    expect(result.payload?.colors[0].color_code).toBeUndefined();
  });

  it("substitutes the colour regardless of the placeholder's casing", () => {
    const result = buildInventoryPayload({
      brand: "FootJoy",
      styles: [{ brandName: "FootJoy", productNumber: "33296", shopifyColor: "White" }],
      current: [current({ brandName: "FootJoy", productNumber: "33296", color: " default " })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("White");
  });

  it("substitutes on a colourway reached only through future rows", () => {
    const result = buildInventoryPayload({
      brand: "FootJoy",
      styles: [{ brandName: "FootJoy", productNumber: "33296", shopifyColor: "White" }],
      current: [],
      future: [future({ brandName: "FootJoy", productNumber: "33296", color: "Default" })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.payload?.colors[0].color).toBe("White");
    expect(result.payload?.colors[0].color_code).toBe("33296");
  });

  it("converts strict M/D/YYYY dates to ISO and accepts strict ISO dates", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current()],
      future: [
        future({ availabilityDate: "8/1/2026", quantity: 5 }),
        future({ availabilityDate: "2026-08-02", quantity: 6 }),
      ],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });
    expect(result.issues).toEqual([]);
    expect(result.payload?.dates).toEqual(["2026-08-01", "2026-08-02"]);
    expect(result.payload?.colors[0].sizes[0].future).toEqual([
      { date: "2026-08-01", qty: 5 },
      { date: "2026-08-02", qty: 6 },
    ]);
  });

  it("includes a future-only size alongside current sizes with current quantity zero", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ size: "M", quantity: 10 })],
      future: [future({ variantId: "2", size: "XL", quantity: 8 })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload?.size_order).toEqual(["M", "XL"]);
    expect(result.payload?.colors[0].sizes).toEqual([
      { size: "M", current: 10 },
      { size: "XL", current: 0, future: [{ date: "2026-08-01", qty: 8 }] },
    ]);
  });

  it("builds a payload for a style represented only by future inventory", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [],
      future: [future({ size: "L", quantity: 12 })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload).toMatchObject({
      styles: ["STYLE-1"],
      size_order: ["L"],
      dates: ["2026-08-01"],
      colors: [{
        color: "Black",
        sizes: [{ size: "L", current: 0, future: [{ date: "2026-08-01", qty: 12 }] }],
      }],
    });
  });

  it("omits future inventory entirely when showFutureInventory is false (ATS only)", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ size: "M", quantity: 10 })],
      future: [future({ size: "M", quantity: 20 })],
      cap: null,
      horizonDays: 90,
      showFutureInventory: false,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload?.dates).toEqual([]);
    expect(result.payload?.colors[0].sizes).toEqual([{ size: "M", current: 10 }]);
  });

  it("does not fail an ATS-only brand on a malformed future date", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current()],
      future: [future({ availabilityDate: "not-a-date" })],
      cap: null,
      horizonDays: 90,
      showFutureInventory: false,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload?.colors[0].sizes[0]).toEqual({ size: "M", current: 10 });
  });

  it("drops an obsolete color with no current stock and no future restock", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [
        current({ size: "M", quantity: 10 }),
        current({ variantId: "2", color: "Obsolete", size: "M", quantity: 0 }),
        current({ variantId: "2", color: "Obsolete", size: "XL", quantity: null }),
      ],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload?.colors).toEqual([{ color: "Black", sizes: [{ size: "M", current: 10 }] }]);
    // XL only existed on the dropped color, so it must not leave an empty column.
    expect(result.payload?.size_order).toEqual(["M"]);
  });

  it("keeps a zero-current color that still has a future restock", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ variantId: "2", color: "Restocking", quantity: 0 })],
      future: [future({ variantId: "2", color: "Restocking", quantity: 6 })],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload?.colors).toEqual([{
      color: "Restocking",
      sizes: [{ size: "M", current: 0, future: [{ date: "2026-08-01", qty: 6 }] }],
    }]);
  });

  it("publishes an empty color list rather than failing when every color is obsolete", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ quantity: 0 }), current({ variantId: "2", color: "Navy", quantity: 0 })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.issues).toEqual([]);
    expect(result.payload).toMatchObject({ colors: [], size_order: [], dates: [] });
  });

  it("uses a per-brand source-age window instead of the two-day default", () => {
    const olderSource = current({ sourceUpdatedAt: "2026-07-10T10:00:00.000Z" });
    const defaultWindow = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [olderSource], future: [], cap: null, horizonDays: 90, now: NOW,
    });
    const feedWindow = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [olderSource], future: [], cap: null, horizonDays: 90, now: NOW,
      maxSourceAgeDays: 9,
    });

    expect(defaultWindow.issues.map((issue) => issue.code)).toContain("source_stale");
    expect(feedWindow.issues).toEqual([]);
    expect(feedWindow.payload).not.toBeNull();
  });

  it("treats a source exactly at the age cutoff as fresh, but rejects one millisecond older", () => {
    const atCutoff = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ sourceUpdatedAt: "2026-07-13T12:00:00.000Z" })],
      future: [],
      cap: null,
      horizonDays: 90,
      maxSourceAgeDays: 2,
      now: NOW,
    });
    const justOlder = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ sourceUpdatedAt: "2026-07-13T11:59:59.999Z" })],
      future: [],
      cap: null,
      horizonDays: 90,
      maxSourceAgeDays: 2,
      now: NOW,
    });

    expect(atCutoff.issues).toEqual([]);
    expect(atCutoff.payload).not.toBeNull();
    // The detail now names the style and echoes the window in force, which is
    // what makes a per-brand limit legible in a run log.
    expect(justOlder.issues).toEqual([
      {
        code: "source_stale",
        detail: "Test Brand/STYLE-1: last refreshed 2026-07-13, 2 day(s) ago (limit 2)",
      },
    ]);
    expect(justOlder.payload).toBeNull();
  });

  it("requires every current and future source row to be fresh and fails closed on a missing timestamp", () => {
    const staleFuture = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current()],
      future: [future({ sourceUpdatedAt: "2026-07-05T10:00:00.000Z" })],
      cap: null,
      horizonDays: 90,
      maxSourceAgeDays: 9,
      now: NOW,
    });
    const missingTimestamp = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ sourceUpdatedAt: null })],
      future: [],
      cap: null,
      horizonDays: 90,
      maxSourceAgeDays: 365,
      now: NOW,
    });

    expect(staleFuture.issues.map((issue) => issue.code)).toEqual(["source_stale"]);
    expect(staleFuture.payload).toBeNull();
    expect(missingTimestamp.issues).toEqual([
      { code: "source_stale", detail: "Test Brand/STYLE-1: 1 source row(s) carry no timestamp" },
    ]);
    expect(missingTimestamp.payload).toBeNull();
  });

  it.each(["2/29/2025", "13/1/2026", "2026-02-30", "2026-8-01", "8-1-2026"])(
    "rejects impossible or non-contract date %s",
    (availabilityDate) => {
      const result = buildInventoryPayload({
        brand: "Test Brand",
        styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
        current: [current()],
        future: [future({ availabilityDate })],
        cap: null,
        horizonDays: 90,
        now: NOW,
      });
      expect(result.issues.map((issue) => issue.code)).toContain("invalid_date");
    },
  );
});

it("hashes canonical business data without synced_at", () => {
  const first = buildInventoryPayload({
    brand: "Test Brand",
    styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
    current: [current()], future: [], cap: 500, horizonDays: 90, now: NOW,
  }).payload!;
  const second = { ...first, synced_at: "2030-01-01T00:00:00.000Z" };
  expect(payloadBusinessHash(first)).toBe(payloadBusinessHash(second));
  expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
});
