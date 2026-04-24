/**
 * W8 revise-loop bookkeeping — budget decrement, history append, state reset.
 *
 * The pure state machine (state-machine.ts) tells the orchestrator where to
 * go; this module does the orchestrator-side mutations when the transition
 * enters a revise-loop state.
 *
 * Responsibilities:
 *
 *   1. `enterReviseSlotLevel(ctx, verdict)` — called when the state machine
 *      returns a transition INTO REVISING_SLOTS. Decrements
 *      `budget.reviseLoopRemaining`, appends a ReviseHistoryEntry, and
 *      clears stale downstream ctx fields (picks, snapshots, critic verdict,
 *      copy package) so the next Director invocation operates from a clean
 *      slate. PlannerOutput + candidateSets are preserved — slot_level
 *      revise is a Director re-invocation, not a re-plan.
 *
 *   2. `enterReviseStructural(ctx, verdict)` — entered on REPLANNING
 *      transition. Decrements budget, appends history, clears EVERYTHING
 *      downstream of Planner including plannerOutput and candidateSets.
 *      The next Planner invocation gets a fresh library inventory call
 *      too (caller responsibility; inventory isn't cleared here since it's
 *      stable across the job per brief).
 *
 *   3. `checkTotalInvocationsCap(ctx)` — safety ceiling at 15 agent
 *      invocations per job (brief § "Retry budgets"). Crossing it throws
 *      to surface the "something is very wrong" state per Rule 38.
 *
 *   4. Helpers to inspect the current revise state (iteration count, most
 *      recent scope) for logging / context-packet assembly.
 *
 * These mutations are concentrated here rather than inlined in the
 * orchestrator so unit tests can construct an OrchestratorContext literal,
 * call `enterReviseSlotLevel`, and assert on the post-state without having
 * to simulate the full pipeline.
 *
 * File: src/orchestrator/revise-loop.ts
 */

import {
  RETRY_BUDGETS,
  type OrchestratorContext,
  type ReviseHistoryEntry,
} from '../types/orchestrator-state.js';
import type { CriticVerdict } from '../types/critic-verdict.js';

// ─────────────────────────────────────────────────────────────────────────────
// Total invocation cap — safety ceiling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a job has executed more agent invocations than the safety
 * ceiling permits. Per brief: "5 agents × 3 = 15 — if hit, something is
 * very wrong." Rule 38 says validation throws loud, so we throw rather
 * than silently terminating.
 */
export class TotalInvocationsCapExceededError extends Error {
  readonly jobId: string;
  readonly cap: number;
  readonly observed: number;

  constructor(jobId: string, observed: number, cap: number) {
    super(
      `[revise-loop] job ${jobId} hit total-agent-invocations safety ceiling (${observed} > ${cap}). This indicates a runaway loop; terminating.`,
    );
    this.name = 'TotalInvocationsCapExceededError';
    this.jobId = jobId;
    this.cap = cap;
    this.observed = observed;
  }
}

/**
 * Called by the orchestrator BEFORE every agent invocation. If the next
 * invocation would cross the cap, throw. The orchestrator catches and
 * transitions to FAILED via `agent_error` signal so the failure narrative
 * is captured correctly.
 */
