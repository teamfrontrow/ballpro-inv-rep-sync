import { createHash } from "node:crypto";
import type { InventoryColor, InventoryPayload, InventorySize } from "@/lib/domain";
import { normalizeMatchKey } from "@/lib/matching/normalize";
import type { RepSparkCurrentRow, RepSparkFutureRow, RepSparkStyleKey } from "@/lib/repspark/inventory";

const CANONICAL_SIZE_ORDER = [
  "XXS", "XS", "S", "S/M", "M", "M/L", "L", "L/XL", "XL", "1XL", "2XL", "XXL",
  "3XL", "XXXL", "4XL", "5XL", "6XL", "OS", "OSFA", "ONE SIZE",
];
const SIZE_RANK = new Map(CANONICAL_SIZE_ORDER.map((size, index) => [size, index]));

/**
 * A style, plus the colour Shopify holds for it. `shopifyColor` is only
 * consulted for sources that cannot report colour themselves — see
 * SOURCE_COLOR_PLACEHOLDER.
 */
export interface PayloadStyle extends RepSparkStyleKey {
  shopifyColor?: string | null;
}

export interface BuildInventoryPayloadInput {
  brand: string;
  styles: PayloadStyle[];
  current: RepSparkCurrentRow[];
  future: RepSparkFutureRow[];
  cap: number | null;
  horizonDays: number;
  // When false, the brand is "ATS only": current availability is published but
  // future restock dates are omitted entirely. Defaults to true when unset.
  showFutureInventory?: boolean;
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
  // Fatal: non-empty exactly when `payload` is null.
  issues: PayloadIssue[];
  // Styles dropped from an otherwise publishable payload, so a caller can
  // record what was left out without failing the product.
  warnings: PayloadIssue[];
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

/**
 * What a source writes when it has no colour to report. Must match
 * `DEFAULT_COLOR_LABEL` in the scraper, which applies it both as a fallback for
 * a blank colour and — for Acushnet's Hybris site, which exposes no colour field
 * at all — as the label on every style.
 *
 * It matters because colourways are grouped by this string: left alone, every
 * FootJoy colourway on a product collapses into one row with their quantities
 * summed. Shopify knows the real colour, so the catalog crawl records it per
 * style and it is substituted here, before the grouping key is taken.
 */
const SOURCE_COLOR_PLACEHOLDER = "DEFAULT";

/**
 * The colourways to blame in a staleness message, deduped and capped so one bad
 * scrape of a 40-colour style cannot turn a run log into a wall of names.
 */
function namedColors(rows: { color: string }[], limit = 3): string {
  const unique = [...new Set(rows.map((row) => row.color))];
  const shown = unique.slice(0, limit).join(", ");
  return unique.length > limit ? `${shown} +${unique.length - limit} more` : shown;
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
  // ATS-only brands publish no future inventory at all. Drop future rows before
  // any of them can reach the payload or raise an invalid_date failure — the
  // dates are irrelevant to this brand, so a malformed one must not fail it.
  const includeFuture = input.showFutureInventory !== false;
  const requested = new Set(input.styles.map((style) => canonicalStyleKey(style.brandName, style.productNumber)));
  const current = input.current.filter((row) => requested.has(canonicalStyleKey(row.brandName, row.productNumber)));
  const future = includeFuture
    ? input.future.filter((row) => requested.has(canonicalStyleKey(row.brandName, row.productNumber)))
    : [];
  const usableCurrent = current.filter((row) => row.variantId && row.color?.trim() && row.size?.trim());
  const usableFuture = future.flatMap((row) => {
    if (!row.variantId || !row.color?.trim() || !row.size?.trim()) return [];
    const date = validIsoDate(row.availabilityDate);
    if (!date) return [];
    const dateValue = new Date(`${date}T00:00:00.000Z`);
    return dateValue >= today && dateValue <= horizon ? [{ row, date }] : [];
  });

  // Every mapped style is judged on its own. A product maps one style per
  // colorway, so a single colorway RepSpark no longer refreshes — a corporate
  // make, or one added to Shopify after the scraper's target list was last
  // built — used to fail its whole product on every sync, permanently hiding
  // live inventory for every other colorway. Diagnosing per style lets the
  // healthy ones publish while the unusable one is reported by name.
  const maxAgeDays = input.maxSourceAgeDays ?? 2;
  const freshnessCutoff = now.valueOf() - maxAgeDays * 86_400_000;
  const diagnoses = input.styles.map((style) => {
    const key = canonicalStyleKey(style.brandName, style.productNumber);
    const label = `${style.brandName}/${style.productNumber}`;
    const belongs = (row: { brandName: string; productNumber: string }) =>
      canonicalStyleKey(row.brandName, row.productNumber) === key;
    const styleCurrent = current.filter(belongs);
    const styleFuture = future.filter(belongs);
    const styleIssues: PayloadIssue[] = [];

    if (styleCurrent.length === 0 && styleFuture.length === 0) {
      return { key, issues: [{ code: "source_missing" as const, detail: label }] };
    }

    // Parent rows without a variant cannot carry a child timestamp, so they are
    // not evidence of freshness either way.
    // The colour travels with the timestamp: a style fails on its oldest row, and
    // that row is almost always one colourway the source stopped listing while
    // the rest kept refreshing. Naming it turns a database query into a glance.
    const stamped = [...styleCurrent, ...styleFuture]
      .filter((row) => row.variantId)
      .map((row) => ({
        at: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).valueOf() : Number.NaN,
        color: row.color?.trim() || "no color",
      }));
    const undated = stamped.filter((row) => !Number.isFinite(row.at));
    const dated = stamped.filter((row) => Number.isFinite(row.at));
    if (undated.length > 0) {
      styleIssues.push({
        code: "source_stale",
        detail: `${label}: ${undated.length} source row(s) carry no timestamp (${namedColors(undated)})`,
      });
    } else if (dated.length > 0) {
      const oldest = Math.min(...dated.map((row) => row.at));
      if (oldest < freshnessCutoff) {
        const days = Math.floor((now.valueOf() - oldest) / 86_400_000);
        const blame = namedColors(dated.filter((row) => row.at === oldest));
        styleIssues.push({
          code: "source_stale",
          detail: `${label} (${blame}): last refreshed ${new Date(oldest).toISOString().slice(0, 10)}, ${days} day(s) ago (limit ${maxAgeDays})`,
        });
      }
    }
    if ([...styleCurrent, ...styleFuture].some((row) => row.variantId && !row.color?.trim())) {
      styleIssues.push({ code: "null_color", detail: `${label}: one or more variants have no color` });
    }
    for (const row of styleFuture) {
      if (row.availabilityDate && !validIsoDate(row.availabilityDate)) {
        styleIssues.push({ code: "invalid_date", detail: `${label}: ${String(row.availabilityDate)}` });
      }
    }
    if (!usableCurrent.some(belongs) && !usableFuture.some(({ row }) => belongs(row))) {
      styleIssues.push({ code: "empty_sizes", detail: label });
    }
    return { key, issues: styleIssues };
  });

