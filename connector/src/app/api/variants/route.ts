import { NextRequest, NextResponse } from "next/server";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const values: unknown[] = [];
  let where = `WHERE pm.match_status IN ('auto', 'manual', 'partial')
    AND EXISTS (
      SELECT 1 FROM product_mapping_styles eligible
      WHERE eligible.product_mapping_id = pm.id
        AND eligible.match_status IN ('auto', 'manual')
        AND nullif(trim(eligible.repspark_product_number), '') IS NOT NULL
    )`;
  if (query) {
    values.push(`%${query}%`);
    where += ` AND (pm.shopify_title ILIKE $1 OR pm.shopify_handle ILIKE $1
      OR pm.shopify_vendor ILIKE $1 OR pm.shopify_product_gid ILIKE $1
      OR EXISTS (
        SELECT 1 FROM product_mapping_styles searched
        WHERE searched.product_mapping_id = pm.id
          AND searched.repspark_product_number ILIKE $1
      ))`;
  }

  try {
    const result = await connectorDb().query(
      `SELECT pm.id::text, pm.shopify_product_gid, pm.shopify_handle, pm.shopify_title,
              pm.shopify_vendor, b.brand_name,
              COALESCE(array_agg(DISTINCT trim(pms.repspark_product_number)) FILTER (
                WHERE pms.match_status IN ('auto', 'manual')
                  AND nullif(trim(pms.repspark_product_number), '') IS NOT NULL
              ), ARRAY[]::text[]) AS styles
         FROM product_mappings pm
         LEFT JOIN brands b ON b.id = pm.brand_id
         LEFT JOIN product_mapping_styles pms ON pms.product_mapping_id = pm.id
         ${where}
        GROUP BY pm.id, b.brand_name
        ORDER BY pm.shopify_title, pm.id
        LIMIT 50`,
      values,
    );
    return NextResponse.json({ mappings: result.rows });
  } catch (error) {
    console.error("Unable to list variant backfill mappings", error);
    return NextResponse.json({ error: "Unable to load variant backfill mappings" }, { status: 500 });
  }
}

