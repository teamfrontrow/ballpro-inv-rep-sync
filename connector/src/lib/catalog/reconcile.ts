import { normalizeMatchKey, normalizeShopifySku } from "@/lib/matching/normalize";
import type { ShopifyProduct } from "@/lib/shopify/client";

import type {
  BrandAliasMap,
  CatalogBrandMetric,
  CatalogReconciliation,
  ReconciledCatalogProduct,
  RepSparkCatalogPair,
} from "./types";

export const DEFAULT_BRAND_ALIASES: BrandAliasMap = [
  { shopifyVendor: "AndersonOrd", repsparkBrand: "Anderson Ord" },
  { shopifyVendor: "Flag&Anthem", repsparkBrand: "Flag & Anthem" },
  { shopifyVendor: "Holderness&Bourne", repsparkBrand: "Holderness & Bourne" },
];

interface SourceBrand {
  brandName: string;
  styles: Map<string, Set<string>>;
}

function sourceCatalog(pairs: RepSparkCatalogPair[]): Map<string, SourceBrand> {
  const result = new Map<string, SourceBrand>();
  for (const pair of pairs) {
    const brandKey = normalizeMatchKey(pair.brandName);
    const styleKey = normalizeShopifySku(pair.productNumber);
    if (!brandKey || !styleKey) continue;
    const brand = result.get(brandKey) ?? { brandName: pair.brandName.trim(), styles: new Map() };
    const values = brand.styles.get(styleKey) ?? new Set<string>();
    values.add(pair.productNumber.trim());
    brand.styles.set(styleKey, values);
    result.set(brandKey, brand);
  }
  return result;
}

function aliasLookup(aliases: BrandAliasMap): Map<string, string> {
  const result = new Map<string, string>();
  for (const alias of aliases) {
    const vendor = normalizeMatchKey(alias.shopifyVendor);
    const source = normalizeMatchKey(alias.repsparkBrand);
    if (vendor && source) result.set(vendor, source);
  }
  return result;
}

function productStyles(product: ShopifyProduct): { styles: string[]; blankSkuVariants: number } {
  const styles = new Set<string>();
  let blankSkuVariants = 0;
  for (const variant of product.variants.nodes) {
    const normalized = normalizeShopifySku(variant.sku);
    if (normalized) styles.add(normalized);
    else blankSkuVariants += 1;
  }
  return { styles: [...styles].sort(), blankSkuVariants };
}

function productStatus(matched: number, total: number): Pick<ReconciledCatalogProduct, "matchStatus" | "matchSource"> {
  if (total > 0 && matched === total) return { matchStatus: "auto", matchSource: "catalog-auto" };
  if (matched > 0) return { matchStatus: "partial", matchSource: "catalog-partial" };
  return { matchStatus: "unmatched", matchSource: "catalog-unmatched" };
}

export function reconcileCatalog(
  shopifyProducts: ShopifyProduct[],
  repsparkPairs: RepSparkCatalogPair[],
  aliases: BrandAliasMap = DEFAULT_BRAND_ALIASES,
): CatalogReconciliation {
  const source = sourceCatalog(repsparkPairs);
  const aliasMap = aliasLookup(aliases);
  const products: ReconciledCatalogProduct[] = [];

  for (const shopifyProduct of shopifyProducts) {
    const vendorKey = normalizeMatchKey(shopifyProduct.vendor);
    const sourceBrand = source.get(vendorKey) ?? source.get(aliasMap.get(vendorKey) ?? "") ?? null;
    const extracted = productStyles(shopifyProduct);
    const styles = extracted.styles.map((normalizedSku) => {
      const sourceValues = sourceBrand?.styles.get(normalizedSku);
      const repsparkProductNumber = sourceValues?.size === 1 ? [...sourceValues][0] : null;
      return {
        normalizedSku,
        repsparkProductNumber,
        matchStatus: repsparkProductNumber ? "auto" as const : "unmatched" as const,
        matchSource: repsparkProductNumber ? "catalog-auto" as const : "catalog-unmatched" as const,
      };
    });
    const matched = styles.filter((style) => style.matchStatus === "auto").length;
    products.push({
      shopifyProduct,
      sourceBrandName: sourceBrand?.brandName ?? null,
      ...productStatus(matched, styles.length),
      styles,
      blankSkuVariants: extracted.blankSkuVariants,
    });
  }

  return { products, metrics: buildMetrics(products, source) };
}

function buildMetrics(
  products: ReconciledCatalogProduct[],
  source: Map<string, SourceBrand>,
): CatalogBrandMetric[] {
  const groups = new Map<string, ReconciledCatalogProduct[]>();
  for (const product of products) {
    const key = normalizeMatchKey(product.sourceBrandName ?? product.shopifyProduct.vendor) || "(BLANK VENDOR)";
    groups.set(key, [...groups.get(key) ?? [], product]);
  }

  const metrics = [...groups.entries()].map(([key, brandProducts]) => {
    const styleProducts = new Map<string, Set<string>>();
    for (const product of brandProducts) {
      for (const style of product.styles) {
        const owners = styleProducts.get(style.normalizedSku) ?? new Set<string>();
        owners.add(product.shopifyProduct.id);
        styleProducts.set(style.normalizedSku, owners);
      }
    }
    const collisions = [...styleProducts.values()].filter((owners) => owners.size > 1);
    const sourceBrand = source.get(key);
    return {
      brandName: brandProducts[0].sourceBrandName ?? (brandProducts[0].shopifyProduct.vendor.trim() || "(blank vendor)"),
      shopifyVendor: brandProducts[0].shopifyProduct.vendor.trim(),
      totalProducts: brandProducts.length,
      anyStyleMatchedProducts: brandProducts.filter((product) => product.styles.some((style) => style.matchStatus === "auto")).length,
      allStylesMatchedProducts: brandProducts.filter((product) => product.styles.length > 0 && product.styles.every((style) => style.matchStatus === "auto")).length,
      matchedStyles: brandProducts.reduce((total, product) => total + product.styles.filter((style) => style.matchStatus === "auto").length, 0),
      totalStyles: brandProducts.reduce((total, product) => total + product.styles.length, 0),
      blankSkuProducts: brandProducts.filter((product) => product.blankSkuVariants > 0).length,
      blankSkuVariants: brandProducts.reduce((total, product) => total + product.blankSkuVariants, 0),
      collisionStyles: collisions.length,
      collisionProducts: new Set(collisions.flatMap((owners) => [...owners])).size,
      sourceStyleCollisions: sourceBrand
        ? [...sourceBrand.styles.values()].filter((values) => values.size > 1).length
        : 0,
    };
  });
  for (const [key, sourceBrand] of source) {
    if (groups.has(key)) continue;
    metrics.push({
      brandName: sourceBrand.brandName,
      shopifyVendor: sourceBrand.brandName,
      totalProducts: 0,
      anyStyleMatchedProducts: 0,
      allStylesMatchedProducts: 0,
      matchedStyles: 0,
      totalStyles: 0,
      blankSkuProducts: 0,
      blankSkuVariants: 0,
      collisionStyles: 0,
      collisionProducts: 0,
      sourceStyleCollisions: [...sourceBrand.styles.values()].filter((values) => values.size > 1).length,
    });
  }
  return metrics.sort((left, right) => left.brandName.localeCompare(right.brandName));
}
