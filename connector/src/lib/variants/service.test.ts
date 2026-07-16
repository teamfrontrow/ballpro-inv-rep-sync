import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type {
  ProductVariantCreateInput,
  ShopifyProduct,
  ShopifyVariant,
  VariantCreatePreview,
} from "@/lib/shopify/client";

import { loadVariantSourceRows, StaleVariantPreviewError, VariantBackfillService } from "./service";
import type { VariantMapping, VariantShopifyClient, VariantSourceRow } from "./types";

const mapping: VariantMapping = {
  id: "7",
  shopifyProductGid: "gid://shopify/Product/123",
  shopifyHandle: "polo",
  shopifyTitle: "Performance Polo",
  shopifyVendor: "Brand",
  brandName: "Brand",
  styles: ["STYLE1"],
};

function product(options = ["Color", "Size"], variants: ShopifyVariant[] = [variant("1", "Red", "S", "EXISTING")]): ShopifyProduct {
  return {
    id: mapping.shopifyProductGid,
    title: mapping.shopifyTitle,
    handle: mapping.shopifyHandle,
    vendor: mapping.shopifyVendor,
    options: options.map((name, index) => ({ id: `option-${index}`, name, position: index + 1, optionValues: [] })),
    variants: { nodes: variants, pageInfo: { hasNextPage: false, endCursor: null } },
  };
}

function variant(id: string, color: string, size: string, sku: string | null): ShopifyVariant {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: `${color} / ${size}`,
    sku,
    inventoryPolicy: "CONTINUE",
    inventoryItem: { tracked: false },
    selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
  };
}

function previewCreate(input: Parameters<VariantShopifyClient["previewProductVariantsBulkCreate"]>[0]): VariantCreatePreview {
  const key = (values: Record<string, string>) => Object.entries(values).sort().map(([name, value]) => `${name.toLowerCase()}:${value.toLowerCase()}`).join("|");
  const existing = new Set(input.existingVariants.map((item) => key(item.optionValues)));
  const additions: ProductVariantCreateInput[] = input.candidates
    .filter((candidate) => !existing.has(key(candidate.optionValues)))
    .map((candidate) => ({
      sku: candidate.sku,
      optionValues: Object.entries(candidate.optionValues).map(([optionName, name]) => ({ optionName, name })),
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false },
    }));
  return { productId: input.productId, existingCount: input.existingVariants.length, additions, warnings: [], canWrite: additions.length > 0, signature: `client-${additions.length}` };
}

function setup(shopifyProduct: ShopifyProduct, rows: VariantSourceRow[]) {
  const state = { product: shopifyProduct, rows };
  const shopify: VariantShopifyClient = {
    readProducts: vi.fn(async () => [state.product]),
    previewProductVariantsBulkCreate: vi.fn(previewCreate),
    productVariantsBulkCreate: vi.fn(async (preview: VariantCreatePreview): Promise<ShopifyVariant[]> => preview.additions.map((addition: ProductVariantCreateInput, index: number) => variant(`new-${index}`, addition.optionValues[0].name, addition.optionValues[1].name, addition.sku ?? null))),
  };
  const service = new VariantBackfillService({
    loadMapping: vi.fn(async () => mapping),
    loadSourceRows: vi.fn(async () => state.rows),
    shopify,
    signingSecret: "test-signing-secret",
  });
  return { service, shopify, state };
}

describe("VariantBackfillService", () => {
  it("blocks a product without an existing Size option", async () => {
    const { service, shopify } = setup(product(["Color"]), [{ productNumber: "STYLE1", color: "Red", size: "M" }]);

    const preview = await service.preview(mapping.shopifyProductGid);

    expect(preview.canApply).toBe(false);
    expect(preview.blockingReasons).toContain("Shopify product has no Size option. Option creation or reordering requires separate approval.");
    await expect(service.apply(mapping.shopifyProductGid, preview.signature)).rejects.toThrow("Shopify product has no Size option");
    expect(shopify.productVariantsBulkCreate).not.toHaveBeenCalled();
  });

  it("returns only the additive source-backed variant diff", async () => {
    const { service } = setup(product(), [
      { productNumber: "STYLE1", color: "Red", size: "S" },
      { productNumber: "STYLE1", color: "Red", size: "M" },
      { productNumber: "UNMAPPED", color: "Blue", size: "L" },
    ]);

    const preview = await service.preview(mapping.shopifyProductGid);

    expect(preview.canApply).toBe(true);
    expect(preview.additions).toEqual([{
      sku: undefined,
      optionValues: [{ optionName: "Color", name: "Red" }, { optionName: "Size", name: "M" }],
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false },
    }]);
    expect(preview.warnings).toContain("New variants will use blank SKUs because RepSpark does not provide SKU values. This prevents generated values from affecting later catalog mapping.");
    expect(preview.existingCount).toBe(1);
  });

  it("rejects a stale signature after server-side source rebuild", async () => {
    const { service, shopify, state } = setup(product(), [{ productNumber: "STYLE1", color: "Red", size: "M" }]);
    const preview = await service.preview(mapping.shopifyProductGid);
    state.rows = [...state.rows, { productNumber: "STYLE1", color: "Blue", size: "L" }];

    await expect(service.apply(mapping.shopifyProductGid, preview.signature)).rejects.toBeInstanceOf(StaleVariantPreviewError);
    expect(shopify.productVariantsBulkCreate).not.toHaveBeenCalled();
  });

  it("blocks blank source color or size data", async () => {
    const { service, shopify } = setup(product(), [
      { productNumber: "STYLE1", color: " ", size: "M" },
      { productNumber: "STYLE1", color: "Blue", size: null },
    ]);

    const preview = await service.preview(mapping.shopifyProductGid);

    expect(preview.canApply).toBe(false);
    expect(preview.blockingReasons).toContain("2 RepSpark source row(s) have a blank color or size. Correct the source before applying.");
    expect(preview.additions).toHaveLength(0);
    expect(shopify.productVariantsBulkCreate).not.toHaveBeenCalled();
  });
});

describe("loadVariantSourceRows", () => {
  it("unions distinct current and future-only sizes without multiplying inventory rows", async () => {
    const rows: VariantSourceRow[] = [
      { productNumber: "STYLE1", color: "Red", size: "M" },
      { productNumber: "STYLE1", color: "Red", size: "XL" },
    ];
    const query = vi.fn().mockResolvedValue({ rows });

    const result = await loadVariantSourceRows(mapping, { query } as unknown as Pool);

    expect(result).toEqual(rows);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("SELECT DISTINCT");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("FROM variant_sizes vs");
    expect(sql).toContain("UNION");
    expect(sql).toContain("FROM variant_future_inventory vfi");
    expect(sql).not.toContain("JOIN variant_future_inventory");
    expect(values).toEqual(["Brand", ["STYLE1"]]);
  });
});
