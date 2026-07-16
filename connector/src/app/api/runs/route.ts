import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connectorDb } from "@/lib/db";
import { enqueueSync } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  dryRun: z.boolean().default(false),
  brandIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  productGids: z.array(z.string().trim().min(1)).max(100).optional(),
}).refine((value) => !(value.brandIds?.length && value.productGids?.length), "Select brands or products, not both");

export async function GET(request: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));
  try {
    const result = await connectorDb().query(
      `SELECT sr.*, sj.status AS job_status, sj.attempts, sj.last_error
         FROM sync_runs sr LEFT JOIN sync_jobs sj ON sj.sync_run_id = sr.id
        ORDER BY sr.requested_at DESC, sr.id DESC LIMIT $1`,
      [limit],
    );
    return NextResponse.json({ runs: result.rows });
  } catch (error) {
    console.error("Unable to list runs", error);
    return NextResponse.json({ error: "Unable to load sync runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid sync request" }, { status: 400 });
  const brandIds = parsed.data.brandIds?.length ? [...new Set(parsed.data.brandIds)] : undefined;
  const productGids = parsed.data.productGids?.length ? [...new Set(parsed.data.productGids)] : undefined;
  const kind = productGids ? "manual_single" as const : "one_time" as const;
  try {
    const runId = await enqueueSync({ kind, dryRun: parsed.data.dryRun, brandIds, productGids }, "control-plane");
    return NextResponse.json({ runId, status: "queued" }, { status: 202 });
  } catch (error) {
    console.error("Unable to enqueue sync", error);
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return NextResponse.json({ error: code === "23505" ? "A sync is already queued or running" : "Unable to enqueue sync" }, { status: code === "23505" ? 409 : 500 });
  }
}
