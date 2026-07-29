import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { transaction } from "@/lib/db";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  maxDisplayCap: z.number().int().min(0).nullable().optional(),
  showFutureInventory: z.boolean().optional(),
  shopifyVendors: z.array(z.string().trim().min(1).max(255)).min(1).max(20).optional(),
}).refine(
  (value) => value.enabled !== undefined || value.maxDisplayCap !== undefined || value.showFutureInventory !== undefined || value.shopifyVendors !== undefined,
  "No changes supplied",
);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid brand ID" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  try {
    const values: unknown[] = [id];
    const assignments: string[] = [];
    if (parsed.data.enabled !== undefined) {
      values.push(parsed.data.enabled);
      assignments.push(`enabled = $${values.length}`);
    }
    if (parsed.data.maxDisplayCap !== undefined) {
      values.push(parsed.data.maxDisplayCap);
      assignments.push(`max_display_cap = $${values.length}`);
    }
    if (parsed.data.showFutureInventory !== undefined) {
      values.push(parsed.data.showFutureInventory);
      assignments.push(`show_future_inventory = $${values.length}`);
    }
    const shopifyVendors = parsed.data.shopifyVendors
      ? [...new Map(parsed.data.shopifyVendors.map((vendor) => [vendor.trim().toUpperCase(), vendor.trim()])).values()]
      : undefined;
    if (shopifyVendors !== undefined) {
      values.push(shopifyVendors[0]);
      assignments.push(`shopify_vendor = $${values.length}`);
    }
    assignments.push("updated_at = now()");
    const brand = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE brands SET ${assignments.join(", ")} WHERE id = $1
         RETURNING id, brand_slug, brand_name, shopify_vendor, enabled, max_display_cap, show_future_inventory, updated_at`,
        values,
      );
      if (!result.rows[0]) return null;
      if (shopifyVendors !== undefined) {
        await client.query("DELETE FROM brand_vendor_aliases WHERE brand_id = $1", [id]);
        for (const vendor of shopifyVendors) {
          await client.query(
            `INSERT INTO brand_vendor_aliases (brand_id, shopify_vendor) VALUES ($1, $2)`,
            [id, vendor],
          );
        }
      }
      const aliases = await client.query<{ shopify_vendor: string }>(
        `SELECT shopify_vendor
           FROM brand_vendor_aliases
          WHERE brand_id = $1
          ORDER BY CASE WHEN upper(btrim(shopify_vendor)) = upper(btrim($2)) THEN 0 ELSE 1 END,
                   shopify_vendor`,
        [id, result.rows[0].shopify_vendor],
      );
      return { ...result.rows[0], shopify_vendors: aliases.rows.map((alias) => alias.shopify_vendor) };
    });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    console.error("Unable to update brand", error);
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A Shopify vendor alias can belong to only one RepSpark brand" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update brand" }, { status: 500 });
  }
}
