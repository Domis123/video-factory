/**
 * W8 orchestrator state machine — PURE transition logic.
 *
 * Given an `OrchestratorContext` (read-only here) and a `TransitionSignal`,
 * returns a `StateTransition` describing what the orchestrator should do
 * next: which state to move to, which `job_events` to emit, and whether the
 * job has reached a terminal state.
 *
 * Guarantees:
 *   - NO I/O (no Supabase, no agent calls, no filesystem, no random)
 *   - NO mutation of the context (read-only in the signature)
 *   - Deterministic: same (ctx, signal) → same transition
 *
 * The orchestrator (`orchestrator-v2.ts`) is responsible for:
 *   - Invoking agents and populating `ctx` fields (plannerOutput, picks, ...)
 *   - Calling `planNextTransition()` on each signal
 *   - Writing returned events to `job_events`
 *   - Updating `ctx.currentState` / `ctx.terminalState` / decrementing budgets
 *
 * Keeping this pure means transitions are unit-testable without Supabase
 * or Gemini stubs — just construct an OrchestratorContext literal, feed it
 * a signal, assert on the returned StateTransition.
 *
 * File: src/orchestrator/state-machine.ts
 */

import {
  StateMachineGuardError,
  type OrchestratorContext,
  type OrchestratorStateName,
  type StateTransition,
  type TransitionEventType,
  type TransitionSignal,
} from '../types/orchestrator-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard helpers — throw StateMachineGuardError on missing preconditions
// ─────────────────────────────────────────────────────────────────────────────

function assertPlannerOutput(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  if (!ctx.plannerOutput) {
    throw new StateMachineGuardError(
      'plannerOutput_present',
      ctx.currentState,
      signal,
      'ctx.plannerOutput is undefined — Planner must complete before leaving PLANNING',
    );
  }
}

function assertCandidateSets(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  if (!ctx.candidateSets || ctx.candidateSets.length === 0) {
    throw new StateMachineGuardError(
      'candidateSets_present',
      ctx.currentState,
      signal,
      'ctx.candidateSets is missing or empty — Retrieval must populate candidate pools before leaving RETRIEVING',
    );
  }
}

function assertPicks(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  if (!ctx.picks) {
    throw new StateMachineGuardError(
      'picks_present',
      ctx.currentState,
      signal,
      'ctx.picks is undefined — Director must complete before leaving DIRECTING',
    );
  }
}

function assertSnapshots(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  if (!ctx.snapshots || ctx.snapshots.size === 0) {
    throw new StateMachineGuardError(
      'snapshots_present',
      ctx.currentState,
      signal,
      'ctx.snapshots is missing or empty — buildSegmentSnapshots must complete before leaving SNAPSHOT_BUILDING',
    );
  }
}

function assertCriticVerdictAndCopy(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  if (!ctx.criticVerdict) {
    throw new StateMachineGuardError(
      'criticVerdict_present',
      ctx.currentState,
      signal,
      'ctx.criticVerdict is undefined — Critic must return before branching from PARALLEL_FANOUT',
    );
  }
  if (!ctx.copyPackage) {
    throw new StateMachineGuardError(
      'copyPackage_present',
      ctx.currentState,
      signal,
      'ctx.copyPackage is undefined — Copywriter must return before branching from PARALLEL_FANOUT',
    );
  }
}

function assertCopyForCommit(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): void {
  // On critic_parse_exhausted soft-approve we reach COMMITTING without a
  // criticVerdict, but copyPackage must still be present (Copywriter ran in
  // parallel with Critic).
  if (!ctx.copyPackage) {
    throw new StateMachineGuardError(
      'copyPackage_present',
      ctx.currentState,
      signal,
      'ctx.copyPackage is undefined — Copywriter output required before committing',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small builders for StateTransition literals
// ─────────────────────────────────────────────────────────────────────────────

function transition(
  from: OrchestratorStateName,
  to: OrchestratorStateName,
  events: TransitionEventType[],
): StateTransition {
  return { from, to, events };
}

function terminal(
  from: OrchestratorStateName,
  to: Extract<OrchestratorStateName, 'DONE' | 'FAILED' | 'ESCALATING_TO_HUMAN'>,
  events: TransitionEventType[],
  terminalState: StateTransition['terminalState'],
  failureReason?: string,
): StateTransition {
  return { from, to, events, terminalState, failureReason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────

export function planNextTransition(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  const from = ctx.currentState;

  // Universal: agent_error short-circuits from any non-terminal state to FAILED.
  if (signal.kind === 'agent_error') {
    return terminal(
      from,
      'FAILED',
      ['pipeline_v2_failed'],
      'failed_agent_error',
      `agent ${signal.agent} failed: ${signal.reason}`,
    );
  }

  switch (from) {
    case 'QUEUED':
      return handleQueued(ctx, signal);
    case 'PLANNING':
      return handlePlanning(ctx, signal);
    case 'RETRIEVING':
      return handleRetrieving(ctx, signal);
    case 'DIRECTING':
      return handleDirecting(ctx, signal);
    case 'SNAPSHOT_BUILDING':
      return handleSnapshotBuilding(ctx, signal);
    case 'PARALLEL_FANOUT':
      return handleParallelFanout(ctx, signal);
    case 'REVISING_SLOTS':
      return handleRevisingSlots(ctx, signal);
    case 'REPLANNING':
      return handleReplanning(ctx, signal);
    case 'COMMITTING':
      return handleCommitting(ctx, signal);
    case 'DONE':
    case 'FAILED':
    case 'ESCALATING_TO_HUMAN':
      throw new StateMachineGuardError(
        'not_terminal',
        from,
        signal,
        `received signal ${signal.kind} in terminal state ${from}`,
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-state handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleQueued(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `QUEUED only accepts 'advance', got '${signal.kind}'`,
    );
  }
  return transition('QUEUED', 'PLANNING', ['planning_started']);
}

function handlePlanning(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `PLANNING only accepts 'advance', got '${signal.kind}'`,
    );
  }
  assertPlannerOutput(ctx, signal);
  return transition('PLANNING', 'RETRIEVING', [
    'planning_completed',
    'retrieval_started',
  ]);
}

function handleRetrieving(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind === 'advance') {
    assertCandidateSets(ctx, signal);
    return transition('RETRIEVING', 'DIRECTING', [
      'retrieval_completed',
      'directing_started',
    ]);
  }
  if (signal.kind === 'retrieval_empty') {
    // Q8: successful retries are silent; exhaustion emits.
    if (ctx.budget.interAgentRetryRemaining > 0) {
      // Re-plan once. Silent (no events) per Q8.
      return transition('RETRIEVING', 'PLANNING', []);
    }
    return terminal(
      'RETRIEVING',
      'FAILED',
      ['retrieval_retry_exhausted', 'pipeline_v2_failed'],
      'failed_agent_error',
      'retrieval returned empty candidate pool; inter-agent retry budget exhausted',
    );
  }
  throw new StateMachineGuardError(
    'signal_kind',
    ctx.currentState,
    signal,
    `RETRIEVING does not accept '${signal.kind}'`,
  );
}

function handleDirecting(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `DIRECTING only accepts 'advance', got '${signal.kind}'`,
    );
  }
  assertPicks(ctx, signal);
  return transition('DIRECTING', 'SNAPSHOT_BUILDING', [
    'directing_completed',
    'snapshot_building_started',
  ]);
}

function handleSnapshotBuilding(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `SNAPSHOT_BUILDING only accepts 'advance', got '${signal.kind}'`,
    );
  }
  assertSnapshots(ctx, signal);
  return transition('SNAPSHOT_BUILDING', 'PARALLEL_FANOUT', [
    'snapshot_building_completed',
    'parallel_fanout_started',
  ]);
}