  const publishable = new Set(diagnoses.filter((entry) => entry.issues.length === 0).map((entry) => entry.key));
  const issues = diagnoses.flatMap((entry) => entry.issues);
  if (publishable.size === 0) {
    return {
      payload: null, json: null, hash: null, warnings: [],
      issues: issues.length > 0 ? issues : [{ code: "empty_sizes", detail: "no mapped styles have usable sizes" }],
    };
  }
  // Excluded styles are dropped from the payload as well as from the check, so
  // an unrefreshed colorway can never leak stale quantities into what is
  // published.
  const inPayload = (row: { brandName: string; productNumber: string }) =>
    publishable.has(canonicalStyleKey(row.brandName, row.productNumber));

  // Shopify's colour for each style, used only where the source had none.
  const shopifyColors = new Map<string, string>();
  for (const style of input.styles) {
    const value = style.shopifyColor?.trim();
    if (value) shopifyColors.set(canonicalStyleKey(style.brandName, style.productNumber), value);
  }
  /**
   * The colour to publish, and the code to show beside it. A source that
   * reported a real colour is left exactly as it was; only the placeholder is
   * replaced, and only when Shopify actually has a colour for that style. The
   * style number becomes the code, because for these sources the style number
   * IS the colourway identifier (Acushnet's 33296 is one colourway).
   */
  const resolveColor = (row: {
    brandName: string;
    productNumber: string;
    color: string | null;
    colorCode?: string | null;
  }): { color: string; colorCode?: string } => {
    const sourceColor = row.color?.trim() ?? "";
    const sourceCode = row.colorCode?.trim() || undefined;
    if (normalizeMatchKey(sourceColor) !== SOURCE_COLOR_PLACEHOLDER) {
      return { color: sourceColor, colorCode: sourceCode };
    }
    const mapped = shopifyColors.get(canonicalStyleKey(row.brandName, row.productNumber));
    if (!mapped) return { color: sourceColor, colorCode: sourceCode };
    return { color: mapped, colorCode: row.productNumber.trim() || undefined };
  };

