-- Migration 012: shadow_review view + creative-quality columns on shadow_runs
-- Phase 4 Part B W9 (Shadow Rollout): adds the read-only join that n8n
-- S-workflow polls to populate the Sheet review surface, plus three new
-- operator-populated columns on shadow_runs that complete the creative-
-- quality measurement loop (Q9c — feels_organic + tag set + notes).
--
-- Per W9_SHADOW_ROLLOUT_BRIEF.md § "Operator review workflow (Q3a Sheet-native)"
-- and § "Cutover decision rule (Q5d formalized)".
--
-- Purely additive per Architecture Rule 36:
--   * New columns on shadow_runs are nullable; existing rows untouched.
--   * New view is read-only — no INSERT/UPDATE/DELETE path through it.
--   * No data migration; no downtime.
--   * Pre-merge code references this view (cutover-status helper),
--     so apply BEFORE the W9 merge per W8 pattern.
--
-- Rollback (reverse order):
--   DROP VIEW IF EXISTS shadow_review;
--   ALTER TABLE shadow_runs DROP CONSTRAINT IF EXISTS shadow_runs_creative_quality_tags_check;
--   ALTER TABLE shadow_runs DROP COLUMN IF EXISTS creative_quality_notes;
--   ALTER TABLE shadow_runs DROP COLUMN IF EXISTS creative_quality_tags;
--   ALTER TABLE shadow_runs DROP COLUMN IF EXISTS creative_quality_feels_organic;
--
-- Rolling back code without rolling back this migration is safe: the new
-- columns default to NULL and don't break existing reads, the view is
-- read-only and ignored if nothing queries it.

-- ------------------------------------------------------------------
-- New operator-populated columns on shadow_runs (nullable)
-- ------------------------------------------------------------------

ALTER TABLE shadow_runs
  ADD COLUMN IF NOT EXISTS creative_quality_feels_organic BOOLEAN;

ALTER TABLE shadow_runs
  ADD COLUMN IF NOT EXISTS creative_quality_tags TEXT[];

ALTER TABLE shadow_runs
  ADD COLUMN IF NOT EXISTS creative_quality_notes TEXT;

-- CHECK constraint: tags must be a subset of the fixed enum from brief Q9c.
-- Wrapped in DO block since Postgres lacks ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shadow_runs_creative_quality_tags_check'
  ) THEN
    ALTER TABLE shadow_runs
      ADD CONSTRAINT shadow_runs_creative_quality_tags_check
      CHECK (
        creative_quality_tags IS NULL OR
        creative_quality_tags <@ ARRAY[
          'reads-as-ad',
          'homogenized-voice',
          'stock-footage-y',
          'overlay-redundant',
          'voice-off-persona',
          'pacing-off',
          'other'
        ]::text[]
      );
  END IF;
END
$$;

-- ------------------------------------------------------------------
-- shadow_review read-only view
-- ------------------------------------------------------------------
--
-- Joins shadow_runs to its parent job + brand config so n8n + the
-- cutover-status helper can read brand_id / pipeline_version / Phase 3.5
-- status / operator-populated fields in a single SELECT, without each
-- consumer re-implementing the join.
--
-- LEFT JOIN brand_configs is defensive: every job's brand_id is FK-bound
-- to a brand_configs row in current production, but a future brand
-- archival flow could break that — better to surface the row with NULL
-- pipeline_version than drop it silently from the review surface.

CREATE OR REPLACE VIEW shadow_review AS
SELECT
  -- Identity
  sr.id                                    AS run_id,
  sr.job_id                                AS job_id,
  sr.created_at                            AS created_at,

  -- Brand + flag context
  j.brand_id                               AS brand_id,
  bc.pipeline_version                      AS pipeline_version,
  j.pipeline_override                      AS pipeline_override,

  -- Job creative input + Phase 3.5 lifecycle status
  j.idea_seed                              AS idea_seed,
  j.status                                 AS phase35_status,

  -- Part B run metrics
  sr.part_b_terminal_state                 AS part_b_terminal_state,
  sr.part_b_failure_reason                 AS part_b_failure_reason,
  sr.revise_loop_iterations                AS revise_loop_iterations,
  sr.total_agent_invocations               AS total_agent_invocations,
  sr.part_b_wall_time_ms                   AS part_b_wall_time_ms,
  sr.part_b_cost_usd                       AS part_b_cost_usd,

  -- Operator-populated (write-back from n8n complementary workflow)
  sr.operator_comparison_verdict           AS operator_comparison_verdict,
  sr.operator_notes                        AS operator_notes,
  sr.creative_quality_feels_organic        AS creative_quality_feels_organic,
  sr.creative_quality_tags                 AS creative_quality_tags,
  sr.creative_quality_notes                AS creative_quality_notes,

  -- Full brief blobs (operator inspects via Sheet "Part B Brief Preview URL")
  sr.planner_output                        AS planner_output,
  sr.storyboard_picks                      AS storyboard_picks,
  sr.critic_verdict                        AS critic_verdict,
  sr.copy_package                          AS copy_package,
  sr.context_packet_v2                     AS context_packet_v2,
  sr.context_packet_v1                     AS context_packet_v1
FROM shadow_runs sr
JOIN jobs j ON j.id = sr.job_id
LEFT JOIN brand_configs bc ON bc.brand_id = j.brand_id;

-- PostgREST schema reload picks up the new columns + view.
NOTIFY pgrst, 'reload schema';
