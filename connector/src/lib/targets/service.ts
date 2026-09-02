import type { Pool } from "pg";

import { connectorDb } from "@/lib/db";

export interface ScrapeTargets {
  generatedAt: string;
  brands: Record<string, string[]>;
}

// Both the SELECT list and the WHERE clause need this expression, and they must
// not drift apart, so it is written once.
const STYLE = `coalesce(nullif(trim(pms.repspark_product_number), ''), pms.normalized_sku)`;

/**
 * The style numbers the scraper must keep fresh, derived from the connector's
 * live Shopify sync.
 *
 * This exists to replace the RepSpark database's `shopify_targets`, which was
 * rebuilt from a hand-uploaded CSV export and so went stale the moment a variant
 * was added in Shopify. The scraper has no Shopify credentials; the connector
 * does. A style absent from the target list is never re-scraped, so its
 * `last_seen_at` freezes and the sync fails its whole product as `source_stale`
 * — a state that re-running the scrape cannot clear.
 *
 * `normalized_sku` (the Shopify SKU minus its `A-` prefix) backs up a style with
 * no `repspark_product_number` yet. Without that fallback a brand-new variant
 * could never be scraped, so it could never be matched, so it would never gain
 * the product number that would have made it a target.
 *
 * Brand `enabled` is deliberately not a filter here: it means "do not sync right
 * now", not "never scrape", and the scraper keeps its own per-brand enable flag.
 * `ignored` at vendor, mapping or style level does mean never, so it is excluded.
 */
export async function readScrapeTargets(
  brandSlug: string | null = null,
  db: Pool = connectorDb(),
): Promise<ScrapeTargets> {
  const result = await db.query<{ brandSlug: string; productNumber: string }>(
    `SELECT DISTINCT b.brand_slug AS "brandSlug",
            upper(trim(${STYLE})) AS "productNumber"
       FROM product_mapping_styles pms
       JOIN product_mappings pm ON pm.id = pms.product_mapping_id
       JOIN brands b ON b.id = pm.brand_id
       LEFT JOIN ignored_vendors iv ON iv.shopify_vendor = pm.shopify_vendor
      WHERE iv.shopify_vendor IS NULL
        -- Deleted in Shopify. Scraping a style only this product needed keeps a
        -- style alive in the scrape purely to serve a product that no longer
        -- exists.
        AND pm.shopify_absent_since IS NULL
        AND pm.match_status <> 'ignored'
        AND pms.match_status <> 'ignored'
        AND nullif(trim(b.brand_slug), '') IS NOT NULL
        AND nullif(trim(${STYLE}), '') IS NOT NULL
        AND ($1::text IS NULL OR b.brand_slug = $1::text)
      ORDER BY 1, 2`,
    [brandSlug],
  );
  const brands: Record<string, string[]> = {};
  for (const row of result.rows) (brands[row.brandSlug] ??= []).push(row.productNumber);
  return { generatedAt: new Date().toISOString(), brands };
}
