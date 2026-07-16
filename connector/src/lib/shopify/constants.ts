export const DEFAULT_SHOPIFY_API_VERSION = "2026-07";
export const INVENTORY_METAFIELD_NAMESPACE = "custom";
export const INVENTORY_METAFIELD_KEY = "inventory_by_date";
export const MAX_METAFIELDS_SET_BATCH_SIZE = 25;

export const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopDomain(value: string): string {
  const shop = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!SHOP_DOMAIN_PATTERN.test(shop)) throw new Error("Invalid Shopify shop domain");
  return shop;
}

export function assertApiVersion(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error(`Invalid Shopify API version: ${value}`);
  return value;
}
