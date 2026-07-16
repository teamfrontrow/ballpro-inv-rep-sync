# Required RepSpark Upstream Changes

The 2026-07-15 live assessment found that `variant_sizes` and
`variant_future_inventory` have no row freshness marker. The scraper upserts
observed rows but does not remove quantities that disappear from a later modal
response. Refreshing `products.last_seen_at` or `product_variants.last_seen_at`
therefore does not prove that child inventory is current.

The connector now fails closed until this is corrected in
`teamfrontrow/repspark-scraper`.

## Schema

Add a freshness marker to both child tables. A run ID is stronger than a bare
timestamp because it identifies the snapshot that produced each row:

```sql
ALTER TABLE variant_sizes
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS scrape_run_id integer REFERENCES scrape_runs(id) ON DELETE SET NULL;

ALTER TABLE variant_future_inventory
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS scrape_run_id integer REFERENCES scrape_runs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_sizes_identity
  ON variant_sizes (variant_id, size_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_future_inventory_identity
  ON variant_future_inventory (variant_id, availability_date, size_code);
```

Use a migration appropriate to the RepSpark repository. Review and resolve any
pre-existing duplicate identities before creating the unique indexes.

## Persistence Contract

For each product modal that completes successfully:

1. Start a database transaction.
2. Upsert the variant's observed current and future rows with the current
   `scrape_run_id` and one shared `last_seen_at` value.
3. Delete prior `variant_sizes` rows for that variant whose `scrape_run_id` is
   not the current run.
4. Delete prior `variant_future_inventory` rows for that variant whose
   `scrape_run_id` is not the current run.
5. Commit only after the complete modal snapshot is persisted.

Do not clear a variant when the modal fetch or parse fails. That must fail the
brand run instead of converting unknown inventory into zero inventory.

A full-brand run should also reconcile products/variants not seen in the run,
using an explicit inactive/tombstone policy. Do not infer deletion from an
Excel-only, image-only, retry-missing, canceled, failed, or zero-product run.

## Run Semantics

`scrape_runs.run_mode` currently records `single`, which does not prove whether
modal inventory was collected. Record the effective mode and coverage result,
for example `full`, `data_only`, `images_only`, or `retry_missing`, plus a flag
or count proving all intended modals completed.

The connector should accept freshness only from a completed inventory-bearing
run. Until that metadata is available, deploy only after a deliberate full or
data-only candidate-brand scrape and verify the child timestamps directly.

## Verification

Before the first connector write:

1. Re-scrape one candidate brand with complete modal coverage.
2. Confirm every current and future child row for that brand has a recent
   timestamp and the expected completed run ID.
3. Remove one size/future row in a controlled scraper fixture, rerun, and prove
   the old database row is deleted.
4. Force a modal failure and prove the previous snapshot remains intact while
   the scrape run fails.
5. Run connector catalog readiness and require no `source_freshness`, active
   scrape, blank-color, incomplete-size, or invalid-date issue.
6. Run a brand-scoped connector dry run and require zero skipped and failed
   mappings before allowing a Shopify write.

## Separate Deployment Prerequisites

The RepSpark Compose resource must also attach Postgres to external network
`coolify` with alias `repspark-db`, and the database owner must create the
`ballpro_ro` role described in `connector/deploy/repspark-readonly-role.sql`.
Those changes remain owned by the RepSpark resource.
