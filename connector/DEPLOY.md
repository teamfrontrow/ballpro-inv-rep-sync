# Connector deployment

Deploy `connector/` as one Docker Compose resource in Coolify. The Compose file creates separate web, worker, and Postgres services. Only `connector-web:3000` should be public.

## Required setup

1. Create the Shopify app in the Dev Dashboard and choose custom distribution for the Ball Pro store.
2. Release an app version with `read_products,write_products` scopes.
3. Set the app URL to the connector's HTTPS URL and allow `https://<connector>/api/shopify/callback` as a redirect URL.
4. Generate a 64-character hexadecimal encryption key with `openssl rand -hex 32`.
5. Complete the RepSpark network and database prerequisites below.
6. Materialize `.env` from `.env.example` in the Coolify resource and set `POSTGRES_PASSWORD` as a Compose variable.
7. Deploy the connector and complete the ordered connectivity checks below.
8. Install the app once using the connector's Shopify connect action. The encrypted offline token is stored in connector Postgres.
9. Configure a Coolify scheduled task with `npm run sync:scheduled` at the desired interval. It only enqueues work; `connector-worker` performs the sync.

## RepSpark prerequisites

The connector and RepSpark are separate Coolify resources. They communicate only through Docker's external `coolify` network:

- This repository attaches `connector-web` and `connector-worker` to `coolify` in `docker-compose.yml`.
- `connector-db` remains attached only to the connector's private default network.
- The RepSpark resource must attach only its Postgres service to `coolify` and give that service the unique alias `repspark-db`.
- Do not use a generated Coolify container name or the generic `postgres` alias in `REPSPARK_DATABASE_URL`.
- Do not publish RepSpark Postgres port `5432` on the host or make the database public.

The RepSpark repository owns its side of the network. Its Compose service needs the equivalent of:

```yaml
services:
  postgres:
    networks:
      default:
      coolify:
        aliases:
          - repspark-db

networks:
  coolify:
    external: true
    name: coolify
```

Create the least-privilege login from the RepSpark Postgres container as a role that can manage roles and grant access to RepSpark-owned objects. The live RepSpark deployment uses role `repspark` for this:

```sh
psql -U repspark -d repspark -f /path/to/repspark-readonly-role.sql
```

Use `deploy/repspark-readonly-role.sql`. Its interactive `\password` prompt keeps the credential out of the repository and shell history. The script removes direct object privileges before granting current-table reads, sets future default grants for tables created by role `repspark`, removes elevated role capabilities, and defaults every connection to read-only transactions. If another migration role owns future tables, add matching `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` statements.

Set the resulting URL only in the connector's private environment:

```dotenv
REPSPARK_DATABASE_URL=postgresql://ballpro_ro:<percent-encoded-password>@repspark-db:5432/repspark?sslmode=disable
```

Never reuse the RepSpark owner/superuser credential. Percent-encode reserved URL characters in the password.

## Coolify resource

- Repository base directory: `/connector`
- Build pack: Docker Compose
- Compose file: `docker-compose.yml`
- Public service: `connector-web`, port `3000`
- Persistent service: `connector-db` volume `connector-db-data`
- Private service: `connector-worker`
- External network: existing Docker network `coolify`; web and worker only
- Health path: `/api/health`

The Shopify OAuth connect route is protected by the connector's HTTP Basic credentials. The callback is public because Shopify redirects the browser to it, but it accepts only a fresh signed state, a valid Shopify HMAC, and the configured shop domain.

Never commit `.env`, Shopify credentials, the encryption key, or database passwords.

## Ordered deployment verification

1. Redeploy RepSpark after adding the `repspark-db` alias, then create `ballpro_ro` with `deploy/repspark-readonly-role.sql`.
2. Deploy the connector. Docker Compose must find the existing external `coolify` network.
3. Verify DNS independently from both connector application containers:

   ```sh
   docker compose exec -T connector-web node -e "require('node:dns').lookup('repspark-db',(e,a)=>{if(e)throw e;console.log(a)})"
   docker compose exec -T connector-worker node -e "require('node:dns').lookup('repspark-db',(e,a)=>{if(e)throw e;console.log(a)})"
   ```

4. Verify the configured login, read-only default, source read access, and absence of table writes from each application service:

   ```sh
   docker compose exec -T connector-web node -e 'const {Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.REPSPARK_DATABASE_URL});await c.connect();const r=await c.query("SELECT current_user, current_database(), current_setting(\u0027default_transaction_read_only\u0027) AS default_read_only, has_table_privilege(current_user, \u0027public.brands\u0027, \u0027SELECT\u0027) AS can_select, has_table_privilege(current_user, \u0027public.brands\u0027, \u0027INSERT\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027UPDATE\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027DELETE\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027TRUNCATE\u0027) AS can_write, has_schema_privilege(current_user, \u0027public\u0027, \u0027CREATE\u0027) AS can_create");console.log(r.rows[0]);await c.end()})().catch(e=>{console.error(e);process.exit(1)})'
   docker compose exec -T connector-worker node -e 'const {Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.REPSPARK_DATABASE_URL});await c.connect();const r=await c.query("SELECT current_user, current_database(), current_setting(\u0027default_transaction_read_only\u0027) AS default_read_only, has_table_privilege(current_user, \u0027public.brands\u0027, \u0027SELECT\u0027) AS can_select, has_table_privilege(current_user, \u0027public.brands\u0027, \u0027INSERT\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027UPDATE\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027DELETE\u0027) OR has_table_privilege(current_user, \u0027public.brands\u0027, \u0027TRUNCATE\u0027) AS can_write, has_schema_privilege(current_user, \u0027public\u0027, \u0027CREATE\u0027) AS can_create");console.log(r.rows[0]);await c.end()})().catch(e=>{console.error(e);process.exit(1)})'
   ```

   Both results must show `current_user: ballpro_ro`, `default_read_only: on`, `can_select: true`, `can_write: false`, and `can_create: false`.

5. Open `https://<connector>/api/health` and confirm the `repspark_db` check has `"ok": true`. Do not start catalog discovery or sync while that check is red.
6. Inspect the Docker/host port configuration and confirm RepSpark Postgres has no published host port. Internal access uses `repspark-db:5432` only.

## First production gate

Use `ballproplusdev.myshopify.com`. Run a dry sync for one fully ready brand, inspect the generated payload and mapping report, then run a write sync. A second run must report unchanged. Production uses a separate connector deployment and database.
