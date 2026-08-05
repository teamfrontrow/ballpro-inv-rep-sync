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
        { table_name: "scrape_batches", column_name: "status" },
        { table_name: "scrape_batches", column_name: "completed_at" },
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
    expect(readinessCalls[0][0]).toContain("lower(trim(sj.status)) = ANY ($2::text[])");
    expect(readinessCalls[0][0]).toContain("regexp_split_to_array");
    expect(readinessCalls[0][1][1]).toEqual(["pending", "queued", "running", "processing"]);
    expect(readinessCalls[1][0]).toContain("FROM scrape_runs sr");
    const fetchCalls = query.mock.calls.slice(3);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0][0]).toContain("JOIN variant_sizes vs ON vs.variant_id = pv.id");
    expect(fetchCalls[0][0]).not.toContain("LEFT JOIN variant_sizes");
    expect(fetchCalls[0][0]).not.toContain("variant_future_inventory");
    expect(fetchCalls[1][0]).toContain("JOIN variant_future_inventory vfi ON vfi.variant_id = pv.id");
    expect(fetchCalls[1][0]).not.toContain("LEFT JOIN variant_future_inventory");
    expect(fetchCalls[1][0]).not.toContain("variant_sizes");
    expect(fetchCalls[0][1]).toEqual([["brand"], ["STYLE"]]);
    expect(fetchCalls[0][0]).toContain("NULL::timestamptz");
    expect(fetchCalls[0][0]).not.toContain('p."last_seen_at"');
    expect(fetchCalls[0][0]).not.toContain('pv."last_seen_at"');
  });

  it("reads only the ready brands and reports the blocked one", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { table_name: "brands", column_name: "id" },
        { table_name: "brands", column_name: "brand_name" },
        { table_name: "variant_sizes", column_name: "size_code" },
        { table_name: "scrape_jobs", column_name: "brand_id" },
        { table_name: "scrape_jobs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "brand_id" },
        { table_name: "scrape_runs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "id" },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ brand_name: "Blocked", status: "failed" }] })
      .mockResolvedValueOnce({ rows: [{ variantId: "1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const db = { query } as unknown as Pool;

    const result = await fetchRepSparkInventory([
      { brandName: "Ready", productNumber: "STYLE-A" },
      { brandName: "Blocked", productNumber: "STYLE-B" },
    ], db);

    expect(result.notReady).toEqual([
      { brandName: "Blocked", reason: "latest RepSpark scrape is not complete (failed)" },
    ]);
    // The blocked brand is dropped from the query parameters, so no row of its
    // can reach the payload builder — while the ready brand still syncs.
    expect(query.mock.calls[3][1]).toEqual([["ready"], ["STYLE-A"]]);
    expect(result.current).toHaveLength(1);
  });

  it("fails closed before inventory reads while a target brand scrape is active", async () => {
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
        { table_name: "scrape_batches", column_name: "status" },
        { table_name: "scrape_batches", column_name: "completed_at" },
        { table_name: "scrape_runs", column_name: "brand_id" },
        { table_name: "scrape_runs", column_name: "status" },
        { table_name: "scrape_runs", column_name: "id" },
      ] })
      .mockResolvedValueOnce({ rows: [{ brand_name: "Brand" }] })
      .mockResolvedValueOnce({ rows: [] });
    const db = { query } as unknown as Pool;

    const result = await fetchRepSparkInventory([{ brandName: "Brand", productNumber: "STYLE" }], db);

    expect(result.notReady).toEqual([
      { brandName: "Brand", reason: "a RepSpark scrape is active for this brand" },
    ]);
    // Readiness queries only — with every brand blocked there is nothing to read.
    expect(query).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual([]);
    expect(result.future).toEqual([]);
    expect(query.mock.calls[1][0]).toContain("FROM scrape_batches sb");
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
        { table_name: "scrape_runs", column_name: "started_at" },
        { table_name: "scrape_runs", column_name: "completed_at" },
        { table_name: "scrape_runs", column_name: "error_class" },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ brand_name: "Brand", status: "failed", error_class: "PlaywrightTimeoutError" }] });
    const db = { query } as unknown as Pool;

    const result = await fetchRepSparkInventory([{ brandName: "Brand", productNumber: "STYLE" }], db);

    // The reason names the failure so the reader doesn't have to go query the
    // scraper's database to find out what went wrong.
    expect(result.notReady).toEqual([
      { brandName: "Brand", reason: "latest RepSpark scrape is not complete (failed: PlaywrightTimeoutError)" },
    ]);
    expect(result.current).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
    const latestSql = query.mock.calls[2][0] as string;
    expect(latestSql.indexOf('sr."started_at"')).toBeLessThan(latestSql.indexOf('sr."completed_at"'));
  });
});
