import { createHash } from "node:crypto";
import type { InventoryColor, InventoryPayload, InventorySize } from "@/lib/domain";
import { normalizeMatchKey } from "@/lib/matching/normalize";
import type { RepSparkCurrentRow, RepSparkFutureRow, RepSparkStyleKey } from "@/lib/repspark/inventory";

const CANONICAL_SIZE_ORDER = [
  "XXS", "XS", "S", "S/M", "M", "M/L", "L", "L/XL", "XL", "1XL", "2XL", "XXL",
  "3XL", "XXXL", "4XL", "5XL", "6XL", "OS", "OSFA", "ONE SIZE",
];
const SIZE_RANK = new Map(CANONICAL_SIZE_ORDER.map((size, index) => [size, index]));

export interface BuildInventoryPayloadInput {
  brand: string;
  styles: RepSparkStyleKey[];
  current: RepSparkCurrentRow[];
  future: RepSparkFutureRow[];
  cap: number | null;
  horizonDays: number;
  now?: Date;
  maxSourceAgeDays?: number;
}

export interface PayloadIssue {
  code: "source_missing" | "source_stale" | "null_color" | "empty_sizes" | "invalid_date";
  detail: string;
}

export interface BuiltInventoryPayload {
  payload: InventoryPayload | null;
  json: string | null;
  hash: string | null;
  issues: PayloadIssue[];
}

interface MutableSize {
  size: string;
  sequence: number | null;
  current: number;
  future: Map<string, number>;
}

function finiteQuantity(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function validIsoDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!isoMatch && !usMatch) return null;
  const year = Number(isoMatch?.[1] ?? usMatch?.[3]);
  const month = Number(isoMatch?.[2] ?? usMatch?.[1]);
  const day = Number(isoMatch?.[3] ?? usMatch?.[2]);
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

function canonicalStyleKey(brandName: string, productNumber: string): string {
  return `${normalizeMatchKey(brandName)}\0${normalizeMatchKey(productNumber)}`;
}

