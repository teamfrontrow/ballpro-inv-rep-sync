-- A RepSpark source brand may supply products sold under more than one Shopify
-- vendor. Perry Ellis International, for example, supplies both Penguin and
-- Callaway apparel. Keep brands.shopify_vendor as the primary/display vendor for
-- backward compatibility, while storing every discovery alias here.
CREATE TABLE IF NOT EXISTS brand_vendor_aliases (
  id                BIGSERIAL PRIMARY KEY,
  brand_id          BIGINT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  shopify_vendor    TEXT NOT NULL CHECK (nullif(btrim(shopify_vendor), '') IS NOT NULL),
  normalized_vendor TEXT GENERATED ALWAYS AS (upper(btrim(shopify_vendor))) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_vendor)
);

CREATE INDEX IF NOT EXISTS brand_vendor_aliases_brand_idx
  ON brand_vendor_aliases (brand_id);

-- Preserve all existing one-to-one vendor configuration.
INSERT INTO brand_vendor_aliases (brand_id, shopify_vendor)
SELECT id, shopify_vendor
FROM brands
WHERE nullif(btrim(shopify_vendor), '') IS NOT NULL
ON CONFLICT (normalized_vendor) DO NOTHING;

-- Perry Ellis is one RepSpark catalog serving two Shopify vendor names.
INSERT INTO brand_vendor_aliases (brand_id, shopify_vendor)
SELECT id, 'Callaway'
FROM brands
WHERE brand_slug = 'perry-ellis-international'
ON CONFLICT (normalized_vendor) DO NOTHING;
