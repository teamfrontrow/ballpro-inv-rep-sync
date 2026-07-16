import type { PoolClient } from "pg";

import type { CatalogReconciliation, RepSparkCatalogPair } from "./types";

export interface CatalogPersistCounts {
  brandsUpserted: number;
  productsUpserted: number;
  stylesUpserted: number;
}

interface PersistedBrand {
  id: number;
  brandName: string;
}

function brandSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Cannot derive a brand slug from ${JSON.stringify(value)}`);
  return slug;
}

export async function persistCatalog(
  client: PoolClient,
  reconciliation: CatalogReconciliation,
  repsparkPairs: RepSparkCatalogPair[],
): Promise<CatalogPersistCounts> {
  const sourceBrands = new Map<string, { name: string; slug: string }>();
  for (const pair of repsparkPairs) {
    const name = pair.brandName.trim();
    if (!name) continue;
    sourceBrands.set(name.toUpperCase(), { name, slug: pair.brandSlug?.trim() || brandSlug(name) });
  }

  const vendorBySource = new Map<string, string>();
  for (const product of reconciliation.products) {
    if (product.sourceBrandName && !vendorBySource.has(product.sourceBrandName.toUpperCase())) {
      vendorBySource.set(product.sourceBrandName.toUpperCase(), product.shopifyProduct.vendor.trim());
    }
  }

  const brands = new Map<string, PersistedBrand>();
  for (const [key, sourceBrand] of sourceBrands) {
    const result = await client.query<{ id: number; brand_name: string }>(
      `INSERT INTO brands (brand_slug, brand_name, shopify_vendor)
       VALUES ($1, $2, $3)
       ON CONFLICT (brand_slug) DO UPDATE
         SET brand_name = EXCLUDED.brand_name,
             shopify_vendor = EXCLUDED.shopify_vendor,
             updated_at = now()
       RETURNING id, brand_name`,
      [sourceBrand.slug, sourceBrand.name, vendorBySource.get(key) ?? sourceBrand.name],
    );
    brands.set(key, { id: result.rows[0].id, brandName: result.rows[0].brand_name });
  }

  let stylesUpserted = 0;
  for (const product of reconciliation.products) {
    const brandId = product.sourceBrandName
      ? brands.get(product.sourceBrandName.toUpperCase())?.id ?? null
      : null;
    const mapping = await client.query<{ id: number }>(
      `INSERT INTO product_mappings
         (shopify_product_gid, shopify_handle, shopify_vendor, shopify_title,
          brand_id, match_status, match_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (shopify_product_gid) DO UPDATE
         SET shopify_handle = EXCLUDED.shopify_handle,
             shopify_vendor = EXCLUDED.shopify_vendor,
             shopify_title = EXCLUDED.shopify_title,
             brand_id = CASE
               WHEN product_mappings.match_status IN ('manual', 'ignored') THEN product_mappings.brand_id
               ELSE EXCLUDED.brand_id
             END,
             match_status = CASE
               WHEN product_mappings.match_status IN ('manual', 'ignored') THEN product_mappings.match_status
               ELSE EXCLUDED.match_status
             END,
             match_source = CASE
               WHEN product_mappings.match_status IN ('manual', 'ignored') THEN product_mappings.match_source
               ELSE EXCLUDED.match_source
             END,
             updated_at = now()
       RETURNING id`,
      [
        product.shopifyProduct.id,
        product.shopifyProduct.handle,
        product.shopifyProduct.vendor,
        product.shopifyProduct.title,
        brandId,
        product.matchStatus,
        product.matchSource,
      ],
    );
    const mappingId = mapping.rows[0].id;
    for (const style of product.styles) {
      await client.query(
        `INSERT INTO product_mapping_styles
           (product_mapping_id, normalized_sku, repspark_product_number, match_status, match_source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_mapping_id, normalized_sku) DO UPDATE
           SET repspark_product_number = CASE
                 WHEN product_mapping_styles.match_status IN ('manual', 'ignored')
                   THEN product_mapping_styles.repspark_product_number
                 ELSE EXCLUDED.repspark_product_number
               END,
               match_status = CASE
                 WHEN product_mapping_styles.match_status IN ('manual', 'ignored')
                   THEN product_mapping_styles.match_status
                 ELSE EXCLUDED.match_status
               END,
               match_source = CASE
                 WHEN product_mapping_styles.match_status IN ('manual', 'ignored')
                   THEN product_mapping_styles.match_source
                 ELSE EXCLUDED.match_source
               END,
               updated_at = now()`,
        [mappingId, style.normalizedSku, style.repsparkProductNumber, style.matchStatus, style.matchSource],
      );
      stylesUpserted += 1;
    }
    await client.query(
      `DELETE FROM product_mapping_styles
        WHERE product_mapping_id = $1
          AND match_status NOT IN ('manual', 'ignored')
          AND NOT (normalized_sku = ANY($2::text[]))`,
      [mappingId, product.styles.map((style) => style.normalizedSku)],
    );
  }

  return {
    brandsUpserted: brands.size,
    productsUpserted: reconciliation.products.length,
    stylesUpserted,
  };
}
