# BallPro Inventory Implementation Status

Updated: 2026-07-15

## Code complete

- Partner-owned custom-distribution Shopify app installation using authorization-code OAuth and an encrypted offline Admin API token.
- Shopify Admin GraphQL client pinned to `2026-07`, with version assertions, throttling retries, metafield compare-digest concurrency control, 25-item metafield writes, and 250-item variant-create chunks.
- RepSpark catalog discovery and readiness checks against the scraper's actual Postgres schema.
- Vendor/style reconciliation with aliases, multi-style product mappings, manual mapping, ignore controls, and match-quality reporting.
- Per-brand enablement and display caps plus global cap, future horizon, and API-version settings.
- Durable queued dry/write/scheduled syncs with leases, heartbeats, bounded recovery, history, idempotent payload hashes, and stale-metafield cleanup.
- Additive-only Color and Size variant backfill with an exact signed one-product preview, server-side preview rebuild, blank SKUs, untracked inventory, and explicit confirmation.
- Shopify theme inventory-by-date accordion using the JSON product metafield and capped quantity display.
- Independent `connector/` and `shopify-theme/` deployment directories plus read-only `reference-data/` fixtures.

## Verified locally

- Connector ESLint and TypeScript checks pass.
- 50 tests pass across 11 test files.
- Next.js production build passes.
- Production dependency audit reports zero vulnerabilities.
- Fresh migrations seed environment defaults once; migration reruns preserve GUI-edited settings.
- HTTP smoke test confirms public health, protected operations, and authenticated access.
- Shopify Dev MCP validates the Admin GraphQL operations against API `2026-07`.
- Shopify Dev MCP validates the inventory theme integration files.

The full copied theme has 27 pre-existing Theme Check offenses across unrelated files. The new inventory integration introduced no new Theme Check offenses.

## Live acceptance gates

These require credentials or services that are intentionally not committed:

1. Create and version the custom-distribution app in the Shopify Dev Dashboard with `read_products,write_products`.
2. Deploy `connector/`, configure its HTTPS app and callback URLs, materialize `.env`, and connect the development store once.
3. Provide a read-only RepSpark Postgres URL and run catalog discovery after a completed scrape.
4. Reconcile and enable one pilot brand, then run dry sync, write sync, and a second idempotency run.
5. Preview and apply one product's variant additions, then inspect options, media, blank SKUs, and untracked inventory in Shopify Admin.
6. Preview `shopify-theme/` on `ballproplusdev.myshopify.com` and inspect products with capped inventory, future inventory, no future inventory, and no metafield.
7. Configure the Coolify scheduled task and verify an unattended run.

Do not point the connector at `ballpro.com` until all seven development-store gates pass.
