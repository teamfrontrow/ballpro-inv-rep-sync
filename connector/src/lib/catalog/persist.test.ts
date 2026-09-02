import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { persistCatalog } from "./persist";
import type { CatalogReconciliation, ReconciledCatalogProduct } from "./types";

/**
 * A client that answers the two counting queries with fixed numbers and records
 * every statement. Everything else returns an id, which is all persistCatalog
 * reads from the upserts.
 */
function fakeClient(counts: { absent: number; total: number }) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      // Order matters: the UPDATE carries the same WHERE clause as the count,
      // so it has to be matched first.
      if (sql.includes("SET shopify_absent_since = now()")) {
        return Promise.resolve({ rows: [], rowCount: counts.absent });
      }
      if (sql.includes("WHERE shopify_absent_since IS NULL AND NOT")) {
        return Promise.resolve({ rows: [{ count: String(counts.absent) }], rowCount: 1 });
      }
      if (sql.includes("SELECT count(*) AS count FROM product_mappings")) {
        return Promise.resolve({ rows: [{ count: String(counts.total) }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
    },
  } as unknown as PoolClient;
  return { client, statements };
}

function reconciled(id: string): ReconciledCatalogProduct {
  return {
    shopifyProduct: {
      id: `gid://shopify/Product/${id}`,
      handle: `handle-${id}`,
      title: `Product ${id}`,
      vendor: "Test Vendor",
      options: [],
      variants: { nodes: [] },
    },
    sourceBrandName: "Test Brand",
    matchStatus: "unmatched",
    matchSource: "catalog-unmatched",
    styles: [],
    blankSkuVariants: 0,
  } as unknown as ReconciledCatalogProduct;
}

function reconciliation(ids: string[]): CatalogReconciliation {
  return { products: ids.map(reconciled), metrics: [] };
}

describe("persistCatalog", () => {
  /*
   * The crawl reads the whole store, so a mapping whose GID it did not return is
   * a product that has been deleted. Before this, nothing recorded that: the
   * table only ever grew, and deleted products kept being synced -- which is
   * what produces "Owner does not exist" on every run, forever.
   */
  it("marks mappings whose Shopify product was absent from the crawl", async () => {
    const { client, statements } = fakeClient({ absent: 2, total: 100 });
    const counts = await persistCatalog(client, reconciliation(["1", "2"]), []);

    expect(counts.mappingsMarkedAbsent).toBe(2);
    const update = statements.find((s) => s.sql.includes("SET shopify_absent_since = now()"));
    expect(update).toBeDefined();
    // Scoped by the GIDs the crawl actually returned, never by brand or vendor.
    expect(update?.params[0]).toEqual([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
    ]);
  });

  it("clears the flag for a product that came back", async () => {
    const { client, statements } = fakeClient({ absent: 0, total: 100 });
    await persistCatalog(client, reconciliation(["1"]), []);

    // The upsert resets it, so a product deleted and restored in Shopify starts
    // syncing again on the next crawl with no manual step.
    const upsert = statements.find((s) => s.sql.includes("INSERT INTO product_mappings"));
    expect(upsert?.sql).toContain("shopify_absent_since = NULL");
  });

  it("does nothing when every mapping was found", async () => {
    const { client, statements } = fakeClient({ absent: 0, total: 100 });
    const counts = await persistCatalog(client, reconciliation(["1", "2"]), []);

    expect(counts.mappingsMarkedAbsent).toBe(0);
    expect(statements.some((s) => s.sql.includes("SET shopify_absent_since = now()"))).toBe(false);
  });

  /*
   * The dangerous path. A bulk operation that silently truncates looks exactly
   * like a store that lost most of its products, and acting on it would stop
   * syncing hundreds of live products at once. Refusing is recoverable; a mass
   * mark is noticed days later, as a stale storefront.
   */
  it("refuses to mark a suspicious share of the table absent", async () => {
    const { client, statements } = fakeClient({ absent: 40, total: 100 });

    await expect(persistCatalog(client, reconciliation(["1"]), [])).rejects.toThrow(
      /over the 25% guard/,
    );
    expect(statements.some((s) => s.sql.includes("SET shopify_absent_since = now()"))).toBe(false);
  });

  it("allows a small sweep on a small table", async () => {
    // 1 of 8 is under the guard; the floor of max(1, ...) must not block it.
    const { client } = fakeClient({ absent: 1, total: 8 });
    const counts = await persistCatalog(client, reconciliation(["1"]), []);
    expect(counts.mappingsMarkedAbsent).toBe(1);
  });
});
