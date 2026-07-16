import { NextRequest, NextResponse } from "next/server";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(search.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(search.get("limit") ?? "25", 10) || 25));
  const query = (search.get("q") ?? "").trim();
  const status = (search.get("status") ?? "").trim();
  const brandId = Number.parseInt(search.get("brandId") ?? "", 10);
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (query) {
    values.push(`%${query}%`);
    conditions.push(`(pm.shopify_title ILIKE $${values.length} OR pm.shopify_handle ILIKE $${values.length} OR pm.shopify_vendor ILIKE $${values.length} OR EXISTS (
      SELECT 1 FROM product_mapping_styles search_style WHERE search_style.product_mapping_id = pm.id
      AND (search_style.normalized_sku ILIKE $${values.length} OR search_style.repspark_product_number ILIKE $${values.length})
    ))`);
  }
  if (["auto", "manual", "partial", "unmatched", "ignored"].includes(status)) {
    values.push(status);
    conditions.push(`pm.match_status = $${values.length}`);
  }
  if (Number.isSafeInteger(brandId) && brandId > 0) {
    values.push(brandId);
    conditions.push(`pm.brand_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const countResult = await connectorDb().query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM product_mappings pm ${where}`, values);
    const dataValues = [...values, limit, (page - 1) * limit];
    const result = await connectorDb().query(
      `SELECT pm.id, pm.shopify_product_gid, pm.shopify_handle, pm.shopify_vendor,
              pm.shopify_title, pm.brand_id, b.brand_name, pm.match_status, pm.match_source,
              pm.last_synced_at, pm.last_sync_run_id, pm.updated_at,
              COALESCE(styles.styles, '[]'::json) AS styles
         FROM product_mappings pm
         LEFT JOIN brands b ON b.id = pm.brand_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object(
             'id', pms.id, 'normalized_sku', pms.normalized_sku,
             'repspark_product_number', pms.repspark_product_number,
             'match_status', pms.match_status, 'match_source', pms.match_source
           ) ORDER BY pms.normalized_sku) AS styles
           FROM product_mapping_styles pms WHERE pms.product_mapping_id = pm.id
         ) styles ON true
         ${where}
        ORDER BY pm.updated_at DESC, pm.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      dataValues,
    );
    const total = countResult.rows[0]?.total ?? 0;
    return NextResponse.json({ mappings: result.rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error("Unable to list mappings", error);
    return NextResponse.json({ error: "Unable to load mappings" }, { status: 500 });
  }
}
