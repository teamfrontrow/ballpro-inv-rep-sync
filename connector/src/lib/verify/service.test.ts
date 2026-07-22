import { describe, expect, it } from "vitest";

import type { InventoryPayload } from "@/lib/domain";
import { inventoryVerdict } from "./service";

function payload(overrides: Partial<InventoryPayload> = {}): InventoryPayload {
  return {
    schema: 1,
    styles: ["STYLE-1"],
    brand: "Test Brand",
    synced_at: "2026-07-22T00:00:00.000Z",
    cap: 500,
    size_order: ["M"],
    dates: [],
    colors: [{ color: "Black", sizes: [{ size: "M", current: 10 }] }],
    ...overrides,
  };
}

describe("inventoryVerdict", () => {
  it("is in_sync when expected and actual match on business data (ignoring synced_at)", () => {
    const expected = payload({ synced_at: "2026-07-22T00:00:00.000Z" });
    const actual = payload({ synced_at: "2026-07-01T00:00:00.000Z" }); // different timestamp only
    expect(inventoryVerdict(expected, actual)).toBe("in_sync");
  });

  it("is out_of_date when quantities differ", () => {
    const expected = payload();
    const actual = payload({ colors: [{ color: "Black", sizes: [{ size: "M", current: 3 }] }] });
    expect(inventoryVerdict(expected, actual)).toBe("out_of_date");
  });

  it("is missing_in_shopify when source has data but Shopify has no metafield", () => {
    expect(inventoryVerdict(payload(), null)).toBe("missing_in_shopify");
  });

  it("is tombstoned when the metafield is an unavailable sentinel", () => {
    expect(inventoryVerdict(payload(), { schema: 1, status: "unavailable", reason: "disabled" })).toBe("tombstoned");
  });

  it("is no_source_data when neither side has publishable inventory", () => {
    expect(inventoryVerdict(null, null)).toBe("no_source_data");
  });

  it("is out_of_date when source is now empty but Shopify still holds a payload", () => {
    expect(inventoryVerdict(null, payload())).toBe("out_of_date");
  });
});
