import { NextResponse } from "next/server";

import { CatalogSourceNotReadyError, DEFAULT_BRAND_ALIASES, getCatalogIngestReport, ingestCatalog, readBrandVendorAliases } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getCatalogIngestReport());
  } catch (error) {
    console.error("Unable to report catalog readiness", error);
    return NextResponse.json({ error: "Unable to report catalog readiness" }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Brands-table vendor aliases override the built-in defaults on conflict, so
    // a brand's configured Shopify vendor drives matching.
    const brandAliases = await readBrandVendorAliases();
    const report = await ingestCatalog({ aliases: [...DEFAULT_BRAND_ALIASES, ...brandAliases] });
    return NextResponse.json({ status: "completed", report }, { status: 200 });
  } catch (error) {
    if (error instanceof CatalogSourceNotReadyError) {
      return NextResponse.json(
        { error: error.message, readiness: error.report },
        { status: 409 },
      );
    }
    console.error("Unable to ingest catalog", error);
    return NextResponse.json({ error: "Unable to ingest catalog" }, { status: 500 });
  }
}
