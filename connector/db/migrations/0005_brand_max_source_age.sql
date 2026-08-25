-- Per-brand source freshness window for feeds and other slower cadence sources.
-- NULL intentionally preserves the connector-wide default (currently two days).
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS max_source_age_days INTEGER
    CHECK (max_source_age_days IS NULL OR max_source_age_days >= 0);
