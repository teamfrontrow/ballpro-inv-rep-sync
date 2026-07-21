import { createHash } from "node:crypto";

import type { InventoryPayload } from "@/lib/domain";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";

import {
  assertApiVersion,
  DEFAULT_SHOPIFY_API_VERSION,
  INVENTORY_METAFIELD_KEY,
  INVENTORY_METAFIELD_NAMESPACE,
  MAX_METAFIELDS_SET_BATCH_SIZE,
  normalizeShopDomain,
} from "./constants";
import { loadShopifyCredentials } from "./installations";

type JsonObject = Record<string, unknown>;
type Variables = Record<string, unknown>;

export interface GraphQLProblem {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string; [key: string]: unknown };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLProblem[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
    };
  };
}

export interface ShopifyLogger {
  debug(message: string, details?: JsonObject): void;
  info(message: string, details?: JsonObject): void;
  warn(message: string, details?: JsonObject): void;
}

const defaultLogger: ShopifyLogger = {
  debug: (message, details) => console.debug(message, details ?? ""),
  info: (message, details) => console.info(message, details ?? ""),
  warn: (message, details) => console.warn(message, details ?? ""),
};

export class ShopifyGraphQLError extends Error {
  constructor(
    message: string,
    readonly problems: GraphQLProblem[],
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

class NonRetryableShopifyError extends Error {}

export interface ShopifyClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  logger?: ShopifyLogger;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 150);
}

function throttleDelay(response: GraphQLResponse<unknown>, attempt: number): number {
  const cost = response.extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status?.restoreRate) return retryDelay(attempt);
  const deficit = Math.max(1, (cost?.requestedQueryCost ?? 1) - status.currentlyAvailable);
  return Math.max(250, Math.ceil((deficit / status.restoreRate) * 1_000) + 100);
}

function userErrorMessage(errors: ShopifyUserError[]): string {
  return errors.map((error) => `${error.field?.join(".") ?? "input"}: ${error.message}`).join("; ");
}

export class ShopifyAdminClient {
  readonly shopDomain: string;
  readonly apiVersion: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: ShopifyLogger;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private loggedApiVersion = false;

  constructor(private readonly options: ShopifyClientOptions) {
    this.shopDomain = normalizeShopDomain(options.shopDomain);
    this.apiVersion = assertApiVersion(options.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION);
    this.endpoint = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? defaultLogger;
    this.maxRetries = options.maxRetries ?? 4;
    this.sleep = options.sleep ?? delay;
  }

