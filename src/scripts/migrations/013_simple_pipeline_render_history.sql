-- Migration 013: Simple Pipeline render history table
-- Reference: docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md § "Cooldown enforcement"
--
-- Tracks per-brand parent + segment usage for Simple Pipeline cooldown logic.
-- Routine path: parent cooldown (last 2 used) + segment cooldown (last 2 used).
-- Meme path: segment cooldown only (segment uniqueness implies parent uniqueness
-- when slot_count=1).
--
-- Format CHECK locks the two product paths to a known set; any other value
-- would point at a bug in the dispatcher.
--
-- parent_asset_id and segment_id are UUID rather than TEXT (the brief used TEXT
-- but the underlying tables use UUID; matching types removes a casting layer
-- and avoids ambiguity if anyone later adds an FK).
--
-- No ON DELETE behavior on parent_asset_id / segment_id: they are denormalized
-- references to history. If a parent is deleted, its history rows still tell us
-- the brand has used "something at this slot" recently, which is the cooldown
-- semantic we want.
--
-- job_id is UUID with ON DELETE SET NULL (not CASCADE): preserving render history
-- across job deletion is intentional — the cooldown should outlive job lifecycle.
--
-- Indexes (3): one base brand+time index for general history reads, one
-- brand+parent+time for parent cooldown queries, one brand+segment+time for
-- segment cooldown queries. All DESC on created_at because cooldown reads are
-- "most recent N" patterns.

CREATE TABLE IF NOT EXISTS simple_pipeline_render_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        TEXT NOT NULL REFERENCES brand_configs(brand_id),
  parent_asset_id UUID NOT NULL,
  segment_id      UUID NOT NULL,
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  format          TEXT NOT NULL CHECK (format IN ('routine', 'meme')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simple_pipeline_render_history_brand_created
  ON simple_pipeline_render_history (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simple_pipeline_render_history_brand_parent_created
  ON simple_pipeline_render_history (brand_id, parent_asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simple_pipeline_render_history_brand_segment_created
  ON simple_pipeline_render_history (brand_id, segment_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
