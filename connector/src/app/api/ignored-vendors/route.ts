import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  vendor: z.string().trim().min(1, "Vendor is required").max(255),
  note: z.string().trim().max(500).optional(),
});

// List ignored vendors, each with how many Shopify product mappings it covers.
export async function GET() {
  try {
    const result = await connectorDb().query(
      `SELECT iv.shopify_vendor, iv.note, iv.created_at,
              COUNT(pm.id)::int AS product_count
         FROM ignored_vendors iv
         LEFT JOIN product_mappings pm ON pm.shopify_vendor = iv.shopify_vendor
        GROUP BY iv.shopify_vendor, iv.note, iv.created_at
        ORDER BY iv.shopify_vendor`,
    );
    return NextResponse.json({ vendors: result.rows });
  } catch (error) {
    console.error("Unable to list ignored vendors", error);
    return NextResponse.json({ error: "Unable to load ignored vendors" }, { status: 500 });
  }
}

// Add a vendor to the ignore list (idempotent).
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await connectorDb().query(
      `INSERT INTO ignored_vendors (shopify_vendor, note) VALUES ($1, $2)
       ON CONFLICT (shopify_vendor) DO UPDATE SET note = EXCLUDED.note`,
      [parsed.data.vendor, parsed.data.note ?? null],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to add ignored vendor", error);
    return NextResponse.json({ error: "Unable to add ignored vendor" }, { status: 500 });
  }
}

// Remove a vendor from the ignore list.
export async function DELETE(request: NextRequest) {
  const parsed = bodySchema.pick({ vendor: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await connectorDb().query("DELETE FROM ignored_vendors WHERE shopify_vendor = $1", [parsed.data.vendor]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to remove ignored vendor", error);
    return NextResponse.json({ error: "Unable to remove ignored vendor" }, { status: 500 });
  }
}
