-- Migration 014: brand_configs.aesthetic_description + nordpilates starter seed
-- Reference: docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md § "Match-Or-Match Agent"
-- Kickoff Q1, Q1b, Q2 (2026-04-28).
--
-- Q1: aesthetic_description is a NEW top-level column (not nested in any JSONB
-- sidecar). Match-Or-Match agent reads it for visual reasoning.
-- Q1b: aesthetic_description (visual) is kept distinct from voice_guidelines
-- (voice). Two fields serve two different consumers; do not conflate them.
-- Q2: agent drafts a starter aesthetic_description for nordpilates during c1
-- from existing voice_guidelines + content_pillars + brand-Sheet content.
-- c1 halts after push for operator review; c2 does not start until operator
-- approves or revises this starter text.
--
-- Per-brand activation procedure (documented in docs/SIMPLE_PIPELINE.md, c9):
-- when adding a new brand to Simple Pipeline, populate aesthetic_description
-- the same way — agent drafts from voice/pillars/sheet, operator revises.

ALTER TABLE brand_configs
  ADD COLUMN IF NOT EXISTS aesthetic_description TEXT;

-- Seed: nordpilates starter draft (operator-revisable post-c1)
-- Drafted from:
--   * voice_guidelines: "Motivational, warm, empowering. Speak like a
--     supportive pilates instructor who believes in the student. Focus on
--     mindful movement, breath, and progress over perfection."
--   * content_pillars: pilates, flexibility, wellness, mindful movement
--   * primary_color #E8B4A2 (warm peach) / secondary #2C2C2C / accent #FFFFFF
--   * color_grade_preset: warm-vibrant
--   * allowed_color_treatments: warm-vibrant, soft-pastel, golden-hour,
--     natural, cool-muted (no high-contrast, no moody-dark, no clean-bright)
--   * transition_style: fade
UPDATE brand_configs
SET aesthetic_description = $aes$
Warm, soft, and grounded — like a mid-morning pilates session in natural window light. Footage skews peachy, golden-hour, and soft-pastel; the palette stays warm and supportive, never high-contrast, never moody. Subjects move with intention and breath: still poses, slow flows, gentle holds. The camera is calm — locked-off or drifting steadily, never frenetic, never gym-crunchy. Bodies are shown welcomingly across abilities; the visual register is "supportive instructor who believes in you," not "fitness influencer pushing intensity." Outfits skew softly neutral or in the brand's warm palette (peach, cream, charcoal). Avoid: stark gym aesthetics, fluorescent lighting, sweat-glistening intensity, fast-cut explainer-style framing, competitive-fitness energy, or anything that reads as HIIT/bootcamp.
$aes$
WHERE brand_id = 'nordpilates';

NOTIFY pgrst, 'reload schema';
