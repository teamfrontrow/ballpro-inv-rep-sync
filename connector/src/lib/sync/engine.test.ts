import { describe, expect, it, vi } from "vitest";

import { isExcludedMapping, runSyncWithDependencies, type SyncEngineDependencies } from "./engine";

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

const NOW = new Date("2026-07-15T12:00:00.000Z");

function mapping(id: number, brandName: string, productNumber: string) {
  return {
    id, shopifyProductGid: `gid://shopify/Product/${id}`, brandId: id, brandName,
    brandEnabled: true, matchStatus: "auto", vendorIgnored: false,
    maxDisplayCap: null, defaultCap: 500, horizonDays: 90, showFutureInventory: true,
    lastSyncedAt: null, latestPayloadHash: null,
    styles: [{ productNumber, matchStatus: "auto" }],
  };
}

function fakeDatabase(mappings: ReturnType<typeof mapping>[]) {
  const statements: { sql: string; params?: unknown[] }[] = [];
  const query = async (sql: string, params?: unknown[]) => {
    statements.push({ sql, params });
    if (sql.includes("INSERT INTO sync_runs")) return { rows: [{ id: 99 }] };
    if (sql.includes("FROM product_mappings pm")) return { rows: mappings };
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  const database = { query, connect: async () => client };
  return { statements, database: database as unknown as SyncEngineDependencies["database"] };
}

describe("runSyncWithDependencies carrying Shopify colours", () => {
  it("publishes each colourway separately when the source reports no colour", async () => {
    // One Shopify product, two FootJoy colourways. The source labels both
    // "Default"; the colour has to survive the mapping row -> parseStyles ->
    // activeStyles -> payload path or the two collapse into one summed row.
    const footjoy = {
      id: 1, shopifyProductGid: "gid://shopify/Product/1", brandId: 1, brandName: "FootJoy",
      brandEnabled: true, matchStatus: "auto", vendorIgnored: false,
      maxDisplayCap: null, defaultCap: 500, horizonDays: 90, showFutureInventory: true,
      lastSyncedAt: null, latestPayloadHash: null,
      styles: [
        { productNumber: "33296", matchStatus: "auto", shopifyColor: "White" },
        { productNumber: "33297", matchStatus: "auto", shopifyColor: "Navy" },
      ],
    };
    const { database } = fakeDatabase([footjoy as unknown as ReturnType<typeof mapping>]);
    const setInventoryMetafields = vi.fn(async (writes: { ownerId: string }[]) =>
      writes.map((write) => ({ ownerId: write.ownerId, id: "gid://shopify/Metafield/1" })));

    await runSyncWithDependencies({ kind: "one_time" }, undefined, {
      database,
      fetchInventory: async () => ({
        current: [
          { brandName: "FootJoy", productNumber: "33296", variantId: "1",
            color: "Default", size: "M", quantity: 5, sizeSequence: null,
            sourceUpdatedAt: "2026-07-15T10:00:00.000Z" },
          { brandName: "FootJoy", productNumber: "33297", variantId: "2",
            color: "Default", size: "M", quantity: 7, sizeSequence: null,
            sourceUpdatedAt: "2026-07-15T10:00:00.000Z" },
        ],
        future: [],
        notReady: [],
      }),
      createShopifyClient: async () => ({
        ensureInventoryMetafieldDefinition: async () => undefined,
        setInventoryMetafields,
        deleteInventoryMetafields: async () => undefined,
        tombstoneInventoryMetafields: async () => undefined,
      }),
      now: () => NOW,
      cleanupMode: "delete",
    } as unknown as SyncEngineDependencies);

    expect(setInventoryMetafields).toHaveBeenCalledTimes(1);
    // The engine writes the serialised payload, not the object.
    const write = setInventoryMetafields.mock.calls[0][0][0] as unknown as { value: string };
    const payload = JSON.parse(write.value) as {
      colors: Array<{ color: string; color_code?: string; sizes: Array<{ size: string; current: number }> }>;
    };
    expect(payload.colors).toEqual([
      { color: "Navy", color_code: "33297", sizes: [{ size: "M", current: 7 }] },
      { color: "White", color_code: "33296", sizes: [{ size: "M", current: 5 }] },
    ]);
  });
});

describe("runSyncWithDependencies with a not-ready brand", () => {
  it("skips the blocked brand's products and still writes the healthy brand", async () => {
    const { statements, database } = fakeDatabase([
      mapping(1, "Greyson", "STYLE-1"),
      mapping(2, "Perry Ellis International", "STYLE-2"),
    ]);
    const setInventoryMetafields = vi.fn(async (writes: { ownerId: string }[]) =>
      writes.map((write) => ({ ownerId: write.ownerId, id: "gid://shopify/Metafield/1" })));

    await runSyncWithDependencies({ kind: "one_time" }, undefined, {
      database,
      fetchInventory: async () => ({
        current: [{
          brandName: "Greyson", productNumber: "STYLE-1", variantId: "1",
          color: "Arctic", size: "M", quantity: 4, sizeSequence: null,
          sourceUpdatedAt: "2026-07-15T10:00:00.000Z",
        }],
        future: [],
        // Perry Ellis is mid-scrape or its last scrape failed.
        notReady: [{ brandName: "Perry Ellis International", reason: "latest RepSpark scrape is not complete (failed)" }],
      }),
      createShopifyClient: async () => ({
        ensureInventoryMetafieldDefinition: async () => undefined,
        setInventoryMetafields,
        deleteInventoryMetafields: async () => undefined,
        tombstoneInventoryMetafields: async () => undefined,
      }),
      now: () => NOW,
      cleanupMode: "delete",
    } as unknown as SyncEngineDependencies);

    // The healthy brand is written; the blocked one is never sent to Shopify, so
    // its existing metafield is left exactly as it was.
    expect(setInventoryMetafields).toHaveBeenCalledTimes(1);
    expect(setInventoryMetafields.mock.calls[0][0].map((write) => write.ownerId))
      .toEqual(["gid://shopify/Product/1"]);

    const items = statements.find((statement) => statement.sql.includes("INSERT INTO sync_run_items"));
    const ids = items?.params?.[1] as number[];
    const statuses = items?.params?.[2] as string[];
    const errors = items?.params?.[4] as (string | null)[];
    const byMapping = new Map(ids.map((id, index) => [id, { status: statuses[index], error: errors[index] }]));
    expect(byMapping.get(1)?.status).toBe("written");
    expect(byMapping.get(2)?.status).toBe("skipped");
    expect(byMapping.get(2)?.error)
      .toContain("Perry Ellis International: latest RepSpark scrape is not complete (failed)");

    // Skipped, not failed — the run completes instead of aborting on one brand.
    const runUpdate = statements.find((statement) => statement.sql.includes("UPDATE sync_runs SET status"));
    expect(runUpdate?.params?.[1]).toBe("completed");
    expect(runUpdate?.params?.[5]).toBe(1);
  });
});
