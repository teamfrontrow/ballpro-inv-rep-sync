-- Columbia is a weekly OCS feed rather than a RepSpark scrape. Seed the
-- connector-side brand with the feed's longer freshness window so it is ready
-- to publish as soon as an operator enables it.
--
-- enabled stays false, matching the column default set in 0001_init.sql: every
-- brand is opt-in because enabling one starts writing metafields to live
-- Shopify products. A migration must not make that decision on someone's
-- behalf — turn Columbia on from the Brands page once its first feed has been
-- imported and the payload looks right.
--
-- Preserve explicit operator settings on an existing row, but backfill the
-- feed-specific freshness window when an earlier discovery already created
-- Columbia without it.
INSERT INTO brands (
  brand_slug,
  brand_name,
  shopify_vendor,
  enabled,
  max_source_age_days
)
VALUES (
  'columbia',
  'Columbia',
  'Columbia',
  false,
  9
)
ON CONFLICT (brand_slug) DO UPDATE
SET max_source_age_days = COALESCE(brands.max_source_age_days, EXCLUDED.max_source_age_days);

-- Migration 0004 backfills aliases for brands that already existed. This
-- brand is seeded after that migration, so add its canonical vendor alias too.
-- A conflicting alias belongs to another configured brand and must not be
-- reassigned implicitly.
INSERT INTO brand_vendor_aliases (brand_id, shopify_vendor)
SELECT id, 'Columbia'
FROM brands
WHERE brand_slug = 'columbia'
ON CONFLICT (normalized_vendor) DO NOTHING;
