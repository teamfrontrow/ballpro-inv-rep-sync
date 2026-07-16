import { NextResponse } from "next/server";

import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { normalizeShopDomain } from "@/lib/shopify/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InstallationMeta {
  granted_scopes: string;
  updated_at: string;
}

export async function GET(): Promise<NextResponse> {
  const config = env();
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(config.SHOPIFY_SHOP_DOMAIN);
  } catch {
    return NextResponse.json({ connected: false, error: "Invalid SHOPIFY_SHOP_DOMAIN" }, { status: 200 });
  }

  const installation = await queryOne<InstallationMeta>(
    "SELECT granted_scopes, updated_at FROM shopify_installations WHERE shop_domain = $1",
    [shopDomain],
  ).catch(() => null);

  const source = installation ? "oauth" : config.SHOPIFY_ADMIN_TOKEN ? "environment" : null;
  if (!source) {
    return NextResponse.json({ connected: false, shopDomain });
  }

  // A stored credential exists; confirm it still works with a cheap live shop query.
  let verified = false;
  let shopName: string | undefined;
  let error: string | undefined;
  try {
    const shop = await (await createShopifyAdminClient()).shopHealth();
    verified = true;
    shopName = shop.name;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return NextResponse.json({
    connected: true,
    verified,
    shopDomain,
    shopName,
    grantedScopes: installation?.granted_scopes,
    source,
    updatedAt: installation?.updated_at,
    error,
  });
}
