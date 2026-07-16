# BallPro Inventory Connector

Control plane and durable worker for matching Shopify products to RepSpark, writing capped inventory-by-date JSON metafields, and safely previewing additive display variants. It never writes Shopify inventory levels.

## Processes

- `connector-web` serves the authenticated GUI, API, Shopify OAuth callback, and health endpoint.
- `connector-worker` leases and executes queued sync runs.
- `connector-db` stores OAuth installation data, settings, mappings, jobs, and sync history.
- RepSpark Postgres remains external and is accessed as `ballpro_ro` over the shared external `coolify` network. The RepSpark Postgres service must own the unique `repspark-db` network alias; no database port is exposed on the host.

## Local verification

```sh
npm ci
npm run verify
```

For local runtime setup:

```sh
cp .env.example .env
docker network inspect coolify >/dev/null 2>&1 || docker network create coolify
docker compose up --build
```

Open `http://localhost:3000`. The health endpoint is public at `/api/health`; all operational pages and APIs require HTTP Basic authentication.

## Operator flow

1. Connect the custom-distribution Shopify app from Settings.
2. Discover the Shopify and RepSpark catalogs and review readiness.
3. Resolve mappings, enable a pilot brand, and set its display cap.
4. Run a dry sync and inspect its run detail.
5. Run the write sync, then rerun it to verify `unchanged` idempotency.
6. Use Variant backfill only after reviewing and confirming the signed one-product preview.

See `DEPLOY.md` for the Shopify Dev Dashboard, RepSpark role and network prerequisites, and ordered Coolify production verification.
