-- Per-brand control over whether future (restock-date) inventory is published.
-- Some brands are "ATS only": current availability may be shown, but future
-- restock dates must not be. Defaults to true so existing brands keep their
-- current behaviour (future dates shown, subject to the global horizon).
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS show_future_inventory BOOLEAN NOT NULL DEFAULT true;
