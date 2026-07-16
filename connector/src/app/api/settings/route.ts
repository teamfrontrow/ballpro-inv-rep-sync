import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  defaultCap: z.number().int().min(0).nullable(),
  futureHorizonDays: z.number().int().min(0).max(3650),
  shopifyApiVersion: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a Shopify version such as 2026-07"),
});

export async function GET() {
  try {
    const result = await connectorDb().query("SELECT default_cap, future_horizon_days, shopify_api_version, updated_at FROM app_settings WHERE singleton = true");
    if (!result.rows[0]) return NextResponse.json({ error: "Settings are not initialized" }, { status: 404 });
    return NextResponse.json({ settings: result.rows[0] });
  } catch (error) {
    console.error("Unable to load settings", error);
    return NextResponse.json({ error: "Unable to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  try {
    const result = await connectorDb().query(
      `UPDATE app_settings SET default_cap = $1, future_horizon_days = $2,
              shopify_api_version = $3, updated_at = now()
        WHERE singleton = true
        RETURNING default_cap, future_horizon_days, shopify_api_version, updated_at`,
      [parsed.data.defaultCap, parsed.data.futureHorizonDays, parsed.data.shopifyApiVersion],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Settings are not initialized" }, { status: 404 });
    return NextResponse.json({ settings: result.rows[0] });
  } catch (error) {
    console.error("Unable to save settings", error);
    return NextResponse.json({ error: "Unable to save settings" }, { status: 500 });
  }
}
