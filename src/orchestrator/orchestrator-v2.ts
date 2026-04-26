/**
 * W8 Part B orchestrator — entry point + pipeline driver.
 *
 * `runPipelineV2(jobId)` is the single function callers invoke. It:
 *
 *   1. Loads brand_id + idea_seed from the `jobs` row (Phase 3.5 has already
 *      written the Phase 3.5 context packet by the time we're dispatched,
 *      but we operate entirely from Part B's own inputs and do not read
 *      Phase 3.5's output).
 *   2. Fetches LibraryInventory + BrandPersona once (cached across the job's
 *      lifecycle, including revise cycles — inventory is stable per brief
 *      § "Library inventory caching").
 *   3. Runs the state machine loop, invoking agents in turn and feeding
 *      signals to `planNextTransition`:
 *         QUEUED → PLANNING → RETRIEVING → DIRECTING → SNAPSHOT_BUILDING →
 *         PARALLEL_FANOUT → COMMITTING → DONE
 *      Revise loops route PARALLEL_FANOUT backward to DIRECTING (slot-level)
 *      or PLANNING (structural) via `revise-loop.ts` bookkeeping.
 *   4. Emits `job_events` for each forward/backward transition + revise
 *      trigger + exhaustion (per Q8).
 *   5. On reaching a terminal state, if outputs are complete enough to write
 *      a `shadow_runs` row, does so via `shadow-writer.ts`. Early-failure
 *      paths (Planner exhausts before producing any outputs) skip the
 *      shadow_runs insert — migration 011 NOT NULL constraints reject rows
 *      with incomplete payloads, and the observability signal is already
 *      captured via job_events.
 *   6. Returns a small summary for the caller to log.
 *
 * Graceful degradation: every error path funnels through the state machine's
 * `agent_error` universal short-circuit. The orchestrator itself NEVER throws
 * up to the caller in normal operation — it converts agent failures into
 * terminal FAILED states and returns normally. This is load-bearing for the
 * fire-and-forget BullMQ dispatch in `src/index.ts`: Phase 3.5 must never be
 * affected by Part B's success or failure during the shadow era.
 *
 * Phase 3.5 is not touched by this module. No reads, no writes, no mutation
 * of `jobs.status` / `jobs.context_packet` / etc. Part B's outputs live in
 * `shadow_runs` and only `shadow_runs`.
 *
 * File: src/orchestrator/orchestrator-v2.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import { loadBrandPersona } from '../agents/brand-persona.js';
import { getLibraryInventory } from '../agents/library-inventory-v2.js';
import { planVideo } from '../agents/planner-v2.js';
import { retrieveCandidates } from '../agents/candidate-retrieval-v2.js';
import { pickClipsForStoryboard } from '../agents/visual-director.js';
import { reviewStoryboard } from '../agents/coherence-critic.js';
import { writeCopyForStoryboard } from '../agents/copywriter-v2.js';
import { buildSegmentSnapshots } from '../lib/segment-snapshot.js';
import { embedText } from '../lib/clip-embed.js';

import { planNextTransition } from './state-machine.js';
import {
  enterReviseSlotLevel,
  enterReviseStructural,
  checkTotalInvocationsCap,
  TotalInvocationsCapExceededError,
} from './revise-loop.js';
import { writeShadowRun } from './shadow-writer.js';

import {
  initialContext,
  type FailedAgent,
  type OrchestratorContext,
  type StateTransition,
  type TerminalState,
  type TransitionEventType,
  type TransitionSignal,
} from '../types/orchestrator-state.js';
import type { PlannerOutput } from '../types/planner-output.js';
import type { CandidateSet } from '../types/candidate-set.js';
import type { BrandPersona } from '../types/brand-persona.js';
import type { LibraryInventory } from '../types/library-inventory.js';
import type { CriticVerdict } from '../types/critic-verdict.js';
import type { CopyPackage } from '../types/copywriter-output.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineV2Summary {
  /** shadow_runs.id when a row was written; null on early-failure paths. */
  runId: string | null;
  terminalState: TerminalState;
  walltime_ms: number;
  /**
   * Aggregate USD spend across agents. Placeholder during W8 — agents don't
   * surface per-call USD today. Remains 0 until cost instrumentation lands
   * in a later workstream; shadow_runs.part_b_cost_usd captures the same
   * 0 until then, and W9 analysis can reconstruct cost from token logs.
   */
  cost_usd: number;
}

