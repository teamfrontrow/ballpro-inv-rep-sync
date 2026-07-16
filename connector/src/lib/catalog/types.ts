import type { ShopifyProduct } from "@/lib/shopify/client";

export interface BrandAlias {
  shopifyVendor: string;
  repsparkBrand: string;
}

export type BrandAliasMap = readonly BrandAlias[];

export interface RepSparkCatalogPair {
  brandName: string;
  brandSlug?: string;
  productNumber: string;
}

export type CatalogProductStatus = "auto" | "partial" | "unmatched";
export type CatalogStyleStatus = "auto" | "unmatched";

export interface ReconciledCatalogStyle {
  normalizedSku: string;
  repsparkProductNumber: string | null;
  matchStatus: CatalogStyleStatus;
  matchSource: "catalog-auto" | "catalog-unmatched";
}

export interface ReconciledCatalogProduct {
  shopifyProduct: ShopifyProduct;
  sourceBrandName: string | null;
  matchStatus: CatalogProductStatus;
  matchSource: "catalog-auto" | "catalog-partial" | "catalog-unmatched";
  styles: ReconciledCatalogStyle[];
  blankSkuVariants: number;
}

export interface CatalogBrandMetric {
  brandName: string;
  shopifyVendor: string;
  totalProducts: number;
  anyStyleMatchedProducts: number;
  allStylesMatchedProducts: number;
  matchedStyles: number;
  totalStyles: number;
  blankSkuProducts: number;
  blankSkuVariants: number;
  collisionStyles: number;
  collisionProducts: number;
  sourceStyleCollisions: number;
}

export interface CatalogReconciliation {
  products: ReconciledCatalogProduct[];
  metrics: CatalogBrandMetric[];
}

export type SourceReadinessIssueCode =
  | "active_scrape"
  | "latest_run_not_completed"
  | "no_current_size_rows"
  | "null_color_coverage"
  | "invalid_dates"
  | "source_schema";

export interface SourceReadinessIssue {
  code: SourceReadinessIssueCode;
  message: string;
  count?: number;
}

export interface BrandSourceReadiness {
  brandName: string;
  ready: boolean;
  latestRunStatus: string | null;
  currentSizeRows: number;
  variantRows: number;
  nullColorRows: number;
  invalidDateRows: number;
  issues: SourceReadinessIssue[];
}

export interface SourceReadinessReport {
  ready: boolean;
  checkedAt: string;
  globalIssues: SourceReadinessIssue[];
  brands: BrandSourceReadiness[];
}

export interface CatalogIngestReport {
  completedAt: string;
  shopifyProductsRead: number;
  repsparkPairsRead: number;
  brandsUpserted: number;
  productsUpserted: number;
  stylesUpserted: number;
  metrics: CatalogBrandMetric[];
  readiness: SourceReadinessReport;
}
