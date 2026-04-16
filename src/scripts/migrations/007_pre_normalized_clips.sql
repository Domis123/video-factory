-- Migration 007: Add pre_normalized_r2_key to assets
-- Phase 3 W5: pre-normalization at ingestion
--
-- Stores the R2 key of the 1080p H.264 normalized parent clip, produced at
-- ingestion time. Segments are then trimmed from this normalized source
-- instead of the raw 4K/variable-codec original.
--
-- Nullable. Existing rows stay NULL until clean-slate re-ingestion (W5 Step 4).
-- New ingestions populate this column automatically.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS pre_normalized_r2_key TEXT;
