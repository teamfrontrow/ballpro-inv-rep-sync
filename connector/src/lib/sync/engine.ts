import type { Pool, PoolClient, QueryResultRow } from "pg";
import { connectorDb } from "@/lib/db";
import type { RunSyncInput, SyncItemStatus } from "@/lib/domain";
import { normalizeMatchKey } from "@/lib/matching/normalize";
import {
  fetchRepSparkInventory,
  type RepSparkInventory,
  type RepSparkStyleKey,
} from "@/lib/repspark/inventory";
import { buildInventoryPayload, stableStringify } from "./payload";
import type {
  InventoryMetafieldWrite,
  ShopifyAdminClient,
} from "@/lib/shopify/client";

const SHOPIFY_BATCH_SIZE = 25;
const MAX_SOURCE_AGE_DAYS = 2;

interface MappingStyleRow {
  productNumber: string;
  matchStatus: string;
}

interface MappingRow extends QueryResultRow {
  id: number | string;
  shopifyProductGid: string;
  brandId: number | string | null;
  brandName: string | null;
  brandEnabled: boolean;
  matchStatus: string;
  vendorIgnored: boolean;
  maxDisplayCap: number | null;
  defaultCap: number | null;
  horizonDays: number;
  showFutureInventory: boolean;
  lastSyncedAt: Date | string | null;
  latestPayloadHash: string | null;
  styles: MappingStyleRow[] | string;
}

interface RunItem {
  mappingId: number;
  ownerId: string;
  status: SyncItemStatus;
  payloadHash: string | null;
  error: string | null;
  metafieldId: string | null;
  syncedAt?: string;
  cleanup?: boolean;
}

interface PendingWrite {
  mapping: MappingRow;
  mappingId: number;
  hash: string;
  syncedAt: string;
  write: InventoryMetafieldWrite;
}

export interface SyncEngineDependencies {
  database: Pick<Pool, "query" | "connect">;
  fetchInventory: (keys: RepSparkStyleKey[]) => Promise<RepSparkInventory>;
  createShopifyClient: () => Promise<Pick<ShopifyAdminClient,
    "ensureInventoryMetafieldDefinition" | "setInventoryMetafields" |
    "deleteInventoryMetafields" | "tombstoneInventoryMetafields"
  >>;
  now: () => Date;
  cleanupMode: "delete" | "tombstone";
}

function defaultDependencies(): SyncEngineDependencies {
  return {
    database: connectorDb(),
    fetchInventory: (keys) => fetchRepSparkInventory(keys),
    createShopifyClient: async () => {
      const { createShopifyAdminClient } = await import("@/lib/shopify/client");
      return createShopifyAdminClient();
    },
    now: () => new Date(),
    cleanupMode: "delete",
  };
}

function parseStyles(value: MappingRow["styles"]): MappingStyleRow[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((style) => {
    if (!style || typeof style !== "object") return [];
    const productNumber = String((style as { productNumber?: unknown }).productNumber ?? "").trim();
    const matchStatus = String((style as { matchStatus?: unknown }).matchStatus ?? "");
    return productNumber ? [{ productNumber, matchStatus }] : [];
  });
}

/**
 * True when a mapping is intentionally out of scope for sync — its Shopify vendor
 * is ignored, it was marked 'ignored', or its RepSpark brand is disabled (which
 * includes products with no RepSpark brand at all, e.g. Ball Pro). Such mappings,
 * when never previously synced, produce no run item at all rather than a 'skipped'
 * row, so house/Shopify-only products don't clutter run results.
 */
export function isExcludedMapping(
  mapping: Pick<MappingRow, "vendorIgnored" | "matchStatus" | "brandEnabled">,
): boolean {
  return mapping.vendorIgnored || mapping.matchStatus === "ignored" || !mapping.brandEnabled;
}

function activeStyles(mapping: MappingRow): RepSparkStyleKey[] {
  if (!mapping.brandEnabled || !mapping.brandName || !["auto", "manual", "partial"].includes(mapping.matchStatus)) return [];
  const styles = new Map<string, RepSparkStyleKey>();
  for (const style of parseStyles(mapping.styles)) {
    if (!["auto", "manual"].includes(style.matchStatus)) continue;
    const key = normalizeMatchKey(style.productNumber);
    if (key) styles.set(key, { brandName: mapping.brandName, productNumber: style.productNumber });
  }
  return [...styles.values()];
}

