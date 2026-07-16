# Ball Pro — RepSpark → Shopify Inventory Connector

## Context

Ball Pro (golf/promotional apparel) runs a Shopify store (`ballproplusdev.myshopify.com` dev / `ballpro.com`) that is **not a real ecommerce store** — customers don't check out against live inventory. Product variants exist only to display color/size options and images. All real inventory data comes from a **RepSpark B2B wholesale scraper** (already built, hosted on Coolify) that maintains a Postgres catalog of every brand's products, colors, sizes, available-to-sell quantities, and dated incoming stock.

We need to bridge those two systems. Concretely:

1. **Backfill variants** — ensure each Shopify product carries the color/size options RepSpark shows (for images/display only; **no** Shopify inventory tracking).
2. **Sync inventory into a metafield** — a one-time push of inventory levels into a per-product metafield as JSON (with the foundation for future scheduled/real-time sync). Inventory is **not** written to Shopify variant stock; it lives as a JSON blob rendered as a table.
3. **Management GUI** — a small web app to set a **per-brand MAX display cap** (ceiling on the quantity shown on the storefront, e.g. show "500+" instead of 5,000) and toggle which brands are enabled.
4. **Storefront display** — an accordion table on the product page (Liquid) reading the metafield JSON, showing inventory levels by date.

The intended outcome: a repeatable pipeline that keeps Shopify product pages showing accurate, brand-capped inventory-by-date tables sourced from RepSpark, plus a GUI for the team to manage caps and brand enablement.

## Key facts established during exploration

- **This folder** starts empty except for data drops: a Shopify product export CSV (`products_export_1.csv`, 1,581 products / 53 vendors) and six RepSpark xlsx catalog exports (anderson-ord, bald-head-blues, donald-ross, flag-and-anthem, holderness-bourne, sun-day-red). The connector app is a **fresh build**.
- **RepSpark Postgres model** (`teamfrontrow/repspark-scraper`): `brands → products → product_variants (one row per COLOR, holds pricing) → variant_sizes (size_code + ats_now) → variant_future_inventory (availability_date, size_code, quantity)` + `product_images`. Identity = `brand_name`/`brand_slug` + `product_number` (style, e.g. `HB2001`, `DR002-226`) + `color` + `size_code`. **No SKU.** Each color is a separate `products` row sharing one `product_number`. Also exposes a Next.js JSON API, but **direct Postgres read** is the chosen access path.
- **Shopify** (`teamfrontrow/2026_BallPro_Theme`, "Hyper" theme by FoxEcom): products keyed by Vendor (= brand), Handle, Variant SKU (e.g. `A-DR016FP-226`). Heavy `custom.*` metafield use. There's a **proven pattern** for JSON-in-a-metafield → HTML table (`snippets/pricing-details-v2.liquid`, the `b2b.price_breaks` tables) and a native accordion system (`assets/theme.js` `AccordionGroup`, `snippets/product-collapsible-tab.liquid`) to reuse for the storefront table.
- **MATCH KEY (validated against real data)**: `Shopify.Vendor == RepSpark.brand_name` AND `normalize(Shopify SKU) == RepSpark.product_number`, where `normalize` strips a leading `A-` and uppercases. Measured match rate: Holderness&Bourne 100%, AndersonOrd 100%, Flag&Anthem 100%, Donald Ross 96%, Sun Day Red 79%. The unmatched tail = discontinued styles absent from the current scrape → a **reconciliation/manual-override** step is required, not a pure auto-join. One Shopify product aggregates **all** RepSpark color-rows sharing its `product_number`.
- **Shopify auth (verified 2026-07-15)**: apps are now created and versioned in the **Dev Dashboard**. The client-credentials grant is restricted to apps owned by the same organization that owns the store, so Partner collaborator access to a client-owned store is not sufficient. This connector therefore uses a **custom-distribution Dev Dashboard app + one-time authorization-code install + non-expiring offline access token**. The encrypted offline token supports unattended syncs. An existing admin-created custom-app token remains an optional compatibility input, not the primary path.

