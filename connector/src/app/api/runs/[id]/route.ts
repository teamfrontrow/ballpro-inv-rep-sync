import { NextResponse } from "next/server";

import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  try {
    const [runResult, itemsResult] = await Promise.all([
      connectorDb().query(
        `SELECT sr.*, sj.status AS job_status, sj.attempts, sj.locked_by, sj.last_error, sj.updated_at AS job_updated_at
           FROM sync_runs sr LEFT JOIN sync_jobs sj ON sj.sync_run_id = sr.id WHERE sr.id = $1`, [id],
      ),
      connectorDb().query(
        `SELECT sri.*, pm.shopify_title, pm.shopify_handle, pm.shopify_vendor, pm.shopify_product_gid
           FROM sync_run_items sri JOIN product_mappings pm ON pm.id = sri.product_mapping_id
          WHERE sri.sync_run_id = $1 ORDER BY sri.id`, [id],
      ),
    ]);
    if (!runResult.rows[0]) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ run: runResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    console.error("Unable to load run", error);
    return NextResponse.json({ error: "Unable to load sync run" }, { status: 500 });
  }
}
