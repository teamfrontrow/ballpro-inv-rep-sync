import { NextResponse } from "next/server";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await connectorDb().query<{
      id: string; brand_slug: string; brand_name: string; shopify_vendor: string;
      shopify_vendors: string[];
      enabled: boolean; max_display_cap: number | null; max_source_age_days: number | null;
      show_future_inventory: boolean;
      product_count: number; ready_count: number;
      unmatched_count: number; updated_at: string;
    }>(
      `SELECT b.id, b.brand_slug, b.brand_name, b.shopify_vendor, b.enabled,
              b.max_display_cap, b.max_source_age_days, b.show_future_inventory, b.updated_at,
              COALESCE(aliases.shopify_vendors, ARRAY[b.shopify_vendor]) AS shopify_vendors,
              COALESCE(metrics.product_count, 0)::int AS product_count,
              COALESCE(metrics.ready_count, 0)::int AS ready_count,
              COALESCE(metrics.unmatched_count, 0)::int AS unmatched_count
         FROM brands b
         LEFT JOIN LATERAL (
           SELECT array_agg(a.shopify_vendor ORDER BY
                    CASE WHEN upper(btrim(a.shopify_vendor)) = upper(btrim(b.shopify_vendor)) THEN 0 ELSE 1 END,
                    a.shopify_vendor) AS shopify_vendors
             FROM brand_vendor_aliases a
            WHERE a.brand_id = b.id
         ) aliases ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS product_count,
                  COUNT(*) FILTER (WHERE pm.match_status IN ('auto', 'manual'))::int AS ready_count,
                  COUNT(*) FILTER (WHERE pm.match_status IN ('partial', 'unmatched'))::int AS unmatched_count
             FROM product_mappings pm
            WHERE pm.brand_id = b.id
         ) metrics ON true
        ORDER BY b.brand_name`,
    );
    return NextResponse.json({ brands: result.rows });
  } catch (error) {
    console.error("Unable to list brands", error);
    return NextResponse.json({ error: "Unable to load brands" }, { status: 500 });
  }
}
