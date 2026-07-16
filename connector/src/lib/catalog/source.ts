import type { Pool } from "pg";

import { repsparkDb } from "@/lib/db";

import type {
  BrandSourceReadiness,
  RepSparkCatalogPair,
  SourceReadinessIssue,
  SourceReadinessReport,
} from "./types";

interface BrandQualityRow {
  brandName: string;
  latestRunStatus: string | null;
  currentSizeRows: number | string;
  variantRows: number | string;
  nullColorRows: number | string;
  futureDateRows: Array<{ id: number; date: string }> | null;
}

export async function readRepSparkCatalog(db: Pool = repsparkDb()): Promise<RepSparkCatalogPair[]> {
  const result = await db.query<{
    brandName: string;
    brandSlug: string;
    productNumber: string;
  }>(
    `SELECT DISTINCT b.brand_name AS "brandName", b.brand_slug AS "brandSlug",
            p.product_number AS "productNumber"
       FROM brands b
       JOIN products p ON p.brand_id = b.id
      WHERE nullif(trim(b.brand_name), '') IS NOT NULL
        AND nullif(trim(p.product_number), '') IS NOT NULL
      ORDER BY b.brand_name, p.product_number`,
  );
  return result.rows;
}

export async function reportSourceReadiness(db: Pool = repsparkDb()): Promise<SourceReadinessReport> {
  const checkedAt = new Date().toISOString();
  try {
    const [activeJobs, activeBatches, quality] = await Promise.all([
      db.query<{ count: number | string }>(
        `SELECT count(*)::int AS count
           FROM scrape_jobs
          WHERE lower(trim(status)) IN ('pending', 'queued', 'running', 'processing')`,
      ),
      db.query<{ count: number | string }>(
        `SELECT count(*)::int AS count
           FROM scrape_batches
          WHERE lower(trim(status)) IN ('pending', 'queued', 'running', 'processing')
             OR (completed_at IS NULL AND lower(trim(coalesce(status, 'running'))) NOT IN ('failed', 'canceled', 'cancelled'))`,
      ),
      db.query<BrandQualityRow>(
        `SELECT b.brand_name AS "brandName",
                latest.status AS "latestRunStatus",
                count(DISTINCT vs.id)::int AS "currentSizeRows",
                count(DISTINCT pv.id)::int AS "variantRows",
                count(DISTINCT pv.id) FILTER (WHERE nullif(trim(pv.color), '') IS NULL)::int AS "nullColorRows",
                jsonb_agg(DISTINCT jsonb_build_object(
                  'id', vfi.id,
                  'date', trim(vfi.availability_date)
                )) FILTER (
                  WHERE nullif(trim(vfi.availability_date), '') IS NOT NULL
                ) AS "futureDateRows"
           FROM brands b
           LEFT JOIN LATERAL (
             SELECT sr.status
               FROM scrape_runs sr
              WHERE sr.brand_id = b.id
              ORDER BY sr.completed_at DESC NULLS LAST, sr.started_at DESC NULLS LAST, sr.id DESC
              LIMIT 1
           ) latest ON true
           LEFT JOIN products p ON p.brand_id = b.id
           LEFT JOIN product_variants pv ON pv.product_id = p.id
           LEFT JOIN variant_sizes vs ON vs.variant_id = pv.id
           LEFT JOIN variant_future_inventory vfi ON vfi.variant_id = pv.id
          GROUP BY b.id, b.brand_name, latest.status
          ORDER BY b.brand_name`,
      ),
    ]);

    const activeJobCount = Number(activeJobs.rows[0]?.count ?? 0);
    const activeBatchCount = Number(activeBatches.rows[0]?.count ?? 0);
    const globalIssues: SourceReadinessIssue[] = [];
    if (activeJobCount + activeBatchCount > 0) {
      globalIssues.push({
        code: "active_scrape",
        count: activeJobCount + activeBatchCount,
        message: `${activeJobCount} active scrape job(s) and ${activeBatchCount} active batch(es)`,
      });
    }

    const brands = quality.rows.map(toBrandReadiness);
    return {
      ready: globalIssues.length === 0 && brands.length > 0 && brands.every((brand) => brand.ready),
      checkedAt,
      globalIssues,
      brands,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ready: false,
      checkedAt,
      globalIssues: [{ code: "source_schema", message: `Unable to inspect RepSpark source: ${message}` }],
      brands: [],
    };
  }
}

function toBrandReadiness(row: BrandQualityRow): BrandSourceReadiness {
  const latestRunStatus = row.latestRunStatus?.trim() || null;
  const currentSizeRows = Number(row.currentSizeRows);
  const variantRows = Number(row.variantRows);
  const nullColorRows = Number(row.nullColorRows);
  const invalidDateRows = (row.futureDateRows ?? []).filter((row) => !isValidSourceDate(row.date)).length;
  const issues: SourceReadinessIssue[] = [];
  if (latestRunStatus?.toLowerCase() !== "completed") {
    issues.push({
      code: "latest_run_not_completed",
      message: latestRunStatus
        ? `Latest scrape run has status ${latestRunStatus}`
        : "Brand has no completed scrape run",
    });
  }
  if (currentSizeRows === 0) {
    issues.push({ code: "no_current_size_rows", message: "Brand has no current size inventory rows" });
  }
  if (nullColorRows > 0) {
    issues.push({
      code: "null_color_coverage",
      count: nullColorRows,
      message: `${nullColorRows} of ${variantRows} variant row(s) have a blank color`,
    });
  }
  if (invalidDateRows > 0) {
    issues.push({
      code: "invalid_dates",
      count: invalidDateRows,
      message: `${invalidDateRows} future inventory row(s) have an invalid date`,
    });
  }
  return {
    brandName: row.brandName,
    ready: issues.length === 0,
    latestRunStatus,
    currentSizeRows,
    variantRows,
    nullColorRows,
    invalidDateRows,
    issues,
  };
}

export function isValidSourceDate(value: string): boolean {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : us
      ? { year: Number(us[3]), month: Number(us[1]), day: Number(us[2]) }
      : null;
  if (!parts) return false;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCFullYear() === parts.year
    && date.getUTCMonth() === parts.month - 1
    && date.getUTCDate() === parts.day;
}

export function readinessFailureMessage(report: SourceReadinessReport): string {
  return [
    ...report.globalIssues.map((issue) => issue.message),
    ...report.brands.flatMap((brand) => brand.issues.map((issue) => `${brand.brandName}: ${issue.message}`)),
  ].join("; ") || "RepSpark source is not ready";
}
