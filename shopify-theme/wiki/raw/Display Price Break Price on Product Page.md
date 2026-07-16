# Display Price Break Price on Product Page

> Exported from Antigravity Storage Manager on 4/8/2026, 10:14:25 AM
> Conversation ID: `2f315039-9f4e-446d-a10d-6dd6c917bb51`

---

## Conversation Messages

*Raw extracted content:*

---

## Artifacts

### implementation_plan.md

# Display Price Break Price for Selected Quantity on Product Page

## Problem

On the `pricebreaks-colors` product template, the displayed product price (in the header area) always shows the **variant's base Shopify price**, regardless of the quantity the customer enters. The price break table below shows the correct tiered pricing, but the prominent price display never updates to reflect the actual per-unit cost at the chosen quantity. This is confusing for customers — they see one price at the top and a different price in the tier table.

## Goal

When a customer changes the quantity in the quantity selector, the displayed price should update to show the **per-unit price from the matching price break tier** for the current variant and quantity. When no price break data exists, the price should remain the standard variant price.

---

## Architecture Analysis

### Current Flow

1. **Price display** — The `price` block (id: `price_tVjtKg` in the template) renders a `<product-price>` web component that uses the `price.liquid` snippet. It displays `selected_variant.price` from Shopify's variant data. The `product-price.js` web component listens for `variant:update` events and replaces the price HTML with server-rendered content — it **never** considers quantity or metafield price breaks.

2. **Price break table** — The `price-breaks-colors` block renders the `price-breaks-colors.liquid` snippet, which contains ~560 lines of inline JS. This JS:
   - Reads the `pricebreaks_default` metafield from a hidden `<div>`
   - Parses it as a JSON object keyed by variant title (e.g., `{"Black": [...], "White": [...]}`)
   - Renders a table of quantity ranges, prices, and savings
   - Listens for `variant:update`, `variant:change`, and radio button changes to update the table
   - Enforces minimum quantities from the price break data

3. **Quantity selector** — Managed by the theme's built-in quantity component inside `buy-buttons-colors.liquid`

### Key Insight

The price-breaks-colors snippet **already has** all the logic needed to look up a price for a given variant+quantity. It just doesn't feed that information back to the price display block. The fix is to add JS in the snippet that:
- Listens for quantity changes
- Looks up the matching tier price
- Updates the `<product-price>` element's displayed price

---

## Proposed Changes

### Price Breaks Colors Snippet

#### [MODIFY] [price-breaks-colors.liquid](file:///Users/shawnplep/WebProjects/mcgbPriceBreaks/snippets/price-breaks-colors.liquid)

Add a new function `updateDisplayedPrice(variantTitle, quantity)` to the existing inline `<script>` block that:

1. **Reads the price break data** from the hidden div (same as `displayPriceBreaks` already does)
2. **Looks up the current variant's tier array** using the variant title as key
3. **Finds the matching tier** where `quantity >= minimum_quantity` and `quantity <= maximum_quantity` (treating missing `maximum_quantity` as ∞)
4. **Updates the `<product-price>` element** by:
   - Finding the `.price` span inside the `<product-price>` element in the same section
   - Replacing its text content with the formatted price from the matched tier
   - Optionally showing the original variant price as a ~~strikethrough~~ compare-at price (crossed out) to visually indicate the discount
5. **Reverts to the base variant price** if quantity falls below any tier or no price break data is found

Hook this function into:
- **Quantity input `change`/`input` events** — fires when the customer increments/decrements the quantity or types a new value
- **Quantity button clicks** (plus/minus buttons) — theme likely dispatches a custom event or direct DOM update
- The existing **variant change handlers** — when the color variant changes, recalculate for the current quantity
- **`DOMContentLoaded`** — initialize on page load with the default quantity

The function should look for the `<product-price>` element using `document.querySelector('product-price')` within the closest `.shopify-section`, matching by `data-product-id`.

> [!IMPORTANT]
> The `product-price.js` web component replaces the price HTML on `variant:update` events (server-rendered). This would overwrite our custom price. We need to **re-apply** our price update **after** the variant update event finishes. We can do this by listening for the same `variant:update` event and using a `setTimeout` (e.g., 250ms) to run after the web component's handler.

### Summary of Changes

| What | Where | Type |
|---|---|---|
| Add `updateDisplayedPrice()` function | `snippets/price-breaks-colors.liquid` (inline JS) | New function |
| Add quantity input listener | Same file, near existing `DOMContentLoaded` handler | New event listener |
| Add post-variant-update price recalculation | Same file, alongside existing `variant:update` handler | Extend existing logic |
| Add CSS for strikethrough original price | Same file, inline `<style>` block | New CSS rule |

**No new files are created. No template JSON changes needed. Only one file modified.**

---

## Verification Plan

### Manual Verification

Since this is a Shopify theme modification with inline JS, there are no unit/integration tests to run. The verification must be done visually on the live/preview storefront.

> [!IMPORTANT]
> I'd appreciate your guidance here: **What's the best way for you to test this?** Options:
> 1. **Preview theme** via Shopify admin Customize editor → visit a Type B (color variant) product page
> 2. **`shopify theme dev`** if you have the CLI set up for local preview
> 3. **Deploy to a preview theme** and test on the live storefront
>
> Please let me know which approach works, and I'll work around that for verification.

#### Test Cases

1. **Base case — quantity matches first tier**
   - Navigate to a Type B product (e.g., Crosshairs Ergo Green Divot Tool)
   - Set quantity to `250` (first price break tier minimum)
   - Verify the displayed price updates to `$1.10` per unit

2. **Middle tier**
   - Set quantity to `500`
   - Verify displayed price updates to `$1.00` per unit

