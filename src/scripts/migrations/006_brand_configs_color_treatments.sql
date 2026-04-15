-- Migration 006: Phase 3 W1 — allowed_color_treatments per brand
-- Reference: docs/PHASE_3_DESIGN.md lines 309-327
-- Adds a brand-restricted subset of the 8 Phase 3 color treatments.

ALTER TABLE brand_configs
  ADD COLUMN IF NOT EXISTS allowed_color_treatments TEXT[];

-- Backfill locked values for active Phase 3 brands.
UPDATE brand_configs
SET allowed_color_treatments = ARRAY[
  'warm-vibrant', 'soft-pastel', 'golden-hour', 'natural', 'cool-muted'
]
WHERE brand_id = 'nordpilates';

UPDATE brand_configs
SET allowed_color_treatments = ARRAY[
  'high-contrast', 'warm-vibrant', 'moody-dark', 'natural', 'clean-bright'
]
WHERE brand_id = 'carnimeat';

-- Other brands (welcomebaby, nodiet, ketoway, highdiet) intentionally left NULL.
-- Will be set when those brands begin Phase 3 production. CD must handle NULL by
-- treating it as "all 8 treatments allowed" (no restriction).
