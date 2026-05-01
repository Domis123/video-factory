/**
 * Editor prompt test — runs against 5 production segments under two pacing
 * scenarios to exercise the v1.2.1 pacing-aware logic.
 *
 *   Scenario A: target=30s. With 5 random segments typically summing
 *               30-50s, this lands in the pacing-tight band (overshoot>5).
 *               Expected: Editor trims more aggressively, more refined_ok
 *               outcomes with notable Δend.
 *
 *   Scenario B: target=120s. Same 5 segments, target far above current.
 *               Pacing-fine band (overshoot ≤ 5 trivially). Expected:
 *               Editor optimizes for boundary quality only, more
 *               no_change_needed outcomes.
 *
 * Mechanical assertions hold in both scenarios: refined within original,
 * duration ≥1.5s, schema-clean outcomes. Behavioral assertion: scenario A
 * should have at least as many refined_ok as scenario B (pacing pressure
 * → more refinement).
 *
 * Calls happen in parallel (mirrors c4's orchestrator Promise.all pattern)
 * to also confirm per-segment isolation in practice.
 *
 * Usage: npx tsx src/scripts/test-editor-agent-prompt.ts
 *
 * Cost: ~$0.005-0.01 × 5 segments × 2 scenarios = ~$0.05-0.10 per run.
 */

import { supabaseAdmin } from '../config/supabase.js';
import {
  refineSegmentBoundary,
  type EditorAgentInput,
  type EditorAgentOutcome,
  type SlotRole,
} from '../agents/editor-agent.js';

const BRAND_ID = 'nordpilates';

const SEGMENT_TYPES_DESIRED = ['exercise', 'hold', 'b-roll', 'setup', 'transition'];

const IDEA_SEED = '5-min morning routine to wake up your glutes';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

interface PickedRow {
  id: string;
  segment_type: string;
  start_s: number;
  end_s: number;
  description: string | null;
  segment_v2: Record<string, unknown>;
  keyframe_grid_r2_key: string;
}

async function pickSegments(): Promise<PickedRow[]> {
  // Pull one segment per desired type, biased toward higher quality_score so
  // we exercise the prompt against representative content.
  const picked: PickedRow[] = [];
  for (const type of SEGMENT_TYPES_DESIRED) {
    const { data, error } = await supabaseAdmin
      .from('asset_segments')
      .select('id, segment_type, start_s, end_s, description, segment_v2, keyframe_grid_r2_key, quality_score')
      .eq('brand_id', BRAND_ID)
      .eq('segment_type', type)
      .not('segment_v2', 'is', null)
      .not('keyframe_grid_r2_key', 'is', null)
      .order('quality_score', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      picked.push(data[0] as unknown as PickedRow);
    } else {
      console.log(`  ⚠ no segment of type=${type} matched filters; skipping`);
    }
  }
  return picked;
}

function inputFromRow(
  row: PickedRow,
  slotRole: SlotRole,
  slotIndex: number,
  slotCountTotal: number,
  currentRenderDurationS: number,
  targetRenderDurationS: number,
): EditorAgentInput {
  return {
    segmentId: row.id,
    originalStartS: Number(row.start_s),
    originalEndS: Number(row.end_s),
    segmentType: row.segment_type,
    description: row.description,
    editorUse: null,
    segmentV2: row.segment_v2,
    keyframeGridR2Key: row.keyframe_grid_r2_key,
    ideaSeed: IDEA_SEED,
    slotRole,
    slotCountTotal,
    slotIndex,
    currentRenderDurationS,
    targetRenderDurationS,
  };
}

function pickSlotRole(idx: number, total: number): SlotRole {
  if (idx === 0) return 'hook';
  if (idx === total - 1) return 'close';
  return 'body';
}

function summarize(o: EditorAgentOutcome, input: EditorAgentInput): string {
  const orig = `[${input.originalStartS.toFixed(2)}, ${input.originalEndS.toFixed(2)}]s`;
  const refined = `[${o.refinedStartS.toFixed(2)}, ${o.refinedEndS.toFixed(2)}]s`;
  const startDelta = o.refinedStartS - input.originalStartS;
  const endDelta = o.refinedEndS - input.originalEndS;
  const deltaTag = `Δstart=${startDelta >= 0 ? '+' : ''}${startDelta.toFixed(2)} Δend=${endDelta >= 0 ? '+' : ''}${endDelta.toFixed(2)}`;
  const tail =
    o.kind === 'fallback'
      ? `reason=${o.reason}`
      : `conf=${o.confidence}`;
  return `${o.kind.padEnd(18)} ${orig} → ${refined} ${deltaTag} ${tail} ($${o.costUsd.toFixed(4)} ${o.wallMs}ms)`;
}

interface ScenarioResult {
  label: string;
  targetDurationS: number;
  totalDurationS: number;
  overshoot: number;
  outcomes: EditorAgentOutcome[];
  inputs: EditorAgentInput[];
  byKind: Record<string, number>;
  totalCost: number;
  wallMs: number;
}

