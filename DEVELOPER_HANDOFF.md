# Developer Handoff

Updated: 2026-07-15

Repository: https://github.com/teamfrontrow-james/ballpro-inv-rep-sync

## Executive Status

The implementation is **code-complete and locally verified**, but it is **not yet accepted against the live RepSpark database or a Shopify store**.

The connector, worker, database schema, management UI, Shopify OAuth flow, synchronization pipeline, guarded variant backfill, and storefront theme integration are implemented. The remaining work is deployment configuration and a controlled end-to-end pilot on `ballproplusdev.myshopify.com`.

Do not treat this as production-approved yet. No writes should be made to `ballpro.com` until the development-store gates pass.

## Status At A Glance

| Area | Status | Notes |
| --- | --- | --- |
| Connector web app and API | Complete | Next.js 15, React 19, TypeScript |
| Connector Postgres schema | Complete | Checksum migrations and persistent settings |
| RepSpark database integration | Implemented, live validation pending | Must receive a read-only production-compatible URL |
| Shopify authentication | Complete, installation pending | Custom-distribution app plus one-time OAuth install and encrypted offline token |
| Catalog reconciliation | Complete | Vendor aliases, multi-style mappings, manual override, ignore flow |
| Inventory transformation | Complete | Current and future quantities, caps, canonical hashes, horizon filtering |
| Shopify metafield writes | Complete | API `2026-07`, compare-digest control, retries, batching, isolation |
| Durable worker and scheduling | Complete | Queue, leases, heartbeats, bounded recovery; unattended run pending |
| Variant backfill | Complete and hard-gated | Additive only, signed preview, blank SKUs, untracked inventory |
| Theme integration | Complete | Local/MCP validation passed; real product-page preview pending |
| Production rollout | Not started | Development-store acceptance must happen first |

## What The System Does

RepSpark remains the inventory source of truth. The connector reads its Postgres database and matches styles to Shopify products. It writes a product-level JSON metafield named `custom.inventory_by_date`, which the theme renders as an inventory-by-date accordion.

It does **not** update Shopify inventory levels, locations, fulfillment, or checkout availability.

The second workflow can add missing Color and Size combinations as Shopify variants for catalog display. That workflow is intentionally separate from inventory sync and requires an exact per-product preview and explicit confirmation.

## Deployment Boundaries

### `connector/`

One Coolify Docker Compose resource containing:

- `connector-web`: authenticated GUI, API, health route, and OAuth callback.
- `connector-worker`: private durable sync worker.
- `connector-db`: dedicated Postgres database and persistent volume.

The connector reads the existing RepSpark Postgres through a separate `SELECT`-only connection.

### `shopify-theme/`

An independently previewed and deployed Shopify theme artifact. It reads the synchronized metafield and has no runtime connection to the connector or RepSpark.

### `reference-data/`

Read-only Shopify CSV and RepSpark XLSX snapshots used during discovery and reconciliation. They are not runtime dependencies.

## Shopify Authentication Decision

The inventory connector uses a Partner-owned **custom-distribution app** in Shopify's Dev Dashboard:

1. Release an app version with `read_products,write_products`.
2. Restrict custom distribution to the Ball Pro store.
3. Configure the connector URL and `/api/shopify/callback` redirect.
4. Install once through the connector Settings page.
5. Persist the resulting offline token encrypted in connector Postgres.

The client-credentials grant is not the connector's auth path because the Partner organization does not own the client store. Collaborator permissions alone do not change that ownership restriction.

The copied theme contains an unrelated legacy `webhooks/registerCustomer.php` integration that references client credentials from an external config file. That is not part of this inventory connector and should not be used as the connector auth model.

## RepSpark Data Contract

The implementation was built against the scraper's actual Postgres relationships:

```text
brands
  -> products
    -> product_variants       # color level
      -> variant_sizes        # size_code + ats_now
      -> variant_future_inventory
```

Important details:

- Identity is brand plus `product_number`; RepSpark does not provide a Shopify SKU.
- Current availability comes from `variant_sizes.ats_now`.
- Future availability comes from `variant_future_inventory`.
- Future dates are stored as text and validated before use.
- Source readiness checks active scrape jobs and the latest brand scrape run.
- Current and future rows are queried independently to avoid row multiplication.
- Inventory rows with missing timestamps or timestamps older than two days are rejected as stale.

## Matching Contract

The initial automatic match is based on:

```text
Shopify Vendor ~= RepSpark brand name
normalize(Shopify variant SKU) == RepSpark product_number
```

Normalization trims, uppercases, and removes the Shopify `A-` prefix. Vendor aliases cover known naming differences. One Shopify product can map to multiple RepSpark styles, and partial matches must be reviewed rather than silently collapsed.

New backfilled variants intentionally have blank SKUs. Generating synthetic SKUs would contaminate later style discovery because Shopify SKU is part of the reconciliation input.

## Safety Properties Already Implemented

