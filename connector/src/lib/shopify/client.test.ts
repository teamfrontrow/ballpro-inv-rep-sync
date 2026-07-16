import { describe, expect, it, vi } from "vitest";

import { parseProductBulkJsonl, ShopifyAdminClient, type ProductVariantCreateInput } from "./client";

function graphQLResponse(data: unknown, apiVersion = "2026-07"): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Shopify-API-Version": apiVersion },
  });
}

describe("ShopifyAdminClient", () => {
  it("retries throttled GraphQL errors", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 } } },
      }), { status: 200, headers: { "X-Shopify-API-Version": "2026-07" } }))
      .mockResolvedValueOnce(graphQLResponse({ shop: { id: "gid://shopify/Shop/1", name: "Ball Pro" } }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token", fetchImpl, sleep });
    await expect(client.shopHealth()).resolves.toMatchObject({ name: "Ball Pro" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("asserts the response API version", async () => {
    const client = new ShopifyAdminClient({
      shopDomain: "ballproplusdev.myshopify.com",
      accessToken: "token",
      fetchImpl: vi.fn().mockResolvedValue(graphQLResponse({ shop: {} }, "2026-01")),
    });
    await expect(client.shopHealth()).rejects.toThrow("requested 2026-07, received 2026-01");
  });

  it("fresh-reads compareDigest and subdivides a rejected atomic batch", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (request.query.includes("InventoryMetafieldDigests")) {
        const ids = request.variables.ids as string[];
        return graphQLResponse({ nodes: ids.map((id) => ({ id, metafield: { compareDigest: `digest-${id}` } })) });
      }
      const metafields = request.variables.metafields as Array<{ ownerId: string; compareDigest: string }>;
      if (metafields.length > 1) {
        return graphQLResponse({ metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields", "1"], message: "Rejected item" }] } });
      }
      return graphQLResponse({ metafieldsSet: {
        metafields: [{ id: `metafield-${metafields[0].ownerId}`, ownerType: "PRODUCT", compareDigest: "updated" }],
        userErrors: [],
      } });
    });
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token", fetchImpl });
    const result = await client.setInventoryMetafields([
      { ownerId: "product-1", value: { status: "one" } },
      { ownerId: "product-2", value: { status: "two" } },
    ]);
    expect(result.map((item) => item.ownerId)).toEqual(["product-1", "product-2"]);
    const requests = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> });
    expect(requests.filter((request) => request.query.includes("InventoryMetafieldDigests"))).toHaveLength(3);
    const writes = requests.filter((request) => request.query.includes("SetInventoryMetafields"));
    expect(writes[0].variables.metafields).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerId: "product-1", compareDigest: "digest-product-1" }),
    ]));
  });

  it("creates then pins the inventory metafield definition with separate mutations", async () => {
    const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      requests.push(request);
      if (request.query.includes("CreateInventoryMetafieldDefinition")) {
        return graphQLResponse({ metafieldDefinitionCreate: {
          createdDefinition: { id: "definition-1", namespace: "custom", key: "inventory_by_date", name: "Inventory by date", ownerType: "PRODUCT", type: { name: "json" } },
          userErrors: [],
        } });
      }
      if (request.query.includes("query InventoryMetafieldDefinition")) {
        return graphQLResponse({ metafieldDefinitions: { nodes: [] } });
      }
      return graphQLResponse({ metafieldDefinitionPin: { pinnedDefinition: { id: "definition-1" }, userErrors: [] } });
    });
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token", fetchImpl });
    await expect(client.ensureInventoryMetafieldDefinition()).resolves.toMatchObject({ created: true });
    const createVariables = requests.find((request) => request.query.includes("CreateInventoryMetafieldDefinition"))?.variables;
    expect(createVariables?.definition).not.toHaveProperty("pin");
    expect(requests.at(-1)).toMatchObject({ variables: { definitionId: "definition-1" } });
    expect(requests.at(-1)?.query).toContain("metafieldDefinitionPin");
  });

  it("requires exact preview confirmation for additive variant writes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(graphQLResponse({ productVariantsBulkCreate: { productVariants: [], userErrors: [] } }));
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token", fetchImpl });
    const preview = client.previewProductVariantsBulkCreate({
      productId: "gid://shopify/Product/1",
      existingVariants: [{ optionValues: { Color: "Black", Size: "M" } }],
      candidates: [
        { sku: "EXISTING", optionValues: { Color: "Black", Size: "M" } },
        { sku: "NEW-L", optionValues: { Color: "Black", Size: "L" } },
      ],
    });
    expect(preview.additions).toHaveLength(1);
    expect(preview.additions[0]).toMatchObject({ inventoryPolicy: "CONTINUE", inventoryItem: { tracked: false } });
    await expect(client.productVariantsBulkCreate(preview, { confirmed: true, signature: "wrong" })).rejects.toThrow("exact preview");
    await expect(client.productVariantsBulkCreate(preview, { confirmed: true, signature: preview.signature })).resolves.toEqual([]);
  });

  it("defaults variant preview capacity to 2,048", () => {
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token" });
    const existingVariants = Array.from({ length: 2_047 }, (_, index) => ({
      optionValues: { Size: `Size ${index}` },
    }));
    const atLimit = client.previewProductVariantsBulkCreate({
      productId: "gid://shopify/Product/1",
      existingVariants,
      candidates: [{ sku: "LAST", optionValues: { Size: "Last size" } }],
    });
    expect(atLimit.canWrite).toBe(true);
    expect(atLimit.warnings).toEqual([]);

    const overLimit = client.previewProductVariantsBulkCreate({
      productId: "gid://shopify/Product/1",
      existingVariants: [...existingVariants, { optionValues: { Size: "Existing last" } }],
      candidates: [{ sku: "TOO-MANY", optionValues: { Size: "One too many" } }],
    });
    expect(overLimit.canWrite).toBe(false);
    expect(overLimit.warnings).toContain("Variant count would exceed configured limit 2048");
  });

  it("chunks confirmed variant additions at Shopify's 250-item input limit", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { variables: { variants: ProductVariantCreateInput[] } };
      return graphQLResponse({ productVariantsBulkCreate: { productVariants: request.variables.variants.map((variant, index) => ({
        id: `gid://shopify/ProductVariant/${index}`,
        title: "Created",
        sku: variant.sku ?? null,
        inventoryPolicy: "CONTINUE",
        inventoryItem: { tracked: false },
        selectedOptions: [],
      })), userErrors: [] } });
    });
    const client = new ShopifyAdminClient({ shopDomain: "ballproplusdev.myshopify.com", accessToken: "token", fetchImpl });
    const preview = client.previewProductVariantsBulkCreate({
      productId: "gid://shopify/Product/1",
      existingVariants: [],
      candidates: Array.from({ length: 251 }, (_, index) => ({ optionValues: { Color: "Black", Size: `Size ${index}` } })),
    });

    await expect(client.productVariantsBulkCreate(preview, { confirmed: true, signature: preview.signature })).resolves.toHaveLength(251);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const batchSizes = fetchImpl.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { variables: { variants: unknown[] } }).variables.variants.length);
    expect(batchSizes).toEqual([250, 1]);
  });

  it("parses bulk product JSONL with child variant records", () => {
    const product = { id: "gid://shopify/Product/1", title: "Polo", handle: "polo", vendor: "Brand", options: [] };
    const variant = { id: "gid://shopify/ProductVariant/2", __parentId: product.id, title: "Black / M", sku: "SKU", inventoryPolicy: "CONTINUE", inventoryItem: { tracked: false }, selectedOptions: [] };
    const parsed = parseProductBulkJsonl(`${JSON.stringify(product)}\n${JSON.stringify(variant)}\n`);
    expect(parsed[0].variants.nodes[0]).toMatchObject({ id: variant.id, sku: "SKU" });
  });
});
