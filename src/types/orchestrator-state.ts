/**
 * W8 orchestrator state machine — types, constants, guard error.
 *
 * The orchestrator itself (src/orchestrator/orchestrator-v2.ts) executes a
 * pipeline: Planner → Retrieval → Director → Snapshots → Critic∥Copywriter →
 * Commit. Revise loops are *backward* transitions (PARALLEL_FANOUT → DIRECTING
 * for slot-level fixes, PARALLEL_FANOUT → PLANNING for structural). Hence the
 * need for an explicit state machine rather than a linear DAG executor.
 *
 * This file exports:
 *   - State names (`ORCHESTRATOR_STATE_NAMES`) + terminal-state union
 *   - Transition event types (written to `job_events` by the orchestrator)
 *   - Retry-budget constants (Q4: revise soft-cap 2; inter-agent retry 1)
 *   - `OrchestratorContext` — the state bag each tick of the state machine
 *     reads and the orchestrator mutates.
 *   - `TransitionSignal` — what the orchestrator tells the state machine
 *     ("agent advanced", "critic verdict arrived", "retrieval was empty").
 *   - `StateTransition` — what the state machine returns (next state, events
 *     to emit, optional terminal state).
 *   - `StateMachineGuardError` — thrown when a state transition precondition
 *     fails (e.g. advancing from RETRIEVING without `candidateSets` populated).
 *
 * Design note: state-machine.ts is PURE. It never mutates the context and
 * never performs I/O. The orchestrator applies returned transitions: updates
 * `ctx.currentState`, mutates budget/history, writes `job_events` rows,
 * invokes agents. This keeps the transition logic unit-testable without
 * Supabase/Gemini.
 *
 * File: src/types/orchestrator-state.ts
 */

import type { PlannerOutput } from './planner-output.js';
import type { CandidateSet } from './candidate-set.js';
import type { StoryboardPicks } from './slot-pick.js';
import type { CriticVerdict } from './critic-verdict.js';
import type { CopyPackage } from './copywriter-output.js';
import type { LibraryInventory } from './library-inventory.js';
import type { SegmentSnapshot } from '../lib/segment-snapshot.js';

// ─────────────────────────────────────────────────────────────────────────────
// States
// ─────────────────────────────────────────────────────────────────────────────

export const ORCHESTRATOR_STATE_NAMES = [
  'QUEUED',
  'PLANNING',
  'RETRIEVING',
  'DIRECTING',
  'SNAPSHOT_BUILDING',
  'PARALLEL_FANOUT',
  // Backward transitional states (entered post-revise verdict; advance→DIRECTING / PLANNING).
  'REVISING_SLOTS',
  'REPLANNING',
  'COMMITTING',
  // Terminal states
  'ESCALATING_TO_HUMAN', // revise-budget exhausted → operator review
  'DONE',                 // committed successfully
  'FAILED',               // agent error, critic reject, inter-agent retry exhausted
] as const;
export type OrchestratorStateName = (typeof ORCHESTRATOR_STATE_NAMES)[number];

// Terminal state value written to shadow_runs.part_b_terminal_state.
export const TERMINAL_STATES = [
  'completed',
  'failed_after_revise_budget',
  'failed_critic_reject',
  'failed_agent_error',
] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminalState(s: OrchestratorStateName): boolean {
  return s === 'DONE' || s === 'FAILED' || s === 'ESCALATING_TO_HUMAN';
}

