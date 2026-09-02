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

  it("reports stale rows, null colors and malformed dates as warnings, not failures", () => {
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
    // None of these withhold publication any more. The only row here has no
    // colour and so contributes nothing, leaving no usable data for any mapped
    // style -- which blanks the metafield rather than failing the product.
    expect(result.issues).toEqual([]);
    expect(new Set(result.warnings.map((issue) => issue.code))).toEqual(
      new Set(["source_missing", "source_stale", "null_color", "empty_sizes", "invalid_date"]),
    );
    expect(result.payload).not.toBeNull();
    expect(result.payload?.colors).toEqual([]);
  });

  it("publishes a stale colourway alongside fresh ones, and says it is old", () => {
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
    /*
     * Both publish. Withholding the stale colourway did not make Shopify
     * correct -- it left whatever was published last sitting on the product
     * page indefinitely. The age is reported as a warning instead, so it is
     * visible without being suppressed.
     */
    expect(result.payload?.styles).toEqual(["FRESH-1", "STALE-1"]);
    expect(result.payload?.colors.map((color) => color.color)).toEqual(["Lavender", "Navy"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("source_stale");
    expect(result.warnings[0].detail).toContain("STALE-1");
  });

  it("names the style, the colourway to blame, its age and the limit in a staleness message", () => {
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
      "Test Brand/STALE-1 (Black): last refreshed 2026-07-05, 10 day(s) ago (limit 2)",
    );
  });

  it("blames only the colourways carrying the oldest timestamp, capping a long list", () => {
    // The Holderness & Bourne shape: one colourway the source stopped listing,
    // every other colourway of the same style refreshed today.
    const dead = (color: string) =>
      current({ variantId: color, color, sourceUpdatedAt: "2026-07-05T10:00:00.000Z" });
    const oneDead = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ color: "Navy" }), current({ variantId: "2", color: "White" }), dead("Belmont")],
      future: [], cap: null, horizonDays: 90, now: NOW, maxSourceAgeDays: 2,
    });
    const manyDead = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: ["Belmont", "Sonoma", "Tudor", "Windsor", "Harbor"].map(dead),
      future: [], cap: null, horizonDays: 90, now: NOW, maxSourceAgeDays: 2,
    });

    expect(oneDead.warnings[0].detail).toBe(
      "Test Brand/STYLE-1 (Belmont): last refreshed 2026-07-05, 10 day(s) ago (limit 2)",
    );
    expect(manyDead.warnings[0].detail).toBe(
      "Test Brand/STYLE-1 (Belmont, Sonoma, Tudor +2 more): last refreshed 2026-07-05, 10 day(s) ago (limit 2)",
    );
  });

  it("falls back to a placeholder when the stale row has no colour at all", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STYLE-1" }],
      current: [current({ color: null, sourceUpdatedAt: "2026-07-05T10:00:00.000Z" })],
      future: [], cap: null, horizonDays: 90, now: NOW, maxSourceAgeDays: 2,
    });

    expect(result.warnings[0].detail).toBe(
      "Test Brand/STYLE-1 (no color): last refreshed 2026-07-05, 10 day(s) ago (limit 2)",
    );
  });

  it("reports a source row with no timestamp as stale, naming the style and colourway", () => {
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

    expect(result.payload?.styles).toEqual(["FRESH-1", "UNDATED-1"]);
    expect(result.warnings[0].detail).toBe(
      "Test Brand/UNDATED-1: 1 source row(s) carry no timestamp (Black)",
    );
  });

  it("publishes a product whose only data is stale, rather than withholding it", () => {
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "STALE-1" }],
      current: [current({ productNumber: "STALE-1", sourceUpdatedAt: "2026-07-05T10:00:00.000Z" })],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    /*
     * This used to fail the product, which sounds cautious and is not: a failed
     * sync writes nothing, so the metafield keeps whatever it held from before
     * the data went stale, and the storefront offers that indefinitely. What we
     * last heard from the source, marked old, beats a frozen number nobody can
     * see the age of.
     */
    expect(result.payload).not.toBeNull();
    expect(result.payload?.styles).toEqual(["STALE-1"]);
    expect(result.issues).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(["source_stale"]);
  });

  it("blanks the metafield when the source no longer lists the product at all", () => {
    /*
     * The johnnie-O case: the style is live in Shopify and correctly targeted,
     * but the supplier stopped listing it, so no row is returned for any mapped
     * style. An empty payload clears the metafield -- the honest statement that
     * we have no inventory data -- instead of failing and leaving the last
     * known quantities on sale forever. Reversible: the moment the source lists
     * it again, the next sync republishes.
     */
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [{ brandName: "Test Brand", productNumber: "DROPPED-1" }],
      current: [],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload).not.toBeNull();
    expect(result.payload?.colors).toEqual([]);
    expect(result.payload?.styles).toEqual([]);
    expect(result.json).not.toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toContain("source_missing");
  });

  it("still FAILS a product with no styles mapped at all", () => {
    /*
     * Distinct from the case above and deliberately still fatal. No mapped
     * styles is a matching bug, not a supplier decision, and blanking on it
     * would wipe good inventory because of a fault on our side.
     */
    const result = buildInventoryPayload({
      brand: "Test Brand",
      styles: [],
      current: [],
      future: [],
      cap: null,
      horizonDays: 90,
      now: NOW,
    });

    expect(result.payload).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual(["source_missing"]);
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

    // The malformed future row is still excluded -- validIsoDate drops it, so no
    // date reaches the payload -- but it no longer withholds that style's
    // current stock, which was never in question.
    expect(result.payload?.styles).toEqual(["BAD-DATE-1", "FRESH-1"]);
    expect(result.payload?.dates).toEqual([]);
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

    expect(defaultWindow.warnings.map((issue) => issue.code)).toContain("source_stale");
    expect(feedWindow.warnings).toEqual([]);
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

    expect(atCutoff.warnings).toEqual([]);
    expect(atCutoff.payload).not.toBeNull();
    // The detail now names the style and echoes the window in force, which is
    // what makes a per-brand limit legible in a run log.
    expect(justOlder.warnings).toEqual([
      {
        code: "source_stale",
        detail: "Test Brand/STYLE-1 (Black): last refreshed 2026-07-13, 2 day(s) ago (limit 2)",
      },
    ]);
    // Published, not withheld: the age is reported, the data still goes out.
    expect(justOlder.payload).not.toBeNull();
  });

  it("reports an untimestamped row as stale but still publishes it", () => {
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

    expect(staleFuture.warnings.map((issue) => issue.code)).toEqual(["source_stale"]);
    expect(staleFuture.payload).not.toBeNull();
    expect(missingTimestamp.warnings).toEqual([
      { code: "source_stale", detail: "Test Brand/STYLE-1: 1 source row(s) carry no timestamp (Black)" },
    ]);
    expect(missingTimestamp.payload).not.toBeNull();
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
      expect(result.warnings.map((issue) => issue.code)).toContain("invalid_date");
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