3. **Open-ended final tier**
   - Set quantity to `1000` or `2000`
   - Verify displayed price updates to `$0.95` per unit

4. **Below minimum tier**
   - Set quantity to `1` (below `250` min)
   - Verify the displayed price shows the standard variant base price (no price break applies)

5. **Variant change — verify price recalculates**
   - Select color "Black" with quantity `500` → price should be `$1.00`
   - Switch to "White" → price should remain `$1.00` (same tiers in sample data)
   - Verify the price break table also updates correctly as before

6. **No breakage of existing functionality**
   - Verify the price break table still renders correctly
   - Verify add to cart still works
   - Verify minimum quantity enforcement still works


### implementation_plan.md.metadata.json

```
{
  "artifactType": "ARTIFACT_TYPE_IMPLEMENTATION_PLAN",
  "summary": "Implementation plan for updating the product page price display to show the price break tier price based on the customer's selected quantity. Only the `price-breaks-colors.liquid` snippet needs modification — adding JS to listen for quantity changes, look up the matching tier, and update the `<product-price>` element. Includes handling for variant changes that overwrite the price via the theme's web component.",
  "updatedAt": "2026-03-17T15:26:58.573634Z"
}
```

### task.md

# Display Price Break Price on Product Page

- [x] Add `updateDisplayedPrice()` function to `snippets/price-breaks-colors.liquid`
- [x] Add quantity input listener to trigger price updates
- [x] Add post-variant-update price recalculation (with delay to run after web component)
- [x] Add CSS for strikethrough compare-at price styling
- [x] Hook into `DOMContentLoaded` for initial price calculation
- [ ] Create walkthrough


### task.md.metadata.json

```
{
  "artifactType": "ARTIFACT_TYPE_TASK",
  "summary": "Checklist for implementing the price break price display on the pricebreaks-colors product template. All items completed.",
  "updatedAt": "2026-03-17T15:29:44.661231Z",
  "version": "1"
}
```

### walkthrough.md

# Walkthrough: Price Break Price Display on Product Page

## What Changed

**One file modified:** [price-breaks-colors.liquid](file:///Users/shawnplep/WebProjects/mcgbPriceBreaks/snippets/price-breaks-colors.liquid)

## Changes Made

### 3 New JS Functions (lines 558–729)

| Function | Purpose |
|---|---|
| `updateDisplayedPrice(variantTitle)` | Reads the current quantity from the input, finds the matching price break tier, and overwrites the `<product-price>` element with the tier price + strikethrough original |
| `resetDisplayedPrice()` | Restores the original variant price HTML when quantity drops below all tiers |
| `setupQuantityPriceListener()` | Attaches `input`/`change` listeners to the quantity input and `click` listeners to plus/minus buttons |

### Variant Event Handler Changes (lines 340–395)

Both `variant:update` and `variant:change` handlers now:
1. Clear the cached original price (`_originalPriceHTML` / `_originalPriceText`) so it re-captures from new server HTML
2. Call `updateDisplayedPrice()` with a 300ms `setTimeout` — this delay ensures our update runs **after** the `product-price.js` web component replaces the price container with server-rendered HTML

### DOMContentLoaded Hook (lines 784–803)

- Calls `setupQuantityPriceListener()` on page load
- Runs an initial `updateDisplayedPrice()` after 500ms to handle the default quantity
- Retries listener setup every 500ms (up to 10s) in case the quantity input isn't in the DOM yet

### CSS (lines 155–170)

```css
/* Tier price inherits normal color */
product-price .mcgb-pricebreak-price .price { color: var(--color-foreground); }

/* Original price shows as strikethrough, dimmed */
product-price .mcgb-pricebreak-price .mcgb-original-price {
  text-decoration: line-through; opacity: 0.55;
  font-size: 0.85em; margin-left: 0.4em;
}

/* "/ ea" label */
product-price .mcgb-pricebreak-price .mcgb-per-unit-label {
  font-size: 0.75em; opacity: 0.6; margin-left: 0.15em;
}
```

## How It Works — Example Flow

1. Customer visits a Crosshairs Divot Tool page (Type B product, `pricebreaks_default` metafield)
2. On load, quantity is enforced to `250` (minimum from tier data)
3. `updateDisplayedPrice("Black")` runs → finds tier `250–499` → price `$1.10`
4. The `<product-price>` element now shows: **$1.10** / ea ~~$3.49~~
5. Customer increases quantity to `500` → tier lookup matches `500–999` → price updates to **$1.00** / ea ~~$3.49~~
6. Customer switches color to "White" → `variant:update` fires → web component replaces price with new variant HTML → 300ms later our override re-applies with the White tier price

## Edge Cases Handled

- **Quantity below all tiers** → restores original variant price (no price break active)
- **Quantity above last tier (open-ended, no `maximum_quantity`)** → matches via `Infinity` comparison, or falls back to last tier
- **Variant change** → clears cached original price to prevent stale strikethrough values
- **Quantity input not yet in DOM** → retries with `setInterval` up to 10 seconds

## Testing

This requires manual testing on the live/preview storefront with a Type B product (color variants with `pricebreaks_default` metafield). See the implementation plan for the full test matrix.


### walkthrough.md.metadata.json

```
{
  "artifactType": "ARTIFACT_TYPE_WALKTHROUGH",
  "summary": "Walkthrough documenting the changes made to snippets/price-breaks-colors.liquid to display price break tier prices based on the selected quantity. Covers the three new functions, event listener integration, CSS additions, and edge case handling.",
  "updatedAt": "2026-03-17T15:29:44.679891Z"
}
```
