import { NextRequest, NextResponse } from "next/server";

import { verifyProduct } from "@/lib/verify/service";

export const dynamic = "force-dynamic";

// GET /api/verify?mappingId=123 — compare a single product's latest RepSpark
// inventory against what is actually stored in its Shopify metafield.
export async function GET(request: NextRequest) {
  const mappingId = Number(request.nextUrl.searchParams.get("mappingId"));
  if (!Number.isSafeInteger(mappingId) || mappingId < 1) {
    return NextResponse.json({ error: "A valid mappingId is required" }, { status: 400 });
  }
  try {
    const result = await verifyProduct(mappingId);
    if (!result) return NextResponse.json({ error: "Product mapping not found" }, { status: 404 });
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Verification failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed" }, { status: 500 });
  }
}