async function createOrStartRun(
  input: RunSyncInput,
  existingRunId: number | undefined,
  database: SyncEngineDependencies["database"],
): Promise<number> {
  if (existingRunId !== undefined) {
    const result = await database.query<{ id: number | string }>(
      `UPDATE sync_runs
       SET status = 'running', started_at = COALESCE(started_at, now()), completed_at = NULL,
           error_summary = NULL, dry_run = $2
       WHERE id = $1 RETURNING id`,
      [existingRunId, input.dryRun ?? false],
    );
    if (!result.rows[0]) throw new Error(`Sync run ${existingRunId} does not exist`);
    return Number(result.rows[0].id);
  }
  const result = await database.query<{ id: number | string }>(
    `INSERT INTO sync_runs (kind, trigger, status, dry_run, started_at)
     VALUES ($1, 'direct', 'running', $2, now()) RETURNING id`,
    [input.kind, input.dryRun ?? false],
  );
  return Number(result.rows[0].id);
}

async function loadMappings(
  input: RunSyncInput,
  database: SyncEngineDependencies["database"],
): Promise<MappingRow[]> {
  const result = await database.query<MappingRow>(
    `SELECT pm.id,
            pm.shopify_product_gid AS "shopifyProductGid",
            pm.brand_id AS "brandId",
            b.brand_name AS "brandName",
            COALESCE(b.enabled, false) AS "brandEnabled",
            pm.match_status AS "matchStatus",
            (iv.shopify_vendor IS NOT NULL) AS "vendorIgnored",
            b.max_display_cap AS "maxDisplayCap",
            COALESCE(b.show_future_inventory, true) AS "showFutureInventory",
            settings.default_cap AS "defaultCap",
            settings.future_horizon_days AS "horizonDays",
            pm.last_synced_at AS "lastSyncedAt",
            latest.payload_hash AS "latestPayloadHash",
            COALESCE(styles.values, '[]'::jsonb) AS styles
       FROM product_mappings pm
       LEFT JOIN brands b ON b.id = pm.brand_id
       LEFT JOIN ignored_vendors iv ON iv.shopify_vendor = pm.shopify_vendor
       CROSS JOIN app_settings settings
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'productNumber', pms.repspark_product_number,
           'matchStatus', pms.match_status
         ) ORDER BY upper(pms.repspark_product_number), pms.id) AS values
         FROM product_mapping_styles pms
         WHERE pms.product_mapping_id = pm.id
           AND pms.repspark_product_number IS NOT NULL
           AND trim(pms.repspark_product_number) <> ''
       ) styles ON true
       LEFT JOIN LATERAL (
         SELECT item.payload_hash
         FROM sync_run_items item
         JOIN sync_runs successful_run ON successful_run.id = item.sync_run_id
         WHERE item.product_mapping_id = pm.id
           AND item.status = 'written'
           AND item.payload_hash IS NOT NULL
           AND successful_run.status = 'completed'
           AND successful_run.dry_run = false
         ORDER BY item.id DESC LIMIT 1
       ) latest ON true
      WHERE ($1::bigint[] IS NULL OR pm.brand_id = ANY ($1::bigint[]))
        AND ($2::text[] IS NULL OR pm.shopify_product_gid = ANY ($2::text[]))
      ORDER BY pm.id`,
    [input.brandIds ?? null, input.productGids ?? null],
  );
  return result.rows;
}

function groupInventory(inventory: RepSparkInventory): Map<string, RepSparkInventory> {
  const grouped = new Map<string, RepSparkInventory>();
  const add = <T extends "current" | "future">(kind: T, row: RepSparkInventory[T][number]): void => {
    const key = `${normalizeMatchKey(row.brandName)}\0${normalizeMatchKey(row.productNumber)}`;
    const value = grouped.get(key) ?? { current: [], future: [] };
    if (kind === "current") value.current.push(row as RepSparkInventory["current"][number]);
    else value.future.push(row as RepSparkInventory["future"][number]);
    grouped.set(key, value);
  };
  for (const row of inventory.current) add("current", row);
  for (const row of inventory.future) add("future", row);
  return grouped;
}

function inventoryForStyles(styles: RepSparkStyleKey[], grouped: Map<string, RepSparkInventory>): RepSparkInventory {
  const result: RepSparkInventory = { current: [], future: [] };
  for (const style of styles) {
    const rows = grouped.get(`${normalizeMatchKey(style.brandName)}\0${normalizeMatchKey(style.productNumber)}`);
    if (rows) {
      result.current.push(...rows.current);
      result.future.push(...rows.future);
    }
  }
  return result;
}

