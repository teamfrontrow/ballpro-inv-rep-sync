import { NextResponse } from "next/server";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await connectorDb().query<{
      id: string; brand_slug: string; brand_name: string; shopify_vendor: string;
      enabled: boolean; max_display_cap: number | null; show_future_inventory: boolean;
      product_count: number; ready_count: number;
      unmatched_count: number; updated_at: string;
    }>(
      `SELECT b.id, b.brand_slug, b.brand_name, b.shopify_vendor, b.enabled,
              b.max_display_cap, b.show_future_inventory, b.updated_at,
              COUNT(pm.id)::int AS product_count,
              COUNT(pm.id) FILTER (WHERE pm.match_status IN ('auto', 'manual'))::int AS ready_count,
              COUNT(pm.id) FILTER (WHERE pm.match_status IN ('partial', 'unmatched'))::int AS unmatched_count
         FROM brands b
         LEFT JOIN product_mappings pm ON pm.brand_id = b.id
        GROUP BY b.id
        ORDER BY b.brand_name`,
    );
    return NextResponse.json({ brands: result.rows });
  } catch (error) {
    console.error("Unable to list brands", error);
    return NextResponse.json({ error: "Unable to load brands" }, { status: 500 });
  }
}
