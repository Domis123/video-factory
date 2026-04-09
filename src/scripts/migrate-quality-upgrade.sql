-- Quality Upgrade Migration
-- Run after the base migrate.sql has been applied.
-- Adds columns for video type matrix, clip analysis, and color grading.

-- ── Jobs: add video_type ──
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS video_type TEXT;

-- ── Assets: add visual metadata from FFmpeg clip analysis ──
ALTER TABLE assets ADD COLUMN IF NOT EXISTS dominant_color_hex TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS motion_intensity TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS avg_brightness INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS scene_cuts INTEGER;

-- ── Brand Configs: add video types + color grading ──
ALTER TABLE brand_configs ADD COLUMN IF NOT EXISTS allowed_video_types TEXT[] DEFAULT '{"tips-listicle"}';
ALTER TABLE brand_configs ADD COLUMN IF NOT EXISTS color_grade_preset TEXT;
ALTER TABLE brand_configs ADD COLUMN IF NOT EXISTS color_lut_r2_key TEXT;

-- ── Update pilot brands with allowed video types ──
UPDATE brand_configs SET allowed_video_types = '{"workout-demo","tips-listicle","transformation"}' WHERE brand_id = 'nordpilates';
UPDATE brand_configs SET allowed_video_types = '{"workout-demo","tips-listicle","transformation"}' WHERE brand_id = 'highdiet';
UPDATE brand_configs SET allowed_video_types = '{"recipe-walkthrough","tips-listicle"}' WHERE brand_id = 'ketoway';
UPDATE brand_configs SET allowed_video_types = '{"recipe-walkthrough","tips-listicle"}' WHERE brand_id = 'carnimeat';
UPDATE brand_configs SET allowed_video_types = '{"tips-listicle","transformation"}' WHERE brand_id = 'nodiet';

-- ── Set default color presets for pilot brands ──
UPDATE brand_configs SET color_grade_preset = 'warm-vibrant' WHERE brand_id IN ('nordpilates', 'highdiet');
UPDATE brand_configs SET color_grade_preset = 'warm-vibrant' WHERE brand_id IN ('ketoway', 'carnimeat');
UPDATE brand_configs SET color_grade_preset = 'neutral' WHERE brand_id = 'nodiet';
