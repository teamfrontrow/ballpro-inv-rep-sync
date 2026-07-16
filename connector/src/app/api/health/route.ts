import { connectorDb, repsparkDb } from "@/lib/db";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function probe(name: string, operation: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    await operation();
    return { name, ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const checks = await Promise.all([
    probe("connector_db", () => connectorDb().query("SELECT 1")),
    probe("repspark_db", () => repsparkDb().query("SELECT 1")),
    probe("shopify", async () => (await createShopifyAdminClient()).shopHealth()),
  ]);
  const ok = checks.filter((check) => check.name !== "shopify").every((check) => check.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
