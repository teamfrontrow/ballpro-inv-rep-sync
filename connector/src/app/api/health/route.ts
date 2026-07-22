import { connectorDb, repsparkDb } from "@/lib/db";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 5_000;

// A stale pooled connection to a restarted dependency can hang far longer than
// the pool's connect timeout, so bound each probe: report it failed rather than
// letting the whole endpoint hang.
function withTimeout<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`probe timed out after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS)),
  ]);
}

async function probe(name: string, operation: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    await withTimeout(operation);
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
