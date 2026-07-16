# BallPro Connector Live Coolify Findings

**Snapshot date:** 2026-07-15

**Scope:** Read-only assessment of the live RepSpark scraper resource, its Postgres topology, and the source data available to the BallPro connector.
**Change boundary:** No Coolify, database, or repository changes were made during the assessment. Values below are observations from that date and can change after redeploys or scraper runs.

## Executive status

The BallPro connector was **not deployed** in the assessed Coolify environment. Two prerequisites block a production deployment:

1. Runtime: the RepSpark resource and future connector resource do not yet share a Docker network.
2. Security: RepSpark Postgres does not yet have the required `ballpro_ro` SELECT-only login. Another sufficiently privileged login would technically connect, but must not be used in production.

The selected production contract is:

- External Docker network: `coolify`.
- Stable RepSpark Postgres alias: `repspark-db`.
- RepSpark database role: `ballpro_ro`, restricted to read-only access.
- Connector secret: `REPSPARK_DATABASE_URL` points to `ballpro_ro@repspark-db:5432/repspark` with the actual password stored only in Coolify.

The stable alias and role are **RepSpark-resource changes**. They are not created by deploying this repository. The connector resource must attach both its web and worker services to the same external network, while its own database remains private.

Source completeness identified three pilot candidates but does not yet support a write. Of 20 observed brands, johnnie-O, Holderness & Bourne, and Sun Day Red passed the aggregate run/color/size checks. A separate audit found that RepSpark cannot currently prove child-inventory freshness or remove quantities that disappear from later scrapes. Missing product images do not block the core inventory sync.

## Observed Coolify topology

RepSpark scraper resource UUID: `potgqdk2xho4ijy8namfi8kg`

Observed deployed commit: `191433c`

| Container | Image/service | Network | Notes |
| --- | --- | --- | --- |
| `web-potgqdk2xho4ijy8namfi8kg-032818277250` | RepSpark web | `potgqdk2xho4ijy8namfi8kg` | Next.js control plane |
| `worker-potgqdk2xho4ijy8namfi8kg-032818333659` | RepSpark worker | `potgqdk2xho4ijy8namfi8kg` | Playwright scraper |
| `postgres-potgqdk2xho4ijy8namfi8kg-032818228548` | `postgres:16-alpine` | `potgqdk2xho4ijy8namfi8kg` | RepSpark database |

Observed Postgres facts:

- Private network alias: `postgres`.
- Observed container IP: `10.0.3.3`.
- Port `5432/tcp` was not published to the host.
- The service was not attached to external network `coolify`.
- Database and existing superuser role were both named `repspark`.
- `repspark` was the only login role; `ballpro_ro` did not exist.
- No BallPro connector containers existed on the host.

Container names and IPs are evidence, not durable configuration. Do not use the generated container suffix or IP in `REPSPARK_DATABASE_URL`.

## Selected network contract

Use the Coolify external network named `coolify` for cross-resource traffic. The durable hostname is `repspark-db`, assigned to the RepSpark Postgres service on that network.

Required ownership:

| Change | Owner | Reason |
| --- | --- | --- |
| Attach RepSpark Postgres to `coolify` | RepSpark resource | Makes the database reachable from the connector resource |
| Assign alias `repspark-db` | RepSpark resource | Avoids generated Coolify container names |
| Create `ballpro_ro` | RepSpark database owner | Enforces least-privilege access |
| Attach connector web and worker to `coolify` | Connector deployment | Both processes query RepSpark |
| Keep connector Postgres private | Connector deployment | No cross-resource access is required |

Do not publish RepSpark Postgres to the host. Do not rely on a manual `docker network connect`, because Coolify recreates containers during deployment and manual attachments are not durable.

## Read-only role contract

The RepSpark database owner should create `ballpro_ro` with no elevated capabilities, grant current and future table reads, and force read-only transactions. The password must be generated and stored outside Git.

Reference SQL for the RepSpark owner to review and run:

