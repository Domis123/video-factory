/**
 * W8 shadow_runs writer — persists Part B output to the shadow_runs table.
 *
 * Called from orchestrator-v2 after a Part B pipeline reaches a state that
 * has captured complete outputs:
 *   - DONE (successful completion)
 *   - FAILED with verdict='reject' (critic rejected but outputs exist)
 *   - ESCALATING_TO_HUMAN (revise budget exhausted; last-pass outputs exist)
 *
 * Early failures (Planner exhausts, Director exhausts, Retrieval exhausts)
 * have incomplete outputs and the migration 011 schema has NOT NULL on all
 * JSONB payload columns, so the orchestrator skips the writer on those
 * paths and just emits `pipeline_v2_failed` to job_events. shadow_runs is
 * an observability table; job_events is the audit log.
 *
 * Graceful degradation: Supabase errors on insert are logged but do NOT
 * propagate. Part B is fire-and-forget during shadow (brief § "BullMQ
 * integration"); a failed shadow_runs write must not throw back up into
 * Phase 3.5. The return value surfaces ok/error for the orchestrator to
 * log, but throwing is never an option here.
 *
 * File: src/orchestrator/shadow-writer.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { PlannerOutput } from '../types/planner-output.js';
import type { CandidateSet } from '../types/candidate-set.js';
import type { StoryboardPicks } from '../types/slot-pick.js';
import type { CriticVerdict } from '../types/critic-verdict.js';
import type { CopyPackage } from '../types/copywriter-output.js';
import type { TerminalState } from '../types/orchestrator-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval debug summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compress CandidateSet[] into a lightweight JSONB blob:
 *   - per-slot counts + top similarity + relaxations used
 *   - global totals
 *
 * Keeps the W9 analysis signals (did retrieval relax? how many candidates
 * per slot? did the top candidate have high similarity?) while dropping
 * the heavy raw candidate arrays — those can reach several MB with
 * segment_v2 payloads, bloating shadow_runs storage.
 */
export interface RetrievalDebugPerSlot {
  slot_index: number;
  slot_role: string;
  candidate_count: number;
  strict_match_count: number;
  total_candidates: number;
  relaxations_used: string[];
  latency_ms: number;
  top_similarity: number | null;
}

export interface RetrievalDebugSummary {
  per_slot: RetrievalDebugPerSlot[];
  total_slots: number;
  total_candidates: number;
  aggregate_latency_ms: number;
}

export function summarizeRetrievalForDebug(
  sets: CandidateSet[],
): RetrievalDebugSummary {
  const per_slot: RetrievalDebugPerSlot[] = sets.map((s) => ({
    slot_index: s.slot_index,
    slot_role: s.slot_role,
    candidate_count: s.candidates.length,
    strict_match_count: s.relaxation_summary.strict_match_count,
    total_candidates: s.relaxation_summary.total_candidates,
    relaxations_used: [...s.relaxation_summary.relaxations_used],
    latency_ms: s.latency_ms,
    top_similarity: s.candidates[0]?.similarity ?? null,
  }));
  return {
    per_slot,
    total_slots: sets.length,
    total_candidates: per_slot.reduce((a, p) => a + p.candidate_count, 0),
    aggregate_latency_ms: per_slot.reduce((a, p) => a + p.latency_ms, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writer input + result
// ─────────────────────────────────────────────────────────────────────────────

export interface ShadowRunInput {
  jobId: string;

  /** Part B outputs — all required for a well-formed row. */
  plannerOutput: PlannerOutput;
  candidateSets: CandidateSet[];
  picks: StoryboardPicks;
  /**
   * CriticVerdict. On the soft-approve path (critic parse exhausted) the
   * orchestrator synthesizes a default-approve verdict to honor the NOT NULL
   * constraint on this column. Downstream W9 analysis can identify those
   * rows by the accompanying `critic_unavailable_approving_default` event in
   * job_events.
   */
  criticVerdict: CriticVerdict;
  copyPackage: CopyPackage;
  /** Orchestrator-assembled Part B context packet (analogue of Phase 3.5's jobs.context_packet). */
  contextPacketV2: unknown;

  /** Phase 3.5's context_packet if a dual-run exercised it; null for Part-B-only. */
  contextPacketV1: unknown | null;

  /** Run metadata */
  reviseLoopIterations: number;
  totalAgentInvocations: number;
  partBWallTimeMs: number;
  partBCostUsd: number;

  /** Terminal state + failure narrative (failure narrative null on 'completed'). */
  partBTerminalState: TerminalState;
  partBFailureReason: string | null;
}

export interface ShadowRunWriteResult {
  ok: boolean;
  runId: string | null;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────

export async function writeShadowRun(
  input: ShadowRunInput,
): Promise<ShadowRunWriteResult> {
  const retrievalDebug = summarizeRetrievalForDebug(input.candidateSets);

  const row = {
    job_id: input.jobId,
    planner_output: input.plannerOutput as unknown as Record<string, unknown>,
    retrieval_debug: retrievalDebug as unknown as Record<string, unknown>,
    storyboard_picks: input.picks as unknown as Record<string, unknown>,
    critic_verdict: input.criticVerdict as unknown as Record<string, unknown>,
    copy_package: input.copyPackage as unknown as Record<string, unknown>,
    context_packet_v2: input.contextPacketV2 as Record<string, unknown>,
    context_packet_v1:
      input.contextPacketV1 === null
        ? null
        : (input.contextPacketV1 as Record<string, unknown>),
    revise_loop_iterations: input.reviseLoopIterations,
    total_agent_invocations: input.totalAgentInvocations,
    part_b_wall_time_ms: input.partBWallTimeMs,
    part_b_cost_usd: input.partBCostUsd,
    part_b_terminal_state: input.partBTerminalState,
    part_b_failure_reason: input.partBFailureReason,
    // operator_comparison_verdict + operator_notes left NULL; W9 populates.
  };

  try {
    const { data, error } = await supabaseAdmin
      .from('shadow_runs')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      console.error(
        `[shadow-writer] insert failed for job ${input.jobId}:`,
        error.message,
      );
      return { ok: false, runId: null, error: error.message };
    }

    const runId =
      (data as { id?: string } | null)?.id ??
      (data as unknown as string | null);
    return {
      ok: true,
      runId: typeof runId === 'string' ? runId : null,
      error: null,
    };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.error(
      `[shadow-writer] unexpected error writing shadow_run for job ${input.jobId}:`,
      err,
    );
    return { ok: false, runId: null, error: message };
  }
}
