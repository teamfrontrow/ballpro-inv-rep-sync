CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopify_installations (
  shop_domain TEXT PRIMARY KEY,
  encrypted_access_token TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id BIGSERIAL PRIMARY KEY,
  brand_slug TEXT NOT NULL UNIQUE,
  brand_name TEXT NOT NULL,
  shopify_vendor TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  max_display_cap INTEGER CHECK (max_display_cap IS NULL OR max_display_cap >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_mappings (
  id BIGSERIAL PRIMARY KEY,
  shopify_product_gid TEXT NOT NULL UNIQUE,
  shopify_handle TEXT NOT NULL,
  shopify_vendor TEXT NOT NULL,
  shopify_title TEXT NOT NULL,
  brand_id BIGINT REFERENCES brands(id) ON DELETE SET NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('auto', 'manual', 'partial', 'unmatched', 'ignored')),
  match_source TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  last_sync_run_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_mappings_vendor_sku_idx
  ON product_mappings (shopify_vendor, shopify_product_gid);

CREATE TABLE IF NOT EXISTS product_mapping_styles (
  id BIGSERIAL PRIMARY KEY,
  product_mapping_id BIGINT NOT NULL REFERENCES product_mappings(id) ON DELETE CASCADE,
  normalized_sku TEXT NOT NULL,
  repspark_product_number TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN ('auto', 'manual', 'unmatched', 'ignored')),
  match_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_mapping_id, normalized_sku)
);

CREATE INDEX IF NOT EXISTS product_mapping_styles_repspark_number_idx
  ON product_mapping_styles (repspark_product_number);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('one_time', 'scheduled', 'manual_single')),
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  products_total INTEGER NOT NULL DEFAULT 0,
  products_written INTEGER NOT NULL DEFAULT 0,
  products_unchanged INTEGER NOT NULL DEFAULT 0,
  products_skipped INTEGER NOT NULL DEFAULT 0,
  products_failed INTEGER NOT NULL DEFAULT 0,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  error_summary TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

ALTER TABLE product_mappings
  DROP CONSTRAINT IF EXISTS product_mappings_last_sync_run_id_fkey;
ALTER TABLE product_mappings
  ADD CONSTRAINT product_mappings_last_sync_run_id_fkey
  FOREIGN KEY (last_sync_run_id) REFERENCES sync_runs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sync_run_items (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  product_mapping_id BIGINT NOT NULL REFERENCES product_mappings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('written', 'unchanged', 'skipped', 'failed')),
  payload_hash TEXT,
  error TEXT,
  shopify_metafield_gid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, product_mapping_id)
);

CREATE INDEX IF NOT EXISTS sync_run_items_run_idx ON sync_run_items (sync_run_id);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT NOT NULL UNIQUE REFERENCES sync_runs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_one_active_run_idx
  ON sync_jobs ((true)) WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS sync_jobs_claim_idx ON sync_jobs (status, available_at, id);

CREATE TABLE IF NOT EXISTS app_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  default_cap INTEGER CHECK (default_cap IS NULL OR default_cap >= 0),
  future_horizon_days INTEGER NOT NULL CHECK (future_horizon_days >= 0),
  shopify_api_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (singleton, default_cap, future_horizon_days, shopify_api_version)
VALUES (true, 500, 365, '2026-07')
ON CONFLICT (singleton) DO NOTHING;
