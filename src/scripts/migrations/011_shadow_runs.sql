-- Migration 011: shadow_runs table + pipeline_version + pipeline_override flag columns
-- Phase 4 Part B W8 (Orchestrator): creates the persistence layer for Part B shadow runs
-- and the two new flag columns that drive the 3-tier dispatch composition.
--
-- Per W8_ORCHESTRATOR_BRIEF.md § "shadow_runs table (Migration 011)" and
-- § "Feature flag composition (3-tier)".
--
-- Purely additive per Architecture Rule 36:
--   * New `shadow_runs` table — isolated from production `jobs.context_packet`.
--   * New `brand_configs.pipeline_version` column with default `'phase35'` so
--     every existing row is defaulted to Phase-3.5-only behavior at commit time.
--   * New `jobs.pipeline_override` column, default NULL — no existing rows are
--     affected; Part B routing is opt-in per job via the operator allowlist.
--
-- No backfill required. All existing brands continue running Phase 3.5 only
-- until W9 flips nordpilates to `part_b_shadow`. No data migration; no downtime.
--
-- Rollback script (reverse order of operations; safe to run even if Part B
-- code has been reverted because W8 is the only reader of these columns):
--
--   DROP INDEX IF EXISTS idx_shadow_runs_brand_state_time;
--   DROP INDEX IF EXISTS idx_shadow_runs_terminal_state;
--   DROP INDEX IF EXISTS idx_shadow_runs_created_at;
--   DROP INDEX IF EXISTS idx_shadow_runs_job_id;
--   DROP TABLE IF EXISTS shadow_runs;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS pipeline_override;
--   ALTER TABLE brand_configs DROP COLUMN IF EXISTS pipeline_version;
--
-- Rolling back code without rolling back this migration is safe: new columns
-- are ignored by Phase 3.5 code paths, shadow_runs accepts no writes without
-- the Part B orchestrator, and the existing W8 reader (shadow-writer.ts)
-- doesn't run if the orchestrator never dispatches.

-- ------------------------------------------------------------------
-- Tier 1: brand-level eligibility
-- ------------------------------------------------------------------

ALTER TABLE brand_configs
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT NOT NULL DEFAULT 'phase35';

-- CHECK added separately so IF NOT EXISTS above stays idempotent. If the column
-- already exists without the constraint (partial apply), the constraint add is
-- guarded with DO block since Postgres lacks ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_configs_pipeline_version_check'
  ) THEN
    ALTER TABLE brand_configs
      ADD CONSTRAINT brand_configs_pipeline_version_check
      CHECK (pipeline_version IN ('phase35', 'part_b_shadow', 'part_b_primary'));
  END IF;
END
$$;

-- ------------------------------------------------------------------
-- Tier 2: job-level allowlist override
-- ------------------------------------------------------------------

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pipeline_override TEXT DEFAULT NULL;

-- No CHECK on pipeline_override: the orchestrator treats unrecognized values
-- as null (Tier 3 decides). This is intentional — operator free-text errors
-- should NOT block a job from being planned; they should just not force-route.

-- ------------------------------------------------------------------
-- shadow_runs table
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Part B output (all NOT NULL; orchestrator only writes on pipeline completion
  -- or in failure summary after revise-budget exhaustion where it has captured
  -- the partial state it got through).
  planner_output JSONB NOT NULL,
  retrieval_debug JSONB NOT NULL,
  storyboard_picks JSONB NOT NULL,
  critic_verdict JSONB NOT NULL,
  copy_package JSONB NOT NULL,
  context_packet_v2 JSONB NOT NULL,

  -- Phase 3.5 reference: populated on dual-run paths, NULL when Part-B-only
  -- (reachable post-W9 when pipeline_version flips to 'part_b_primary').
  context_packet_v1 JSONB,

  -- Run metadata
  revise_loop_iterations INT NOT NULL DEFAULT 0,
  total_agent_invocations INT NOT NULL,
  part_b_wall_time_ms INT NOT NULL,
  part_b_cost_usd NUMERIC(6,4) NOT NULL,

  -- Operator verdict (W9 populates post-shadow review; NULL at W8 write time)
  operator_comparison_verdict TEXT,
  operator_notes TEXT,

  -- Failure narrative (NULL on successful completion)
  part_b_terminal_state TEXT,
  part_b_failure_reason TEXT
);

-- Indexes: job_id for single-job lookup, created_at DESC for recency scans,
-- terminal_state for failure-rate dashboards, composite for W9 per-brand
-- measurement queries (brand_id read from JSONB).
CREATE INDEX IF NOT EXISTS idx_shadow_runs_job_id
  ON shadow_runs (job_id);

CREATE INDEX IF NOT EXISTS idx_shadow_runs_created_at
  ON shadow_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shadow_runs_terminal_state
  ON shadow_runs (part_b_terminal_state);

CREATE INDEX IF NOT EXISTS idx_shadow_runs_brand_state_time
  ON shadow_runs ((context_packet_v2->>'brand_id'), part_b_terminal_state, created_at DESC);

-- PostgREST needs to pick up the schema change for the new table + columns.
NOTIFY pgrst, 'reload schema';
