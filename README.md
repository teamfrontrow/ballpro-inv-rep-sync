# BallPro RepSpark Inventory Sync

RepSpark-to-Shopify inventory display system for Ball Pro. It reconciles Shopify products with the RepSpark catalog, writes capped current and future availability to a product JSON metafield, and renders that data as an inventory-by-date accordion in the Shopify theme.

This system does **not** update Shopify inventory quantities, locations, fulfillment data, or checkout availability. Shopify remains a display catalog; RepSpark remains the inventory source of truth.

## What It Includes

- Shopify product discovery and RepSpark catalog reconciliation.
- Vendor aliases, normalized style matching, multi-style products, and manual mapping controls.
- Per-brand enablement and display caps such as `500+`.
- Current and dated future inventory aggregation by color and size.
- Dry runs, idempotent writes, run history, scheduled jobs, leases, and bounded retry recovery.
- Additive-only Color and Size variant backfill behind an exact signed per-product preview.
- A Shopify Liquid inventory accordion that reads the synchronized metafield.
- Separate deployment boundaries for the connector and Shopify theme.

## Architecture

```text
RepSpark scraper Postgres (read-only)
                  |
                  v
        connector-web + worker
                  |
          connector Postgres
                  |
                  v
 Shopify Admin GraphQL API 2026-07
                  |
        custom.inventory_by_date
                  |
                  v
        Shopify product accordion
```

The connector is a Next.js 15 application with a separate durable worker. Both use the same image and share a dedicated connector Postgres database. RepSpark is queried through a separate read-only database connection.

## Repository Layout

- [`connector/`](connector/) - web control plane, API, OAuth flow, sync worker, database migrations, Docker image, and Compose deployment.
- [`shopify-theme/`](shopify-theme/) - independently deployed Liquid and CSS storefront integration.
- [`reference-data/`](reference-data/) - Shopify CSV and RepSpark XLSX snapshots used for reconciliation and verification; not needed at runtime.
- [`BALLPRO_INVENTORY_PLAN.md`](BALLPRO_INVENTORY_PLAN.md) - architecture, data contracts, implementation phases, and acceptance criteria.
- [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) - completed work, measured verification, and remaining live-store gates.
- [`DEVELOPER_HANDOFF.md`](DEVELOPER_HANDOFF.md) - peer-developer status, review map, access requirements, and recommended first deployment session.
- [`connector/DEPLOY.md`](connector/DEPLOY.md) - Shopify Dev Dashboard and Coolify deployment runbook.

## Shopify Authentication

This deployment uses a Partner-owned **custom-distribution app** created in Shopify's Dev Dashboard. Because the app and client store are owned by different organizations, collaborator access does not make the client-credentials grant applicable.

The connection flow is:

1. Create the app in the Shopify Dev Dashboard.
2. Select custom distribution and restrict it to the Ball Pro store.
3. Release an app version with `read_products,write_products`.
4. Configure the connector URL and `/api/shopify/callback` redirect URL.
5. Use **Connect Shopify store** in the connector Settings page.
6. Approve the one-time authorization-code OAuth installation.
7. Store the resulting offline token encrypted in connector Postgres.

An existing Shopify-admin-created custom app token can be supplied through `SHOPIFY_ADMIN_TOKEN`, but it is a compatibility path rather than the primary deployment method.

## Prerequisites

- Node.js 22 or newer.
- Docker with Docker Compose for the recommended local and production layout.
- A Shopify custom-distribution app with `read_products,write_products`.
- A read-only Postgres role for the existing RepSpark scraper database.
- Shopify CLI 3 for theme preview and deployment.

## Connector Setup

```sh
cd connector
cp .env.example .env
```

Set the required values in `.env`:

- `APP_URL` - connector origin; HTTPS is required in production.
- `SHOPIFY_SHOP_DOMAIN` - start with `ballproplusdev.myshopify.com`.
- `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` - Dev Dashboard app credentials.
- `TOKEN_ENCRYPTION_KEY` - 32-byte key encoded as 64 hexadecimal characters.
- `REPSPARK_DATABASE_URL` - read-only RepSpark Postgres connection.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` - connector HTTP Basic credentials.
- `POSTGRES_PASSWORD` - local/Compose connector database password.

Generate the token-encryption key with:

```sh
openssl rand -hex 32
```

Start the complete connector stack:

```sh
docker compose up --build
```

Open `http://localhost:3000`. The Compose deployment starts:

