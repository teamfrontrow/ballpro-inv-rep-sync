import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { readScrapeTargets } from "./service";

describe("readScrapeTargets", () => {
  it("groups style numbers by brand slug", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { brandSlug: "anderson-ord", productNumber: "12005501" },
      { brandSlug: "anderson-ord", productNumber: "49057501" },
      { brandSlug: "holderness-bourne", productNumber: "HB3109" },
    ] });

    const result = await readScrapeTargets(null, { query } as unknown as Pool);

    expect(result.brands).toEqual({
      "anderson-ord": ["12005501", "49057501"],
      "holderness-bourne": ["HB3109"],
    });
  });

  it("falls back to the normalized Shopify SKU when a style has no RepSpark number yet", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await readScrapeTargets(null, { query } as unknown as Pool);

    // Without this fallback a newly added variant could never be scraped, so it
    // could never be matched, so it would never gain the product number that
    // would have made it a target.
    const [sql] = query.mock.calls[0];
    expect(sql).toContain("coalesce(nullif(trim(pms.repspark_product_number), ''), pms.normalized_sku)");
  });

  it("excludes ignored vendors, mappings and styles", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await readScrapeTargets(null, { query } as unknown as Pool);

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("iv.shopify_vendor IS NULL");
    expect(sql).toContain("pm.match_status <> 'ignored'");
    expect(sql).toContain("pms.match_status <> 'ignored'");
  });

  it("passes the brand filter as a parameter, and null when unfiltered", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as Pool;

    await readScrapeTargets("anderson-ord", db);
    expect(query.mock.calls[0][1]).toEqual(["anderson-ord"]);

    await readScrapeTargets(null, db);
    expect(query.mock.calls[1][1]).toEqual([null]);
  });

  it("returns an empty brand map rather than throwing when nothing is mapped", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const result = await readScrapeTargets(null, { query } as unknown as Pool);

    expect(result.brands).toEqual({});
    expect(result.generatedAt).toEqual(expect.any(String));
  });
});
