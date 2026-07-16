import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createVariantBackfillService, VariantBackfillError } from "@/lib/variants";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  productGid: z.string().trim().regex(/^gid:\/\/shopify\/Product\/\d+$/),
}).strict();

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid Shopify product GID is required" }, { status: 400 });
  try {
    const service = await createVariantBackfillService();
    return NextResponse.json({ preview: await service.preview(parsed.data.productGid) });
  } catch (error) {
    if (error instanceof VariantBackfillError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to preview variant backfill", error);
    return NextResponse.json({ error: "Unable to preview variant backfill" }, { status: 500 });
  }
}

