// Strips a single leading letter-dash prefix ("A-HB2001" -> "HB2001").
//
// It was `^A-` for a long time, because the Shopify SKUs all carry an "A-".
// Flag & Anthem then turned out to prefix its *RepSpark* numbers instead —
// "M-SP24OW1978" for a Shopify "A-SP24OW1978" — and since 715 of its 911 styles
// are prefixed that way (711 "M-", 4 "B-"), matching them one by one in the
// mappings screen was not viable. No other brand carries a letter prefix at all.
//
// Widening this is safe in a way that is worth spelling out: reconcile runs this
// over *both* sides of the comparison (the Shopify SKU in `productStyles` and
// the RepSpark product number in `sourceCatalog`), so stripping symmetrically
// cannot break a pair that matches today. The only risk is two distinct styles
// colliding on one key, and that degrades safely — `reconcileCatalog` auto-
// matches only when exactly one source value maps to a key, so a collision
// falls back to `unmatched` rather than publishing another style's inventory.
// Measured across the live catalog, exactly one collision exists:
// "B-COREHW290" against a bare "COREHW290".
//
// Deliberately one letter: "BA-100" is a style number, not a prefixed one.
export function normalizeShopifySku(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/^[A-Z]-/, "") ?? "";
  return normalized || null;
}

export function normalizeMatchKey(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}