export function checkTotalInvocationsCap(ctx: OrchestratorContext): void {
  if (ctx.budget.totalAgentInvocations >= RETRY_BUDGETS.TOTAL_AGENT_INVOCATIONS_CAP) {
    throw new TotalInvocationsCapExceededError(
      ctx.jobId,
      ctx.budget.totalAgentInvocations,
      RETRY_BUDGETS.TOTAL_AGENT_INVOCATIONS_CAP,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Revise entry mutations
// ─────────────────────────────────────────────────────────────────────────────

function truncatedReasoning(verdict: CriticVerdict): string {
  // ReviseHistoryEntry.verdict_summary — store the reasoning bounded so
  // escalation packets don't blow up. Critic's overall_reasoning is
  // already capped 20..500 by schema; we trim to 300 for the history
  // to keep escalation payloads lean across 2+ iterations.
  const r = verdict.overall_reasoning ?? '';
  return r.length > 300 ? `${r.slice(0, 297)}...` : r;
}

function affectedSlotIndices(verdict: CriticVerdict): number[] {
  const set = new Set<number>();
  for (const issue of verdict.issues) {
    for (const i of issue.affected_slot_indices) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

function nextIteration(ctx: OrchestratorContext): number {
  return (ctx.reviseHistory.at(-1)?.iteration ?? 0) + 1;
}

/**
 * REVISING_SLOTS entry: surgical Director re-invoke. Preserve plannerOutput
 * + candidateSets; clear Director onwards. Consumes 1 revise-loop budget.
 *
 * Returns the appended history entry so the orchestrator can log it or
 * emit it into the escalation context packet later.
 */
export function enterReviseSlotLevel(
  ctx: OrchestratorContext,
  verdict: CriticVerdict,
): ReviseHistoryEntry {
  const entry: ReviseHistoryEntry = {
    iteration: nextIteration(ctx),
    triggered_at_iso: new Date().toISOString(),
    scope: 'slot_level',
    verdict_summary: truncatedReasoning(verdict),
    affected_slots: affectedSlotIndices(verdict),
  };
  ctx.reviseHistory.push(entry);
  ctx.budget.reviseLoopRemaining = Math.max(
    0,
    ctx.budget.reviseLoopRemaining - 1,
  );

  // Clear downstream-of-Director state so the next Director pass starts fresh.
  // plannerOutput + candidateSets are PRESERVED — the revise is slot-level,
  // not a re-plan.
  ctx.picks = undefined;
  ctx.snapshots = undefined;
  ctx.criticVerdict = undefined;
  ctx.copyPackage = undefined;

  return entry;
}

/**
 * REPLANNING entry: full re-plan. Clear Planner output + everything
 * downstream. Library inventory is NOT cleared — stable across the job.
 * Consumes 1 revise-loop budget.
 */
export function enterReviseStructural(
  ctx: OrchestratorContext,
  verdict: CriticVerdict,
): ReviseHistoryEntry {
  const entry: ReviseHistoryEntry = {
    iteration: nextIteration(ctx),
    triggered_at_iso: new Date().toISOString(),
    scope: 'structural',
    verdict_summary: truncatedReasoning(verdict),
    affected_slots: affectedSlotIndices(verdict),
  };
  ctx.reviseHistory.push(entry);
  ctx.budget.reviseLoopRemaining = Math.max(
    0,
    ctx.budget.reviseLoopRemaining - 1,
  );

  // Clear Planner output + everything downstream. libraryInventory preserved.
  ctx.plannerOutput = undefined;
  ctx.candidateSets = undefined;
  ctx.picks = undefined;
  ctx.snapshots = undefined;
  ctx.criticVerdict = undefined;
  ctx.copyPackage = undefined;

  return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Current revise-loop iteration count (0 if never revised). */
export function reviseIterationCount(ctx: OrchestratorContext): number {
  return ctx.reviseHistory.length;
}

/** Budget remaining after previous revisions. */
export function reviseBudgetRemaining(ctx: OrchestratorContext): number {
  return ctx.budget.reviseLoopRemaining;
}

/** Scope of the most recent revise (null if none). */
export function lastReviseScope(
  ctx: OrchestratorContext,
): ReviseHistoryEntry['scope'] | null {
  return ctx.reviseHistory.at(-1)?.scope ?? null;
}

/**
 * Escalation-context payload: the revise history rendered as the operator
 * needs to see it in brief_review. Small helper so the orchestrator can
 * stitch this into whatever escalation packet it writes.
 */
export function formatReviseHistoryForOperator(
  ctx: OrchestratorContext,
): string {
  if (ctx.reviseHistory.length === 0) {
    return '(no revise iterations)';
  }
  return ctx.reviseHistory
    .map(
      (h) =>
        `#${h.iteration} (${h.scope}) @ ${h.triggered_at_iso} — slots [${h.affected_slots.join(', ')}]: ${h.verdict_summary}`,
    )
    .join('\n');
}
