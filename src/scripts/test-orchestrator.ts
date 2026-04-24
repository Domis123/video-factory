/**
 * W8 Gate A smoke — three tiers covering the orchestrator state machine,
 * feature-flag composition, render-prep null-safety, shadow-writer
 * graceful degradation, and (optionally) real end-to-end pipeline runs.
 *
 * Tiers:
 *   T1. State machine coverage (pure, ~$0)
 *       10 synthetic scenarios hand-constructed against planNextTransition,
 *       enterReviseSlotLevel, enterReviseStructural. No LLM calls, no
 *       Supabase writes. Exercises every documented transition from the
 *       brief § "Gate A — three-tier testing / Tier 1".
 *
 *   T2. Real E2E (opt-in via --tier2, ~$3)
 *       3 seeds through runPipelineV2 end-to-end against real Supabase +
 *       Gemini/Claude. Seeds picked per brief § "Tier 2". Emits per-seed
 *       summary. Off by default — flag-gated to keep this harness cheap
 *       to re-run during development.
 *
 *   T3. Synthetic failure paths (~$0; Supabase probe only)
 *       - Feature-flag truth table: 9 canonical combinations of
 *         pipeline_version × pipeline_override × rollout-bucket through
 *         decidePipelineRouting.
 *       - Remotion null-safety: prepareContextForRender covers null,
 *         non-empty string, whitespace-only, and unexpected-type inputs.
 *       - shadow-writer graceful degradation: writeShadowRun with an
 *         intentionally invalid job_id — FK violation should return
 *         ok=false without throwing.
 *
 * Usage:
 *   npx tsx src/scripts/test-orchestrator.ts           # T1 + T3 only
 *   npx tsx src/scripts/test-orchestrator.ts --tier2   # T1 + T2 + T3
 *
 * Exit code: 0 if all tests in the active tiers pass, 1 otherwise.
 *
 * File: src/scripts/test-orchestrator.ts
 */

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { planNextTransition } from '../orchestrator/state-machine.js';
import {
  enterReviseSlotLevel,
  enterReviseStructural,
  reviseIterationCount,
} from '../orchestrator/revise-loop.js';
import {
  decidePipelineRouting,
  shouldRunPartBByPercentage,
  type PipelineFlags,
  type PipelineVersion,
} from '../orchestrator/feature-flags.js';
import { prepareContextForRender } from '../orchestrator/render-prep.js';
import { writeShadowRun } from '../orchestrator/shadow-writer.js';
import { runPipelineV2 } from '../orchestrator/orchestrator-v2.js';
import {
  initialContext,
  type OrchestratorContext,
  type StateTransition,
  type TransitionEventType,
  type TransitionSignal,
} from '../types/orchestrator-state.js';
import type { PlannerOutput } from '../types/planner-output.js';
import type { CandidateSet } from '../types/candidate-set.js';
import type { StoryboardPicks } from '../types/slot-pick.js';
import type { CriticVerdict } from '../types/critic-verdict.js';
import type { CopyPackage } from '../types/copywriter-output.js';
import type { SegmentSnapshot } from '../lib/segment-snapshot.js';

// ─────────────────────────────────────────────────────────────────────────────
// Assertion plumbing
// ─────────────────────────────────────────────────────────────────────────────

interface CaseResult {
  tier: 'T1' | 'T2' | 'T3';
  name: string;
  ok: boolean;
  note?: string;
  error?: string;
  wall_ms?: number;
}

const RESULTS: CaseResult[] = [];

function pass(
  tier: CaseResult['tier'],
  name: string,
  note?: string,
  wall_ms?: number,
): void {
  RESULTS.push({ tier, name, ok: true, note, wall_ms });
  console.log(`  ✓ [${tier}] ${name}${note ? ` — ${note}` : ''}`);
}

function fail(
  tier: CaseResult['tier'],
  name: string,
  error: string,
  wall_ms?: number,
): void {
  RESULTS.push({ tier, name, ok: false, error, wall_ms });
  console.error(`  ✗ [${tier}] ${name} — ${error}`);
}