- Shopify API is pinned to `2026-07` and the response version is asserted.
- OAuth validates state, timestamp, Shopify HMAC, and the configured shop domain.
- Offline access tokens are encrypted with AES-256-GCM before storage.
- Connector operations require HTTP Basic authentication; only health and OAuth callback are public.
- Metafield writes fresh-read `compareDigest` and retry conflicts.
- Metafield mutations are limited to 25 inputs and subdivided for per-product failure attribution.
- Payload hashes exclude `synced_at`, so unchanged source data is a true no-op.
- A previously synchronized mapping that becomes disabled or loses all approved styles currently deletes `custom.inventory_by_date` from the product.
- RepSpark access is designed for a read-only database role.
- The queue permits one active sync, uses leases and heartbeats, and fails after three expired attempts.
- Variant writes are additive only and never delete or reorder options, variants, or media.
- Variant previews are signed and rebuilt server-side before apply.
- Variant mutation inputs are chunked to Shopify's 250-item input limit.
- The 2,048 variants-per-product ceiling is checked before writing.

## Verification Completed

- ESLint passes.
- TypeScript passes.
- 50 Vitest tests pass across 11 files.
- Next.js optimized production build passes.
- `npm audit --omit=dev` reports zero vulnerabilities.
- Fresh migration and repeat migration behavior was tested against Postgres.
- Repeat migrations preserve GUI-edited settings.
- HTTP smoke tests verified public health, `401` on protected routes, and authenticated access.
- Shopify Dev MCP validated the generated Admin GraphQL operations against `2026-07`.
- Shopify Dev MCP validated the inventory theme integration files.

The full copied theme has 27 pre-existing Theme Check offenses in unrelated files. The inventory integration introduced no new Theme Check offenses.

## What Has Not Been Verified Yet

- OAuth installation against the real Ball Pro development store.
- A connector query against the deployed RepSpark database and its production role/network path.
- Match metrics against a fresh scrape rather than the supplied snapshots.
- A real dry run using the development store and RepSpark source together.
- A real metafield write followed by an unchanged second run.
- A variant backfill on a real development-store product.
- Product media behavior after adding variants.
- Storefront rendering against real synchronized metafield data.
- An unattended Coolify scheduled run and worker recovery behavior in deployment.
- Production configuration or production writes.

## Recommended Review Starting Points

Read these in order:

1. `README.md` - system overview and operator flow.
2. `IMPLEMENTATION_STATUS.md` - acceptance gates.
3. `BALLPRO_INVENTORY_PLAN.md` - design decisions and data contract.
4. `connector/src/lib/sync/engine.ts` - sync orchestration and persistence.
5. `connector/src/lib/repspark/inventory.ts` - source schema discovery, readiness, and queries.
6. `connector/src/lib/shopify/client.ts` - GraphQL operations, throttling, metafields, and variants.
7. `connector/src/lib/catalog/` - discovery, reconciliation, and persistence.
8. `connector/src/lib/variants/service.ts` - signed preview and additive backfill gate.
9. `connector/src/lib/jobs/queue.ts` - worker leasing and recovery.
10. `shopify-theme/snippets/product-inventory-table.liquid` - storefront rendering.

## Local Review

```sh
git clone https://github.com/teamfrontrow-james/ballpro-inv-rep-sync.git
cd ballpro-inv-rep-sync/connector
npm ci
npm run verify
```

To run the complete Compose stack, create `connector/.env` from `.env.example`, fill in the required values, then run:

```sh
docker compose up --build
```

The app is available on `http://localhost:3000`; `/api/health` is public and the remaining interface uses the configured Basic credentials.

## Secrets And Access Needed

Share these through the team's approved secret manager, never Slack, email, or Git:

- Shopify Dev Dashboard app access or the finalized client ID and client secret.
- Permission to install the custom-distribution app on `ballproplusdev.myshopify.com`.
- Deployed connector HTTPS hostname.
- `TOKEN_ENCRYPTION_KEY` generated with `openssl rand -hex 32`.
- Read-only RepSpark Postgres URL and network access from Coolify.
- Connector `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Connector Postgres `POSTGRES_PASSWORD`.
- Coolify project access.
- Shopify CLI/theme access to the development store.

## Proposed First Joint Deployment Session

1. Review the source queries and Shopify write paths together.
2. Create/version the custom-distribution app with only `read_products,write_products`.
3. Deploy the Compose resource to Coolify with a new connector database.
4. Verify `/api/health` sees both databases while Shopify is still uninstalled.
5. Complete the one-time Shopify install and verify the expected shop identity.
6. Run catalog discovery immediately after a completed RepSpark scrape.
7. Review match metrics and choose one fully ready pilot brand.
8. Set a conservative cap and run a dry sync.
9. Inspect the payload and run the first write.
10. Verify the metafield in Shopify Admin, rerun, and require `unchanged`.
11. Preview the theme and inspect current, future, capped, empty, and missing-metafield states.
12. Test one signed variant preview and addition on a disposable development product.
13. Enable the scheduled task only after those checks pass.

## Decisions Still Open

- Final Coolify hostname and scheduled interval.
- Which RepSpark Postgres role and network route to use.
- Which brand/product will be the first pilot.
- Whether to keep the current stale-mapping behavior (delete the metafield) or switch production to a tombstone.
- When to clean up the copied theme's unrelated Theme Check backlog.
- Production rollout date and rollback owner.

## Current Bottom Line

The project is ready for peer review and a controlled development deployment. The main engineering risk has shifted from implementation to integration: real credentials, network connectivity, current source-data quality, Shopify installation approval, and end-to-end observation on the development store.
