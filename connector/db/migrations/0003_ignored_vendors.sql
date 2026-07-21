-- Shopify vendors the admin never wants to sync (e.g. house / Shopify-only
-- vendors like "Ball Pro" that have no RepSpark brand). The sync engine excludes
-- any product mapping whose shopify_vendor is listed here, so those products are
-- not evaluated and produce no run items.
CREATE TABLE IF NOT EXISTS ignored_vendors (
  shopify_vendor TEXT PRIMARY KEY,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