/**
 * Pipeline driver for Part B shadow runs.
 *
 * This function never throws up to the caller in the shadow era. Agent
 * errors terminate the job in FAILED; state-machine violations terminate
 * in FAILED; Supabase-layer errors on shadow_runs insert are logged by the
 * writer and surface via the `runId: null` return. The BullMQ dispatcher
 * still wraps the call in `.catch(...)` as a belt-and-suspenders guard.
 */
export async function runPipelineV2(jobId: string): Promise<PipelineV2Summary> {
  const wallT0 = Date.now();

  // ── Bootstrap: load the job row to recover brand + idea_seed ─────────────
  const { data: jobRow, error: jobErr } = await supabaseAdmin
    .from('jobs')
    .select('id, brand_id, idea_seed')
    .eq('id', jobId)
    .single();

  if (jobErr || !jobRow) {
    const msg = jobErr?.message ?? 'not found';
    console.error(`[orchestrator-v2] job ${jobId} lookup failed: ${msg}`);
    return {
      runId: null,
      terminalState: 'failed_agent_error',
      walltime_ms: Date.now() - wallT0,
      cost_usd: 0,
    };
  }

  const brandId = (jobRow as { brand_id: string }).brand_id;
  const ideaSeed = (jobRow as { idea_seed: string | null }).idea_seed ?? '';
  if (!ideaSeed.trim()) {
    console.error(`[orchestrator-v2] job ${jobId} has no idea_seed; cannot run Part B`);
    return {
      runId: null,
      terminalState: 'failed_agent_error',
      walltime_ms: Date.now() - wallT0,
      cost_usd: 0,
    };
  }

  const ctx = initialContext(jobId, brandId, ideaSeed);

  // ── Shared job-scoped state (persona + inventory cached per brief) ───────
  let brandPersona: BrandPersona;
  let libraryInventory: LibraryInventory;
  try {
    [brandPersona, libraryInventory] = await Promise.all([
      loadBrandPersona(brandId),
      getLibraryInventory(brandId),
    ]);
    ctx.libraryInventory = libraryInventory;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(
      `[orchestrator-v2] persona/inventory bootstrap failed for brand ${brandId}:`,
      err,
    );
    await emitEvent(jobId, 'pipeline_v2_failed', {
      reason: `persona/inventory bootstrap: ${msg}`,
    });
    return {
      runId: null,
      terminalState: 'failed_agent_error',
      walltime_ms: Date.now() - wallT0,
      cost_usd: 0,
    };
  }

  // ── State machine loop ───────────────────────────────────────────────────
  // First signal kicks QUEUED → PLANNING.
  let signal: TransitionSignal = { kind: 'advance' };

  // The loop terminates when a transition returns a terminal state. Guard
  // against pathological infinite loops via the total-invocations cap; state
  // machine transitions themselves are bounded by the revise-loop budget.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let transition: StateTransition;
    try {
      transition = planNextTransition(ctx, signal);
    } catch (err) {
      // StateMachineGuardError or other structural failure in the transition
      // logic itself. Surface as failed_agent_error with a guard annotation;
      // shadow_runs won't get a row because we haven't completed all outputs.
      console.error(
        `[orchestrator-v2] state-machine error for job ${jobId}:`,
        err,
      );
      await emitEvent(jobId, 'pipeline_v2_failed', {
        reason: `state-machine guard: ${(err as Error).message}`,
      });
      return {
        runId: null,
        terminalState: 'failed_agent_error',
        walltime_ms: Date.now() - wallT0,
        cost_usd: 0,
      };
    }

    await recordTransition(jobId, transition);

    // Silent retrieval re-plan: state machine authorized a retry by returning
    // RETRIEVING→PLANNING with an empty events array. Consume one inter-agent
    // retry budget unit now (the SM itself is pure and never mutates budget).
    if (
      transition.from === 'RETRIEVING' &&
      transition.to === 'PLANNING' &&
      transition.events.length === 0
    ) {
      ctx.budget.interAgentRetryRemaining = Math.max(
        0,
        ctx.budget.interAgentRetryRemaining - 1,
      );
    }

    ctx.currentState = transition.to;

    if (transition.terminalState) {
      ctx.terminalState = transition.terminalState;
      ctx.failureReason = transition.failureReason;
      break;
    }

    // Apply backward-state entry bookkeeping BEFORE invoking the next agent.
    if (transition.to === 'REVISING_SLOTS') {
      enterReviseSlotLevel(ctx, ctx.criticVerdict!);
    } else if (transition.to === 'REPLANNING') {
      enterReviseStructural(ctx, ctx.criticVerdict!);
    }

    // Drive the agent whose output the next state depends on.
    try {
      signal = await executeNextAgent(
        ctx,
        brandPersona,
        libraryInventory,
      );
    } catch (err) {
      if (err instanceof TotalInvocationsCapExceededError) {
        signal = {
          kind: 'agent_error',
          agent: 'planner',
          reason: err.message,
        };
      } else {
        const { agent, reason } = classifyAgentError(ctx, err);
        signal = { kind: 'agent_error', agent, reason };
      }
    }
  }

  // ── Terminal: write shadow_runs if outputs are complete ──────────────────
  const runId = await maybeWriteShadowRun(ctx, Date.now() - wallT0);

  return {
    runId,
    terminalState: ctx.terminalState!,
    walltime_ms: Date.now() - wallT0,
    cost_usd: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent dispatch — per-state side-effects that feed back into the SM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given `ctx.currentState` is a non-terminal state whose owning agent has not
 * yet run, invoke the agent and return the appropriate TransitionSignal for
 * the next tick of the state machine.
 */
async function executeNextAgent(
  ctx: OrchestratorContext,
  brandPersona: BrandPersona,
  libraryInventory: LibraryInventory,
): Promise<TransitionSignal> {
  switch (ctx.currentState) {
    case 'PLANNING':
      return runPlanner(ctx);
    case 'RETRIEVING':
      return runRetrieval(ctx);
    case 'DIRECTING':
      return runDirector(ctx, brandPersona);
    case 'SNAPSHOT_BUILDING':
      return runSnapshotBuild(ctx);
    case 'PARALLEL_FANOUT':
      return runCriticAndCopy(ctx, brandPersona, libraryInventory);
    case 'REVISING_SLOTS':
    case 'REPLANNING':
    case 'COMMITTING':
      // Transitional / terminal-gate states — no external agent. The state
      // machine itself handles the next hop on an 'advance' signal:
      //   REVISING_SLOTS → DIRECTING
      //   REPLANNING     → PLANNING
      //   COMMITTING     → DONE
      return { kind: 'advance' };
    default:
      throw new Error(
        `[orchestrator-v2] executeNextAgent reached unexpected state ${ctx.currentState}`,
      );
  }
}

async function runPlanner(ctx: OrchestratorContext): Promise<TransitionSignal> {
  checkTotalInvocationsCap(ctx);
  ctx.budget.totalAgentInvocations += 1;
  const plannerOutput: PlannerOutput = await planVideo({
    idea_seed: ctx.ideaSeed,
    brand_id: ctx.brandId,
  });
  ctx.plannerOutput = plannerOutput;
  return { kind: 'advance' };
}

async function runRetrieval(
  ctx: OrchestratorContext,
): Promise<TransitionSignal> {
  if (!ctx.plannerOutput) {
    throw new Error('[orchestrator-v2] runRetrieval: plannerOutput missing');
  }
  checkTotalInvocationsCap(ctx);
  ctx.budget.totalAgentInvocations += 1;

  // Fan out per slot in parallel, aligned by array index (candidate set at
  // position i matches plannerOutput.slots[i]). Matches test-visual-director.ts
  // canonical pattern — narrative_beat → embedText → retrieveCandidates.
  const sets: CandidateSet[] = await Promise.all(
    ctx.plannerOutput.slots.map(async (slot) => {
      const embedding = await embedText(slot.narrative_beat);
      return retrieveCandidates({
        slot,
        queryEmbedding: embedding,
        brandId: ctx.brandId,
      });
    }),
  );

  // Empty-pool detection: any slot with zero candidates routes to the
  // retrieval_empty signal. State machine decides retry-vs-fail based on
  // ctx.budget.interAgentRetryRemaining. The orchestrator decrements that
  // budget AFTER the state machine authorizes the silent re-plan — see the
  // `consumeInterAgentRetryBudget` call in the main loop when a silent
  // RETRIEVING→PLANNING transition is observed.
  const hasEmptySlot = sets.some((s) => s.candidates.length === 0);
  if (hasEmptySlot) {
    ctx.candidateSets = undefined;
    return { kind: 'retrieval_empty' };
  }

  ctx.candidateSets = sets;
  return { kind: 'advance' };
}

async function runDirector(
  ctx: OrchestratorContext,
  brandPersona: BrandPersona,
): Promise<TransitionSignal> {
  if (!ctx.plannerOutput || !ctx.candidateSets) {
    throw new Error('[orchestrator-v2] runDirector: prerequisites missing');
  }
  checkTotalInvocationsCap(ctx);
  ctx.budget.totalAgentInvocations += 1;

  const picks = await pickClipsForStoryboard({
    plannerOutput: ctx.plannerOutput,
    candidateSets: ctx.candidateSets,
    brandPersona,
  });
  ctx.picks = picks;
  return { kind: 'advance' };
}

async function runSnapshotBuild(
  ctx: OrchestratorContext,
): Promise<TransitionSignal> {
  if (!ctx.picks) {
    throw new Error('[orchestrator-v2] runSnapshotBuild: picks missing');
  }
  // Snapshots are a Supabase SELECT, not an LLM call — no invocation cap hit.
  const snapshots = await buildSegmentSnapshots(ctx.picks);
  ctx.snapshots = snapshots;
  return { kind: 'advance' };
}

/**
 * PARALLEL_FANOUT: Critic + Copywriter run concurrently over shared snapshots.
 *
 * Critic parse-exhaustion is treated as soft-approve per brief § "Failure
 * modes" — we surface a `critic_parse_exhausted` signal and the state
 * machine emits the `critic_unavailable_approving_default` event. The
 * orchestrator also synthesizes a default-approve CriticVerdict to keep
 * shadow_runs.critic_verdict NOT NULL satisfied; W9 identifies those rows
 * via the companion job_events entry.
 *
 * Copywriter failure is fatal — copy is load-bearing.
 */
async function runCriticAndCopy(
  ctx: OrchestratorContext,
  brandPersona: BrandPersona,
  libraryInventory: LibraryInventory,
): Promise<TransitionSignal> {
  if (!ctx.plannerOutput || !ctx.picks || !ctx.snapshots) {
    throw new Error(
      '[orchestrator-v2] runCriticAndCopy: prerequisites missing',
    );
  }
  checkTotalInvocationsCap(ctx);
  ctx.budget.totalAgentInvocations += 1; // Critic
  checkTotalInvocationsCap(ctx);
  ctx.budget.totalAgentInvocations += 1; // Copywriter

  // Build the CandidateMetadataSnapshot[] that Critic consumes from the same
  // segment-snapshot Map the Copywriter uses. Critic uses a slightly wider
  // shape (includes subject colors, form_rating, on_screen_text); when those
  // are absent on SegmentSnapshot we pass the common subset and let Critic's
  // fallback `fetchSnapshots` call fire for any missing data. In practice
  // Critic has its own internal fetch when candidateSnapshots is omitted,
  // so we pass undefined and let it handle snapshot loading — this aligns
  // with the W7 refactor (Q7 in brief § "buildSegmentSnapshots").
  //
  // Note on W8 W6 extension: reviewStoryboard accepts `libraryInventory`
  // additively; we pass the cached one.
  const criticPromise = reviewStoryboard({
    plannerOutput: ctx.plannerOutput,
    picks: ctx.picks,
    brandPersona,
    libraryInventory,
  }).then(
    (verdict) => ({ ok: true as const, verdict }),
    (err: unknown) => ({ ok: false as const, err }),
  );

  const copyPromise = writeCopyForStoryboard({
    plannerOutput: ctx.plannerOutput,
    picks: ctx.picks,
    brandPersona,
    segmentSnapshots: ctx.snapshots,
  });

  const [criticResult, copyPackage] = await Promise.all([
    criticPromise,
    copyPromise,
  ]);

  ctx.copyPackage = copyPackage;

  if (!criticResult.ok) {
    // Critic failed entirely — soft-approve per brief. Synthesize a default
    // verdict to satisfy downstream shadow_runs NOT NULL. W9 detects these
    // via the companion critic_unavailable_approving_default event.
    console.warn(
      `[orchestrator-v2] critic failed for job ${ctx.jobId}; soft-approving:`,
      (criticResult.err as Error)?.message ?? String(criticResult.err),
    );
    ctx.criticVerdict = synthesizeSoftApproveVerdict();
    return { kind: 'critic_parse_exhausted' };
  }

  ctx.criticVerdict = criticResult.verdict;
  return { kind: 'critic_verdict_ready' };
}

/**
 * When the critic is entirely unavailable (parse retries exhausted /
 * network wedged), we still need a CriticVerdict row on shadow_runs.
 * This placeholder is flagged by the companion `critic_unavailable_approving_default`
 * job_event so W9 analysis can exclude it from quality metrics.
 */
function synthesizeSoftApproveVerdict(): CriticVerdict {
  return {
    verdict: 'approve',
    revise_scope: 'slot_level',
    overall_reasoning:
      'Critic parse retries exhausted — soft-approved by orchestrator; see critic_unavailable_approving_default event.',
    issues: [],
    latency_ms: 0,
    // W9.1 — soft-approve fallback charges no incremental cost; the critic
    // call is what failed, so any tokens spent are sunk on the prior attempt
    // (already accumulated by the wrapper before the throw).
    cost_usd: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classification — map thrown agent errors to FailedAgent values
// ─────────────────────────────────────────────────────────────────────────────

function classifyAgentError(
  ctx: OrchestratorContext,
  err: unknown,
): { agent: FailedAgent; reason: string } {
  const reason = (err as Error)?.message ?? String(err);
  const agent: FailedAgent = (() => {
    switch (ctx.currentState) {
      case 'PLANNING':
        return 'planner';
      case 'RETRIEVING':
        return 'retrieval';
      case 'DIRECTING':
        return 'director';
      case 'SNAPSHOT_BUILDING':
        // Snapshot build uses Supabase, not LLM. Bucket with 'director' since
        // it lives between Director and Critic and its failure points at
        // picked-segment corruption — closer to Director than Critic.
        return 'director';
      case 'PARALLEL_FANOUT':
        // Copywriter failure lands here (Critic failure is soft-approved in
        // runCriticAndCopy). Attributing to copywriter is correct.
        return 'copywriter';
      default:
        return 'planner';
    }
  })();
  return { agent, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// job_events writer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit every event in a StateTransition to job_events.
 *
 * Failures are loud: this function does not swallow Supabase errors.
 * Part B runs fire-and-forget under a BullMQ `.catch(...)` at the
 * dispatcher layer, so a raised error here is contained (it cannot
 * reach Phase 3.5's job state) but remains visible via the BullMQ
 * failure signal + stdout. An emit failure is a schema/access bug
 * worth failing fast on; silent `.warn` logs during shadow are how
 * observability regressions like the prior `payload`/`details`
 * mismatch sit undetected for an entire Gate A cycle.
 */
async function recordTransition(
  jobId: string,
  transition: StateTransition,
): Promise<void> {
  for (const eventType of transition.events) {
    await emitEvent(jobId, eventType, {
      from: transition.from,
      to: transition.to,
      terminalState: transition.terminalState,
      failureReason: transition.failureReason,
    });
  }
}

/**
 * Part B events are namespaced with `partb_` so they don't collide
 * with Phase 3.5's `jobs.status` set (which `to_status` carries for
 * real status transitions). The same prefixed string is written to
 * both `event_type` and `to_status` — `to_status` is NOT NULL on
 * the table, and Part B internal transitions don't correspond to a
 * `jobs.status` value, so we synthesize one from the event itself.
 *
 * `job_events.event_type`, `.from_status`, `.to_status` are all
 * varchar(30). The internal TransitionEventType values are longer
 * than 30-chars-minus-prefix for several events, so we translate to
 * a compact DB form at emit time. The internal enum stays clean so
 * state-machine logic + T1 assertions remain readable. W9 analysis
 * filters Part B events via `event_type LIKE 'partb_%'`.
 *
 * If a future event is added to TransitionEventType, TypeScript will
 * flag it here because the table is typed as Record<TransitionEventType, ...>.
 * Followup filed: widen job_events varchar(30) columns to varchar(64)
 * in migration 012 so the translation layer can go away.
 */
const DB_EVENT_NAMES: Record<TransitionEventType, string> = {
  planning_started: 'partb_planning_started',
  planning_completed: 'partb_planning_completed',
  retrieval_started: 'partb_retrieval_started',
  retrieval_completed: 'partb_retrieval_completed',
  directing_started: 'partb_director_started',
  directing_completed: 'partb_director_completed',
  snapshot_building_started: 'partb_snapshot_started',
  snapshot_building_completed: 'partb_snapshot_completed',
  parallel_fanout_started: 'partb_fanout_started',
  parallel_fanout_completed: 'partb_fanout_completed',
  committing_started: 'partb_commit_started',
  committing_completed: 'partb_commit_completed',
  revise_slot_level_triggered: 'partb_revise_slots',
  revise_structural_triggered: 'partb_revise_structural',
  revise_budget_exhausted: 'partb_revise_exhausted',
  retrieval_retry_exhausted: 'partb_retrieval_exhausted',
  critic_unavailable_approving_default: 'partb_critic_soft_approve',
  pipeline_v2_completed: 'partb_pipeline_completed',
  pipeline_v2_failed: 'partb_pipeline_failed',
  pipeline_v2_escalated: 'partb_pipeline_escalated',
};

async function emitEvent(
  jobId: string,
  eventType: TransitionEventType,
  details: Record<string, unknown>,
): Promise<void> {
  const dbName = DB_EVENT_NAMES[eventType];
  const { error } = await supabaseAdmin.from('job_events').insert({
    job_id: jobId,
    event_type: dbName,
    to_status: dbName,
    details,
  });
  if (error) {
    console.error(
      `[orchestrator-v2] job_events insert failed (${dbName}):`,
      error.message,
    );
    throw new Error(
      `job_events insert failed for ${dbName}: ${error.message}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// shadow_runs write — only when outputs are complete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a shadow_runs row iff all required outputs are present. Returns the
 * runId on success, null on early-failure paths (migration 011 NOT NULL
 * columns reject rows with missing payloads, and observability is already
 * captured via job_events on early failures).
 *
 * ESCALATING_TO_HUMAN terminal: the last-pass outputs ARE present (verdict
 * was `revise` with budget exhausted), so we write the row — W9 analysis
 * needs to see the final revise-exhausted state to understand escalation
 * patterns.
 */
async function maybeWriteShadowRun(
  ctx: OrchestratorContext,
  wallMs: number,
): Promise<string | null> {
  const complete =
    !!ctx.plannerOutput &&
    !!ctx.candidateSets &&
    !!ctx.picks &&
    !!ctx.criticVerdict &&
    !!ctx.copyPackage;

  if (!complete) {
    console.log(
      `[orchestrator-v2] skipping shadow_runs write for job ${ctx.jobId} — incomplete outputs at terminal state ${ctx.currentState}`,
    );
    return null;
  }

  // Assemble a minimal context_packet_v2 — the orchestrator-assembled Part B
  // analogue of Phase 3.5's jobs.context_packet. Schema intentionally lean;
  // W9 comparison logic reads from the individual columns, not this blob.
  // W10+ can enrich this with voiceover_script / media-ref links as needed.
  const contextPacketV2 = {
    planner: ctx.plannerOutput,
    picks: ctx.picks,
    critic_verdict: ctx.criticVerdict,
    copy: ctx.copyPackage,
    revise_history: ctx.reviseHistory,
    terminal_state: ctx.terminalState,
    failure_reason: ctx.failureReason ?? null,
  };

  const result = await writeShadowRun({
    jobId: ctx.jobId,
    plannerOutput: ctx.plannerOutput!,
    candidateSets: ctx.candidateSets!,
    picks: ctx.picks!,
    criticVerdict: ctx.criticVerdict!,
    copyPackage: ctx.copyPackage!,
    contextPacketV2,
    contextPacketV1: ctx.contextPacketV1 ?? null,
    reviseLoopIterations: ctx.reviseHistory.length,
    totalAgentInvocations: ctx.budget.totalAgentInvocations,
    partBWallTimeMs: wallMs,
    partBCostUsd: 0,
    partBTerminalState: ctx.terminalState!,
    partBFailureReason: ctx.failureReason ?? null,
  });

  return result.runId;
}
