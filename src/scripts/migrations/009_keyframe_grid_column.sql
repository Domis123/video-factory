-- Migration 009: Add keyframe_grid_r2_key scalar column to asset_segments
-- Phase 4 Part B W1: per-segment 4x3 portrait mosaic for Visual Director consumption (W5).
--
-- Nullable TEXT. NULL = grid not yet generated. Populated by:
--   1. Backfill script (src/scripts/backfill-keyframe-grids.ts) for existing v2 segments
--   2. Ingestion worker post-v2-analysis when ENABLE_KEYFRAME_GRIDS=true
--
-- R2 path convention: keyframe-grids/{brand_id}/{segment_id}.jpg
-- Mosaic geometry: 4 cols x 3 rows, 256x455 per cell (9:16 portrait), 1024x1365 total, JPEG q80.
-- EXIF UserComment embeds segment_id + start/end + best_in/out + generated_at + generator_version.
--
-- Scalar column (not JSONB sidecar) — grids are a separate concern from segment_v2 analyzer
-- output and should not trigger JSONB rewrites per Architecture Rule 36 spirit.
--
-- No index: this is a null-check predicate column on queries that already filter by
-- segment_v2 IS NOT NULL (GIN-indexed via migration 008). Adding an index here is premature.

ALTER TABLE asset_segments ADD COLUMN IF NOT EXISTS keyframe_grid_r2_key TEXT;
