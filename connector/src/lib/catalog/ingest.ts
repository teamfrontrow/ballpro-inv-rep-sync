import type { Pool } from "pg";

import { connectorDb, repsparkDb, transaction } from "@/lib/db";
import { createShopifyAdminClient, type ShopifyAdminClient } from "@/lib/shopify/client";

import { persistCatalog } from "./persist";
import { reconcileCatalog, DEFAULT_BRAND_ALIASES } from "./reconcile";
import { readinessFailureMessage, readRepSparkCatalog, reportSourceReadiness } from "./source";
import type { BrandAlias, BrandAliasMap, CatalogIngestReport, SourceReadinessReport } from "./types";

// Vendor -> RepSpark-brand aliases taken from the connector's own brands table,
// so discovery can match Shopify products whose vendor differs from the RepSpark
// brand name (e.g. vendor "Swannies Golf" -> brand "Swannies") from editable
// config rather than a hardcoded list.
export async function readBrandVendorAliases(): Promise<BrandAlias[]> {
  const result = await connectorDb().query<{ shopify_vendor: string; brand_name: string }>(
    `SELECT shopify_vendor, brand_name FROM brands
      WHERE nullif(btrim(shopify_vendor), '') IS NOT NULL
        AND nullif(btrim(brand_name), '') IS NOT NULL`,
  );
  return result.rows.map((row) => ({ shopifyVendor: row.shopify_vendor, repsparkBrand: row.brand_name }));
}

export class CatalogSourceNotReadyError extends Error {
  constructor(public readonly report: SourceReadinessReport) {
    super(readinessFailureMessage(report));
    this.name = "CatalogSourceNotReadyError";
  }
}

export interface CatalogIngestDependencies {
  repspark: Pool;
  aliases: BrandAliasMap;
  createShopifyClient: () => Promise<Pick<ShopifyAdminClient, "readProducts">>;
  persist: typeof persistCatalog;
  inTransaction: typeof transaction;
}

function dependencies(overrides: Partial<CatalogIngestDependencies>): CatalogIngestDependencies {
  return {
    repspark: overrides.repspark ?? repsparkDb(),
    aliases: overrides.aliases ?? DEFAULT_BRAND_ALIASES,
    createShopifyClient: overrides.createShopifyClient ?? createShopifyAdminClient,
    persist: overrides.persist ?? persistCatalog,
    inTransaction: overrides.inTransaction ?? transaction,
  };
}

export async function getCatalogIngestReport(
  overrides: Pick<Partial<CatalogIngestDependencies>, "repspark"> = {},
): Promise<{ readiness: SourceReadinessReport }> {
  const deps = dependencies(overrides);
  return { readiness: await reportSourceReadiness(deps.repspark) };
}

export async function ingestCatalog(
  overrides: Partial<CatalogIngestDependencies> = {},
): Promise<CatalogIngestReport> {
  const deps = dependencies(overrides);
  const readiness = await reportSourceReadiness(deps.repspark);
  if (readiness.globalIssues.some((issue) => ["active_scrape", "source_schema"].includes(issue.code))) {
    throw new CatalogSourceNotReadyError(readiness);
  }

  const [shopify, repsparkPairs] = await Promise.all([
    deps.createShopifyClient().then((client) => client.readProducts()),
    readRepSparkCatalog(deps.repspark),
  ]);
  const reconciliation = reconcileCatalog(shopify, repsparkPairs, deps.aliases);
  const counts = await deps.inTransaction((client) => deps.persist(client, reconciliation, repsparkPairs));
  return {
    completedAt: new Date().toISOString(),
    shopifyProductsRead: shopify.length,
    repsparkPairsRead: repsparkPairs.length,
    ...counts,
    metrics: reconciliation.metrics,
    readiness,
  };
}