async function writeWithIsolation(
  client: Pick<ShopifyAdminClient, "setInventoryMetafields">,
  pending: PendingWrite[],
): Promise<RunItem[]> {
  if (!pending.length) return [];
  try {
    const results = await client.setInventoryMetafields(pending.map((item) => item.write));
    const byOwner = new Map(results.map((result) => [result.ownerId, result]));
    return pending.map((item) => ({
      mappingId: item.mappingId,
      ownerId: item.write.ownerId,
      status: "written",
      payloadHash: item.hash,
      error: null,
      metafieldId: byOwner.get(item.write.ownerId)?.id ?? null,
      syncedAt: item.syncedAt,
    }));
  } catch (error) {
    if (pending.length > 1) {
      const midpoint = Math.ceil(pending.length / 2);
      return [
        ...await writeWithIsolation(client, pending.slice(0, midpoint)),
        ...await writeWithIsolation(client, pending.slice(midpoint)),
      ];
    }
    return [{
      mappingId: pending[0].mappingId,
      ownerId: pending[0].write.ownerId,
      status: "failed",
      payloadHash: pending[0].hash,
      error: error instanceof Error ? error.message : String(error),
      metafieldId: null,
    }];
  }
}

async function cleanupWithIsolation(
  client: Pick<ShopifyAdminClient, "deleteInventoryMetafields" | "tombstoneInventoryMetafields">,
  mappings: MappingRow[],
  mode: SyncEngineDependencies["cleanupMode"],
): Promise<RunItem[]> {
  if (!mappings.length) return [];
  try {
    if (mode === "delete") await client.deleteInventoryMetafields(mappings.map((mapping) => mapping.shopifyProductGid));
    else await client.tombstoneInventoryMetafields(mappings.map((mapping) => mapping.shopifyProductGid), "unmapped");
    return mappings.map((mapping) => ({
      mappingId: Number(mapping.id), ownerId: mapping.shopifyProductGid, status: "written",
      payloadHash: null, error: null, metafieldId: null, cleanup: true,
    }));
  } catch (error) {
    if (mappings.length > 1) {
      const midpoint = Math.ceil(mappings.length / 2);
      return [
        ...await cleanupWithIsolation(client, mappings.slice(0, midpoint), mode),
        ...await cleanupWithIsolation(client, mappings.slice(midpoint), mode),
      ];
    }
    return [{
      mappingId: Number(mappings[0].id), ownerId: mappings[0].shopifyProductGid, status: "failed",
      payloadHash: null, error: error instanceof Error ? error.message : String(error), metafieldId: null,
    }];
  }
}

async function persistResults(
  runId: number,
  items: RunItem[],
  database: SyncEngineDependencies["database"],
  fatalError?: string,
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (items.length) {
      await client.query(
        `INSERT INTO sync_run_items
           (sync_run_id, product_mapping_id, status, payload_hash, error, shopify_metafield_gid)
         SELECT $1, item.mapping_id, item.status, item.payload_hash, item.error, item.metafield_id
         FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[])
           AS item(mapping_id, status, payload_hash, error, metafield_id)
         ON CONFLICT (sync_run_id, product_mapping_id) DO UPDATE SET
           status = EXCLUDED.status, payload_hash = EXCLUDED.payload_hash,
           error = EXCLUDED.error, shopify_metafield_gid = EXCLUDED.shopify_metafield_gid`,
        [
          runId,
          items.map((item) => item.mappingId),
          items.map((item) => item.status),
          items.map((item) => item.payloadHash),
          items.map((item) => item.error),
          items.map((item) => item.metafieldId),
        ],
      );
      await client.query(
        `UPDATE product_mappings pm SET last_sync_run_id = $1
         FROM unnest($2::bigint[]) selected(id) WHERE pm.id = selected.id`,
        [runId, items.map((item) => item.mappingId)],
      );
      const synced = items.filter((item) => item.status === "written" && item.syncedAt);
      if (synced.length) {
        await client.query(
          `UPDATE product_mappings pm
           SET last_synced_at = synced.synced_at::timestamptz
           FROM unnest($1::bigint[], $2::text[]) synced(id, synced_at)
           WHERE pm.id = synced.id`,
          [synced.map((item) => item.mappingId), synced.map((item) => item.syncedAt)],
        );
      }
      const cleaned = items.filter((item) => item.status === "written" && item.cleanup);
      if (cleaned.length) {
        await client.query(
          `UPDATE product_mappings SET last_synced_at = NULL WHERE id = ANY ($1::bigint[])`,
          [cleaned.map((item) => item.mappingId)],
        );
      }
    }
    const counters = { written: 0, unchanged: 0, skipped: 0, failed: 0 };
    for (const item of items) counters[item.status] += 1;
    const failed = fatalError ?? (counters.failed ? `${counters.failed} product(s) failed` : null);
    await client.query(
      `UPDATE sync_runs SET status = $2, products_total = $3, products_written = $4,
         products_unchanged = $5, products_skipped = $6, products_failed = $7,
         error_summary = $8, completed_at = now()
       WHERE id = $1`,
      [runId, failed ? "failed" : "completed", items.length, counters.written, counters.unchanged, counters.skipped, counters.failed, failed],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    (client as PoolClient).release();
  }
}

