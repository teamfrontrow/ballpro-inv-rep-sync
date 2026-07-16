import { ingestCatalog } from "../src/lib/catalog";

ingestCatalog()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