```sql
CREATE ROLE ballpro_ro LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE repspark TO ballpro_ro;
GRANT USAGE ON SCHEMA public TO ballpro_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ballpro_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE repspark IN SCHEMA public
  GRANT SELECT ON TABLES TO ballpro_ro;
ALTER ROLE ballpro_ro SET default_transaction_read_only = on;
```

Set the password separately through the approved secret-management workflow. If future migrations create tables under an owner other than `repspark`, repeat the default-privilege grant for that owner. Before deploying the connector, verify that `ballpro_ro` can read required tables and has no INSERT, UPDATE, DELETE, CREATE, or role-management privileges.

## Observed database counts

| Table | Rows observed |
| --- | ---: |
| `brands` | 20: 15 enabled, 5 disabled |
| `products` | 26,910 |
| `product_variants` | 26,910 |
| `variant_sizes` | 28,033 |
| `variant_future_inventory` | 15,086 |
| `product_images` | 240 |
| `scrape_runs` | 20 |
| `scrape_jobs` | 8: 5 completed, 3 failed |

`products` and `product_variants` were one-to-one in the snapshot. Each observed color could be represented by its own product number. The connector's multi-style mapping can associate multiple RepSpark product numbers with one Shopify product, and `product_number` was fully populated in the observed source.

## Brand readiness snapshot

| Brand | Enabled | Products | Blank colors | Size rows | Future rows | Images | Observed status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| johnnie-O | Yes | 2,260 | 0 | 13,005 | 10,277 | 0 | Pilot-ready |
| Holderness & Bourne | Yes | 935 | 0 | 4,906 | 2,768 | 0 | Pilot-ready |
| Sun Day Red | Yes | 240 | 0 | 1,290 | 960 | 240 | Pilot-ready |
| Donald Ross | Yes | 694 | 52 | 3,967 | 0 | 0 | Incomplete color coverage |
| Flag & Anthem | Yes | 707 | 707 | 4,865 | 1,081 | 0 | All colors blank |
| KJUS | Yes | 6,825 | 6,825 | 0 | 0 | 0 | List-only |
| Greyson | Yes | 4,057 | 4,057 | 0 | 0 | 0 | List-only |
| Under Armour Golf | Yes | 3,422 | 3,422 | 0 | 0 | 0 | List-only |
| Summit | Yes | 3,356 | 3,356 | 0 | 0 | 0 | List-only |
| Swannies | Yes | 1,178 | 1,178 | 0 | 0 | 0 | List-only |
| Good Good Golf | Yes | 975 | 975 | 0 | 0 | 0 | List-only |
| AndersonOrd | Yes | 926 | 926 | 0 | 0 | 0 | List-only; jobs 5-7 failed |
| Bald Head Blues | Yes | 494 | 494 | 0 | 0 | 0 | List-only |
| Vineyard Vines | Yes | 444 | 444 | 0 | 0 | 0 | List-only |
| Perry Ellis Intl | Yes | 397 | 397 | 0 | 0 | 0 | List-only |
| Southern Tide | No | 0 | 0 | 0 | 0 | 0 | Disabled and empty |
| Redvanly | No | 0 | 0 | 0 | 0 | 0 | Disabled and empty |
| Acushnet Golf Sandbox | No | 0 | 0 | 0 | 0 | 0 | Disabled and empty |
| Rhoback | No | 0 | 0 | 0 | 0 | 0 | Disabled and empty |
| Ghost Golf Club | No | 0 | 0 | 0 | 0 | 0 | Disabled and empty |

The ten list-only enabled brands had catalog rows but no size detail. Their product modals had not supplied the color and per-size ATS needed by the connector. Donald Ross and Flag & Anthem also failed observed color-completeness requirements. Future inventory is optional; valid future rows are included when present.

## Inventory and date findings

