import { describe, expect, it, vi } from "vitest";

import { isValidSourceDate, reportSourceReadiness } from "./source";

describe("RepSpark source readiness", () => {
  it("accepts strict ISO and RepSpark M/D/YYYY dates and rejects impossible dates", () => {
    expect(isValidSourceDate("2026-08-15")).toBe(true);
    expect(isValidSourceDate("8/15/2026")).toBe(true);
    expect(isValidSourceDate("08/05/2026")).toBe(true);
    expect(isValidSourceDate("2026-02-29")).toBe(false);
    expect(isValidSourceDate("2/30/2026")).toBe(false);
    expect(isValidSourceDate("2026/08/15")).toBe(false);
  });

  it("reports per-brand gates without turning them into active-scrape issues", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { tableName: "variant_sizes", columnName: "last_seen_at" },
        { tableName: "variant_future_inventory", columnName: "last_seen_at" },
      ] })
      .mockResolvedValueOnce({ rows: [
        {
          brandName: "Ready Brand",
          sourceEnabled: true,
          latestRunStatus: "completed",
          currentSizeRows: 10,
          variantRows: 2,
          variantsWithoutCurrentSizes: 0,
          nullColorRows: 0,
          futureDateRows: [{ id: 1, date: "2026-08-15" }, { id: 2, date: "8/16/2026" }],
        },
        {
          brandName: "Review Brand",
          sourceEnabled: true,
          latestRunStatus: "failed",
          currentSizeRows: 0,
          variantRows: 1,
          variantsWithoutCurrentSizes: 1,
          nullColorRows: 1,
          futureDateRows: [{ id: 3, date: "2/30/2026" }],
        },
      ] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.ready).toBe(false);
    expect(report.globalIssues).toEqual([]);
    expect(report.canSync).toBe(true);
    expect(report.summary).toEqual({ totalBrands: 2, enabledBrands: 2, readyEnabledBrands: 1 });
    expect(report.brands[0]).toMatchObject({ brandName: "Ready Brand", ready: true, invalidDateRows: 0 });
    expect(report.brands[1]).toMatchObject({ brandName: "Review Brand", ready: false, invalidDateRows: 1 });
    expect(report.brands[1].issues.map((issue) => issue.code)).toEqual([
      "latest_run_not_completed",
      "no_current_size_rows",
      "null_color_coverage",
      "invalid_dates",
    ]);
    expect(query.mock.calls[3][0]).toContain("count(DISTINCT vs.id)");
  });

  it("excludes disabled source brands from global readiness", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { tableName: "variant_sizes", columnName: "last_seen_at" },
        { tableName: "variant_future_inventory", columnName: "last_seen_at" },
      ] })
      .mockResolvedValueOnce({ rows: [
        {
          brandName: "Ready Brand", sourceEnabled: true, latestRunStatus: "completed",
          currentSizeRows: 1, variantRows: 1, variantsWithoutCurrentSizes: 0,
          nullColorRows: 0, futureDateRows: [],
        },
        {
          brandName: "Disabled Brand", sourceEnabled: false, latestRunStatus: null,
          currentSizeRows: 0, variantRows: 0, variantsWithoutCurrentSizes: 0,
          nullColorRows: 0, futureDateRows: [],
        },
      ] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.ready).toBe(true);
    expect(report.summary).toEqual({ totalBrands: 2, enabledBrands: 1, readyEnabledBrands: 1 });
    expect(report.brands[1]).toMatchObject({ sourceEnabled: false, ready: false });
  });

  it("rejects partial current-size coverage", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [
        { tableName: "variant_sizes", columnName: "last_seen_at" },
        { tableName: "variant_future_inventory", columnName: "last_seen_at" },
      ] })
      .mockResolvedValueOnce({ rows: [{
        brandName: "Partial Brand", sourceEnabled: true, latestRunStatus: "completed",
        currentSizeRows: 8, variantRows: 3, variantsWithoutCurrentSizes: 1,
        nullColorRows: 0, futureDateRows: [],
      }] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.brands[0].issues).toEqual([
      expect.objectContaining({ code: "incomplete_current_size_coverage", count: 1 }),
    ]);
  });

  it("fails closed when child inventory freshness is unverifiable", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        brandName: "Complete Brand", sourceEnabled: true, latestRunStatus: "completed",
        currentSizeRows: 1, variantRows: 1, variantsWithoutCurrentSizes: 0,
        nullColorRows: 0, futureDateRows: [],
      }] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.canSync).toBe(false);
    expect(report.globalIssues).toEqual([
      expect.objectContaining({ code: "source_freshness", count: 2 }),
    ]);
  });

  it("reports active jobs and batches as the global ingest gate", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { tableName: "variant_sizes", columnName: "last_seen_at" },
        { tableName: "variant_future_inventory", columnName: "last_seen_at" },
      ] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.globalIssues).toEqual([
      expect.objectContaining({ code: "active_scrape", count: 2 }),
    ]);
  });
});
