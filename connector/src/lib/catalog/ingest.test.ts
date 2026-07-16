import { describe, expect, it, vi } from "vitest";

import { CatalogSourceNotReadyError, ingestCatalog } from "./ingest";

function sourceDb(options: { active?: boolean; brandStatus?: string } = {}) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: options.active ? 1 : 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { tableName: "variant_sizes", columnName: "last_seen_at" },
        { tableName: "variant_future_inventory", columnName: "last_seen_at" },
      ] })
      .mockResolvedValueOnce({ rows: [{
        brandName: "Acme",
        sourceEnabled: true,
        latestRunStatus: options.brandStatus ?? "completed",
        currentSizeRows: options.brandStatus === "failed" ? 0 : 1,
        variantRows: 1,
        variantsWithoutCurrentSizes: 0,
        nullColorRows: 0,
        futureDateRows: [],
      }] })
      .mockResolvedValueOnce({ rows: [{ brandName: "Acme", brandSlug: "acme", productNumber: "ONE" }] }),
  };
}

describe("ingestCatalog", () => {
  it("continues read-only discovery when a per-brand readiness gate needs review", async () => {
    const db = sourceDb({ brandStatus: "failed" });
    const readProducts = vi.fn().mockResolvedValue([]);
    const persist = vi.fn().mockResolvedValue({ brandsUpserted: 1, productsUpserted: 0, stylesUpserted: 0 });

    const report = await ingestCatalog({
      repspark: db as never,
      createShopifyClient: async () => ({ readProducts }),
      persist,
      inTransaction: async (fn) => fn({} as never),
    });

    expect(report.readiness.ready).toBe(false);
    expect(readProducts).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("rejects an active scrape before reading Shopify or writing connector data", async () => {
    const db = sourceDb({ active: true });
    const readProducts = vi.fn();
    const persist = vi.fn();

    await expect(ingestCatalog({
      repspark: db as never,
      createShopifyClient: async () => ({ readProducts }),
      persist,
      inTransaction: async (fn) => fn({} as never),
    })).rejects.toBeInstanceOf(CatalogSourceNotReadyError);

    expect(readProducts).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