// ─────────────────────────────────────────────────────────────────────────────
// job_events event types emitted by the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const TRANSITION_EVENT_TYPES = [
  // Forward transitions — paired started/completed per state.
  'planning_started',
  'planning_completed',
  'retrieval_started',
  'retrieval_completed',
  'directing_started',
  'directing_completed',
  'snapshot_building_started',
  'snapshot_building_completed',
  'parallel_fanout_started',
  'parallel_fanout_completed',
  'committing_started',
  'committing_completed',

  // Revise-loop triggers (per brief: emit on every trigger, NOT silent).
  'revise_slot_level_triggered',
  'revise_structural_triggered',
  'revise_budget_exhausted',

  // Inter-agent retry exhaustion (successful retries are silent per Q8).
  'retrieval_retry_exhausted',

  // Critic parse-retry exhaustion — soft-approve rather than block.
  'critic_unavailable_approving_default',

  // Terminal events
  'pipeline_v2_completed',
  'pipeline_v2_failed',
  'pipeline_v2_escalated',
] as const;
export type TransitionEventType = (typeof TRANSITION_EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Retry budgets (Q4 + brief § "Retry budgets (per-job)")
// ─────────────────────────────────────────────────────────────────────────────

export const RETRY_BUDGETS = {
  REVISE_LOOP_MAX: 2,
  INTER_AGENT_RETRY_MAX: 1,
  TOTAL_AGENT_INVOCATIONS_CAP: 15,
} as const;

export interface RetryBudget {
  reviseLoopRemaining: number;
  interAgentRetryRemaining: number;
  totalAgentInvocations: number;
}

export function initialBudget(): RetryBudget {
  return {
    reviseLoopRemaining: RETRY_BUDGETS.REVISE_LOOP_MAX,
    interAgentRetryRemaining: RETRY_BUDGETS.INTER_AGENT_RETRY_MAX,
    totalAgentInvocations: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revise-loop history (operator-facing context on escalation)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviseHistoryEntry {
  iteration: number; // 1-based
  triggered_at_iso: string;
  scope: 'slot_level' | 'structural';
  verdict_summary: string; // Critic's overall_reasoning (truncated)
  affected_slots: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost accumulator (per-agent USD; populated by orchestrator on agent completion)
// ─────────────────────────────────────────────────────────────────────────────

export interface CostAccumulator {
  planner_usd: number;
  director_usd: number;
  critic_usd: number;
  copywriter_usd: number;
}

export function emptyCostAccumulator(): CostAccumulator {
  return { planner_usd: 0, director_usd: 0, critic_usd: 0, copywriter_usd: 0 };
}

export function totalCost(acc: CostAccumulator): number {
  return (
    acc.planner_usd + acc.director_usd + acc.critic_usd + acc.copywriter_usd
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator context — the state bag threaded through the pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type FailedAgent =
  | 'planner'
  | 'retrieval'
  | 'director'
  | 'critic'
  | 'copywriter';

export interface OrchestratorContext {
  jobId: string;
  brandId: string;
  ideaSeed: string;

  currentState: OrchestratorStateName;
  terminalState?: TerminalState;

  // Agent outputs — populated progressively. Guards assert presence before
  // transitions that require them.
  libraryInventory?: LibraryInventory;
  plannerOutput?: PlannerOutput;
  candidateSets?: CandidateSet[]; // aligned to plannerOutput.slots by array index
  picks?: StoryboardPicks;
  snapshots?: Map<string, SegmentSnapshot>;
  criticVerdict?: CriticVerdict;
  copyPackage?: CopyPackage;

  // Dual-run reference (populated by caller when brand.pipeline_version ===
  // 'part_b_shadow'; null when routed Part-B-only post-W9 ramp).
  contextPacketV1?: unknown;

  // Budgets + revise history
  budget: RetryBudget;
  reviseHistory: ReviseHistoryEntry[];

  // Cost + wall-clock
  costAccumulator: CostAccumulator;
  startedAtMs: number;

  // Failure narrative (populated when transitioning to FAILED or
  // ESCALATING_TO_HUMAN). The orchestrator uses this to fill
  // shadow_runs.part_b_failure_reason.
  failureReason?: string;
  failedAgent?: FailedAgent;
}

export function initialContext(
  jobId: string,
  brandId: string,
  ideaSeed: string,
): OrchestratorContext {
  return {
    jobId,
    brandId,
    ideaSeed,
    currentState: 'QUEUED',
    budget: initialBudget(),
    reviseHistory: [],
    costAccumulator: emptyCostAccumulator(),
    startedAtMs: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transition signals (inputs to the state machine)
// ─────────────────────────────────────────────────────────────────────────────

export type TransitionSignal =
  // The agent that owns the current state just finished; advance forward.
  | { kind: 'advance' }
  // Critic + Copywriter both returned; branch on critic verdict.
  | { kind: 'critic_verdict_ready' }
  // Critic parse retries exhausted — treat as soft-approve (brief § "Failure modes").
  | { kind: 'critic_parse_exhausted' }
  // Retrieval returned empty candidate pool for ≥1 slot.
  | { kind: 'retrieval_empty' }
  // Any agent threw an unrecoverable error — terminal.
  | { kind: 'agent_error'; agent: FailedAgent; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Transition result (output of the state machine)
// ─────────────────────────────────────────────────────────────────────────────

export interface StateTransition {
  from: OrchestratorStateName;
  to: OrchestratorStateName;
  events: TransitionEventType[];
  // Present iff `to` is a terminal state. Drives shadow_runs.part_b_terminal_state.
  terminalState?: TerminalState;
  // Populated on FAILED or ESCALATING_TO_HUMAN. Drives part_b_failure_reason.
  failureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard error
// ─────────────────────────────────────────────────────────────────────────────

export class StateMachineGuardError extends Error {
  readonly guardName: string;
  readonly currentState: OrchestratorStateName;
  readonly signalKind: TransitionSignal['kind'];

  constructor(
    guardName: string,
    currentState: OrchestratorStateName,
    signal: TransitionSignal,
    detail: string,
  ) {
    super(
      `[state-machine] guard ${guardName} failed in state ${currentState} on signal ${signal.kind}: ${detail}`,
    );
    this.name = 'StateMachineGuardError';
    this.guardName = guardName;
    this.currentState = currentState;
    this.signalKind = signal.kind;
  }
}