async function runScenario(
  label: string,
  rows: PickedRow[],
  targetDurationS: number,
): Promise<ScenarioResult> {
  console.log(`\n══════ Scenario ${label}: target=${targetDurationS}s ══════`);
  const t0 = Date.now();
  const totalDurationS = rows.reduce(
    (acc, r) => acc + (Number(r.end_s) - Number(r.start_s)),
    0,
  );
  const overshoot = totalDurationS - targetDurationS;
  console.log(
    `  current=${totalDurationS.toFixed(2)}s target=${targetDurationS}s overshoot=${overshoot.toFixed(2)}s ` +
      `(band: ${overshoot > 5 ? 'pacing-tight' : 'pacing-fine'})`,
  );

  const inputs = rows.map((row, i) =>
    inputFromRow(row, pickSlotRole(i, rows.length), i, rows.length, totalDurationS, targetDurationS),
  );
  const outcomes = await Promise.all(inputs.map((inp) => refineSegmentBoundary(inp)));
  const wallMs = Date.now() - t0;

  console.log('\n  ── Per-segment outcomes ──');
  for (let i = 0; i < outcomes.length; i++) {
    const row = rows[i];
    const inp = inputs[i];
    const o = outcomes[i];
    console.log(`  [${i + 1}/${outcomes.length}] ${row.segment_type}/${row.id.slice(0, 8)}`);
    console.log(`      ${summarize(o, inp)}`);
    if (o.kind === 'refined_ok' || o.kind === 'no_change_needed') {
      console.log(`      reasoning: ${o.reasoning.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    if (o.clamps.length > 0) {
      console.log(`      clamps: ${o.clamps.join(', ')}`);
    }

    // Per-row mechanical assertions (apply to BOTH scenarios)
    assert(
      `[${label}.${i + 1}] outcome kind valid`,
      ['refined_ok', 'no_change_needed', 'fallback'].includes(o.kind),
    );
    assert(
      `[${label}.${i + 1}] refined within original (clamp held)`,
      o.refinedStartS >= inp.originalStartS - 1e-9 && o.refinedEndS <= inp.originalEndS + 1e-9,
    );
    if (o.kind !== 'fallback') {
      assert(
        `[${label}.${i + 1}] refined duration >= 1.5s`,
        o.refinedEndS - o.refinedStartS >= 1.5 - 1e-9,
      );
    }
  }

  const byKind: Record<string, number> = { refined_ok: 0, no_change_needed: 0, fallback: 0 };
  let totalCost = 0;
  for (const o of outcomes) {
    byKind[o.kind] = (byKind[o.kind] || 0) + 1;
    totalCost += o.costUsd;
  }
  console.log(
    `\n  Scenario ${label} aggregate: refined_ok=${byKind.refined_ok}  no_change=${byKind.no_change_needed}  ` +
      `fallback=${byKind.fallback}  cost=$${totalCost.toFixed(5)}  wall=${wallMs}ms`,
  );

  return { label, targetDurationS, totalDurationS, overshoot, outcomes, inputs, byKind, totalCost, wallMs };
}

async function main() {
  console.log('🧪 editor-agent prompt test — v1.2.1 pacing-aware (2 scenarios)\n');
  const rows = await pickSegments();
  console.log(`Picked ${rows.length} segments across types: ${rows.map((r) => r.segment_type).join(', ')}`);

  // Scenario A: tight target (likely overshoot, exercises pacing-tight band)
  const scenarioA = await runScenario('A (target=30, expect overshoot)', rows, 30);

  // Scenario B: loose target (no overshoot, exercises pacing-fine band)
  const scenarioB = await runScenario('B (target=120, no overshoot)', rows, 120);

  // Cross-scenario behavioral assertions
  console.log('\n── Cross-scenario assertions ──');
  // Pacing pressure should produce at least as many refined_ok as relaxed
  // pacing. Strict equality is not asserted because the 5 segments may
  // already be such that boundary-quality dominates (no pacing pressure
  // needed). Inequality holding ⇒ pacing logic is being read.
  assert(
    'scenario A refined_ok ≥ scenario B refined_ok',
    scenarioA.byKind.refined_ok >= scenarioB.byKind.refined_ok,
    `A=${scenarioA.byKind.refined_ok} B=${scenarioB.byKind.refined_ok}`,
  );
  // Either scenario MUST have zero fallbacks for a healthy run (the c1
  // schema guarantees the in-bounds + duration-floor properties through
  // applyClamps, but if the model returns degenerate output enough times
  // it would surface here).
  assert('scenario A: zero fallbacks', scenarioA.byKind.fallback === 0);
  assert('scenario B: zero fallbacks', scenarioB.byKind.fallback === 0);
  assert(
    'aggregate cost across both scenarios in projected range ($0.005-0.20)',
    scenarioA.totalCost + scenarioB.totalCost >= 0.001 &&
      scenarioA.totalCost + scenarioB.totalCost < 0.20,
    `A=$${scenarioA.totalCost.toFixed(4)} B=$${scenarioB.totalCost.toFixed(4)}`,
  );

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ editor-agent prompt test pass (v1.2.1).\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
