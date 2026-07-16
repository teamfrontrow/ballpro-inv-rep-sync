import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { fetchRepSparkInventory, resetRepSparkSchemaCacheForTests } from "./inventory";

describe("fetchRepSparkInventory", () => {
  beforeEach(() => resetRepSparkSchemaCacheForTests());

  it("uses separate set-based current and future queries keyed by brand and style", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { table_name: "brands", column_name: "id" },
        { table_name: "brands", column_name: "brand_name" },
        { table_name: "products", column_name: "last_seen_at" },
        { table_name: "product_variants", column_name: "last_seen_at" },
        { table_name: "variant_sizes", column_name: "size_code" },
        { table_name: "variant_sizes", column_name: "ats_now" },
        { table_name: "scrape_jobs", column_name: "target_type" },
        { table_name: "scrape_jobs", column_name: "brand_slugs" },
        { table_name: "scrape_jobs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "brand_id" },
        { table_name: "scrape_runs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "started_at" },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ variantId: "1" }] })
      .mockResolvedValueOnce({ rows: [{ variantId: "1" }] });
    const db = { query } as unknown as Pool;

    const result = await fetchRepSparkInventory([
      { brandName: "Brand", productNumber: "style" },
      { brandName: " brand ", productNumber: " STYLE " },
    ], db);

    expect(result.current).toHaveLength(1);
    expect(result.future).toHaveLength(1);
    expect(query.mock.calls[0][1][0]).toContain("scrape_jobs");
    const readinessCalls = query.mock.calls.slice(1, 3);
    expect(readinessCalls[0][0]).toContain("lower(trim(sj.status)) = 'running'");
    expect(readinessCalls[0][0]).toContain("regexp_split_to_array");
    expect(readinessCalls[1][0]).toContain("FROM scrape_runs sr");
    const fetchCalls = query.mock.calls.slice(3);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0][0]).toContain("LEFT JOIN variant_sizes vs ON vs.variant_id = pv.id");
    expect(fetchCalls[0][0]).not.toContain("variant_future_inventory");
    expect(fetchCalls[1][0]).toContain("LEFT JOIN variant_future_inventory vfi ON vfi.variant_id = pv.id");
    expect(fetchCalls[1][0]).not.toContain("variant_sizes");
    expect(fetchCalls[0][1]).toEqual([["brand"], ["STYLE"]]);
    expect(fetchCalls[0][0]).toContain('p."last_seen_at"');
    expect(fetchCalls[0][0]).toContain('pv."last_seen_at"');
  });

  it("fails closed before inventory reads while a target brand scrape is running", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { table_name: "brands", column_name: "id" },
        { table_name: "brands", column_name: "brand_name" },
        { table_name: "products", column_name: "last_seen_at" },
        { table_name: "product_variants", column_name: "last_seen_at" },
        { table_name: "variant_sizes", column_name: "size_code" },
        { table_name: "scrape_jobs", column_name: "target_type" },
        { table_name: "scrape_jobs", column_name: "brand_slugs" },
        { table_name: "scrape_jobs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "brand_id" },
        { table_name: "scrape_runs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "id" },
      ] })
      .mockResolvedValueOnce({ rows: [{ brand_name: "Brand" }] });
    const db = { query } as unknown as Pool;
    await expect(fetchRepSparkInventory([{ brandName: "Brand", productNumber: "STYLE" }], db))
      .rejects.toThrow("RepSpark scrape still running for: Brand");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the latest target brand scrape failed", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { table_name: "brands", column_name: "id" },
        { table_name: "brands", column_name: "brand_name" },
        { table_name: "products", column_name: "last_seen_at" },
        { table_name: "product_variants", column_name: "last_seen_at" },
        { table_name: "variant_sizes", column_name: "size_code" },
        { table_name: "scrape_jobs", column_name: "target_type" },
        { table_name: "scrape_jobs", column_name: "brand_slugs" },
        { table_name: "scrape_jobs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "brand_id" },
        { table_name: "scrape_runs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "id" },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ brand_name: "Brand", status: "failed" }] });
    const db = { query } as unknown as Pool;
    await expect(fetchRepSparkInventory([{ brandName: "Brand", productNumber: "STYLE" }], db))
      .rejects.toThrow("Latest RepSpark scrape is not complete for: Brand (failed)");
    expect(query).toHaveBeenCalledTimes(3);
  });
});