## User decisions (confirmed)

- Build fresh in this folder.
- MAX display = **per-brand cap on shown quantity**.
- Match key to be derived from the data (done — see above).
- Shopify access via a **Partner-owned custom-distribution app**, installed once with authorization-code OAuth and an offline token.
- **GUI mirrors the RepSpark scraper web app's UI/UX** (same design system, ported verbatim).

---

## Architecture

**One connector codebase, two connector processes — Next.js 15 (App Router) + React 19 + TypeScript**, mirroring the RepSpark scraper's stack (`pg` Pool, Tailwind v4 with a hand-rolled CSS design system, Docker Compose on Coolify). The web and worker use the same image but deploy as separate services. The Shopify theme is an independently deployed artifact:
- **GUI** (React pages): brand settings (enable + cap), mapping reconciliation, sync trigger + run history.
- **API** (Route Handlers `/api/*`): GUI actions.
- **Sync engine** (`lib/sync/engine.ts`): a plain TS library with **no HTTP dependency**, invoked by a durable Postgres job worker and a CLI entrypoint (`scripts/sync.ts` via `tsx`). GUI requests enqueue runs and poll progress.

**Shopify is display-only**: inventory never touches variant `inventoryQuantity` — it lives entirely in one product-level JSON metafield. No locations, no inventory levels, no fulfillment. All Shopify calls are **server-side only** (token never reaches the browser).

**Repository/deployment boundaries:**
- `connector/` — Next.js web/API, shared sync engine, worker, migrations, Docker/Compose; one Coolify Compose deployment.
- `shopify-theme/` — Liquid/CSS storefront artifact; deployed independently with Shopify CLI/theme workflow.
- `reference-data/` — read-only CSV/XLSX verification fixtures; never required at runtime.

