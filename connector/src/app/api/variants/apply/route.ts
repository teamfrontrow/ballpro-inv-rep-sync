import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createVariantBackfillService, VariantBackfillError } from "@/lib/variants";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  productGid: z.string().trim().regex(/^gid:\/\/shopify\/Product\/\d+$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
  confirmed: z.literal(true),
}).strict();

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Exact signed preview and explicit confirmation are required" }, { status: 400 });
  try {
    const service = await createVariantBackfillService();
    return NextResponse.json(await service.apply(parsed.data.productGid, parsed.data.signature));
  } catch (error) {
    if (error instanceof VariantBackfillError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to apply variant backfill", error);
    return NextResponse.json({ error: "Unable to apply variant backfill" }, { status: 500 });
  }
}

