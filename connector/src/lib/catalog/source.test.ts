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
        {
          brandName: "Ready Brand",
          latestRunStatus: "completed",
          currentSizeRows: 10,
          variantRows: 2,
          nullColorRows: 0,
          futureDateRows: [{ id: 1, date: "2026-08-15" }, { id: 2, date: "8/16/2026" }],
        },
        {
          brandName: "Review Brand",
          latestRunStatus: "failed",
          currentSizeRows: 0,
          variantRows: 1,
          nullColorRows: 1,
          futureDateRows: [{ id: 3, date: "2/30/2026" }],
        },
      ] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.ready).toBe(false);
    expect(report.globalIssues).toEqual([]);
    expect(report.brands[0]).toMatchObject({ brandName: "Ready Brand", ready: true, invalidDateRows: 0 });
    expect(report.brands[1]).toMatchObject({ brandName: "Review Brand", ready: false, invalidDateRows: 1 });
    expect(report.brands[1].issues.map((issue) => issue.code)).toEqual([
      "latest_run_not_completed",
      "no_current_size_rows",
      "null_color_coverage",
      "invalid_dates",
    ]);
    expect(query.mock.calls[2][0]).toContain("count(DISTINCT vs.id)");
  });

  it("reports active jobs and batches as the global ingest gate", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const report = await reportSourceReadiness({ query } as never);

    expect(report.globalIssues).toEqual([
      expect.objectContaining({ code: "active_scrape", count: 2 }),
    ]);
  });
});
