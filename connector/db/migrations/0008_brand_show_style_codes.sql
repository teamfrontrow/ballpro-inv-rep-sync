-- Per-brand control over whether the Inventory by Date table labels each
-- colour with its style number, e.g. "Navy Blazer (L11941)".
--
-- For brands where every colourway is its own style (Sun Day Red, AndersonOrd,
-- Greyson, FootJoy...) the style number is what the sales team and site users
-- quote, so it is shown beside the colour. Brands where one style covers every
-- colour never get a code regardless of this flag: the payload only emits one
-- when a product maps to more than one style.
--
-- Defaults to true so the behaviour is uniform across brands; switch a brand
-- off here if its customers do not want the numbers.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS show_style_codes BOOLEAN NOT NULL DEFAULT true;