- All 28,033 observed `variant_sizes` rows had `ats_now`; this is the connector's current-availability source.
- `qty_default` was null in all observed size rows and is not used by the connector.
- The snapshot contained 132 distinct `size_code` values.
- Future inventory existed for johnnie-O, Holderness & Bourne, Flag & Anthem, and Sun Day Red.
- Future dates used US `M/D/YYYY` strings. The connector accepts that format and ISO `YYYY-MM-DD`; a future scraper format change must preserve one of those contracts.
- All 240 observed image rows belonged to Sun Day Red. RepSpark images are not input to `custom.inventory_by_date`, so this does not block core sync.

## Readiness interpretation

The original observed per-brand completeness checks were:

- Latest scrape run completed.
- Current-size coverage for the brand's variants.
- No blank color coverage.
- No invalid future dates.

No scrape jobs were active in the 2026-07-15 snapshot; all eight jobs were completed or failed. This statement applies only to that observation time.

Three brands passed the observed aggregate checks: johnnie-O, Holderness & Bourne, and Sun Day Red. Treat them as pilot candidates, not as proven syncable brands. Final eligibility also depends on connector mappings, connector-side enablement, child-row freshness, and a clean brand-scoped dry run with zero skipped or failed products.

## Connector compatibility and open hardening

The live schema provided the expected size, current-inventory, future-inventory, brand, and product-number relationships. It does **not** provide `last_seen_at` or another freshness marker on `variant_sizes` or `variant_future_inventory`. The scraper upserts those rows but does not delete rows that disappear from a later modal response. A fresh parent product/variant timestamp therefore cannot prove that a child quantity is current.

The live `scrape_jobs` schema associates work through `target_type` and comma-separated `brand_slugs`. That fallback path should remain covered by integration tests.

Connector hardening applied after this assessment:

- Brand-scoped sync now treats `pending`, `queued`, `running`, and `processing` jobs plus active batches as unsafe.
- Current and future reads use one repeatable-read, read-only transaction.
- Source-disabled brands, partial size coverage, and missing child freshness fail closed.
- Current and future queries use inner child joins; future-only sizes are retained with current quantity zero.
- Latest-run selection prioritizes run start/id recency rather than an older completion timestamp.

Required RepSpark change before any write:

1. Add a child freshness marker such as `last_seen_at` or `scrape_run_id` to `variant_sizes` and `variant_future_inventory`.
2. On a successful full/data-only modal scrape, replace each processed variant's size and future rows transactionally, or delete rows not seen in that snapshot.
3. Backfill/re-scrape the pilot brand so every child row has trustworthy freshness. A completed Excel-only, image-only, retry, or zero-product run is not proof of inventory freshness.

## Recommended deployment sequence

1. Update RepSpark child inventory persistence and freshness tracking as described above.
2. Update the RepSpark resource so Postgres joins external network `coolify` as `repspark-db`.
3. Create and verify the RepSpark-owned `ballpro_ro` role; store its password only in the approved secret manager and Coolify.
4. Re-scrape one candidate brand with complete modal coverage and verify child freshness plus zero orphaned rows.
5. Deploy the connector with web and worker attached to `coolify`; keep connector Postgres private.
6. Set `REPSPARK_DATABASE_URL` with the stable alias and read-only role, then verify both connector processes can resolve and query RepSpark.
7. Confirm both database checks on `/api/health`; inspect the Shopify check separately because HTTP success does not require Shopify to be green.
8. Install the Shopify custom-distribution app on `ballproplusdev.myshopify.com`.
9. Run discovery and choose johnnie-O, Holderness & Bourne, or Sun Day Red for the first candidate.
10. Require a clean brand-scoped dry run with zero skipped/failed products, then a first write and unchanged second run before enabling the schedule.
11. Re-scrape and reassess incomplete brands before expanding beyond the pilot.

## Snapshot caveat

This file reconciles the assessment performed on 2026-07-15. Recheck container topology, database roles, job states, row counts, and brand readiness after any RepSpark redeploy or scrape. No credentials are recorded here.
