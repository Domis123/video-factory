-- Migration 008: Add segment_v2 JSONB sidecar to asset_segments
-- Phase 4 Part A W0c: production integration of v2 segment analyzer
--
-- Stores the full v2.1 Zod-validated analyzer output alongside the existing v1
-- scalar columns. New ingestions (with ENABLE_SEGMENT_V2=true) dual-write v1
-- columns + segment_v2 JSONB. Existing rows get segment_v2 populated by the
-- destroy-and-rebuild backfill (W0d). Nullable — v1-only rows stay NULL until
-- backfilled.
--
-- GIN index supports containment and key-existence queries downstream
-- (Visual Director filters by motion.velocity, quality.overall, etc.).

ALTER TABLE asset_segments ADD COLUMN IF NOT EXISTS segment_v2 JSONB;

CREATE INDEX IF NOT EXISTS asset_segments_segment_v2_gin
  ON asset_segments USING GIN (segment_v2);