function expect(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function expectEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function expectIncludes<T>(arr: readonly T[], v: T, label: string): void {
  if (!arr.includes(v)) {
    throw new Error(
      `${label}: expected array to include ${JSON.stringify(v)}, got ${JSON.stringify(arr)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared synthetic outputs (stub-minimum shapes for state-machine tests)
// ─────────────────────────────────────────────────────────────────────────────

function stubPlannerOutput(): PlannerOutput {
  // Minimal but schema-valid — only used as presence marker for SM guards.
  return {
    creative_vision:
      'Soft morning pilates vignette highlighting hip mobility with natural golden light.',
    form_id: 'routine_sequence',
    hook_mechanism: 'opening-energy',
    audience_framing: null,
    subject_consistency: 'single-subject',
    slot_count: 3,
    slots: [
      {
        slot_index: 0,
        slot_role: 'hook',
        target_duration_s: 2,
        energy: 6,
        body_focus: null,
        segment_type_preferences: ['talking-head'],
        subject_role: 'primary',
        narrative_beat: 'Opening beat — invite the viewer into the routine',
      },
      {
        slot_index: 1,
        slot_role: 'body',
        target_duration_s: 4,
        energy: 7,
        body_focus: ['hips'],
        segment_type_preferences: ['exercise'],
        subject_role: 'primary',
        narrative_beat: 'Core hip-mobility exercise demonstration',
      },
      {
        slot_index: 2,
        slot_role: 'close',
        target_duration_s: 3,
        energy: 5,
        body_focus: null,
        segment_type_preferences: ['cooldown'],
        subject_role: 'any',
        narrative_beat: 'Calm close inviting a save or follow',
      },
    ],
    music_intent: 'warm-acoustic',
    posture: 'P1',
  };
}

function stubCandidateSets(): CandidateSet[] {
  return stubPlannerOutput().slots.map((s) => {
    const segment_id = randomUUID();
    const parent_asset_id = randomUUID();
    return {
      slot_index: s.slot_index,
      slot_role: s.slot_role,
      candidates: [
        {
          segment_id,
          parent_asset_id,
          similarity: 0.82,
          segment_type: s.segment_type_preferences[0],
          start_s: 0,
          end_s: s.target_duration_s,
          clip_r2_key: null,
          keyframe_grid_r2_key: null,
          description: `stub segment for slot ${s.slot_index}`,
          segment_v2: null,
          matched_body_regions: s.body_focus ?? [],
          editorial_suitability_for_role: 'good' as const,
          boost_score: 0,
          relaxation_applied: [],
        },
      ],
      relaxation_summary: {
        total_candidates: 1,
        strict_match_count: 1,
        relaxations_used: [],
      },
      latency_ms: 42,
    };
  });
}

function stubPicks(): StoryboardPicks {
  const segs = stubCandidateSets();
  return {
    picks: segs.map((cs, i) => {
      const cand = cs.candidates[0];
      const duration = cand.end_s - cand.start_s;
      return {
        slot_index: cs.slot_index,
        picked_segment_id: cand.segment_id,
        parent_asset_id: cand.parent_asset_id,
        in_point_s: cand.start_s,
        out_point_s: cand.end_s,
        duration_s: duration,
        reasoning: `stub reasoning for slot ${i} — clip matches the slot narrative beat`,
        similarity: cand.similarity,
        was_relaxed_match: false,
        same_parent_as_primary: i === 0 ? null : true,
        latency_ms: 25,
      };
    }),
    total_latency_ms: 75,
    parallel_speedup_ratio: 2.5,
  };
}

function stubCriticVerdict(
  verdict: 'approve' | 'reject' | 'revise',
  scope: 'slot_level' | 'structural' = 'slot_level',
): CriticVerdict {
  return {
    verdict,
    revise_scope: scope,
    overall_reasoning:
      verdict === 'approve'
        ? 'Slots read coherent; subject continuity preserved.'
        : verdict === 'reject'
          ? 'Storyboard fundamentally misaligned with brand voice.'
          : 'Minor coherence issue on hook energy arc; please adjust.',
    issues:
      verdict === 'approve'
        ? []
        : [
            {
              issue_type: 'hook_weak' as const,
              severity: 'low' as const,
              affected_slot_indices: [0],
              note: 'stub issue — hook opening feels weak for the energy target',
              suggested_fix: 'tighten the opening beat to emphasize motion',
            },
          ],
    latency_ms: 15,
  };
}

function stubCopyPackage(): CopyPackage {
  return {
    hook: {
      text: 'Open your hips before coffee.',
      delivery: 'overlay',
      mechanism_tie: 'opening-energy — invites the viewer into the routine via a low-effort start',
    },
    per_slot: stubPlannerOutput().slots.map((s) => ({
      slot_id: `slot-${s.slot_index}`,
      overlay: {
        type: 'none' as const,
        text: null,
        start_time_s: 0,
        end_time_s: 0,
      },
      reasoning: `stub overlay reasoning for slot ${s.slot_index}`,
    })),
    cta_text: 'Save this for tomorrow morning.',
    captions: {
      canonical: 'Morning pilates: open your hips before coffee.',
      tiktok: '#pilates open your hips before coffee',
      instagram: 'Morning pilates — open your hips before coffee.',
      youtube: 'A soft pilates routine to open your hips first thing.',
    },
    hashtags: ['#pilates', '#mobility', '#morningroutine'],
    voiceover_script: null,
    metadata: { copywriter_version: 'w7-v1', temperature: 0.7, retry_count: 0 },
  };
}

function stubSnapshotMap(): Map<string, SegmentSnapshot> {
  const m = new Map<string, SegmentSnapshot>();
  for (const p of stubPicks().picks) {
    m.set(p.picked_segment_id, {
      segment_id: p.picked_segment_id,
      segment_type: 'exercise',
      duration_s: p.duration_s,
      exercise: { name: 'glute bridge', confidence: 'high' },
      setting: {
        location: 'indoor-studio',
        equipment_visible: ['yoga mat'],
        on_screen_text: null,
      },
      posture: 'standing',
      body_focus: ['hips'],
      description: 'stub description',
    });
  }
  return m;
}

function mkCtx(
  currentState: OrchestratorContext['currentState'],
  overrides: Partial<OrchestratorContext> = {},
): OrchestratorContext {
  const c = initialContext('job-synthetic', 'nordpilates', 'test idea seed');
  c.currentState = currentState;
  return { ...c, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — State machine coverage
// ─────────────────────────────────────────────────────────────────────────────

function t1HappyPath(): void {
  const name = 'T1.1 happy path — QUEUED → DONE';
  try {
    // QUEUED → PLANNING
    let ctx = mkCtx('QUEUED');
    let t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'PLANNING', `${name} [Q→P]`);
    expectIncludes(t.events as TransitionEventType[], 'planning_started', `${name} events`);

    // PLANNING → RETRIEVING (needs plannerOutput)
    ctx = mkCtx('PLANNING', { plannerOutput: stubPlannerOutput() });
    t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'RETRIEVING', `${name} [P→R]`);
    expectIncludes(
      t.events as TransitionEventType[],
      'planning_completed',
      `${name} events P→R`,
    );

    // RETRIEVING → DIRECTING (needs candidateSets)
    ctx = mkCtx('RETRIEVING', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
    });
    t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'DIRECTING', `${name} [R→D]`);

    // DIRECTING → SNAPSHOT_BUILDING
    ctx = mkCtx('DIRECTING', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
    });
    t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'SNAPSHOT_BUILDING', `${name} [D→S]`);

    // SNAPSHOT_BUILDING → PARALLEL_FANOUT
    ctx = mkCtx('SNAPSHOT_BUILDING', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
    });
    t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'PARALLEL_FANOUT', `${name} [S→F]`);

    // PARALLEL_FANOUT + approve → COMMITTING
    ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      criticVerdict: stubCriticVerdict('approve'),
      copyPackage: stubCopyPackage(),
    });
    t = planNextTransition(ctx, { kind: 'critic_verdict_ready' });
    expectEq(t.to, 'COMMITTING', `${name} [F→C]`);

    // COMMITTING → DONE (terminal)
    ctx = mkCtx('COMMITTING', { copyPackage: stubCopyPackage() });
    t = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t.to, 'DONE', `${name} [C→DONE]`);
    expectEq(t.terminalState, 'completed', `${name} terminalState`);

    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1SlotLevelRevise(): void {
  const name = 'T1.2 slot-level revise — PARALLEL_FANOUT → REVISING_SLOTS → DIRECTING';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      criticVerdict: stubCriticVerdict('revise', 'slot_level'),
      copyPackage: stubCopyPackage(),
    });
    ctx.budget.reviseLoopRemaining = 2;

    const t = planNextTransition(ctx, { kind: 'critic_verdict_ready' });
    expectEq(t.to, 'REVISING_SLOTS', `${name} to=REVISING_SLOTS`);
    expectIncludes(
      t.events as TransitionEventType[],
      'revise_slot_level_triggered',
      `${name} emits revise_slot_level_triggered`,
    );

    // Exercise bookkeeping — budget decrement + history append + clears.
    enterReviseSlotLevel(ctx, ctx.criticVerdict!);
    expectEq(ctx.budget.reviseLoopRemaining, 1, `${name} budget decremented to 1`);
    expectEq(reviseIterationCount(ctx), 1, `${name} iteration=1`);
    expect(ctx.picks === undefined, `${name} picks cleared`);
    expect(ctx.snapshots === undefined, `${name} snapshots cleared`);
    expect(ctx.copyPackage === undefined, `${name} copyPackage cleared`);
    expect(ctx.plannerOutput !== undefined, `${name} plannerOutput preserved`);
    expect(ctx.candidateSets !== undefined, `${name} candidateSets preserved`);

    // REVISING_SLOTS → DIRECTING
    ctx.currentState = 'REVISING_SLOTS';
    const t2 = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t2.to, 'DIRECTING', `${name} REVISING_SLOTS→DIRECTING`);

    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1StructuralRevise(): void {
  const name = 'T1.3 structural revise — PARALLEL_FANOUT → REPLANNING → PLANNING';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      criticVerdict: stubCriticVerdict('revise', 'structural'),
      copyPackage: stubCopyPackage(),
    });
    ctx.budget.reviseLoopRemaining = 2;

    const t = planNextTransition(ctx, { kind: 'critic_verdict_ready' });
    expectEq(t.to, 'REPLANNING', `${name} to=REPLANNING`);
    expectIncludes(
      t.events as TransitionEventType[],
      'revise_structural_triggered',
      `${name} emits revise_structural_triggered`,
    );

    enterReviseStructural(ctx, ctx.criticVerdict!);
    expectEq(ctx.budget.reviseLoopRemaining, 1, `${name} budget to 1`);
    expect(ctx.plannerOutput === undefined, `${name} plannerOutput cleared`);
    expect(ctx.candidateSets === undefined, `${name} candidateSets cleared`);

    ctx.currentState = 'REPLANNING';
    const t2 = planNextTransition(ctx, { kind: 'advance' });
    expectEq(t2.to, 'PLANNING', `${name} REPLANNING→PLANNING`);

    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1ReviseBudgetExhaustion(): void {
  const name = 'T1.4 revise budget exhaustion → ESCALATING_TO_HUMAN';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      criticVerdict: stubCriticVerdict('revise', 'slot_level'),
      copyPackage: stubCopyPackage(),
    });
    ctx.budget.reviseLoopRemaining = 0; // Already exhausted.

    const t = planNextTransition(ctx, { kind: 'critic_verdict_ready' });
    expectEq(t.to, 'ESCALATING_TO_HUMAN', `${name} to`);
    expectEq(t.terminalState, 'failed_after_revise_budget', `${name} terminalState`);
    expectIncludes(
      t.events as TransitionEventType[],
      'revise_budget_exhausted',
      `${name} emits revise_budget_exhausted`,
    );
    expectIncludes(
      t.events as TransitionEventType[],
      'pipeline_v2_escalated',
      `${name} emits pipeline_v2_escalated`,
    );

    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1CriticReject(): void {
  const name = 'T1.5 critic reject → FAILED';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      criticVerdict: stubCriticVerdict('reject'),
      copyPackage: stubCopyPackage(),
    });

    const t = planNextTransition(ctx, { kind: 'critic_verdict_ready' });
    expectEq(t.to, 'FAILED', `${name} to`);
    expectEq(t.terminalState, 'failed_critic_reject', `${name} terminalState`);
    expectIncludes(
      t.events as TransitionEventType[],
      'pipeline_v2_failed',
      `${name} emits pipeline_v2_failed`,
    );

    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1AgentErrorCascade(): void {
  const name = 'T1.6 agent_error from PLANNING → FAILED';
  try {
    const ctx = mkCtx('PLANNING');
    const t = planNextTransition(ctx, {
      kind: 'agent_error',
      agent: 'planner',
      reason: 'Gemini 500 after retry budget exhausted',
    });
    expectEq(t.to, 'FAILED', `${name} to`);
    expectEq(t.terminalState, 'failed_agent_error', `${name} terminalState`);
    expect(
      (t.failureReason ?? '').includes('planner'),
      `${name} failureReason mentions planner`,
    );
    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1RetrievalEmptyRetry(): void {
  const name = 'T1.7 retrieval_empty + retry budget available → silent PLANNING re-entry';
  try {
    const ctx = mkCtx('RETRIEVING', { plannerOutput: stubPlannerOutput() });
    ctx.budget.interAgentRetryRemaining = 1;

    const t = planNextTransition(ctx, { kind: 'retrieval_empty' });
    expectEq(t.to, 'PLANNING', `${name} to=PLANNING`);
    expectEq(t.events.length, 0, `${name} silent (no events)`);
    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1RetrievalEmptyExhaustion(): void {
  const name = 'T1.8 retrieval_empty + budget exhausted → FAILED';
  try {
    const ctx = mkCtx('RETRIEVING', { plannerOutput: stubPlannerOutput() });
    ctx.budget.interAgentRetryRemaining = 0;

    const t = planNextTransition(ctx, { kind: 'retrieval_empty' });
    expectEq(t.to, 'FAILED', `${name} to`);
    expectEq(t.terminalState, 'failed_agent_error', `${name} terminalState`);
    expectIncludes(
      t.events as TransitionEventType[],
      'retrieval_retry_exhausted',
      `${name} emits retrieval_retry_exhausted`,
    );
    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1CriticParseExhausted(): void {
  const name = 'T1.9 critic parse exhausted → COMMITTING (soft-approve)';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
      copyPackage: stubCopyPackage(),
      // Note: no criticVerdict — parse exhausted BEFORE verdict emission.
    });

    const t = planNextTransition(ctx, { kind: 'critic_parse_exhausted' });
    expectEq(t.to, 'COMMITTING', `${name} to`);
    expectIncludes(
      t.events as TransitionEventType[],
      'critic_unavailable_approving_default',
      `${name} emits critic_unavailable_approving_default`,
    );
    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

function t1CopywriterFailure(): void {
  const name = 'T1.10 copywriter failure → FAILED';
  try {
    const ctx = mkCtx('PARALLEL_FANOUT', {
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      snapshots: stubSnapshotMap(),
    });

    const t = planNextTransition(ctx, {
      kind: 'agent_error',
      agent: 'copywriter',
      reason: 'copywriter parse retries exhausted',
    });
    expectEq(t.to, 'FAILED', `${name} to`);
    expectEq(t.terminalState, 'failed_agent_error', `${name} terminalState`);
    expect(
      (t.failureReason ?? '').includes('copywriter'),
      `${name} failureReason mentions copywriter`,
    );
    pass('T1', name);
  } catch (err) {
    fail('T1', name, (err as Error).message);
  }
}

async function runT1(): Promise<void> {
  console.log('\n── Tier 1: state machine coverage ───────────────────────────');
  t1HappyPath();
  t1SlotLevelRevise();
  t1StructuralRevise();
  t1ReviseBudgetExhaustion();
  t1CriticReject();
  t1AgentErrorCascade();
  t1RetrievalEmptyRetry();
  t1RetrievalEmptyExhaustion();
  t1CriticParseExhausted();
  t1CopywriterFailure();
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Synthetic failure paths
// ─────────────────────────────────────────────────────────────────────────────

interface FlagCase {
  name: string;
  pipelineVersion: PipelineVersion;
  override: string | null;
  rolloutPct: number;
  expected: Omit<PipelineFlags, 'reason'>;
}

function t3FlagTruthTable(): void {
  const cases: FlagCase[] = [
    {
      name: 'phase35 gate wins over everything',
      pipelineVersion: 'phase35',
      override: 'force',
      rolloutPct: 100,
      expected: { runPhase35: true, runPartB: false, isDualRun: false },
    },
    {
      name: 'part_b_primary gate — Part B only',
      pipelineVersion: 'part_b_primary',
      override: null,
      rolloutPct: 0,
      expected: { runPhase35: false, runPartB: true, isDualRun: false },
    },
    {
      name: 'shadow + override=force → dual-run',
      pipelineVersion: 'part_b_shadow',
      override: 'force',
      rolloutPct: 0,
      expected: { runPhase35: true, runPartB: true, isDualRun: true },
    },
    {
      name: 'shadow + override=part_b → dual-run (synonym)',
      pipelineVersion: 'part_b_shadow',
      override: 'part_b',
      rolloutPct: 0,
      expected: { runPhase35: true, runPartB: true, isDualRun: true },
    },
    {
      name: 'shadow + override=skip → Part B off',
      pipelineVersion: 'part_b_shadow',
      override: 'skip',
      rolloutPct: 100,
      expected: { runPhase35: true, runPartB: false, isDualRun: false },
    },
    {
      name: 'shadow + override=phase35 → Part B off',
      pipelineVersion: 'part_b_shadow',
      override: 'phase35',
      rolloutPct: 100,
      expected: { runPhase35: true, runPartB: false, isDualRun: false },
    },
    {
      name: 'shadow + no override + rollout=100 → dual-run',
      pipelineVersion: 'part_b_shadow',
      override: null,
      rolloutPct: 100,
      expected: { runPhase35: true, runPartB: true, isDualRun: true },
    },
    {
      name: 'shadow + no override + rollout=0 → Part B off',
      pipelineVersion: 'part_b_shadow',
      override: null,
      rolloutPct: 0,
      expected: { runPhase35: true, runPartB: false, isDualRun: false },
    },
    {
      name: 'shadow + unknown override (typo) → treated as null, gated by rollout=0',
      pipelineVersion: 'part_b_shadow',
      override: 'part-B', // hyphen typo → unknown → normalize to null
      rolloutPct: 0,
      expected: { runPhase35: true, runPartB: false, isDualRun: false },
    },
  ];

  const jobId = '00000000-0000-0000-0000-000000000001';
  for (const c of cases) {
    const name = `T3.flag — ${c.name}`;
    try {
      const got = decidePipelineRouting(
        c.pipelineVersion,
        c.override,
        c.rolloutPct,
        jobId,
      );
      expectEq(got.runPhase35, c.expected.runPhase35, `${name} runPhase35`);
      expectEq(got.runPartB, c.expected.runPartB, `${name} runPartB`);
      expectEq(got.isDualRun, c.expected.isDualRun, `${name} isDualRun`);
      expect(got.reason.length > 0, `${name} reason populated`);
      pass('T3', name, got.reason);
    } catch (err) {
      fail('T3', name, (err as Error).message);
    }
  }

  // Percentage bucket determinism: same jobId at pct=50 returns same result.
  try {
    const name = 'T3.flag — shouldRunPartBByPercentage determinism';
    const j = 'deterministic-job-id';
    const a = shouldRunPartBByPercentage(j, 50);
    const b = shouldRunPartBByPercentage(j, 50);
    expectEq(a, b, `${name} stable across calls`);
    // Edge cases 0 and 100
    expectEq(
      shouldRunPartBByPercentage(j, 0),
      false,
      `${name} pct=0 always false`,
    );
    expectEq(
      shouldRunPartBByPercentage(j, 100),
      true,
      `${name} pct=100 always true`,
    );
    pass('T3', name);
  } catch (err) {
    fail('T3', 'T3.flag — shouldRunPartBByPercentage determinism', (err as Error).message);
  }
}

function t3RenderPrepNullSafety(): void {
  const base = { copy: stubCopyPackage() };

  // Case A: null → pass-through
  try {
    const name = 'T3.render — voiceover_script=null pass-through';
    const out = prepareContextForRender(base);
    expect(
      out.context.copy.voiceover_script === null,
      `${name} voiceover remains null`,
    );
    expect(
      out.notes.toLowerCase().includes('pass-through'),
      `${name} notes indicate pass-through`,
    );
    pass('T3', name, out.notes);
  } catch (err) {
    fail('T3', 'T3.render — voiceover_script=null pass-through', (err as Error).message);
  }

  // Case B: whitespace-only string → normalized to null (reachable only
  // post-W10 but guard already handles it defensively).
  try {
    const name = 'T3.render — whitespace string normalizes to null';
    const withWhitespace = {
      copy: {
        ...stubCopyPackage(),
        voiceover_script: '   ' as unknown as null,
      },
    };
    const out = prepareContextForRender(withWhitespace);
    expect(
      out.context.copy.voiceover_script === null,
      `${name} voiceover normalized to null`,
    );
    pass('T3', name, out.notes);
  } catch (err) {
    fail('T3', 'T3.render — whitespace string normalizes to null', (err as Error).message);
  }

  // Case C: non-empty string → pass-through with length report
  try {
    const name = 'T3.render — non-empty string pass-through';
    const withText = {
      copy: {
        ...stubCopyPackage(),
        voiceover_script: 'hello world narration' as unknown as null,
      },
    };
    const out = prepareContextForRender(withText);
    expect(
      typeof out.context.copy.voiceover_script === 'string',
      `${name} voiceover retained as string`,
    );
    expect(
      out.notes.includes('pass-through'),
      `${name} notes indicate pass-through`,
    );
    pass('T3', name, out.notes);
  } catch (err) {
    fail('T3', 'T3.render — non-empty string pass-through', (err as Error).message);
  }

  // Case D: unexpected type throws
  try {
    const name = 'T3.render — unexpected type throws';
    const bogus = {
      copy: {
        ...stubCopyPackage(),
        voiceover_script: 42 as unknown as null,
      },
    };
    let threw = false;
    try {
      prepareContextForRender(bogus);
    } catch (e) {
      threw = true;
      expect(
        (e as Error).message.includes('unexpected type'),
        `${name} throws with descriptive message`,
      );
    }
    expect(threw, `${name} throw expected`);
    pass('T3', name);
  } catch (err) {
    fail('T3', 'T3.render — unexpected type throws', (err as Error).message);
  }
}

async function t3ShadowWriterGraceful(): Promise<void> {
  const name = 'T3.shadow — writer graceful on invalid job_id';
  const t0 = Date.now();
  try {
    // Invalid FK on job_id → Supabase must return an error; writer must NOT
    // throw — it must return ok=false, error populated. This is the
    // load-bearing graceful-degradation guarantee for the fire-and-forget
    // dispatch: if shadow_runs is broken, Phase 3.5 still succeeds.
    const result = await writeShadowRun({
      jobId: '00000000-0000-0000-0000-000000000000', // non-existent
      plannerOutput: stubPlannerOutput(),
      candidateSets: stubCandidateSets(),
      picks: stubPicks(),
      criticVerdict: stubCriticVerdict('approve'),
      copyPackage: stubCopyPackage(),
      contextPacketV2: { synthetic: true },
      contextPacketV1: null,
      reviseLoopIterations: 0,
      totalAgentInvocations: 5,
      partBWallTimeMs: 12345,
      partBCostUsd: 0,
      partBTerminalState: 'completed',
      partBFailureReason: null,
    });
    // FK violation should return ok=false without throwing.
    expectEq(result.ok, false, `${name} result.ok=false`);
    expect(result.error !== null, `${name} error populated`);
    pass('T3', name, `error='${result.error}'`, Date.now() - t0);
  } catch (err) {
    // Unexpected: writer threw. That's a regression.
    fail('T3', name, `writer threw: ${(err as Error).message}`, Date.now() - t0);
  }
}

async function runT3(): Promise<void> {
  console.log('\n── Tier 3: synthetic failure paths ──────────────────────────');
  t3FlagTruthTable();
  t3RenderPrepNullSafety();
  await t3ShadowWriterGraceful();
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Real E2E (opt-in; costs ~$3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each seed creates a fresh synthetic jobs row, runs runPipelineV2, then
 * cleans up. The seeds themselves are curated per brief § "Tier 2":
 *   A: W7 seed 3 — aesthetic-ambient, mixed stance → should happy-path
 *   B: W7 seed 1 — routine-sequence, single-subject → historically triggers
 *      revise on subject_discontinuity
 *   C: structurally-blocking seed → exercise with ≤2 library segments,
 *      should force structural revise (or escalation if budget too tight)
 */
const T2_SEEDS = [
  {
    tag: 'A',
    seed:
      'soft golden-hour pilates aesthetic vignette — mixed subjects, no teaching',
    expectation: 'happy-path (approve)',
  },
  {
    tag: 'B',
    seed: 'morning pilates routine for hip mobility',
    expectation: 'may revise (subject_discontinuity)',
  },
  {
    tag: 'C',
    seed:
      'deep dive on the single-leg glute bridge — one exercise, five cue variations',
    expectation: 'may trigger structural revise (library coverage)',
  },
];

async function runT2Seed(
  tag: string,
  seed: string,
  expectation: string,
): Promise<void> {
  const { supabaseAdmin } = await import('../config/supabase.js');
  const jobId = randomUUID();
  const wallT0 = Date.now();
  const name = `T2.${tag} — ${seed}`;
  try {
    // Insert a temp jobs row — Part B reads brand_id + idea_seed from it.
    const { error: insertErr } = await supabaseAdmin.from('jobs').insert({
      id: jobId,
      brand_id: 'nordpilates',
      status: 'planning',
      idea_seed: seed,
    });
    if (insertErr) {
      throw new Error(`job insert failed: ${insertErr.message}`);
    }

    const summary = await runPipelineV2(jobId);
    const wall = Date.now() - wallT0;

    const note = `terminal=${summary.terminalState} runId=${summary.runId ?? 'none'} wallB=${summary.walltime_ms}ms wallTotal=${wall}ms exp=${expectation}`;
    pass('T2', name, note, wall);
  } catch (err) {
    fail('T2', name, (err as Error).message, Date.now() - wallT0);
  } finally {
    // Cleanup — leave shadow_runs row for inspection but drop the synthetic
    // jobs row so we don't clutter the production table.
    try {
      await supabaseAdmin.from('jobs').delete().eq('id', jobId);
    } catch {
      // non-fatal
    }
  }
}

async function runT2(): Promise<void> {
  console.log('\n── Tier 2: real E2E (3 seeds, ~$3) ──────────────────────────');
  for (const s of T2_SEEDS) {
    await runT2Seed(s.tag, s.seed, s.expectation);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runTier2 = argv.includes('--tier2');

  console.log('W8 Gate A smoke — orchestrator / flags / render-prep / shadow-writer');
  console.log(`  Tier 2 real E2E: ${runTier2 ? 'ON' : 'off (pass --tier2 to enable)'}`);

  await runT1();
  if (runTier2) {
    await runT2();
  }
  await runT3();

  // Summary
  const total = RESULTS.length;
  const passed = RESULTS.filter((r) => r.ok).length;
  const failed = total - passed;

  const byTier = (t: CaseResult['tier']): { p: number; f: number } => {
    const rows = RESULTS.filter((r) => r.tier === t);
    return { p: rows.filter((r) => r.ok).length, f: rows.filter((r) => !r.ok).length };
  };
  const t1 = byTier('T1');
  const t2 = byTier('T2');
  const t3 = byTier('T3');

  console.log('\n── Gate A summary ───────────────────────────────────────────');
  console.log(`  T1 state machine:     ${t1.p} pass / ${t1.f} fail`);
  console.log(`  T2 real E2E:          ${t2.p} pass / ${t2.f} fail ${runTier2 ? '' : '(skipped)'}`);
  console.log(`  T3 synthetic:         ${t3.p} pass / ${t3.f} fail`);
  console.log(`  total:                ${passed}/${total} pass`);

  if (failed > 0) {
    console.log('\n── Failures ─────────────────────────────────────────────────');
    for (const r of RESULTS.filter((r) => !r.ok)) {
      console.log(`  ✗ [${r.tier}] ${r.name}`);
      console.log(`       ${r.error}`);
    }
    process.exit(1);
  }

  console.log('\n✓ all active tiers passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('[test-orchestrator] fatal:', err);
  process.exit(1);
});
