import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connectorDb } from "@/lib/db";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  maxDisplayCap: z.number().int().min(0).nullable().optional(),
  showFutureInventory: z.boolean().optional(),
  shopifyVendor: z.string().trim().min(1).max(255).optional(),
}).refine(
  (value) => value.enabled !== undefined || value.maxDisplayCap !== undefined || value.showFutureInventory !== undefined || value.shopifyVendor !== undefined,
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
    if (parsed.data.shopifyVendor !== undefined) {
      values.push(parsed.data.shopifyVendor);
      assignments.push(`shopify_vendor = $${values.length}`);
    }
    assignments.push("updated_at = now()");
    const result = await connectorDb().query(
      `UPDATE brands SET ${assignments.join(", ")} WHERE id = $1
       RETURNING id, brand_slug, brand_name, shopify_vendor, enabled, max_display_cap, show_future_inventory, updated_at`,
      values,
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    return NextResponse.json({ brand: result.rows[0] });
  } catch (error) {
    console.error("Unable to update brand", error);
    return NextResponse.json({ error: "Unable to update brand" }, { status: 500 });
  }
}
