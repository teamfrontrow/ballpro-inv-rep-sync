import { CatalogSourceNotReadyError, DEFAULT_BRAND_ALIASES, ingestCatalog, readBrandVendorAliases } from "../src/lib/catalog";

// Run catalog discovery from a scheduled task (Coolify cron), matching what the
// "Run catalog discovery" button does: read the live Shopify catalog, match it
// to the latest scraped RepSpark data, and rebuild the product mappings. Uses the
// brands table's Shopify-vendor aliases so vendor names that differ from RepSpark
// brand names still match. Runs inline and exits when done, so chaining
// `npm run discover && npm run sync:scheduled` guarantees discovery completes
// before the sync is enqueued.
async function main(): Promise<void> {
  const brandAliases = await readBrandVendorAliases();
  const report = await ingestCatalog({ aliases: [...DEFAULT_BRAND_ALIASES, ...brandAliases] });
  console.log(
    `Catalog discovery complete: ${report.shopifyProductsRead} Shopify products read, ` +
    `${report.productsUpserted} mappings and ${report.stylesUpserted} styles upserted.`,
  );
}

main().catch((error) => {
  if (error instanceof CatalogSourceNotReadyError) {
    // Discovery fails closed while a scrape is active or the source isn't ready.
    // Schedule this to run after the nightly scrape completes.
    console.error(`Catalog discovery skipped — RepSpark source not ready: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