**Hosting** (Coolify + Compose, beside the RepSpark stack):
- `connector-web` (Next.js GUI+API), `connector-db` (the connector's own Postgres — separate lifecycle/blast radius from RepSpark).
- Connect to RepSpark's Postgres **read-only** via its `DATABASE_URL`.
- Phase 6 adds `connector-worker` (same image, `command: tsx scripts/worker.ts`) + Coolify cron.

## GUI design — mirror the RepSpark web app

The connector GUI **reuses the RepSpark web app's design system verbatim** so the two internal tools feel identical. That system is framework-light and highly portable: **no component library** — it's a single global stylesheet of semantic CSS classes + CSS-variable tokens, plus one shared React primitives file.

**How to replicate (copy from `teamfrontrow/repspark-scraper` `web/`):**
1. Copy `web/src/app/globals.css` verbatim — it *is* the design system: all tokens + every component class (`.card`, `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-danger`, `.badge` + status variants, `.data-table`, `.input`/`.select`/`.label`, `.segmented`, `.chip`, `.progress-track`, `.skeleton`, `.toaster`, `.stat-card`, sidebar/nav classes).
2. Copy `web/src/components/ui.tsx` — React primitives (`PageHeader`, `StatCard`, `EmptyState`, `Skeleton`, `Toaster` + `toast()`, `timeAgo()`) and the inline lucide-style icon set.
3. Load **Inter** via `next/font` as `--font-inter`; set `<html data-theme="dark">` (**dark is default**) with the pre-paint theme-init script (persists to `localStorage`, avoids flash).
4. Reuse the shell: `234px` sticky translucent sidebar (`backdrop-filter: blur`) with grouped nav + gradient active-stripe, and `(app)/layout.tsx` content wrapper (`maxWidth:1360`, centered, `page-enter` fade-up animation). No top bar.
5. Build views by composing `.card` + `.data-table` + `.btn`/`.badge` + `ui.tsx` primitives; inline `style={{}}` for layout; `toast()` for feedback; `.skeleton` for loading; `<EmptyState/>` for empty.

**Design tokens (already themed light/dark):** indigo→violet brand gradient `linear-gradient(135deg, var(--accent), var(--accent-2))` (accent `#6d6df5`/`#5b5bf0`), surfaces `--surface`/`--surface-2`, semantic `--success/--warning/--danger/--info` (+ `-soft`), card radius `14px` / button `9px` / pill `999px`, base font 14px, soft layered shadows, ambient radial-glow body background.

**Connector nav (grouped, matching RepSpark's sidebar idiom):**
- **Sync**: Dashboard (`/` — stat cards: enabled brands, mapped products, last run, unmatched count), Sync Runs (`/runs` — history table + drill-down to `sync_run_items`).
- **Catalog**: Brands (`/brands` — enable toggle + `max_display_cap` editor), Mappings (`/mappings` — reconciliation table: filter unmatched, manual-map/ignore).
- **Admin**: Settings (`/settings` — global caps, future horizon, API version).

Views map onto existing RepSpark components: **Brands/Mappings** tables follow `SchedulesView.tsx` (`.data-table` in a `.card`, badge-as-toggle for enable/active with a pulsing `.dot`, right-aligned ghost/danger `.btn-sm` actions). **Dashboard** follows `DashboardStats.tsx` (`.stat-card` auto-fit grid). **Sync trigger + live progress** reuses `.progress-track`/`.progress-fill`. Confirmations use native `window.confirm` (as RepSpark does), or add a small dialog if preferred.

## Connector Postgres schema (`db/migrations/0001_init.sql`)

- **`brands`** — unit of enable/cap control: `brand_slug` (uniq), `brand_name`, `shopify_vendor`, `enabled` (default false — opt-in), `max_display_cap` int null (null = uncapped), timestamps.
- **`product_mappings`** — one row per Shopify product: GID (uniq), denormalized handle/vendor/title, brand FK, aggregate `match_status` (`auto`|`manual`|`partial`|`unmatched`|`ignored`), source, and sync audit fields.
- **`product_mapping_styles`** — one row per distinct normalized Shopify SKU/style under a product, with nullable RepSpark product number and its own match status/source. This supports Shopify products that aggregate multiple RepSpark styles without collapsing them to one scalar key.
- **`sync_runs`** — `kind` (`one_time`|`scheduled`|`manual_single`), `trigger`, `status`, timestamps, counters (`products_total/written/skipped/failed`), `dry_run`, `error_summary`.
- **`sync_run_items`** — per-product: `sync_run_id` FK, `product_mapping_id` FK, `status` (`written`|`unchanged`|`skipped`|`failed`), `payload_hash` (SHA-256 of written JSON, for idempotency), `error`, `shopify_metafield_gid`.
- **`app_settings`** — singleton globals (`default_cap`, `future_horizon_days`, `shopify_api_version`).

Migration approach: SQL files run on boot (same as RepSpark app).

## Inventory metafield (`custom.inventory_by_date`, type `json`)

Create as a pinned **metafield definition** (validated). One `json` blob per product (not `list.*` — needs nested color/size/date shape; read in one Liquid access; written atomically by one `metafieldsSet`). Shape:

```json
{
  "schema": 1, "styles": ["SPP029-226"], "brand": "Sun Day Red",
  "synced_at": "2026-07-15T12:00:00Z", "cap": 500,
  "size_order": ["S","M","L","XL","2XL"],
  "dates": ["2026-09-01","2026-11-15"],
  "colors": [
    { "color": "Black", "color_code": "226", "sizes": [
      { "size": "M", "current": 500, "capped": true,
        "future": [ {"date":"2026-09-01","qty":240}, {"date":"2026-11-15","qty":500,"capped":true} ] }
    ]}
  ]
}
```
- **`current` = `ats_now`** (per color/size); **`future` = `variant_future_inventory`** (dated), sorted.
- Top-level **`dates`** = sorted union of all future dates → gives the Liquid table its column headers directly.
- **`size_order`** explicit (S/M/L/XL, not alphabetical) via RepSpark size sequence + canonical fallback map.
- **Cap applied at write time**: raw value clamped, `capped:true` flag set; theme renders `"500+"` when `capped`. Keeps the value numeric/sortable and the theme dumb (can't leak true quantities). Trade-off: changing a cap requires a brand re-sync — acceptable, cheap, and auditable.
- Size guard: trim future dates beyond `FUTURE_HORIZON_DAYS`, use lean keys, omit empty `future` — stay well under the metafield value ceiling.

## Sync engine (`runSync({ kind, brandIds?, productGids?, dryRun })`)

Per product: **resolve targets → fetch RepSpark → aggregate → cap → serialize+hash → diff → write → record.**
1. Targets = `product_mappings` where `match_status IN (auto,manual)` AND brand `enabled`. Others counted+skipped.
2. Fetch RepSpark inventory **set-based** (one query keyed by an array of `product_number`s), joining `products → product_variants → variant_sizes (ats_now)` + `variant_future_inventory`, for **all** color-rows sharing the style.
3. Aggregate by color→size; build `size_order` + `dates` union.
4. Apply brand cap; set `capped` flags.
5. Stable-stringify canonical business data **excluding `synced_at`** → `payload_hash`; unchanged payloads preserve the prior timestamp.
6. **Idempotency**: if `payload_hash` == last successful write's hash → skip (`unchanged`). Makes re-runs and scheduled runs cheap no-ops.
7. **Write** `metafieldsSet` (batches of **25** metafields/call) with a fresh `compareDigest`, cost-based throttle governor, conflict reread/retry, and rejected-batch subdivision for per-product attribution.
8. Record `sync_run_items`; update `last_synced_at`.

**One-time vs scheduled vs single-product** differ only by `kind` + target selection — no forked code. **Dry-run** runs stages 1–6, records intended hashes + diff summary, skips the write; GUI shows "would write N / unchanged M / skip K" before committing.

Initial Shopify product/variant read (all ~1,581: GID, vendor, handle, SKU, options) via **`bulkOperationRunQuery`** (one-shot, cheap); writes via `metafieldsSet` batches (bulk ops are for reads, not idempotent metafield writes).

## Variant backfill (deliverable 1 — gated, separate from inventory sync)

Additive-only reconciliation of Color × Size options for display/images (no inventory). Read current Shopify options/variants + RepSpark distinct colors/sizes → diff → **`productVariantsBulkCreate`** for missing variants only (never auto-delete; `productSet` can remove variants — avoid). New variants: `inventoryItem.tracked = false`, policy `CONTINUE`. **Hard-gated behind a mandatory signed per-product preview**, batched with the cost governor, rolled out one source-ready brand first. Risks to surface: the current 2,048-variant product limit, option creation/reordering, image associations, blank SKUs, and HTML leakage.

## Config / secrets (`.env.example`, real values via Coolify)

`APP_URL`, `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_SCOPES`, `SHOPIFY_API_VERSION` (pinned to `2026-07`), `TOKEN_ENCRYPTION_KEY`, optional `SHOPIFY_ADMIN_TOKEN` compatibility input, `REPSPARK_DATABASE_URL` (read-only), `CONNECTOR_DATABASE_URL`, `SYNC_DEFAULT_CAP`, `FUTURE_HORIZON_DAYS`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `LOG_LEVEL`.

## Phased build (each independently verifiable)

- **Phase 0 — Scaffold + design system.** Next.js 15+React 19+TS, Dockerfile+Compose, `connector-db`, migration runner, both `pg` Pools. **Port the RepSpark design system**: copy `globals.css` + `ui.tsx`, wire Inter/`next/font`, `data-theme="dark"` init script, and the `234px` sidebar + `(app)/layout.tsx` shell with the connector nav. *Verify:* health endpoint confirms RepSpark DB + connector DB + Shopify API (`shop` query returns shop name) all reachable; the empty app renders with the RepSpark look (sidebar, dark theme, a placeholder dashboard).
- **Phase 1 — Ingest + matching (read-only).** Bulk-read all Shopify products; normalize each distinct SKU (strip `A-`, uppercase); auto-match style sets on vendor aliases + normalized style; populate brands, product mappings, and style rows. Report both any-style and all-styles product match rates plus style-level rates. *Verify:* snapshot-checksummed report lists partial, blank, and collision cases instead of relying on stale percentages.
- **Phase 2 — Reconciliation GUI.** Brands page (enable toggle + `max_display_cap`) and Mappings page (review, manual map / ignore unmatched) — built with the ported `.data-table`/`.card`/`.badge`/`.btn` patterns (mirroring `SchedulesView.tsx`). *Verify:* operator enables a brand and resolves a straggler; persists and re-appears.
- **Phase 3 — Metafield def + transform (dry-run).** Create `custom.inventory_by_date` definition; build aggregate→cap→serialize; dry-run enabled brands. *Verify:* generated JSON for known styles matches RepSpark data + xlsx catalogs; caps applied; shape correct.
- **Phase 4 — One-time sync (writes).** `metafieldsSet` batches, cost governor, idempotency, run logging. *Verify:* metafields present in Shopify admin; re-run reports all `unchanged`; history in GUI.
- **Phase 5 — Variant backfill (gated).** Additive `productVariantsBulkCreate` + mandatory preview, tracking off, one brand first. *Verify:* missing variants appear, tracking off, no image orphaning; preview matched result.
- **Phase 6 — Scheduled sync operations.** The durable worker/queue ships before the first write. Add scheduling, lease heartbeats, bounded crash recovery, and Coolify cron calling `runSync({kind:'scheduled'})`. *Verify:* unattended run executes, mostly `unchanged`, re-writes only changed styles.
- **Phase 7 — Storefront (in `teamfrontrow/2026_BallPro_Theme`, separate repo).** New `snippets/product-inventory-table.liquid` reading `product.metafields.custom.inventory_by_date.value`, wrapped in the existing `is="accordion-group"` accordion (mirror `product-collapsible-tab.liquid` / `pricing-details-v2.liquid` table pattern), rendered via a `collapsible_tab`/`custom_liquid` block in `templates/product.json`. Renders by-date table with `"500+"` capping. *Verify:* real product page renders the table with capping.

## Critical files (all new unless noted)

- `lib/sync/engine.ts` — shared `runSync()` pipeline.
- `lib/shopify/client.ts` — GraphQL Admin client, cost-throttle governor, `metafieldsSet` batching, `bulkOperationRunQuery`.
- `lib/repspark/inventory.ts` — read-only `pg` queries aggregating all color-rows per `product_number`.
- `lib/matching/normalize.ts` — SKU normalize + `(vendor, normalized_sku)` matcher.
- `db/migrations/0001_init.sql` — connector schema.
- `app/globals.css` + `components/ui.tsx` + `components/Sidebar.tsx` + `app/(app)/layout.tsx` — **ported from RepSpark `web/`** (design system + shell).
- `docker-compose.yml`, `Dockerfile`, `.env.example` — deploy (mirror RepSpark).
- Reference inputs already in folder: `products_export_1.csv`, `repspark_catalog_*.xlsx`.
- Storefront (other repo): `snippets/product-inventory-table.liquid`, `templates/product.json`.

## Verification (end-to-end)

Per-phase checks above. Overall acceptance: on the **dev store** (`ballproplusdev.myshopify.com`), enable one brand (e.g. Holderness & Bourne, 100% match) with a cap, run the one-time sync, confirm `custom.inventory_by_date` JSON on its products in admin, re-run to prove idempotency (`unchanged`), then load a product page in the theme and confirm the accordion renders the by-date table with `"500+"` capping. Prefer the dev store for all first writes before touching `ballpro.com`.

## Open items to decide during build (defaults chosen)

- Sync trigger: start with the simple polled Route Handler (Phase 4); promote to the worker queue in Phase 6. (Default: simple first.)
- Variant backfill rollout: pilot one brand, review, then expand. (Default: gated pilot.)
- Shopify API version pinned at build time; upgrade deliberately.
