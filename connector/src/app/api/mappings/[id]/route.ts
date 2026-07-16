import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transaction } from "@/lib/db";

const styleSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  normalizedSku: z.string().trim().min(1).max(255),
  repsparkProductNumber: z.string().trim().max(255).nullable(),
  matchStatus: z.enum(["auto", "manual", "unmatched", "ignored"]),
  matchSource: z.string().trim().min(1).max(255),
});
const mappingSchema = z.object({
  brandId: z.coerce.number().int().positive().nullable(),
  matchStatus: z.enum(["auto", "manual", "partial", "unmatched", "ignored"]),
  matchSource: z.string().trim().min(1).max(255),
  styles: z.array(styleSchema).max(100),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid mapping ID" }, { status: 400 });
  const parsed = mappingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid mapping" }, { status: 400 });
  const normalized = parsed.data.styles.map((style) => style.normalizedSku.toUpperCase());
  if (new Set(normalized).size !== normalized.length) return NextResponse.json({ error: "Style SKUs must be unique within a product" }, { status: 400 });

  try {
    const mapping = await transaction(async (client) => {
      const updated = await client.query(
        `UPDATE product_mappings SET brand_id = $2, match_status = $3, match_source = $4, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, parsed.data.brandId, parsed.data.matchStatus, parsed.data.matchSource],
      );
      if (!updated.rows[0]) return null;

      const retainedIds: number[] = [];
      for (const style of parsed.data.styles) {
        if (style.id) {
          const styleResult = await client.query<{ id: number }>(
            `UPDATE product_mapping_styles
                SET normalized_sku = $3, repspark_product_number = $4, match_status = $5,
                    match_source = $6, updated_at = now()
              WHERE id = $1 AND product_mapping_id = $2 RETURNING id`,
            [style.id, id, style.normalizedSku, style.repsparkProductNumber || null, style.matchStatus, style.matchSource],
          );
          if (!styleResult.rows[0]) throw new Error(`Style ${style.id} does not belong to this mapping`);
          retainedIds.push(styleResult.rows[0].id);
        } else {
          const styleResult = await client.query<{ id: number }>(
            `INSERT INTO product_mapping_styles
              (product_mapping_id, normalized_sku, repspark_product_number, match_status, match_source)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [id, style.normalizedSku, style.repsparkProductNumber || null, style.matchStatus, style.matchSource],
          );
          retainedIds.push(styleResult.rows[0].id);
        }
      }
      if (retainedIds.length) {
        await client.query("DELETE FROM product_mapping_styles WHERE product_mapping_id = $1 AND NOT (id = ANY($2::bigint[]))", [id, retainedIds]);
      } else {
        await client.query("DELETE FROM product_mapping_styles WHERE product_mapping_id = $1", [id]);
      }
      const styles = await client.query("SELECT * FROM product_mapping_styles WHERE product_mapping_id = $1 ORDER BY normalized_sku", [id]);
      return { ...updated.rows[0], styles: styles.rows };
    });
    if (!mapping) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    return NextResponse.json({ mapping });
  } catch (error) {
    console.error("Unable to reconcile mapping", error);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return NextResponse.json({ error: code === "23505" ? "A style with that SKU already exists for this product" : error instanceof Error ? error.message : "Unable to save mapping" }, { status: code === "23505" ? 409 : 500 });
  }
}
