import type { Pool } from "pg";
import { repsparkDb } from "@/lib/db";
import { normalizeMatchKey } from "@/lib/matching/normalize";

export interface RepSparkStyleKey {
  brandName: string;
  productNumber: string;
}

export interface RepSparkCurrentRow extends RepSparkStyleKey {
  variantId: string;
  color: string | null;
  size: string | null;
  quantity: number | string | null;
  sizeSequence: number | string | null;
  sourceUpdatedAt: Date | string | null;
}

export interface RepSparkFutureRow extends RepSparkStyleKey {
  variantId: string;
  color: string | null;
  size: string | null;
  quantity: number | string | null;
  availabilityDate: string | null;
  sourceUpdatedAt: Date | string | null;
}

export interface RepSparkBrandBlock {
  brandName: string;
  reason: string;
}

export interface RepSparkInventory {
  current: RepSparkCurrentRow[];
  future: RepSparkFutureRow[];
  // Brands whose source is not safe to read right now — a scrape is running, or
  // the latest one did not complete. No rows are returned for them; the caller
  // skips their products rather than publishing anything stale.
  notReady: RepSparkBrandBlock[];
}

interface SourceColumns {
  sizeCode: string;
  sizeSequence: string | null;
  freshnessByTable: Map<string, string>;
  tableColumns: Map<string, Set<string>>;
}

type Queryable = Pick<Pool, "query">;

