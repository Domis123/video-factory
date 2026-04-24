/**
 * W8 Part B dispatch routing — 3-tier feature flag composition.
 *
 * Per W8_ORCHESTRATOR_BRIEF.md § "Feature flag composition (3-tier)":
 *
 *   Tier 1 (brand):  brand_configs.pipeline_version ∈ { phase35 |
 *                    part_b_shadow | part_b_primary }
 *   Tier 2 (job):    jobs.pipeline_override ∈ { null | "part_b" | "force"
 *                    | "phase35" | "skip" | <unknown> }
 *   Tier 3 (env):    PART_B_ROLLOUT_PERCENT (0-100), deterministic by job.id
 *
 * The composition is split into:
 *
 *   - `decidePipelineRouting(...)`: PURE. Deterministic given its inputs.
 *     Covered by Tier 3 Gate A truth-table smoke — does not hit Supabase.
 *   - `shouldRunPartBByPercentage(jobId, pct)`: PURE. FNV-1a 32-bit hash of
 *     jobId mod 100, compared against pct. Stable across reruns of the same
 *     jobId.
 *   - `computePipelineFlags(brandId, jobId)`: ASYNC I/O wrapper. Queries
 *     Supabase for brand_configs.pipeline_version + jobs.pipeline_override,
 *     consults env `PART_B_ROLLOUT_PERCENT`, then calls the pure decider.
 *
 * Phase 3.5 is never disturbed by this module's outputs in the shadow era;
 * `runPhase35` is only false when `pipeline_version === 'part_b_primary'`,
 * which is a W9 terminal state NOT reachable at W8 time.
 *
 * File: src/orchestrator/feature-flags.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export const PIPELINE_VERSION_VALUES = [
  'phase35',
  'part_b_shadow',
  'part_b_primary',
] as const;
export type PipelineVersion = (typeof PIPELINE_VERSION_VALUES)[number];

export const PIPELINE_OVERRIDE_VALUES = [
  'part_b',
  'force',
  'phase35',
  'skip',
] as const;
export type PipelineOverride = (typeof PIPELINE_OVERRIDE_VALUES)[number];

export interface PipelineFlags {
  /** Phase 3.5 planning runs (source of truth during shadow). */
  runPhase35: boolean;
  /** Part B orchestrator runs (fire-and-forget during shadow). */
  runPartB: boolean;
  /** BOTH pipelines running for comparison (populates `context_packet_v1`). */
  isDualRun: boolean;
  /** Why this decision was reached — human-readable for logs + shadow_runs. */
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure hash for deterministic rollout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit — simple, stable, no deps. We only need an unbiased bucket
 * [0..99]; cryptographic strength not required. Using the same hash across
 * reruns of the same jobId guarantees reproducibility: a job that was
 * selected for Part B on its first dispatch will be selected again on any
 * retry (idempotency for the feature-flag decision).
 */
function fnv1a32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Returns true iff the job falls into the rolled-out percentage bucket.
 * Edge cases: 0 always false (disabled), 100 always true, otherwise
 * deterministic mod-100 bucket compared against pct.
 */
export function shouldRunPartBByPercentage(
  jobId: string,
  rolloutPct: number,
): boolean {
  if (rolloutPct <= 0) return false;
  if (rolloutPct >= 100) return true;
  const bucket = fnv1a32(jobId) % 100;
  return bucket < rolloutPct;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure decision logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic composition of the 3 tiers.
 *
 * Unknown `pipelineOverride` values (e.g. operator typos) are treated as
 * null per brief — "operator free-text errors should NOT block a job from
 * being planned; they should just not force-route." The migration 011
 * comment on jobs.pipeline_override documents the same intent.
 */
export function decidePipelineRouting(
  pipelineVersion: PipelineVersion,
  pipelineOverrideRaw: string | null,
  rolloutPct: number,
  jobId: string,
): PipelineFlags {
  // Tier 1: phase35 → hard gate, Part B never considered.
  if (pipelineVersion === 'phase35') {
    return {
      runPhase35: true,
      runPartB: false,
      isDualRun: false,
      reason: 'brand pipeline_version=phase35 — Part B disabled',
    };
  }

  // Tier 1: part_b_primary → Part B is production; Phase 3.5 not called.
  // Unreachable at W8 time (brief § "pipeline_version terminology") but
  // the router handles it so W9 ramp can flip without a code change.
  if (pipelineVersion === 'part_b_primary') {
    return {
      runPhase35: false,
      runPartB: true,
      isDualRun: false,
      reason: 'brand pipeline_version=part_b_primary — Part B is production',
    };
  }

  // pipelineVersion === 'part_b_shadow' — Tier 2 + Tier 3 decide.
  const override = normalizeOverride(pipelineOverrideRaw);

  if (override === 'force' || override === 'part_b') {
    return {
      runPhase35: true,
      runPartB: true,
      isDualRun: true,
      reason: `job pipeline_override='${override}' — dual-run forced`,
    };
  }

  if (override === 'skip' || override === 'phase35') {
    return {
      runPhase35: true,
      runPartB: false,
      isDualRun: false,
      reason: `job pipeline_override='${override}' — Part B skipped`,
    };
  }

  // override is null (or was unrecognized and got normalized to null).
  if (shouldRunPartBByPercentage(jobId, rolloutPct)) {
    return {
      runPhase35: true,
      runPartB: true,
      isDualRun: true,
      reason: `rollout=${rolloutPct}% — job hash bucket selected for Part B dual-run`,
    };
  }

  return {
    runPhase35: true,
    runPartB: false,
    isDualRun: false,
    reason: `rollout=${rolloutPct}% — job hash bucket not selected`,
  };
}

function normalizeOverride(raw: string | null): PipelineOverride | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if ((PIPELINE_OVERRIDE_VALUES as readonly string[]).includes(trimmed)) {
    return trimmed as PipelineOverride;
  }
  // Unknown value — treat as null per migration 011 comment.
  return null;
}

