import type { ProductVariantCreateInput, ShopifyProduct, ShopifyVariant, VariantCreatePreview } from "@/lib/shopify/client";

export interface VariantMapping {
  id: string;
  shopifyProductGid: string;
  shopifyHandle: string;
  shopifyTitle: string;
  shopifyVendor: string;
  brandName: string;
  styles: string[];
}

export interface VariantSourceRow {
  productNumber: string;
  color: string | null;
  size: string | null;
}

export interface VariantBackfillPreview {
  product: {
    gid: string;
    title: string;
    handle: string;
    vendor: string;
    options: string[];
  };
  mapping: VariantMapping;
  source: {
    rowCount: number;
    colors: string[];
    sizes: string[];
  };
  existingCount: number;
  additions: ProductVariantCreateInput[];
  warnings: string[];
  blockingReasons: string[];
  canApply: boolean;
  signature: string;
}

export interface VariantShopifyClient {
  readProducts(options?: { preferBulk?: boolean; query?: string; pollIntervalMs?: number }): Promise<ShopifyProduct[]>;
  previewProductVariantsBulkCreate(input: {
    productId: string;
    existingVariants: Array<{ optionValues: Record<string, string> }>;
    candidates: Array<{ sku?: string; optionValues: Record<string, string> }>;
  }): VariantCreatePreview;
  productVariantsBulkCreate(
    preview: VariantCreatePreview,
    confirmation: { confirmed: true; signature: string },
  ): Promise<ShopifyVariant[]>;
}

