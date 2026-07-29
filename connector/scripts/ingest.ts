import { DEFAULT_BRAND_ALIASES, ingestCatalog, readBrandVendorAliases } from "../src/lib/catalog";

readBrandVendorAliases()
  .then((brandAliases) => ingestCatalog({ aliases: [...DEFAULT_BRAND_ALIASES, ...brandAliases] }))
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
