export function normalizeShopifySku(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/^A-/, "") ?? "";
  return normalized || null;
}

export function normalizeMatchKey(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}