let sourceColumnsPromise: Promise<SourceColumns> | undefined;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function discoverSourceColumns(db: Queryable): Promise<SourceColumns> {
  const result = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = ANY (current_schemas(false))
       AND table_name = ANY ($1::text[])`,
    [["brands", "products", "product_variants", "variant_sizes", "variant_future_inventory", "scrape_batches", "scrape_jobs", "scrape_runs"]],
  );
  const columns = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const tableColumns = columns.get(row.table_name) ?? new Set<string>();
    tableColumns.add(row.column_name);
    columns.set(row.table_name, tableColumns);
  }
  const sizes = columns.get("variant_sizes") ?? new Set<string>();
  const sizeCode = sizes.has("size_code") ? "size_code" : sizes.has("size") ? "size" : null;
  if (!sizeCode) throw new Error("RepSpark variant_sizes requires size_code or size");

  const sizeSequence = ["sequence", "size_sequence", "sort_order", "position"].find((name) => sizes.has(name)) ?? null;
  const freshnessCandidates = ["last_seen_at", "last_scraped_at", "scraped_at", "updated_at"];
  const freshnessByTable = new Map<string, string>();
  for (const table of ["brands", "products", "product_variants", "variant_sizes", "variant_future_inventory"]) {
    const freshness = freshnessCandidates.find((name) => columns.get(table)?.has(name));
    if (freshness) freshnessByTable.set(table, freshness);
  }
  return { sizeCode, sizeSequence, freshnessByTable, tableColumns: columns };
}

async function sourceColumns(db: Queryable): Promise<SourceColumns> {
  sourceColumnsPromise ??= discoverSourceColumns(db);
  return sourceColumnsPromise;
}

function keyRows(keys: RepSparkStyleKey[]): { brands: string[]; productNumbers: string[] } {
  const unique = new Map<string, RepSparkStyleKey>();
  for (const key of keys) {
    const brandName = key.brandName.trim();
    const productNumber = key.productNumber.trim();
    if (!brandName || !productNumber) continue;
    const brandKey = normalizeMatchKey(brandName);
    const productKey = normalizeMatchKey(productNumber);
    unique.set(`${brandKey}\0${productKey}`, { brandName: brandKey.toLowerCase(), productNumber: productKey });
  }
  const values = [...unique.values()];
  return {
    brands: values.map((value) => value.brandName),
    productNumbers: values.map((value) => value.productNumber),
  };
}

function childFreshnessExpression(columns: SourceColumns, table: string, alias: string): string {
  const column = columns.freshnessByTable.get(table);
  return column ? `${alias}.${quoteIdentifier(column)}` : "NULL::timestamptz";
}

function brandJoin(table: string, alias: string, columns: SourceColumns): string {
  const tableColumns = columns.tableColumns.get(table) ?? new Set<string>();
  if (tableColumns.has("brand_id")) return `${alias}.brand_id = b.id`;
  if (tableColumns.has("brand_name")) return `upper(trim(${alias}.brand_name)) = r.brand_key`;
  throw new Error(`RepSpark readiness cannot associate ${table} with a target brand`);
}

function activeJobTargetsBrand(columns: SourceColumns): string {
  const jobColumns = columns.tableColumns.get("scrape_jobs") ?? new Set<string>();
  if (jobColumns.has("brand_id")) return "sj.brand_id = b.id";
  if (jobColumns.has("brand_name")) return "upper(trim(sj.brand_name)) = r.brand_key";
  if (jobColumns.has("target_type") && jobColumns.has("brand_slugs")) {
    return `(lower(trim(sj.target_type)) = 'all_active' OR lower(trim(b.brand_slug)) = ANY (
      regexp_split_to_array(lower(COALESCE(sj.brand_slugs, '')), '\\s*,\\s*')
    ))`;
  }
  throw new Error("RepSpark readiness cannot associate scrape_jobs with a target brand");
}

function latestRunOrder(columns: SourceColumns): string {
  const runColumns = columns.tableColumns.get("scrape_runs") ?? new Set<string>();
  const names = ["started_at", "created_at", "id", "updated_at", "completed_at", "finished_at"]
    .filter((name) => runColumns.has(name));
  if (!names.length) throw new Error("RepSpark scrape_runs has no deterministic run ordering column");
  return names.map((name) => `sr.${quoteIdentifier(name)} DESC NULLS LAST`).join(", ");
}

/**
 * Which of the requested brands must not be read right now, and why.
 *
 * Returns rather than throws: one brand mid-scrape used to abort an entire
 * multi-brand sync, so a single failed scrape held every healthy brand hostage.
 * Each blocked brand is still fully fail-closed — no rows are fetched for it and
 * its products are skipped — but the rest of the run proceeds.
 */
async function repSparkBrandBlocks(
  db: Queryable,
  columns: SourceColumns,
  brands: string[],
): Promise<RepSparkBrandBlock[]> {
  for (const table of ["scrape_jobs", "scrape_runs"]) {
    const tableColumns = columns.tableColumns.get(table);
    if (!tableColumns?.has("status")) throw new Error(`RepSpark readiness requires ${table}.status`);
  }
  const requested = `WITH requested AS (
    SELECT DISTINCT upper(trim(brand_name)) AS brand_key
    FROM unnest($1::text[]) AS requested(brand_name)
  )`;
  const batchColumns = columns.tableColumns.get("scrape_batches") ?? new Set<string>();
  const activeBatchBlock = batchColumns.has("status")
    ? `UNION
       SELECT DISTINCT b.brand_name
       FROM requested r
       JOIN brands b ON upper(trim(b.brand_name)) = r.brand_key
       WHERE EXISTS (
         SELECT 1
         FROM scrape_batches sb
         WHERE lower(trim(sb.status)) = ANY ($2::text[])
            ${batchColumns.has("completed_at") ? "OR (sb.completed_at IS NULL AND lower(trim(coalesce(sb.status, 'running'))) NOT IN ('failed', 'canceled', 'cancelled'))" : ""}
       )`
    : "";
  const active = await db.query<{ brand_name: string }>(
    `${requested}
     SELECT DISTINCT b.brand_name
     FROM requested r
     JOIN brands b ON upper(trim(b.brand_name)) = r.brand_key
     JOIN scrape_jobs sj ON ${activeJobTargetsBrand(columns)}
     WHERE lower(trim(sj.status)) = ANY ($2::text[])
     ${activeBatchBlock}`,
    [brands, ["pending", "queued", "running", "processing"]],
  );
  const blocks = new Map<string, RepSparkBrandBlock>();
  for (const row of active.rows) {
    blocks.set(normalizeMatchKey(row.brand_name), {
      brandName: row.brand_name,
      reason: "a RepSpark scrape is active for this brand",
    });
  }

  const notReady = await db.query<{ brand_name: string; status: string | null }>(
    `${requested}
     SELECT b.brand_name,
            CASE WHEN coalesce(b.enabled, false) THEN latest.status ELSE 'source_disabled' END AS status
     FROM requested r
     JOIN brands b ON upper(trim(b.brand_name)) = r.brand_key
     LEFT JOIN LATERAL (
       SELECT sr.status
       FROM scrape_runs sr
       WHERE ${brandJoin("scrape_runs", "sr", columns)}
       ORDER BY ${latestRunOrder(columns)}
       LIMIT 1
     ) latest ON true
     WHERE coalesce(b.enabled, false) = false
        OR latest.status IS NULL
        OR lower(trim(latest.status)) <> ALL ($2::text[])`,
    [brands, ["completed", "complete", "success", "succeeded"]],
  );
  for (const row of notReady.rows) {
    const key = normalizeMatchKey(row.brand_name);
    if (blocks.has(key)) continue;
    blocks.set(key, {
      brandName: row.brand_name,
      reason: `latest RepSpark scrape is not complete (${row.status ?? "missing"})`,
    });
  }
  return [...blocks.values()];
}

async function fetchInventorySnapshot(
  keys: RepSparkStyleKey[],
  db: Queryable,
  assertReady = true,
): Promise<RepSparkInventory> {
  const { brands, productNumbers } = keyRows(keys);
  if (brands.length === 0) return { current: [], future: [], notReady: [] };
  const columns = await sourceColumns(db);
  // The read-only verification view passes assertReady=false so it can show the
  // latest scraped numbers even while a scrape is running or a brand is not yet
  // "ready" — the sync engine keeps the default (fail closed).
  const notReady = assertReady ? await repSparkBrandBlocks(db, columns, brands) : [];
  // Readiness is decided inside the same repeatable-read snapshot as the rows
  // below, so a brand cannot pass the gate and then be read from a later state.
  const blocked = new Set(notReady.map((block) => normalizeMatchKey(block.brandName)));
  const ready = brands
    .map((brand, index) => ({ brand, productNumber: productNumbers[index] }))
    .filter(({ brand }) => !blocked.has(normalizeMatchKey(brand)));
  if (ready.length === 0) return { current: [], future: [], notReady };
  const sizeColumn = quoteIdentifier(columns.sizeCode);
  const sequence = columns.sizeSequence ? `vs.${quoteIdentifier(columns.sizeSequence)}` : "NULL::integer";
  // Parent timestamps cannot prove that child quantities were refreshed or removed.
  const currentFreshness = childFreshnessExpression(columns, "variant_sizes", "vs");
  const futureFreshness = childFreshnessExpression(columns, "variant_future_inventory", "vfi");
  const values = [ready.map((row) => row.brand), ready.map((row) => row.productNumber)];
  const requested = `WITH requested AS (
    SELECT upper(trim(brand_name)) AS brand_key, upper(trim(product_number)) AS product_key
    FROM unnest($1::text[], $2::text[]) AS requested(brand_name, product_number)
  )`;

  // Current and future quantities are intentionally independent to avoid a current x future join.
  const [currentResult, futureResult] = await Promise.all([
    db.query<RepSparkCurrentRow>(
      `${requested}
       SELECT b.brand_name AS "brandName", p.product_number AS "productNumber",
              pv.id::text AS "variantId", pv.color, vs.${sizeColumn} AS size,
              vs.ats_now AS quantity, ${sequence} AS "sizeSequence",
              ${currentFreshness} AS "sourceUpdatedAt"
       FROM requested r
       JOIN brands b ON upper(trim(b.brand_name)) = r.brand_key
       JOIN products p ON p.brand_id = b.id AND upper(trim(p.product_number)) = r.product_key
       JOIN product_variants pv ON pv.product_id = p.id
       JOIN variant_sizes vs ON vs.variant_id = pv.id`,
      values,
    ),
    db.query<RepSparkFutureRow>(
      `${requested}
       SELECT b.brand_name AS "brandName", p.product_number AS "productNumber",
              pv.id::text AS "variantId", pv.color, vfi.size_code AS size,
              vfi.quantity, vfi.availability_date AS "availabilityDate",
              ${futureFreshness} AS "sourceUpdatedAt"
       FROM requested r
       JOIN brands b ON upper(trim(b.brand_name)) = r.brand_key
       JOIN products p ON p.brand_id = b.id AND upper(trim(p.product_number)) = r.product_key
       JOIN product_variants pv ON pv.product_id = p.id
       JOIN variant_future_inventory vfi ON vfi.variant_id = pv.id`,
      values,
    ),
  ]);
  return { current: currentResult.rows, future: futureResult.rows, notReady };
}

export async function fetchRepSparkInventory(
  keys: RepSparkStyleKey[],
  db: Pool = repsparkDb(),
  options: { assertReady?: boolean } = {},
): Promise<RepSparkInventory> {
  const assertReady = options.assertReady ?? true;
  if (keys.length === 0) return { current: [], future: [], notReady: [] };
  if (typeof db.connect !== "function") return fetchInventorySnapshot(keys, db, assertReady);

  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const inventory = await fetchInventorySnapshot(keys, client, assertReady);
    await client.query("COMMIT");
    return inventory;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function resetRepSparkSchemaCacheForTests(): void {
  sourceColumnsPromise = undefined;
}
