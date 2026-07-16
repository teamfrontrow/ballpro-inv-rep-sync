import { describe, expect, it } from "vitest";

import type { ShopifyProduct } from "@/lib/shopify/client";

import { reconcileCatalog } from "./reconcile";

function product(id: string, vendor: string, skus: Array<string | null>): ShopifyProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    handle: `product-${id}`,
    vendor,
    options: [],
    variants: {
      nodes: skus.map((sku, index) => ({
        id: `gid://shopify/ProductVariant/${id}-${index}`,
        title: `Variant ${index}`,
        sku,
        inventoryPolicy: "DENY",
        inventoryItem: { tracked: false },
        selectedOptions: [],
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

describe("reconcileCatalog", () => {
  it("matches every distinct normalized style on a multi-style product", () => {
    const result = reconcileCatalog(
      [product("1", "Acme", ["A-one", "ONE", " two "])],
      [
        { brandName: "ACME", productNumber: "ONE" },
        { brandName: "Acme", productNumber: "TWO" },
      ],
    );

    expect(result.products[0]).toMatchObject({
      matchStatus: "auto",
      styles: [
        { normalizedSku: "ONE", repsparkProductNumber: "ONE", matchStatus: "auto" },
        { normalizedSku: "TWO", repsparkProductNumber: "TWO", matchStatus: "auto" },
      ],
    });
    expect(result.metrics[0]).toMatchObject({
      totalProducts: 1,
      anyStyleMatchedProducts: 1,
      allStylesMatchedProducts: 1,
      matchedStyles: 2,
      totalStyles: 2,
    });
  });

  it("reports partial products when only some distinct styles match", () => {
    const result = reconcileCatalog(
      [product("1", "Acme", ["A-ONE", "MISSING"])],
      [{ brandName: "Acme", productNumber: "ONE" }],
    );

    expect(result.products[0].matchStatus).toBe("partial");
    expect(result.products[0].styles.map((style) => style.matchStatus)).toEqual(["unmatched", "auto"]);
    expect(result.metrics[0]).toMatchObject({
      anyStyleMatchedProducts: 1,
      allStylesMatchedProducts: 0,
      matchedStyles: 1,
      totalStyles: 2,
    });
  });

  it("uses case-normalized explicit vendor aliases", () => {
    const result = reconcileCatalog(
      [product("1", "  SHOP VENDOR ", ["A-STYLE1"])],
      [{ brandName: "Rep Brand", productNumber: "STYLE1" }],
      [{ shopifyVendor: "shop vendor", repsparkBrand: "rep brand" }],
    );

    expect(result.products[0]).toMatchObject({ sourceBrandName: "Rep Brand", matchStatus: "auto" });
    expect(result.metrics[0]).toMatchObject({ brandName: "Rep Brand", shopifyVendor: "SHOP VENDOR" });
  });

  it("counts blank variants without creating blank style mappings", () => {
    const result = reconcileCatalog(
      [product("1", "Acme", [null, " ", "A-ONE"])],
      [{ brandName: "Acme", productNumber: "ONE" }],
    );

    expect(result.products[0]).toMatchObject({ blankSkuVariants: 2, matchStatus: "auto" });
    expect(result.products[0].styles).toHaveLength(1);
    expect(result.metrics[0]).toMatchObject({ blankSkuProducts: 1, blankSkuVariants: 2, totalStyles: 1 });
  });

  it("reports Shopify and normalized RepSpark style collisions", () => {
    const result = reconcileCatalog(
      [product("1", "Acme", ["ONE"]), product("2", "ACME", ["A-ONE"])],
      [
        { brandName: "Acme", productNumber: "ONE" },
        { brandName: "Acme", productNumber: "A-ONE" },
      ],
    );

    expect(result.products.every((item) => item.matchStatus === "unmatched")).toBe(true);
    expect(result.metrics[0]).toMatchObject({
      collisionStyles: 1,
      collisionProducts: 2,
      sourceStyleCollisions: 1,
      matchedStyles: 0,
    });
  });
});
