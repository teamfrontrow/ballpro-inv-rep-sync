import { connectorDb, repsparkDb } from "@/lib/db";
import type { InventoryPayload } from "@/lib/domain";
import type { RepSparkStyleKey } from "@/lib/repspark/inventory";
import { fetchRepSparkInventory } from "@/lib/repspark/inventory";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { buildInventoryPayload, payloadBusinessHash } from "@/lib/sync/payload";

export type VerifyVerdict =
  | "in_sync"             // RepSpark-derived payload matches the live Shopify metafield
  | "out_of_date"         // they differ — a sync would change Shopify
  | "missing_in_shopify"  // RepSpark has data but the product has no metafield yet
  | "tombstoned"          // Shopify holds an "unavailable" tombstone
  | "no_source_data";     // no publishable RepSpark data for this product

// A tombstone is the sentinel the connector writes when a product goes out of
// scope; it is not a real inventory payload.
function isTombstone(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { status?: unknown }).status === "unavailable";
}

/** Pure verdict: compare the expected (RepSpark-derived) payload to whatever is
 *  actually stored in the Shopify metafield. Exported for unit testing. */
export function inventoryVerdict(expected: InventoryPayload | null, actual: unknown): VerifyVerdict {
  if (isTombstone(actual)) return "tombstoned";
  if (!expected) return actual ? "out_of_date" : "no_source_data";
  if (!actual) return "missing_in_shopify";
  return payloadBusinessHash(expected) === payloadBusinessHash(actual as InventoryPayload) ? "in_sync" : "out_of_date";
}

export interface VerifyResult {
  product: {
    mappingId: number;
    shopifyProductGid: string;
    shopifyTitle: string;
    shopifyHandle: string;
    shopifyVendor: string;
    brandName: string | null;
    brandEnabled: boolean;
    lastSyncedAt: string | null;
  };
  styles: string[];
  cap: number | null;
  verdict: VerifyVerdict;
  expected: InventoryPayload | null;
  actual: InventoryPayload | null;
  actualUpdatedAt: string | null;
  sourceIssues: string[];
}

interface MappingRow {
  id: number | string;
  shopify_product_gid: string;
  shopify_title: string;
  shopify_handle: string;
  shopify_vendor: string;
  last_synced_at: Date | string | null;
  brand_name: string | null;
  brand_enabled: boolean | null;
  max_display_cap: number | null;
  show_future_inventory: boolean | null;
  default_cap: number | null;
  future_horizon_days: number;
  styles: string[] | null;
}

export async function verifyProduct(mappingId: number): Promise<VerifyResult | null> {
  const result = await connectorDb().query<MappingRow>(
    `SELECT pm.id, pm.shopify_product_gid, pm.shopify_title, pm.shopify_handle, pm.shopify_vendor,
            pm.last_synced_at, b.brand_name, b.enabled AS brand_enabled,
            b.max_display_cap, COALESCE(b.show_future_inventory, true) AS show_future_inventory,
            settings.default_cap, settings.future_horizon_days,
            COALESCE(styleagg.styles, '[]'::json) AS styles
       FROM product_mappings pm
       LEFT JOIN brands b ON b.id = pm.brand_id
       CROSS JOIN app_settings settings
       LEFT JOIN LATERAL (
         SELECT json_agg(pms.repspark_product_number) AS styles
         FROM product_mapping_styles pms
         WHERE pms.product_mapping_id = pm.id
           AND pms.match_status IN ('auto', 'manual')
           AND pms.repspark_product_number IS NOT NULL
           AND trim(pms.repspark_product_number) <> ''
       ) styleagg ON true
      WHERE pm.id = $1`,
    [mappingId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const cap = row.max_display_cap ?? row.default_cap;
  const styleNumbers = (row.styles ?? []).map((value) => String(value).trim()).filter(Boolean);

  // Build the expected payload from the LATEST scraped data (assertReady=false so
  // this works mid-scrape), with a relaxed freshness window: this view exists to
  // show current numbers, not to gate a write.
  let expected: InventoryPayload | null = null;
  const sourceIssues: string[] = [];
  if (row.brand_name && styleNumbers.length) {
    const styleKeys: RepSparkStyleKey[] = styleNumbers.map((productNumber) => ({ brandName: row.brand_name!, productNumber }));
    const inventory = await fetchRepSparkInventory(styleKeys, repsparkDb(), { assertReady: false });
    const built = buildInventoryPayload({
      brand: row.brand_name,
      styles: styleKeys,
      current: inventory.current,
      future: inventory.future,
      cap,
      horizonDays: row.future_horizon_days,
      showFutureInventory: row.show_future_inventory ?? true,
      maxSourceAgeDays: 36_500,
    });
    expected = built.payload;
    for (const issue of built.issues) sourceIssues.push(`${issue.code}: ${issue.detail}`);
  }

  // Read the live Shopify metafield value.
  let actual: InventoryPayload | null = null;
  let actualUpdatedAt: string | null = null;
  let actualParsed: unknown = null;
  const client = await createShopifyAdminClient();
  const metafields = await client.readInventoryMetafields([row.shopify_product_gid]);
  const live = metafields.get(row.shopify_product_gid) ?? null;
  if (live) {
    actualUpdatedAt = live.updatedAt;
    try {
      actualParsed = JSON.parse(live.value);
      if (!isTombstone(actualParsed)) actual = actualParsed as InventoryPayload;
    } catch {
      sourceIssues.push("Shopify metafield value is not valid JSON");
    }
  }

  return {
    product: {
      mappingId: Number(row.id),
      shopifyProductGid: row.shopify_product_gid,
      shopifyTitle: row.shopify_title,
      shopifyHandle: row.shopify_handle,
      shopifyVendor: row.shopify_vendor,
      brandName: row.brand_name,
      brandEnabled: !!row.brand_enabled,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    },
    styles: styleNumbers,
    cap,
    verdict: inventoryVerdict(expected, actualParsed),
    expected,
    actual,
    actualUpdatedAt,
    sourceIssues,
  };
}
