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
