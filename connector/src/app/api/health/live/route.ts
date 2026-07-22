import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness probe for the container healthcheck. Deliberately checks nothing
// external: it returns 200 whenever the web server can serve a request, so a
// slow or restarted RepSpark/Shopify dependency never marks the container
// unhealthy and takes the whole UI offline. Dependency status lives in
// /api/health (used by the readiness dashboard), not here.
export function GET() {
  return NextResponse.json({ ok: true });
}