  const colors = new Map<string, { color: string; colorCode?: string; sizes: Map<string, MutableSize> }>();
  const currentDedupe = new Map<string, RepSparkCurrentRow>();
  for (const row of usableCurrent.filter(inPayload)) {
    const { color, colorCode } = resolveColor(row);
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
    colorEntry.colorCode ??= colorCode;
    const sizeKey = normalizeMatchKey(size);
    const sizeEntry = colorEntry.sizes.get(sizeKey) ?? { size, sequence: null, current: 0, future: new Map<string, number>() };
    const sequence = Number(row.sizeSequence);
    sizeEntry.sequence = Number.isFinite(sequence) ? sequence : sizeEntry.sequence;
    sizeEntry.current += finiteQuantity(row.quantity);
    colorEntry.sizes.set(sizeKey, sizeEntry);
    colors.set(normalizeMatchKey(color), colorEntry);
  }
  const futureDedupe = new Map<string, RepSparkFutureRow>();
  for (const { row, date } of usableFuture.filter(({ row }) => inPayload(row))) {
    const { color, colorCode } = resolveColor(row);
    const size = row.size?.trim();
    if (!color || !size) continue;
    const dedupeKey = `${row.variantId}\0${normalizeMatchKey(size)}\0${date}`;
    const duplicate = futureDedupe.get(dedupeKey);
    if (duplicate && finiteQuantity(row.quantity) <= finiteQuantity(duplicate.quantity)) continue;
    futureDedupe.set(dedupeKey, row);
    const colorKey = normalizeMatchKey(color);
    const colorEntry = colors.get(colorKey) ?? { color, sizes: new Map<string, MutableSize>() };
    colorEntry.colorCode ??= colorCode;
    const sizeKey = normalizeMatchKey(size);
    const sizeEntry = colorEntry.sizes.get(sizeKey) ?? { size, sequence: null, current: 0, future: new Map<string, number>() };
    const previous = duplicate ? finiteQuantity(duplicate.quantity) : 0;
    sizeEntry.future.set(date, (sizeEntry.future.get(date) ?? 0) - previous + finiteQuantity(row.quantity));
    colorEntry.sizes.set(sizeKey, sizeEntry);
    colors.set(colorKey, colorEntry);
  }

  // Unreachable while a publishable style must have usable rows, but keep the
  // guard so a future change cannot publish an empty payload.
  if (colors.size === 0) {
    return {
      payload: null, json: null, hash: null, warnings: [],
      issues: [...issues, { code: "empty_sizes", detail: "no mapped styles have usable sizes" }],
    };
  }

  // Obsolete colorways: RepSpark keeps a discontinued color's size rows around at
  // zero and never gives it a restock date, so the color renders as a table of
  // nothing but zeroes. Drop it after the readiness gate above — the source rows
  // exist and are fresh, they just describe a color that is no longer carried, so
  // this is a display decision and never a sync failure. A color with any current
  // stock, or any future quantity inside the horizon, is kept.
  for (const [key, color] of colors) {
    const hasQuantity = [...color.sizes.values()].some((size) =>
      size.current > 0 || [...size.future.values()].some((quantity) => quantity > 0));
    if (!hasQuantity) colors.delete(key);
  }

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
      // An unmapped feed colour carries the raw code in `color` already, so the
      // code is redundant there and would render as "HA1464 (HA1464)". Emit it
      // only when a display name actually replaced it.
      const showCode = Boolean(color.colorCode) && color.colorCode !== color.color;
      return { color: color.color, ...(showCode ? { color_code: color.colorCode } : {}), sizes };
    });
  const styles = [...new Set(
    input.styles
      .filter((style) => publishable.has(canonicalStyleKey(style.brandName, style.productNumber)))
      .map((value) => value.productNumber.trim()),
  )].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
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
  return { payload, json: stableStringify(payload), hash: payloadBusinessHash(payload), issues: [], warnings: issues };
}
