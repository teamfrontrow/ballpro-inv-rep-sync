import { NextRequest, NextResponse } from "next/server";

import { readScrapeTargets } from "@/lib/targets/service";

export const dynamic = "force-dynamic";

/**
 * The scrape target list, for the RepSpark scraper.
 *
 * Authentication comes from the Basic-auth middleware that covers every route
 * but `/api/health` and the Shopify callback, so the scraper authenticates with
 * the same ADMIN_USERNAME / ADMIN_PASSWORD as a browser.
 */
export async function GET(request: NextRequest) {
  const brand = request.nextUrl.searchParams.get("brand")?.trim() || null;
  try {
    return NextResponse.json(await readScrapeTargets(brand), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to read scrape targets", error);
    return NextResponse.json({ error: "Unable to read scrape targets" }, { status: 500 });
  }
}
