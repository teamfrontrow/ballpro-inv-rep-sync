import { createHmac, timingSafeEqual } from "node:crypto";

import type { Pool } from "pg";

import { connectorDb, repsparkDb } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeMatchKey } from "@/lib/matching/normalize";
import { createShopifyAdminClient, type VariantCreatePreview } from "@/lib/shopify/client";

import type {
  VariantBackfillPreview,
  VariantMapping,
  VariantShopifyClient,
  VariantSourceRow,
} from "./types";

export class VariantBackfillError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "VariantBackfillError";
  }
}

export class StaleVariantPreviewError extends VariantBackfillError {
  constructor() {
    super("The product, mapping, or RepSpark source changed after preview. Preview again before applying.", 409);
    this.name = "StaleVariantPreviewError";
  }
}

interface VariantBackfillDependencies {
  loadMapping(productGid: string): Promise<VariantMapping | null>;
  loadSourceRows(mapping: VariantMapping): Promise<VariantSourceRow[]>;
  shopify: VariantShopifyClient;
  signingSecret: string;
}

interface BuiltPreview {
  publicPreview: VariantBackfillPreview;
  clientPreview: VariantCreatePreview;
}

export class VariantBackfillService {
  constructor(private readonly dependencies: VariantBackfillDependencies) {}

  async preview(productGid: string): Promise<VariantBackfillPreview> {
    return (await this.build(productGid)).publicPreview;
  }

  async apply(productGid: string, signature: string): Promise<{ created: number; variants: Awaited<ReturnType<VariantShopifyClient["productVariantsBulkCreate"]>> }> {
    const rebuilt = await this.build(productGid);
    if (!safeEqual(rebuilt.publicPreview.signature, signature)) throw new StaleVariantPreviewError();
    if (!rebuilt.publicPreview.canApply) {
      throw new VariantBackfillError(rebuilt.publicPreview.blockingReasons[0] ?? "This preview is not eligible to apply", 409);
    }
    const variants = await this.dependencies.shopify.productVariantsBulkCreate(rebuilt.clientPreview, {
      confirmed: true,
      signature: rebuilt.clientPreview.signature,
    });
    return { created: variants.length, variants };
  }

  private async build(productGid: string): Promise<BuiltPreview> {
    assertProductGid(productGid);
    const mapping = await this.dependencies.loadMapping(productGid);
    if (!mapping) throw new VariantBackfillError("No mapped product was found for this Shopify product GID", 404);
    if (!mapping.styles.length) throw new VariantBackfillError("This product has no approved mapped RepSpark styles", 409);

    const [products, sourceRows] = await Promise.all([
      this.dependencies.shopify.readProducts({ preferBulk: false, query: `id:${productGid.split("/").at(-1)}` }),
      this.dependencies.loadSourceRows(mapping),
    ]);
    const product = products.find((candidate) => candidate.id === productGid);
    if (!product) throw new VariantBackfillError("The mapped Shopify product no longer exists", 404);

    const warnings: string[] = [];
    const blockingReasons: string[] = [];
    const optionNames = product.options.map((option) => option.name.trim());
    const colorOption = optionNames.find((name) => name.toLowerCase() === "color");
    const sizeOption = optionNames.find((name) => name.toLowerCase() === "size");
    if (!sizeOption) blockingReasons.push("Shopify product has no Size option. Option creation or reordering requires separate approval.");
    if (!colorOption) blockingReasons.push("Shopify product has no Color option. Option creation or reordering requires separate approval.");
    if (optionNames.length !== 2 || !colorOption || !sizeOption) {
      blockingReasons.push("Automatic backfill supports only existing products whose option set is exactly Color and Size.");
    }

    const mappedStyles = new Set(mapping.styles.map(normalizeMatchKey));
    const scopedRows = sourceRows.filter((row) => mappedStyles.has(normalizeMatchKey(row.productNumber)));
    const invalidRows = scopedRows.filter((row) => !row.color?.trim() || !row.size?.trim());
    if (!scopedRows.length) blockingReasons.push("No RepSpark color and size rows were found for the approved mapped styles.");
    if (invalidRows.length) {
      blockingReasons.push(`${invalidRows.length} RepSpark source row(s) have a blank color or size. Correct the source before applying.`);
    }

    const validRows = scopedRows.filter((row): row is VariantSourceRow & { color: string; size: string } => Boolean(row.color?.trim() && row.size?.trim()));
    const pairs = distinctPairs(validRows);
    if (pairs.length) {
      warnings.push("New variants will use blank SKUs because RepSpark does not provide SKU values. This prevents generated values from affecting later catalog mapping.");
    }
    const candidates = pairs.map((pair) => ({
        sku: undefined,
        optionValues: {
          [colorOption ?? "Color"]: pair.color,
          [sizeOption ?? "Size"]: pair.size,
        },
      }));
    const existingVariants = product.variants.nodes.map((variant) => ({
      optionValues: Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value])),
    }));
    const clientPreview = this.dependencies.shopify.previewProductVariantsBulkCreate({
      productId: product.id,
      existingVariants,
      candidates,
    });
    warnings.push(...clientPreview.warnings);
    if (!clientPreview.additions.length && !blockingReasons.length) warnings.push("All source-backed Color and Size combinations already exist in Shopify.");
    if (!clientPreview.canWrite && clientPreview.additions.length) {
      blockingReasons.push("Shopify rejected this addition set during preview, including the product variant limit check.");
    }

    const unsigned = {
      product: {
        gid: product.id,
        title: product.title,
        handle: product.handle,
        vendor: product.vendor,
        options: optionNames,
      },
      mapping,
      source: {
        rowCount: scopedRows.length,
        colors: sortedUnique(validRows.map((row) => row.color.trim())),
        sizes: sortedUnique(validRows.map((row) => row.size.trim())),
      },
      existingCount: clientPreview.existingCount,
      additions: clientPreview.additions,
      warnings: uniqueInOrder(warnings),
      blockingReasons: uniqueInOrder(blockingReasons),
      canApply: blockingReasons.length === 0 && clientPreview.canWrite,
    };
    return {
      publicPreview: { ...unsigned, signature: sign(unsigned, this.dependencies.signingSecret) },
      clientPreview,
    };
  }
}