function normalizePipelineVersion(raw: string | null | undefined): PipelineVersion {
  if (raw === null || raw === undefined) return 'phase35';
  if ((PIPELINE_VERSION_VALUES as readonly string[]).includes(raw)) {
    return raw as PipelineVersion;
  }
  // Unknown value — fail safe by defaulting to phase35 (Part B off).
  // A CHECK constraint on the DB side also enforces this set; this branch
  // is defensive against DB-drift scenarios, not expected in normal flow.
  return 'phase35';
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O wrapper
// ─────────────────────────────────────────────────────────────────────────────

export interface ComputePipelineFlagsOptions {
  /** Override the env rollout for test harnesses; production passes nothing. */
  rolloutPctOverride?: number;
}

/**
 * Fetches brand + job flag columns, then runs the pure decider.
 *
 * Failure modes:
 *   - Brand not found → fail-safe to phase35 (Part B off), warn-log.
 *   - Job not found → fail-safe to phase35; caller is in charge of handling
 *     the downstream NotFound (it will surface when Phase 3.5 tries to load
 *     the same row anyway).
 *   - Supabase transient error → fail-safe to phase35; log so ops notice.
 */
export async function computePipelineFlags(
  brandId: string,
  jobId: string,
  options: ComputePipelineFlagsOptions = {},
): Promise<PipelineFlags> {
  const rolloutPct =
    options.rolloutPctOverride ?? env.PART_B_ROLLOUT_PERCENT ?? 0;

  let pipelineVersion: PipelineVersion = 'phase35';
  let pipelineOverrideRaw: string | null = null;

  try {
    const [{ data: brand, error: brandErr }, { data: job, error: jobErr }] =
      await Promise.all([
        supabaseAdmin
          .from('brand_configs')
          .select('pipeline_version')
          .eq('brand_id', brandId)
          .single(),
        supabaseAdmin
          .from('jobs')
          .select('pipeline_override')
          .eq('id', jobId)
          .single(),
      ]);

    if (brandErr || !brand) {
      console.warn(
        `[feature-flags] brand ${brandId} lookup failed (${brandErr?.message ?? 'not found'}); fail-safe to phase35`,
      );
      return {
        runPhase35: true,
        runPartB: false,
        isDualRun: false,
        reason: `brand lookup failed — ${brandErr?.message ?? 'not found'}; defaulted phase35`,
      };
    }

    if (jobErr || !job) {
      console.warn(
        `[feature-flags] job ${jobId} lookup failed (${jobErr?.message ?? 'not found'}); fail-safe to phase35`,
      );
      return {
        runPhase35: true,
        runPartB: false,
        isDualRun: false,
        reason: `job lookup failed — ${jobErr?.message ?? 'not found'}; defaulted phase35`,
      };
    }

    pipelineVersion = normalizePipelineVersion(
      (brand as { pipeline_version?: string | null }).pipeline_version,
    );
    pipelineOverrideRaw =
      (job as { pipeline_override?: string | null }).pipeline_override ?? null;
  } catch (err) {
    console.error(
      `[feature-flags] transient Supabase error reading flag columns for brand=${brandId} job=${jobId}:`,
      err,
    );
    return {
      runPhase35: true,
      runPartB: false,
      isDualRun: false,
      reason: `Supabase error: ${(err as Error).message}; defaulted phase35`,
    };
  }

  return decidePipelineRouting(
    pipelineVersion,
    pipelineOverrideRaw,
    rolloutPct,
    jobId,
  );
}