- `connector-web` on port `3000`.
- `connector-worker` as a private background process.
- `connector-db` with a persistent named volume.

The public `/api/health` endpoint reports connector database, RepSpark database, and Shopify connection status. Operational pages and APIs require the configured Basic credentials.

## Development And Verification

Install dependencies and run the full connector gate:

```sh
cd connector
npm ci
npm run verify
```

`npm run verify` runs ESLint, TypeScript, the Vitest suite, and the optimized Next.js build. Additional commands:

```sh
npm run db:migrate       # apply checksum-verified SQL migrations
npm run sync -- --dry-run
npm run sync             # enqueue a one-time write sync
npm run sync:scheduled   # enqueue the scheduled-sync job used by Coolify
npm run worker           # run the durable worker directly
```

## Operator Workflow

Use the development store for every first write:

1. Connect Shopify from Settings and confirm the health check sees the expected shop.
2. Run catalog discovery after RepSpark has completed its scrape.
3. Review match metrics and resolve unmatched or partial products.
4. Enable one pilot brand and set its display cap.
5. Run a dry sync and inspect the generated run details.
6. Run the write sync and inspect the product metafield in Shopify Admin.
7. Run the same sync again; unchanged source data must report `unchanged`.
8. Preview variant additions one product at a time before explicitly confirming them.
9. Preview the theme against the development store and inspect the storefront table.
10. Configure the scheduled task only after the pilot passes.

Do not point the connector at `ballpro.com` until the development-store gates in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) pass.

## Inventory Metafield

Inventory is written to the product metafield `custom.inventory_by_date` with type `json`. The payload contains:

- Source styles and brand.
- Sync timestamp and applied display cap.
- Explicit size and future-date ordering.
- Current inventory by color and size.
- Dated future quantities.
- `capped` flags so the theme can render values such as `500+` without exposing the raw quantity.

Writes use fresh `compareDigest` values, retry throttled requests, isolate rejected records, and skip unchanged business payloads by SHA-256 hash.

## Variant Backfill Safety

Variant creation is intentionally separate from inventory synchronization:

- Only products already configured with exactly `Color` and `Size` are eligible.
- Existing variants, options, images, and media are never deleted or reordered.
- New variants are untracked and use inventory policy `CONTINUE`.
- New SKUs remain blank because RepSpark does not provide SKU values.
- Every write requires an HMAC-signed preview that is rebuilt server-side before applying.
- Shopify mutations are chunked to the 250-item input-array limit.
- The default 2,048 variants-per-product ceiling is checked before writing.

## Shopify Theme

The theme artifact is deployed independently from [`shopify-theme/`](shopify-theme/):

```sh
cd shopify-theme
shopify theme dev --store ballproplusdev.myshopify.com --path .
shopify theme check --path .
```

The new inventory integration introduces no new Theme Check offenses. The copied source theme currently contains 27 existing offenses across unrelated legacy files; these are recorded in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Coolify Deployment

Create one Docker Compose resource with:

- Base directory: `/connector`
- Compose file: `docker-compose.yml`
- Public service: `connector-web:3000`
- Private service: `connector-worker`
- Persistent volume: `connector-db-data`
- Health path: `/api/health`

Materialize a private `connector/.env` in Coolify and configure `POSTGRES_PASSWORD` as a Compose variable. Schedule `npm run sync:scheduled`; the command only enqueues work and the worker performs the synchronization.

See [`connector/DEPLOY.md`](connector/DEPLOY.md) for the complete production runbook.

## Security

- Never commit `.env`, database passwords, Shopify credentials, access tokens, or encryption keys.
- Use a dedicated `SELECT`-only RepSpark database role.
- Keep only `connector-web` public.
- Use HTTPS in production so Basic credentials and the OAuth callback are encrypted in transit.
- The OAuth callback accepts only a fresh signed state, valid Shopify HMAC and timestamp, and the configured shop domain.
- Start all Shopify writes on `ballproplusdev.myshopify.com`.

## Current Verification

- ESLint and TypeScript pass.
- 50 tests pass across 11 test files.
- Next.js production build passes.
- Production dependency audit reports zero vulnerabilities.
- Fresh and repeat migration behavior is verified.
- Shopify Admin GraphQL operations validate against API `2026-07`.
- Connector authentication and health routes pass HTTP smoke tests.

Live Shopify, RepSpark, theme-preview, and scheduled-run acceptance requires deployment credentials and is tracked in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
