-- Shopify's own colour for a style, captured against the variant SKU.
--
-- Some sources cannot see colour. Acushnet's Hybris site lists each colourway
-- as its own product and exposes no colour field anywhere, so every FootJoy
-- style arrives labelled "Default". That is not merely a cosmetic problem: the
-- payload groups colourways by their colour string, so sibling colourways
-- collapse into one row and their quantities are summed. 28 of 30 FootJoy
-- products carry more than one colourway, up to 19 on a single product.
--
-- Shopify already knows the answer. Each FootJoy variant is one colourway,
-- Option1 is Color, and its SKU is the same code the source uses as its style
-- number -- so the colour can be recorded against the style with no guesswork
-- and no parsing of product names.
--
-- Nullable, and left null for every product with no Color option. A style
-- without one keeps whatever colour its source supplied, so brands whose source
-- reports real colours are unaffected.
ALTER TABLE product_mapping_styles
  ADD COLUMN IF NOT EXISTS shopify_color TEXT;
