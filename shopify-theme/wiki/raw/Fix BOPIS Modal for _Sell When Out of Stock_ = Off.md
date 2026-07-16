# Fix BOPIS Modal for "Sell When Out of Stock" = Off

> Exported from Antigravity Storage Manager on 4/8/2026, 10:14:26 AM
> Conversation ID: `804ec13a-1cc0-4f03-82ad-6831125792a7`

---

## Conversation Messages

*Raw extracted content:*

---

## Artifacts

### implementation_plan.md

# Fix BOPIS Store Pickup Modal for "Sell When Out of Stock" = Off

## Root Cause Analysis

When a single-variant product has **"Sell when out of stock" = Off** (Shopify `inventory_policy: 'deny'`) and its Shopify-tracked inventory reaches 0, the Liquid property `variant.available` becomes `false`. This cascades through **three layers** of the theme — even though the custom `bopis_stores` metafield JSON shows real store-level inventory.

### What happens when `variant.available` is `false`:

| Layer | File | Effect |
|-------|------|--------|
| **Server-side Liquid** | [product-form.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/product-form.liquid#L307-L316) | Add to Cart button renders `disabled` with text "Sold Out" |
| **Server-side Liquid** | [quantity-selector.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/quantity-selector.liquid#L1) | Quantity selector hidden via `display:none` |
| **Client-side JS** | [theme.js `_updateAddToCart`](file:///Users/shawnplep/WebProjects/krisers/assets/theme.js#L3403-L3451) | On variant change: disables button, sets "Sold Out" text, hides quantity wrap, disables dynamic checkout |

The BOPIS delivery methods selector (`div.cStoreSelector`) is technically still rendered and shown (by [frd-google-places-autocomplete.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/frd-google-places-autocomplete.liquid#L25)), but it's **useless** because:
1. The Add to Cart button says "Sold Out" and is `disabled`
2. The quantity selector is hidden
3. Even if a user picks a store, `theme.js` re-disables the button on every variant change event

The `213a.js` BOPIS logic (`Product.updateSku`) does try to re-enable the Add to Cart button, but `theme.js` `_updateAddToCart` fires on the same `variantChange` event and overrides it.

## Proposed Changes

### BOPIS-aware theme logic

The fix must bypass `variant.available` checks **only when the product has BOPIS store data**. This ensures non-BOPIS products behave exactly as before.

---

#### [MODIFY] [theme.js](file:///Users/shawnplep/WebProjects/krisers/assets/theme.js)

In the `_updateAddToCart` method (line ~3403), modify the `!variant.available` branch:
- Before disabling the button and showing "Sold Out", check if the product has BOPIS store data (`window.frd_product_bopis_stores_object` is populated)
- If BOPIS data exists, **do not** disable the button or change text to "Sold Out" — let `213a.js` handle the button state based on actual store inventory
- Also prevent hiding the quantity wrap when BOPIS data exists

```diff
       if (variant.available) {
         // ... existing enable logic, unchanged ...
       } else {
-        $(this.selectors.addToCart)
-          .addClass('disabled')
-          .prop('disabled', true);
-        $(this.selectors.addToCartText).text(StyleHatch.Strings.soldOut);
-        $(this.selectors.quantityWrap).hide();
+        // Check if BOPIS stores exist for this product
+        var hasBopisData = window.frd_product_bopis_stores_object
+          && Object.keys(window.frd_product_bopis_stores_object).length > 0;
+
+        if (!hasBopisData) {
+          $(this.selectors.addToCart)
+            .addClass('disabled')
+            .prop('disabled', true);
+          $(this.selectors.addToCartText).text(StyleHatch.Strings.soldOut);
+          $(this.selectors.quantityWrap).hide();
+        }
+        // When BOPIS data exists, let 213a.js manage button state
```

Apply the same pattern to the `else` branch (variant is `null` / doesn't exist, line ~3438).

---

#### [MODIFY] [product-form.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/product-form.liquid)

**Line 307** — The Add to Cart button server-side render. Wrap the `disabled` attribute and class in a BOPIS check:
```diff
-  <button ... class="... {% unless current_variant.available or section_onboarding %}disabled{% endunless %}" {% unless current_variant.available %}disabled{% endunless %}>
+  {% assign has_bopis = product.metafields.frd.bopis_stores %}
+  <button ... class="... {% unless current_variant.available or section_onboarding or has_bopis != blank %}disabled{% endunless %}" {% unless current_variant.available or has_bopis != blank %}disabled{% endunless %}>
```

**Lines 310-314** — The button text. Add the same BOPIS check:
```diff
-  {% unless current_variant.available or section_onboarding %}
+  {% unless current_variant.available or section_onboarding or has_bopis != blank %}
     {{ 'products.product.sold_out' | t }}
   {% else %}
     {{ 'products.product.add_to_cart' | t }}
   {% endunless %}
```

---

#### [MODIFY] [quantity-selector.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/quantity-selector.liquid)

**Line 1** — The quantity selector is hidden when variant is unavailable. Add BOPIS check:
```diff
-  {% unless current_variant.available or section_onboarding %}style="display:none;"{% endunless %}
+  {% assign has_bopis = product.metafields.frd.bopis_stores %}
+  {% unless current_variant.available or section_onboarding or has_bopis != blank %}style="display:none;"{% endunless %}
```

## User Review Required

> [!IMPORTANT]
> This change means that for products with BOPIS store data, the button will **never** show "Sold Out" based on Shopify inventory alone. The `213a.js` logic will manage the button state entirely based on the BOPIS metafield inventory. For products **without** BOPIS data, behavior is unchanged.

> [!WARNING]  
> If a product has the `bopis_stores` metafield but all stores show 0 inventory in the JSON, the button will still initially render as "Add to Cart" — but `213a.js` will then set "not available" text and select "Ship to Home". This should be acceptable but is worth verifying.

## Verification Plan

### Manual Verification
Since this is a Shopify theme and requires the live Shopify environment to test `variant.available` behavior:

1. **Push the changed theme files** to a development/preview theme on Shopify
2. **Test product with "Sell when out of stock" = Off** and a populated `bopis_stores` metafield:
   - Navigate to the product page
   - Verify the delivery method selector (Store Pickup / Ship to Home / Same Day) is visible
   - Verify the Add to Cart button says "Add to Cart" (not "Sold Out")
   - Verify the quantity selector is visible
   - Click "Pick a store" and verify the store picker modal opens
   - Select a store with available inventory → verify button stays enabled
   - Select a store with 0 inventory → verify button shows appropriate messaging
3. **Test a product WITHOUT `bopis_stores` metafield** and "Sell when out of stock" = Off:
   - Verify it still shows "Sold Out" and disabled button as before (no regression)
4. **Test a product with "Sell when out of stock" = On** (either with or without BOPIS data):
   - Verify it still works as before (no regression)


### implementation_plan.md.metadata.json

```
{
  "artifactType":  "ARTIFACT_TYPE_IMPLEMENTATION_PLAN",
  "summary":  "Root cause analysis and implementation plan for fixing the BOPIS store pickup modal not appearing when a product has 'Sell when out of stock' set to Off. Identifies three code layers where variant.available blocks the UI (theme.js, product-form.liquid, quantity-selector.liquid) and proposes targeted changes to bypass these checks when BOPIS metafield data exists.",
  "updatedAt":  "2026-03-02T21:31:21.522428Z"
}
```

### task.md

# Fix BOPIS Modal for "Sell When Out of Stock" = Off

- [x] Analyze theme code and identify root cause
- [x] Create implementation plan
- [x] Implement changes
  - [x] Modify `theme.js` `_updateAddToCart` to skip "Sold Out" when BOPIS data exists
  - [x] Modify `product-form.liquid` button and text rendering
  - [x] Modify `quantity-selector.liquid` visibility check
- [x] Create walkthrough


### task.md.metadata.json

```
{
  "artifactType":  "ARTIFACT_TYPE_TASK",
  "summary":  "Task checklist for BOPIS fix. All implementation items completed.",
  "updatedAt":  "2026-03-02T21:33:19.119767Z",
  "version":  "1"
}
```

### walkthrough.md

# BOPIS Modal Fix — Walkthrough

## Problem
Products with **"Sell when out of stock" = Off** showed "Sold Out" with a disabled Add to Cart button, preventing users from accessing the BOPIS store pickup flow — even when the `bopis_stores` metafield had stores with available inventory.

## Root Cause
Shopify's `variant.available` is `false` when `inventory_policy: 'deny'` and inventory = 0. Three code layers relied on this flag to gate the purchase UI.

## Changes Made

### 1. [theme.js](file:///Users/shawnplep/WebProjects/krisers/assets/theme.js) — `_updateAddToCart` method

render_diffs(file:///Users/shawnplep/WebProjects/krisers/assets/theme.js)

Both the `!variant.available` and `variant === null` branches now check for `window.frd_product_bopis_stores_object` before applying "Sold Out" state. When BOPIS data exists, the button stays enabled and `213a.js` manages the state.

---

### 2. [product-form.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/product-form.liquid) — Button server-side render

render_diffs(file:///Users/shawnplep/WebProjects/krisers/snippets/product-form.liquid)

Added `bopis_available` variable that overrides `current_variant.available` to `true` when `bopis_stores` metafield exists.

---

### 3. [quantity-selector.liquid](file:///Users/shawnplep/WebProjects/krisers/snippets/quantity-selector.liquid) — Visibility gate

render_diffs(file:///Users/shawnplep/WebProjects/krisers/snippets/quantity-selector.liquid)

Added `has_bopis_qty` check so quantity selector doesn't hide when BOPIS data is present.

---

## Chuck Theme Changes

The same fix was applied to the Chuck theme (`krisers/chuck/`), which has the same three code layers.

### 4. [theme.js](file:///Users/shawnplep/WebProjects/krisers/chuck/assets/theme.js) — `_updateAddToCart` method

render_diffs(file:///Users/shawnplep/WebProjects/krisers/chuck/assets/theme.js)

Identical BOPIS override as the main theme.

---

### 5. [product-form.liquid](file:///Users/shawnplep/WebProjects/krisers/chuck/snippets/product-form.liquid) — Button server-side render

render_diffs(file:///Users/shawnplep/WebProjects/krisers/chuck/snippets/product-form.liquid)

Chuck's product form has two button blocks split by `inventory_policy`. The fix targets the `!= 'continue'` block (the deny case), adding `bopis_available` override to both the main and duplicate disabled buttons.

---

### 6. [quantity-selector.liquid](file:///Users/shawnplep/WebProjects/krisers/chuck/snippets/quantity-selector.liquid) — Visibility gate

render_diffs(file:///Users/shawnplep/WebProjects/krisers/chuck/snippets/quantity-selector.liquid)

## Testing

These changes require deploying to a Shopify preview theme. Key test cases:

| Scenario | Expected |
|----------|----------|
| Product with `bopis_stores` + "Sell OOS" = Off | Button says "Add to Cart", delivery selector visible, store picker works |
| Product **without** `bopis_stores` + "Sell OOS" = Off | Button says "Sold Out" (unchanged behavior) |
| Product with "Sell OOS" = On | Works as before (no regression) |


### walkthrough.md.metadata.json

```
{
  "artifactType":  "ARTIFACT_TYPE_WALKTHROUGH",
  "summary":  "Walkthrough documenting the BOPIS fix applied to both the main Krisers theme and the Chuck theme. Covers root cause, six files changed total (three per theme), and testing plan.",
  "updatedAt":  "2026-03-02T22:03:31.471548Z",
  "version":  "1"
}
```