export async function createVariantBackfillService(): Promise<VariantBackfillService> {
  const config = env();
  const signingSecret = config.TOKEN_ENCRYPTION_KEY ?? config.SHOPIFY_CLIENT_SECRET ?? config.SHOPIFY_ADMIN_TOKEN;
  if (!signingSecret) throw new Error("Variant preview signing requires TOKEN_ENCRYPTION_KEY, SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_TOKEN");
  return new VariantBackfillService({
    loadMapping: (productGid) => loadVariantMapping(productGid),
    loadSourceRows: (mapping) => loadVariantSourceRows(mapping),
    shopify: await createShopifyAdminClient(),
    signingSecret,
  });
}

export async function loadVariantMapping(productGid: string, db: Pool = connectorDb()): Promise<VariantMapping | null> {
  const result = await db.query<{
    id: string;
    shopify_product_gid: string;
    shopify_handle: string;
    shopify_title: string;
    shopify_vendor: string;
    brand_name: string | null;
    styles: string[];
  }>(
    `SELECT pm.id::text, pm.shopify_product_gid, pm.shopify_handle, pm.shopify_title,
            pm.shopify_vendor, b.brand_name,
            COALESCE(array_agg(DISTINCT trim(pms.repspark_product_number)) FILTER (
              WHERE pms.match_status IN ('auto', 'manual')
                AND nullif(trim(pms.repspark_product_number), '') IS NOT NULL
            ), ARRAY[]::text[]) AS styles
       FROM product_mappings pm
       LEFT JOIN brands b ON b.id = pm.brand_id
       LEFT JOIN product_mapping_styles pms ON pms.product_mapping_id = pm.id
      WHERE pm.shopify_product_gid = $1
      GROUP BY pm.id, b.brand_name`,
    [productGid],
  );
  const row = result.rows[0];
  if (!row?.brand_name) return null;
  return {
    id: row.id,
    shopifyProductGid: row.shopify_product_gid,
    shopifyHandle: row.shopify_handle,
    shopifyTitle: row.shopify_title,
    shopifyVendor: row.shopify_vendor,
    brandName: row.brand_name,
    styles: row.styles,
  };
}

export async function loadVariantSourceRows(mapping: VariantMapping, db: Pool = repsparkDb()): Promise<VariantSourceRow[]> {
  const result = await db.query<VariantSourceRow>(
    `SELECT DISTINCT p.product_number AS "productNumber", pv.color, source_size.size
       FROM brands b
       JOIN products p ON p.brand_id = b.id
       JOIN product_variants pv ON pv.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT vs.size_code AS size
           FROM variant_sizes vs
          WHERE vs.variant_id = pv.id
         UNION
         SELECT vfi.size_code AS size
           FROM variant_future_inventory vfi
          WHERE vfi.variant_id = pv.id
       ) source_size ON true
      WHERE upper(trim(b.brand_name)) = upper(trim($1))
        AND upper(trim(p.product_number)) = ANY($2::text[])
      ORDER BY p.product_number, pv.color, source_size.size`,
    [mapping.brandName, mapping.styles.map(normalizeMatchKey)],
  );
  return result.rows;
}

function distinctPairs(rows: Array<VariantSourceRow & { color: string; size: string }>) {
  const pairs = new Map<string, { productNumber: string; color: string; size: string }>();
  for (const row of rows) {
    const pair = { productNumber: row.productNumber.trim(), color: row.color.trim(), size: row.size.trim() };
    const key = `${pair.color.toLowerCase()}\0${pair.size.toLowerCase()}`;
    const current = pairs.get(key);
    if (!current || normalizeMatchKey(pair.productNumber).localeCompare(normalizeMatchKey(current.productNumber)) < 0) pairs.set(key, pair);
  }
  return [...pairs.values()].sort((a, b) => a.color.localeCompare(b.color) || a.size.localeCompare(b.size));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function sign(value: unknown, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}

function safeEqual(expected: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received) || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function assertProductGid(value: string): void {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(value)) throw new VariantBackfillError("Use a Shopify product GID such as gid://shopify/Product/123", 400);
}
