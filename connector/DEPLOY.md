# Connector deployment

Deploy `connector/` as one Docker Compose resource in Coolify. The Compose file creates separate web, worker, and Postgres services. Only `connector-web:3000` should be public.

## Required setup

1. Create the Shopify app in the Dev Dashboard and choose custom distribution for the Ball Pro store.
2. Release an app version with `read_products,write_products` scopes.
3. Set the app URL to the connector's HTTPS URL and allow `https://<connector>/api/shopify/callback` as a redirect URL.
4. Generate a 64-character hexadecimal encryption key with `openssl rand -hex 32`.
5. Create a `SELECT`-only RepSpark Postgres role and use its URL for `REPSPARK_DATABASE_URL`.
6. Materialize `.env` from `.env.example` in the Coolify resource and set `POSTGRES_PASSWORD` as a Compose variable.
7. Install the app once using the connector's Shopify connect action. The encrypted offline token is stored in connector Postgres.
8. Configure a Coolify scheduled task with `npm run sync:scheduled` at the desired interval. It only enqueues work; `connector-worker` performs the sync.

## Coolify resource

- Repository base directory: `/connector`
- Build pack: Docker Compose
- Compose file: `docker-compose.yml`
- Public service: `connector-web`, port `3000`
- Persistent service: `connector-db` volume `connector-db-data`
- Private service: `connector-worker`
- Health path: `/api/health`

The Shopify OAuth connect route is protected by the connector's HTTP Basic credentials. The callback is public because Shopify redirects the browser to it, but it accepts only a fresh signed state, a valid Shopify HMAC, and the configured shop domain.

Never commit `.env`, Shopify credentials, the encryption key, or database passwords.

## First production gate

Use `ballproplusdev.myshopify.com`. Run a dry sync for one fully ready brand, inspect the generated payload and mapping report, then run a write sync. A second run must report unchanged. Production uses a separate connector deployment and database.
