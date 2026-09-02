-- When the catalog crawl last failed to find this mapping's product in Shopify.
--
-- The crawl reads every product in the store, so a mapping whose GID is absent
-- from it is a product that has been deleted. Until now nothing recorded that:
-- persistCatalog only ever upserted, so mappings accumulated forever, kept
-- supplying scrape targets, and kept being synced -- writing metafields to
-- product ids Shopify answers with "Owner does not exist".
--
-- Marked rather than deleted, for two reasons. sync_run_items references
-- product_mappings ON DELETE CASCADE, so removing a mapping would retroactively
-- erase what past runs did to that product. And a product deleted in Shopify is
-- often recreated -- with a new id, which arrives as a new mapping -- so keeping
-- the old row costs nothing and preserves the trail.
--
-- NULL means "present in the most recent crawl", which is the normal state and
-- what every existing row is by definition until the next crawl says otherwise.
ALTER TABLE product_mappings
  ADD COLUMN IF NOT EXISTS shopify_absent_since TIMESTAMPTZ;

-- The sync and the scrape-target query both filter on this, and both run over
-- the whole table.
CREATE INDEX IF NOT EXISTS product_mappings_absent_idx
  ON product_mappings (shopify_absent_since)
  WHERE shopify_absent_since IS NOT NULL;