export async function runSyncWithDependencies(
  input: RunSyncInput,
  existingRunId: number | undefined,
  dependencies: SyncEngineDependencies,
): Promise<void> {
  const runId = await createOrStartRun(input, existingRunId, dependencies.database);
  const items: RunItem[] = [];
  try {
    const mappings = await loadMappings(input, dependencies.database);
    const stylesByMapping = new Map(mappings.map((mapping) => [Number(mapping.id), activeStyles(mapping)]));
    const uniqueStyles = new Map<string, RepSparkStyleKey>();
    for (const styles of stylesByMapping.values()) {
      for (const style of styles) uniqueStyles.set(`${normalizeMatchKey(style.brandName)}\0${normalizeMatchKey(style.productNumber)}`, style);
    }
    const inventory = await dependencies.fetchInventory([...uniqueStyles.values()]);
    const groupedInventory = groupInventory(inventory);
    const pending: PendingWrite[] = [];
    const stale: MappingRow[] = [];
    const now = dependencies.now();

    for (const mapping of mappings) {
      const mappingId = Number(mapping.id);
      const styles = stylesByMapping.get(mappingId) ?? [];
      if (!styles.length) {
        // Previously-synced products always get a row so a now-out-of-scope one
        // is cleaned up (its metafield removed). Never-synced products that are
        // intentionally excluded (ignored vendor/status, disabled or absent brand)
        // produce no row at all; only genuinely in-scope-but-unmatched ones do.
        if (mapping.lastSyncedAt) stale.push(mapping);
        else if (!isExcludedMapping(mapping)) items.push({ mappingId, ownerId: mapping.shopifyProductGid, status: "skipped", payloadHash: null, error: "no matched styles for an in-scope product", metafieldId: null });
        continue;
      }
      const rows = inventoryForStyles(styles, groupedInventory);
      const built = buildInventoryPayload({
        brand: mapping.brandName!, styles, current: rows.current, future: rows.future,
        cap: mapping.maxDisplayCap ?? mapping.defaultCap, horizonDays: mapping.horizonDays,
        showFutureInventory: mapping.showFutureInventory,
        now, maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
      });
      if (!built.payload || !built.hash || !built.json) {
        items.push({
          mappingId, ownerId: mapping.shopifyProductGid, status: "failed", payloadHash: null,
          error: built.issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; "), metafieldId: null,
        });
        continue;
      }
      if (mapping.lastSyncedAt && mapping.latestPayloadHash === built.hash) {
        built.payload.synced_at = new Date(mapping.lastSyncedAt).toISOString();
        built.json = stableStringify(built.payload);
        items.push({ mappingId, ownerId: mapping.shopifyProductGid, status: "unchanged", payloadHash: built.hash, error: null, metafieldId: null });
        continue;
      }
      pending.push({
        mapping, mappingId, hash: built.hash, syncedAt: built.payload.synced_at,
        write: { ownerId: mapping.shopifyProductGid, value: built.json },
      });
    }

    if (input.dryRun) {
      items.push(...pending.map((item) => ({
        mappingId: item.mappingId, ownerId: item.write.ownerId, status: "written" as const,
        payloadHash: item.hash, error: null, metafieldId: null,
      })));
      items.push(...stale.map((mapping) => ({
        mappingId: Number(mapping.id), ownerId: mapping.shopifyProductGid, status: "written" as const,
        payloadHash: null, error: null, metafieldId: null,
      })));
    } else if (pending.length || stale.length) {
      const shopify = await dependencies.createShopifyClient();
      if (pending.length) await shopify.ensureInventoryMetafieldDefinition();
      for (let index = 0; index < pending.length; index += SHOPIFY_BATCH_SIZE) {
        items.push(...await writeWithIsolation(shopify, pending.slice(index, index + SHOPIFY_BATCH_SIZE)));
      }
      for (let index = 0; index < stale.length; index += SHOPIFY_BATCH_SIZE) {
        items.push(...await cleanupWithIsolation(shopify, stale.slice(index, index + SHOPIFY_BATCH_SIZE), dependencies.cleanupMode));
      }
    }
    await persistResults(runId, items, dependencies.database);
    const failures = items.filter((item) => item.status === "failed");
    if (failures.length) throw new Error(`${failures.length} product(s) failed during sync`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!items.some((item) => item.status === "failed")) await persistResults(runId, items, dependencies.database, message);
    throw error;
  }
}

export async function runSync(input: RunSyncInput, existingRunId?: number): Promise<void> {
  return runSyncWithDependencies(input, existingRunId, defaultDependencies());
}
