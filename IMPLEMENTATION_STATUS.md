# BallPro Inventory Implementation Status

Updated: 2026-07-16

## Implemented locally

- Partner-owned custom-distribution Shopify app installation using authorization-code OAuth and an encrypted offline Admin API token.
- Shopify Admin GraphQL client pinned to `2026-07`, with version assertions, throttling retries, metafield compare-digest concurrency control, 25-item metafield writes, and 250-item variant-create chunks.
- RepSpark catalog discovery and readiness checks against the scraper's actual Postgres schema.
- Vendor/style reconciliation with aliases, multi-style product mappings, manual mapping, ignore controls, and match-quality reporting.
- Per-brand enablement and display caps plus global cap, future horizon, and API-version settings.
- Durable queued dry/write/scheduled syncs with leases, heartbeats, bounded recovery, history, idempotent payload hashes, and stale-metafield cleanup.
- Additive-only Color and Size variant backfill with an exact signed one-product preview, server-side preview rebuild, blank SKUs, untracked inventory, and explicit confirmation.
- Shopify theme inventory-by-date accordion using the JSON product metafield and capped quantity display.
- Independent `connector/` and `shopify-theme/` deployment directories plus read-only `reference-data/` fixtures.

## Source hardening applied

- Active jobs/batches now block inventory reads, latest-run ordering uses run recency, source-disabled brands are excluded, partial size coverage fails, reads use a repeatable-read transaction, and future-only sizes are retained.
- The connector now requires child inventory freshness. The deployed RepSpark schema cannot satisfy that gate until its child tables and persistence are updated.

## Verified locally

- Connector ESLint and TypeScript checks pass.
- 55 tests pass across 11 test files.
- Next.js production build passes.
- Production dependency audit reports zero vulnerabilities.
- Fresh migrations seed environment defaults once; migration reruns preserve GUI-edited settings.
- HTTP smoke test confirms public health, protected operations, and authenticated access.
- Shopify Dev MCP validates the Admin GraphQL operations against API `2026-07`.
- Shopify Dev MCP validates the inventory theme integration files.

The full copied theme has 27 pre-existing Theme Check offenses across unrelated files. The new inventory integration introduced no new Theme Check offenses.

## Live Coolify and RepSpark snapshot

These are read-only observations from 2026-07-15, not guarantees about later scraper runs:

- The RepSpark scraper resource was deployed; the BallPro connector was not deployed and no connector containers existed on the host.
- RepSpark Postgres was attached only to its private resource network, with no published host port and no connection to the external `coolify` network.
- The only login role was the `repspark` superuser. The required SELECT-only `ballpro_ro` role did not exist.
- The database contained 20 brands, 15 enabled brands, and 26,910 products.
- johnnie-O, Holderness & Bourne, and Sun Day Red passed the observed completeness checks, but are only candidates until child freshness is fixed.
- Missing images do not block the core connector because the inventory metafield payload does not consume RepSpark image rows.

The selected deployment contract is external network `coolify`, RepSpark-owned stable alias `repspark-db`, and RepSpark-owned SELECT-only role `ballpro_ro`. The alias and role are changes to the existing RepSpark resource; deploying this repository does not create them.

## Live acceptance gates

These require credentials, live services, or RepSpark-resource changes that are intentionally not committed:

1. Add RepSpark child-row freshness and transactional snapshot replacement/removal, then re-scrape one candidate brand.
2. Attach RepSpark Postgres and connector web/worker to external network `coolify`, with `repspark-db` owned by the RepSpark resource.
3. Create and verify the RepSpark-owned `ballpro_ro` role, then store its URL only in Coolify secrets.
4. Create and version the custom-distribution app in the Shopify Dev Dashboard with `read_products,write_products`.
5. Deploy `connector/`, configure its HTTPS app and callback URLs, materialize `.env`, and connect the development store once.
6. Confirm connector and RepSpark database health, then run catalog discovery after a completed scrape.
7. Reconcile and enable johnnie-O, Holderness & Bourne, or Sun Day Red as the pilot; run dry sync, write sync, and a second idempotency run.
8. Preview and apply one product's variant additions, then inspect options, media, blank SKUs, and untracked inventory in Shopify Admin.
9. Preview `shopify-theme/` on `ballproplusdev.myshopify.com` and inspect products with capped inventory, future inventory, no future inventory, and no metafield.
10. Configure the Coolify scheduled task and verify an unattended run.

Do not point the connector at `ballpro.com` until all ten development-store gates pass. See [`LIVE_COOLIFY_FINDINGS.md`](LIVE_COOLIFY_FINDINGS.md) for the full dated assessment.
