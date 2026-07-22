import { NextRequest, NextResponse } from "next/server";

import { repsparkDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// List the RepSpark styles (product numbers) for a brand, each with the colors
// and sizes it carries, so the Mappings editor can offer them as a pick-list
// instead of blind manual entry. Read-only against the RepSpark database.
export async function GET(request: NextRequest) {
  const brand = (request.nextUrl.searchParams.get("brand") ?? "").trim();
  const rawQuery = (request.nextUrl.searchParams.get("query") ?? "").trim();
  if (!brand) return NextResponse.json({ error: "A brand is required" }, { status: 400 });
  const like = rawQuery ? `%${rawQuery}%` : null;

  try {
    const result = await repsparkDb().query(
      `SELECT upper(trim(p.product_number)) AS product_number,
              max(p.product_name) AS product_name,
              coalesce(array_agg(DISTINCT pv.color)
                       FILTER (WHERE pv.color IS NOT NULL AND btrim(pv.color) <> ''), '{}') AS colors,
              count(DISTINCT vs.id)::int AS size_count,
              coalesce(sum(CASE WHEN vs.ats_now > 0 THEN 1 ELSE 0 END), 0)::int AS in_stock_sizes
         FROM brands b
         JOIN products p ON p.brand_id = b.id
         LEFT JOIN product_variants pv ON pv.product_id = p.id
         LEFT JOIN variant_sizes vs ON vs.variant_id = pv.id
        WHERE upper(trim(b.brand_name)) = upper(trim($1))
          AND p.product_number IS NOT NULL AND btrim(p.product_number) <> ''
          AND ($2::text IS NULL OR p.product_number ILIKE $2 OR p.product_name ILIKE $2)
        GROUP BY upper(trim(p.product_number))
        ORDER BY product_number
        LIMIT 100`,
      [brand, like],
    );
    return NextResponse.json({ styles: result.rows });
  } catch (error) {
    console.error("Unable to list RepSpark styles", error);
    return NextResponse.json({ error: "Unable to read RepSpark styles for this brand" }, { status: 500 });
  }
}