function compareSizes(a: MutableSize, b: MutableSize): number {
  if (a.sequence !== null || b.sequence !== null) {
    if (a.sequence === null) return 1;
    if (b.sequence === null) return -1;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  }
  const aRank = SIZE_RANK.get(a.size.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  const bRank = SIZE_RANK.get(b.size.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  return aRank - bRank || a.size.localeCompare(b.size, "en", { numeric: true, sensitivity: "base" });
}

function cappedQuantity(quantity: number, cap: number | null): { qty: number; capped: boolean } {
  if (cap !== null && quantity > cap) return { qty: cap, capped: true };
  return { qty: quantity, capped: false };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function payloadBusinessHash(payload: InventoryPayload): string {
  const businessData = { ...payload } as Partial<InventoryPayload>;
  delete businessData.synced_at;
  return createHash("sha256").update(stableStringify(businessData)).digest("hex");
}

export function buildInventoryPayload(input: BuildInventoryPayloadInput): BuiltInventoryPayload {
  const now = input.now ?? new Date();
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + input.horizonDays);
  const requested = new Set(input.styles.map((style) => canonicalStyleKey(style.brandName, style.productNumber)));
  const current = input.current.filter((row) => requested.has(canonicalStyleKey(row.brandName, row.productNumber)));
  const future = input.future.filter((row) => requested.has(canonicalStyleKey(row.brandName, row.productNumber)));
  const issues: PayloadIssue[] = [];

  const usableCurrent = current.filter((row) => row.variantId && row.color?.trim() && row.size?.trim());
  const usableFuture = future.flatMap((row) => {
    if (!row.variantId || !row.color?.trim() || !row.size?.trim()) return [];
    const date = validIsoDate(row.availabilityDate);
    if (!date) return [];
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    return dateValue >= today && dateValue <= horizon ? [{ row, date }] : [];
  });

  for (const style of input.styles) {
    const key = canonicalStyleKey(style.brandName, style.productNumber);
    const hasSourceRows = [...current, ...future]
      .some((row) => canonicalStyleKey(row.brandName, row.productNumber) === key);
    const hasUsableRows = usableCurrent
      .some((row) => canonicalStyleKey(row.brandName, row.productNumber) === key)
      || usableFuture.some(({ row }) => canonicalStyleKey(row.brandName, row.productNumber) === key);
    if (!hasSourceRows) {
      issues.push({ code: "source_missing", detail: `${style.brandName}/${style.productNumber}` });
    }
    if (!hasUsableRows) {
      issues.push({ code: "empty_sizes", detail: `${style.brandName}/${style.productNumber}` });
    }
  }
  const freshnessRows = [...current, ...future].filter((row) => row.variantId);
  const maxAgeDays = input.maxSourceAgeDays ?? 2;
  const freshnessCutoff = now.valueOf() - maxAgeDays * 86_400_000;
  if (freshnessRows.length === 0 || freshnessRows.some((row) => {
    const timestamp = row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).valueOf() : Number.NaN;
    return !Number.isFinite(timestamp) || timestamp < freshnessCutoff;
  })) {
    issues.push({ code: "source_stale", detail: `source timestamp missing or older than ${maxAgeDays} days` });
  }
  if ([...current, ...future].some((row) => row.variantId && !row.color?.trim())) {
    issues.push({ code: "null_color", detail: "one or more variants have no color" });
  }

  const colors = new Map<string, { color: string; colorCode?: string; sizes: Map<string, MutableSize> }>();
  const currentDedupe = new Map<string, RepSparkCurrentRow>();
  for (const row of usableCurrent) {
    const color = row.color?.trim();
    const size = row.size?.trim();
    if (!color || !size) continue;
    const dedupeKey = `${row.variantId}\0${normalizeMatchKey(size)}`;
    const duplicate = currentDedupe.get(dedupeKey);
    if (duplicate) {
      if (finiteQuantity(row.quantity) <= finiteQuantity(duplicate.quantity)) continue;
      const colorEntry = colors.get(normalizeMatchKey(color));
      const sizeEntry = colorEntry?.sizes.get(normalizeMatchKey(size));
      if (sizeEntry) sizeEntry.current -= finiteQuantity(duplicate.quantity);
    }
    currentDedupe.set(dedupeKey, row);
    const colorEntry = colors.get(normalizeMatchKey(color)) ?? { color, sizes: new Map<string, MutableSize>() };
    const sizeKey = normalizeMatchKey(size);
    const sizeEntry = colorEntry.sizes.get(sizeKey) ?? { size, sequence: null, current: 0, future: new Map<string, number>() };
    const sequence = Number(row.sizeSequence);
    sizeEntry.sequence = Number.isFinite(sequence) ? sequence : sizeEntry.sequence;
    sizeEntry.current += finiteQuantity(row.quantity);
    colorEntry.sizes.set(sizeKey, sizeEntry);
    colors.set(normalizeMatchKey(color), colorEntry);
  }
  const futureDedupe = new Map<string, RepSparkFutureRow>();
  for (const row of future) {
    const date = validIsoDate(row.availabilityDate);
    if (row.availabilityDate && !date) {
      issues.push({ code: "invalid_date", detail: String(row.availabilityDate) });
    }
  }
  for (const { row, date } of usableFuture) {
    const color = row.color?.trim();
    const size = row.size?.trim();
    if (!color || !size) continue;
    const dedupeKey = `${row.variantId}\0${normalizeMatchKey(size)}\0${date}`;
    const duplicate = futureDedupe.get(dedupeKey);
    if (duplicate && finiteQuantity(row.quantity) <= finiteQuantity(duplicate.quantity)) continue;
    futureDedupe.set(dedupeKey, row);
    const colorKey = normalizeMatchKey(color);
    const colorEntry = colors.get(colorKey) ?? { color, sizes: new Map<string, MutableSize>() };
    const sizeKey = normalizeMatchKey(size);
    const sizeEntry = colorEntry.sizes.get(sizeKey) ?? { size, sequence: null, current: 0, future: new Map<string, number>() };
    const previous = duplicate ? finiteQuantity(duplicate.quantity) : 0;
    sizeEntry.future.set(date, (sizeEntry.future.get(date) ?? 0) - previous + finiteQuantity(row.quantity));
    colorEntry.sizes.set(sizeKey, sizeEntry);
    colors.set(colorKey, colorEntry);
  }

  if (colors.size === 0 && !issues.some((issue) => issue.code === "empty_sizes")) {
    issues.push({ code: "empty_sizes", detail: "one or more mapped styles have no usable sizes" });
  }

  if (issues.length > 0) return { payload: null, json: null, hash: null, issues };

  const sizeRepresentatives = new Map<string, MutableSize>();
  for (const color of colors.values()) {
    for (const [key, size] of color.sizes) {
      const existing = sizeRepresentatives.get(key);
      if (!existing || (existing.sequence === null && size.sequence !== null)) sizeRepresentatives.set(key, size);
    }
  }
  const sortedSizes = [...sizeRepresentatives.values()].sort(compareSizes);
  const sizeOrder = sortedSizes.map((size) => size.size);
  const sizeRank = new Map(sortedSizes.map((size, index) => [normalizeMatchKey(size.size), index]));
  const dates = new Set<string>();
  const payloadColors: InventoryColor[] = [...colors.values()]
    .sort((a, b) => a.color.localeCompare(b.color, "en", { numeric: true, sensitivity: "base" }))
    .map((color) => {
      const sizes: InventorySize[] = [...color.sizes.values()]
        .sort((a, b) => (sizeRank.get(normalizeMatchKey(a.size)) ?? 0) - (sizeRank.get(normalizeMatchKey(b.size)) ?? 0))
        .map((size) => {
          const currentQty = cappedQuantity(size.current, input.cap);
          const futureQuantities = [...size.future.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, quantity]) => {
            dates.add(date);
            const capped = cappedQuantity(quantity, input.cap);
            return { date, qty: capped.qty, ...(capped.capped ? { capped: true as const } : {}) };
          });
          return {
            size: size.size,
            current: currentQty.qty,
            ...(currentQty.capped ? { capped: true as const } : {}),
            ...(futureQuantities.length ? { future: futureQuantities } : {}),
          };
        });
      return { color: color.color, ...(color.colorCode ? { color_code: color.colorCode } : {}), sizes };
    });
  const styles = [...new Set(input.styles.map((value) => value.productNumber.trim()))]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
  const payload: InventoryPayload = {
    schema: 1,
    styles,
    brand: input.brand.trim(),
    synced_at: now.toISOString(),
    cap: input.cap,
    size_order: sizeOrder,
    dates: [...dates].sort(),
    colors: payloadColors,
  };
  return { payload, json: stableStringify(payload), hash: payloadBusinessHash(payload), issues: [] };
}