function handleParallelFanout(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  // Critic parse exhausted → soft-approve path (brief § "Failure modes": treat
  // as approve; Critic is a quality gate, don't block the job if it can't
  // render a verdict).
  if (signal.kind === 'critic_parse_exhausted') {
    assertCopyForCommit(ctx, signal);
    return transition('PARALLEL_FANOUT', 'COMMITTING', [
      'critic_unavailable_approving_default',
      'parallel_fanout_completed',
      'committing_started',
    ]);
  }

  if (signal.kind !== 'critic_verdict_ready') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `PARALLEL_FANOUT expects 'critic_verdict_ready' or 'critic_parse_exhausted', got '${signal.kind}'`,
    );
  }

  assertCriticVerdictAndCopy(ctx, signal);
  const verdict = ctx.criticVerdict!;

  if (verdict.verdict === 'approve') {
    return transition('PARALLEL_FANOUT', 'COMMITTING', [
      'parallel_fanout_completed',
      'committing_started',
    ]);
  }

  if (verdict.verdict === 'reject') {
    return terminal(
      'PARALLEL_FANOUT',
      'FAILED',
      ['parallel_fanout_completed', 'pipeline_v2_failed'],
      'failed_critic_reject',
      `critic rejected storyboard: ${verdict.overall_reasoning}`,
    );
  }

  // verdict === 'revise'
  if (ctx.budget.reviseLoopRemaining <= 0) {
    // Budget exhausted → escalate to human.
    return terminal(
      'PARALLEL_FANOUT',
      'ESCALATING_TO_HUMAN',
      [
        'revise_budget_exhausted',
        'parallel_fanout_completed',
        'pipeline_v2_escalated',
      ],
      'failed_after_revise_budget',
      `revise budget exhausted after ${ctx.reviseHistory.length} cycles; final verdict: ${verdict.overall_reasoning}`,
    );
  }

  if (verdict.revise_scope === 'slot_level') {
    return transition('PARALLEL_FANOUT', 'REVISING_SLOTS', [
      'revise_slot_level_triggered',
      'parallel_fanout_completed',
    ]);
  }

  // revise_scope === 'structural'
  return transition('PARALLEL_FANOUT', 'REPLANNING', [
    'revise_structural_triggered',
    'parallel_fanout_completed',
  ]);
}

function handleRevisingSlots(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `REVISING_SLOTS only accepts 'advance', got '${signal.kind}'`,
    );
  }
  // Back to DIRECTING for selective re-pick. The orchestrator is responsible
  // for clearing downstream ctx fields (picks, snapshots, criticVerdict,
  // copyPackage) before re-invoking Director. Budget decrement also happens
  // orchestrator-side, before this call.
  return transition('REVISING_SLOTS', 'DIRECTING', ['directing_started']);
}

function handleReplanning(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `REPLANNING only accepts 'advance', got '${signal.kind}'`,
    );
  }
  // Full re-plan. Orchestrator clears plannerOutput + all downstream fields +
  // decrements budget before this call.
  return transition('REPLANNING', 'PLANNING', ['planning_started']);
}

function handleCommitting(
  ctx: OrchestratorContext,
  signal: TransitionSignal,
): StateTransition {
  if (signal.kind !== 'advance') {
    throw new StateMachineGuardError(
      'signal_kind',
      ctx.currentState,
      signal,
      `COMMITTING only accepts 'advance', got '${signal.kind}'`,
    );
  }
  assertCopyForCommit(ctx, signal);
  return terminal(
    'COMMITTING',
    'DONE',
    ['committing_completed', 'pipeline_v2_completed'],
    'completed',
  );
}