  async request<T>(query: string, variables: Variables = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": this.options.accessToken,
          },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
        });
        this.assertResponseApiVersion(response);

        if (response.status === 429 || response.status >= 500) {
          if (attempt === this.maxRetries) throw new Error(`Shopify Admin API HTTP ${response.status}`);
          const retryAfter = Number(response.headers.get("retry-after"));
          await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : retryDelay(attempt));
          continue;
        }

        const payload = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
        if (!response.ok || !payload) {
          throw new Error(`Shopify Admin API request failed (${response.status})`);
        }
        if (payload.errors?.length) {
          const throttled = payload.errors.some((problem) => problem.extensions?.code === "THROTTLED");
          if (throttled && attempt < this.maxRetries) {
            await this.sleep(throttleDelay(payload, attempt));
            continue;
          }
          throw new ShopifyGraphQLError(userErrorMessage(payload.errors), payload.errors, response.status);
        }
        if (payload.data === undefined) throw new Error("Shopify Admin API returned no data");

        const throttle = payload.extensions?.cost?.throttleStatus;
        if (throttle && throttle.currentlyAvailable < Math.max(10, throttle.maximumAvailable * 0.05)) {
          const wait = Math.ceil(((Math.max(10, throttle.maximumAvailable * 0.1) - throttle.currentlyAvailable) / throttle.restoreRate) * 1_000);
          if (wait > 0) await this.sleep(wait);
        }
        return payload.data;
      } catch (error) {
        lastError = error;
        if (error instanceof ShopifyGraphQLError || error instanceof NonRetryableShopifyError || attempt === this.maxRetries) throw error;
        this.logger.warn("Retrying Shopify Admin GraphQL request", {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sleep(retryDelay(attempt));
      }
    }
    throw lastError;
  }

  private assertResponseApiVersion(response: Response): void {
    const actual = response.headers.get("x-shopify-api-version");
    if (!actual) {
      this.logger.warn("Shopify response omitted X-Shopify-API-Version", { requested: this.apiVersion });
      return;
    }
    if (actual !== this.apiVersion) {
      throw new NonRetryableShopifyError(`Shopify API version mismatch: requested ${this.apiVersion}, received ${actual}`);
    }
    if (!this.loggedApiVersion) {
      this.logger.info("Shopify Admin API version confirmed", { apiVersion: actual });
      this.loggedApiVersion = true;
    }
  }

  async shopHealth(): Promise<ShopHealth> {
    const data = await this.request<{ shop: ShopHealth }>(`#graphql
      query ShopHealth {
        shop { id name myshopifyDomain primaryDomain { host url } }
      }
    `);
    return data.shop;
  }

  async ensureInventoryMetafieldDefinition(): Promise<MetafieldDefinitionResult> {
    const existing = await this.findInventoryMetafieldDefinition();
    if (existing) {
      if (existing.type.name !== "json" || existing.ownerType !== "PRODUCT") {
        throw new Error("custom.inventory_by_date exists with an incompatible owner or type");
      }
      return { definition: existing, created: false };
    }

    const data = await this.request<{
      metafieldDefinitionCreate: { createdDefinition: MetafieldDefinition | null; userErrors: ShopifyUserError[] };
    }>(`#graphql
      mutation CreateInventoryMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id namespace key name ownerType type { name } }
          userErrors { field message code }
        }
      }
    `, {
      definition: {
        name: "Inventory by date",
        namespace: INVENTORY_METAFIELD_NAMESPACE,
        key: INVENTORY_METAFIELD_KEY,
        description: "RepSpark current and dated incoming inventory by color and size.",
        ownerType: "PRODUCT",
        type: "json",
      },
    });
    const result = data.metafieldDefinitionCreate;
    if (result.userErrors.length || !result.createdDefinition) {
      throw new Error(`Unable to create inventory metafield definition: ${userErrorMessage(result.userErrors)}`);
    }
    await this.pinMetafieldDefinition(result.createdDefinition.id);
    return { definition: result.createdDefinition, created: true };
  }

  private async pinMetafieldDefinition(definitionId: string): Promise<void> {
    const data = await this.request<{
      metafieldDefinitionPin: { pinnedDefinition: { id: string } | null; userErrors: ShopifyUserError[] };
    }>(`#graphql
      mutation PinInventoryMetafieldDefinition($definitionId: ID!) {
        metafieldDefinitionPin(definitionId: $definitionId) {
          pinnedDefinition { id }
          userErrors { field message code }
        }
      }
    `, { definitionId });
    const result = data.metafieldDefinitionPin;
    if (result.userErrors.length || !result.pinnedDefinition) {
      throw new Error(`Unable to pin inventory metafield definition: ${userErrorMessage(result.userErrors)}`);
    }
  }

  private async findInventoryMetafieldDefinition(): Promise<MetafieldDefinition | null> {
    const data = await this.request<{ metafieldDefinitions: { nodes: MetafieldDefinition[] } }>(`#graphql
      query InventoryMetafieldDefinition($namespace: String!, $key: String!) {
        metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: $namespace, key: $key) {
          nodes { id namespace key name ownerType type { name } }
        }
      }
    `, { namespace: INVENTORY_METAFIELD_NAMESPACE, key: INVENTORY_METAFIELD_KEY });
    return data.metafieldDefinitions.nodes[0] ?? null;
  }

  async setInventoryMetafields(writes: InventoryMetafieldWrite[]): Promise<MetafieldWriteResult[]> {
    const results: MetafieldWriteResult[] = [];
    for (let index = 0; index < writes.length; index += MAX_METAFIELDS_SET_BATCH_SIZE) {
      results.push(...await this.setMetafieldBatch(writes.slice(index, index + MAX_METAFIELDS_SET_BATCH_SIZE)));
    }
    return results;
  }

  private async setMetafieldBatch(writes: InventoryMetafieldWrite[], conflictAttempt = 0): Promise<MetafieldWriteResult[]> {
    if (!writes.length) return [];
    const digests = await this.readInventoryMetafieldDigests(writes.map((write) => write.ownerId));
    const data = await this.request<{
      metafieldsSet: { metafields: Array<{ id: string; ownerType: string; compareDigest: string | null }>; userErrors: ShopifyUserError[] };
    }>(`#graphql
      mutation SetInventoryMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id ownerType compareDigest }
          userErrors { field message code }
        }
      }
    `, {
      metafields: writes.map((write) => ({
        ownerId: write.ownerId,
        namespace: INVENTORY_METAFIELD_NAMESPACE,
        key: INVENTORY_METAFIELD_KEY,
        type: "json",
        value: typeof write.value === "string" ? write.value : JSON.stringify(write.value),
        compareDigest: digests.get(write.ownerId) ?? null,
      })),
    });
    const mutation = data.metafieldsSet;
    if (!mutation.userErrors.length) {
      return mutation.metafields.map((metafield, index) => ({ ...metafield, ownerId: writes[index].ownerId }));
    }
    if (writes.length === 1) {
      const digestConflict = mutation.userErrors.some((error) =>
        error.code?.includes("DIGEST") || /compare\s*digest|compareDigest/i.test(error.message),
      );
      if (digestConflict && conflictAttempt < this.maxRetries) {
        this.logger.warn("Retrying metafield write after compareDigest conflict", {
          ownerId: writes[0].ownerId,
          attempt: conflictAttempt + 1,
        });
        await this.sleep(retryDelay(conflictAttempt));
        return this.setMetafieldBatch(writes, conflictAttempt + 1);
      }
      throw new Error(`metafieldsSet failed for ${writes[0].ownerId}: ${userErrorMessage(mutation.userErrors)}`);
    }

    this.logger.warn("Subdividing rejected metafieldsSet batch", {
      size: writes.length,
      errors: userErrorMessage(mutation.userErrors),
    });
    const midpoint = Math.ceil(writes.length / 2);
    const left = await this.setMetafieldBatch(writes.slice(0, midpoint));
    const right = await this.setMetafieldBatch(writes.slice(midpoint));
    return [...left, ...right];
  }

  async readInventoryMetafieldDigests(ownerIds: string[]): Promise<Map<string, string | null>> {
    if (!ownerIds.length) return new Map();
    const data = await this.request<{
      nodes: Array<null | { id: string; metafield: null | { compareDigest: string } }>;
    }>(`#graphql
      query InventoryMetafieldDigests($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            metafield(namespace: "${INVENTORY_METAFIELD_NAMESPACE}", key: "${INVENTORY_METAFIELD_KEY}") {
              compareDigest
            }
          }
        }
      }
    `, { ids: ownerIds });
    const result = new Map<string, string | null>();
    for (const node of data.nodes) if (node) result.set(node.id, node.metafield?.compareDigest ?? null);
    for (const ownerId of ownerIds) if (!result.has(ownerId)) result.set(ownerId, null);
    return result;
  }

  async deleteInventoryMetafields(ownerIds: string[]): Promise<string[]> {
    const deleted: string[] = [];
    for (let index = 0; index < ownerIds.length; index += MAX_METAFIELDS_SET_BATCH_SIZE) {
      const batch = ownerIds.slice(index, index + MAX_METAFIELDS_SET_BATCH_SIZE);
      const data = await this.request<{
        metafieldsDelete: { deletedMetafields: Array<{ ownerId: string }>; userErrors: ShopifyUserError[] };
      }>(`#graphql
        mutation DeleteInventoryMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }
      `, { metafields: batch.map((ownerId) => ({ ownerId, namespace: INVENTORY_METAFIELD_NAMESPACE, key: INVENTORY_METAFIELD_KEY })) });
      if (data.metafieldsDelete.userErrors.length) {
        throw new Error(`metafieldsDelete failed: ${userErrorMessage(data.metafieldsDelete.userErrors)}`);
      }
      deleted.push(...data.metafieldsDelete.deletedMetafields.map((item) => item.ownerId));
    }
    return deleted;
  }

  async tombstoneInventoryMetafields(ownerIds: string[], reason: "disabled" | "unmapped"): Promise<MetafieldWriteResult[]> {
    const syncedAt = new Date().toISOString();
    return this.setInventoryMetafields(ownerIds.map((ownerId) => ({
      ownerId,
      value: { schema: 1, status: "unavailable", reason, synced_at: syncedAt },
    })));
  }

  async readProducts(options: { preferBulk?: boolean; query?: string; pollIntervalMs?: number } = {}): Promise<ShopifyProduct[]> {
    if (options.preferBulk !== false) {
      try {
        return await this.bulkReadProducts(options);
      } catch (error) {
        this.logger.warn("Shopify bulk product read failed; using paginated fallback", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.paginatedReadProducts(options.query);
  }

  async bulkReadProducts(options: { query?: string; pollIntervalMs?: number } = {}): Promise<ShopifyProduct[]> {
    const productQuery = `{
      products${options.query ? `(query: ${JSON.stringify(options.query)})` : ""} {
        edges { node {
          id title handle vendor
          options { id name position optionValues { id name } }
          variants { edges { node { id title sku inventoryPolicy inventoryItem { tracked } selectedOptions { name value } } } }
        } }
      }
    }`;
    const started = await this.request<{
      bulkOperationRunQuery: { bulkOperation: null | { id: string; status: string }; userErrors: ShopifyUserError[] };
    }>(`#graphql
      mutation BulkReadProducts($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `, { query: productQuery });
    const operation = started.bulkOperationRunQuery;
    if (operation.userErrors.length || !operation.bulkOperation) {
      throw new Error(`Unable to start Shopify product bulk read: ${userErrorMessage(operation.userErrors)}`);
    }

    let completed: BulkOperation | null = null;
    for (let poll = 0; poll < 600; poll += 1) {
      const status = await this.request<{ currentBulkOperation: BulkOperation | null }>(`#graphql
        query ProductBulkReadStatus {
          currentBulkOperation(type: QUERY) { id status errorCode url partialDataUrl objectCount }
        }
      `);
      if (!status.currentBulkOperation || status.currentBulkOperation.id !== operation.bulkOperation.id) {
        throw new Error("Shopify product bulk operation disappeared before completion");
      }
      if (status.currentBulkOperation.status === "COMPLETED") {
        completed = status.currentBulkOperation;
        break;
      }
      if (["FAILED", "CANCELED", "EXPIRED"].includes(status.currentBulkOperation.status)) {
        throw new Error(`Shopify product bulk read ${status.currentBulkOperation.status}: ${status.currentBulkOperation.errorCode ?? "unknown error"}`);
      }
      await this.sleep(options.pollIntervalMs ?? 1_000);
    }
    if (!completed?.url) throw new Error("Shopify product bulk read timed out or returned no URL");
    const response = await this.fetchImpl(completed.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to download Shopify bulk product data (${response.status})`);
    return parseProductBulkJsonl(await response.text());
  }

  async paginatedReadProducts(query?: string): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let cursor: string | null = null;
    do {
      const data: { products: ProductConnection } = await this.request(PRODUCTS_PAGE_QUERY, { first: 100, after: cursor, query });
      for (const product of data.products.nodes) {
        if (product.variants.pageInfo.hasNextPage) {
          product.variants.nodes.push(...await this.readRemainingVariants(product.id, product.variants.pageInfo.endCursor));
          product.variants.pageInfo = { hasNextPage: false, endCursor: null };
        }
        products.push(product);
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (cursor);
    return products;
  }

  private async readRemainingVariants(productId: string, initialCursor: string | null): Promise<ShopifyVariant[]> {
    const variants: ShopifyVariant[] = [];
    let cursor = initialCursor;
    while (cursor) {
      const data: { product: null | { variants: VariantConnection } } = await this.request(VARIANTS_PAGE_QUERY, { id: productId, after: cursor });
      if (!data.product) throw new Error(`Shopify product disappeared while reading variants: ${productId}`);
      variants.push(...data.product.variants.nodes);
      cursor = data.product.variants.pageInfo.hasNextPage ? data.product.variants.pageInfo.endCursor : null;
    }
    return variants;
  }

  previewProductVariantsBulkCreate(input: VariantPreviewInput): VariantCreatePreview {
    const existing = new Set(input.existingVariants.map((variant) => variantKey(variant.optionValues)));
    const seen = new Set<string>();
    const additions: ProductVariantCreateInput[] = [];
    const warnings: string[] = [];
    for (const candidate of input.candidates) {
      const key = variantKey(candidate.optionValues);
      if (!candidate.sku?.trim()) warnings.push(`Variant ${key} has a blank SKU`);
      if (Object.values(candidate.optionValues).some((value) => /<[^>]+>/.test(value))) warnings.push(`Variant ${key} contains HTML in an option value`);
      if (!existing.has(key) && !seen.has(key)) {
        additions.push({
          sku: candidate.sku?.trim() || undefined,
          price: candidate.price,
          optionValues: Object.entries(candidate.optionValues).map(([optionName, name]) => ({ optionName, name })),
          inventoryPolicy: "CONTINUE",
          inventoryItem: { tracked: false },
        });
        seen.add(key);
      }
    }
    const maxVariants = input.maxVariants ?? 2_048;
    if (input.existingVariants.length + additions.length > maxVariants) {
      warnings.push(`Variant count would exceed configured limit ${maxVariants}`);
    }
    const signature = createHash("sha256").update(JSON.stringify([input.productId, additions])).digest("hex");
    return {
      productId: input.productId,
      existingCount: input.existingVariants.length,
      additions,
      warnings,
      canWrite: additions.length > 0 && input.existingVariants.length + additions.length <= maxVariants,
      signature,
    };
  }

  async productVariantsBulkCreate(preview: VariantCreatePreview, confirmation: { confirmed: true; signature: string }): Promise<ShopifyVariant[]> {
    if (!confirmation.confirmed || !safeSignature(preview.signature, confirmation.signature)) {
      throw new Error("Variant creation requires confirmation of the exact preview");
    }
    if (!preview.canWrite) throw new Error("Variant preview is not eligible to write");
    const created: ShopifyVariant[] = [];
    for (let index = 0; index < preview.additions.length; index += 250) {
      const data = await this.request<{
        productVariantsBulkCreate: { productVariants: ShopifyVariant[]; userErrors: ShopifyUserError[] };
      }>(`#graphql
        mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id title sku inventoryPolicy inventoryItem { tracked } selectedOptions { name value } }
            userErrors { field message code }
          }
        }
      `, { productId: preview.productId, variants: preview.additions.slice(index, index + 250) });
      if (data.productVariantsBulkCreate.userErrors.length) {
        throw new Error(`productVariantsBulkCreate failed: ${userErrorMessage(data.productVariantsBulkCreate.userErrors)}`);
      }
      created.push(...data.productVariantsBulkCreate.productVariants);
    }
    return created;
  }
}

const PRODUCTS_PAGE_QUERY = `#graphql
  query ProductsPage($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes {
        id title handle vendor
        options { id name position optionValues { id name } }
        variants(first: 100) {
          nodes { id title sku inventoryPolicy inventoryItem { tracked } selectedOptions { name value } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANTS_PAGE_QUERY = `#graphql
  query ProductVariantsPage($id: ID!, $after: String!) {
    product(id: $id) {
      variants(first: 100, after: $after) {
        nodes { id title sku inventoryPolicy inventoryItem { tracked } selectedOptions { name value } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function safeSignature(expected: string, received: string): boolean {
  return expected.length === received.length && expected === received;
}

function variantKey(values: Record<string, string>): string {
  return Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}:${value.trim().toLowerCase()}`).join("|");
}

export function parseProductBulkJsonl(jsonl: string): ShopifyProduct[] {
  const products = new Map<string, ShopifyProduct>();
  const pendingVariants = new Map<string, ShopifyVariant[]>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as (ShopifyProduct & { __parentId?: string }) | (ShopifyVariant & { __parentId?: string });
    if (item.__parentId) {
      const variant = { ...item } as ShopifyVariant & { __parentId?: string };
      delete variant.__parentId;
      const product = products.get(item.__parentId);
      if (product) product.variants.nodes.push(variant);
      else pendingVariants.set(item.__parentId, [...pendingVariants.get(item.__parentId) ?? [], variant]);
    } else {
      const product = item as ShopifyProduct;
      product.variants = { nodes: pendingVariants.get(product.id) ?? [], pageInfo: { hasNextPage: false, endCursor: null } };
      pendingVariants.delete(product.id);
      products.set(product.id, product);
    }
  }
  return [...products.values()];
}

export async function createShopifyAdminClient(): Promise<ShopifyAdminClient> {
  const config = env();
  const credentials = await loadShopifyCredentials({ config });
  const settings = await queryOne<{ shopify_api_version: string }>(
    "SELECT shopify_api_version FROM app_settings WHERE singleton = true",
  ).catch(() => null);
  return new ShopifyAdminClient({
    ...credentials,
    apiVersion: settings?.shopify_api_version ?? config.SHOPIFY_API_VERSION,
  });
}

// `code` is present only on specific user-error types (MetafieldsSetUserError,
// MetafieldDefinition*UserError, ProductVariantsBulkCreateUserError). The base
// `UserError` returned by metafieldsDelete and bulkOperationRunQuery has only
// field + message — do NOT select `code` in those mutations or Shopify rejects
// the whole query. `code` stays optional here so both shapes fit this type.
export interface ShopifyUserError { field?: string[]; message: string; code?: string }
export interface ShopHealth { id: string; name: string; myshopifyDomain: string; primaryDomain: { host: string; url: string } }
export interface MetafieldDefinition { id: string; namespace: string; key: string; name: string; ownerType: string; type: { name: string } }
export interface MetafieldDefinitionResult { definition: MetafieldDefinition; created: boolean }
export interface InventoryMetafieldWrite { ownerId: string; value: InventoryPayload | string | JsonObject }
export interface MetafieldWriteResult { id: string; ownerId: string; ownerType: string; compareDigest: string | null }
export interface ShopifySelectedOption { name: string; value: string }
export interface ShopifyVariant { id: string; title: string; sku: string | null; inventoryPolicy: string; inventoryItem: { tracked: boolean }; selectedOptions: ShopifySelectedOption[] }
export interface ShopifyProductOption { id: string; name: string; position: number; optionValues: Array<{ id: string; name: string }> }
export interface VariantConnection { nodes: ShopifyVariant[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
export interface ShopifyProduct { id: string; title: string; handle: string; vendor: string; options: ShopifyProductOption[]; variants: VariantConnection }
interface ProductConnection { nodes: ShopifyProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
interface BulkOperation { id: string; status: string; errorCode: string | null; url: string | null; partialDataUrl: string | null; objectCount: string }
export interface VariantCandidate { sku?: string; price?: string; optionValues: Record<string, string> }
export interface VariantPreviewInput { productId: string; existingVariants: Array<{ optionValues: Record<string, string> }>; candidates: VariantCandidate[]; maxVariants?: number }
export interface ProductVariantCreateInput { sku?: string; price?: string; optionValues: Array<{ optionName: string; name: string }>; inventoryPolicy: "CONTINUE"; inventoryItem: { tracked: false } }
export interface VariantCreatePreview { productId: string; existingCount: number; additions: ProductVariantCreateInput[]; warnings: string[]; canWrite: boolean; signature: string }
