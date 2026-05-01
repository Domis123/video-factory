/**
 * c3 standalone test — runs the editor agent against 5 production segments
 * spanning multiple segment_types (exercise, hold, b-roll, setup, transition)
 * to exercise the prompt across the realistic input distribution.
 *
 * Calls happen in parallel (mirrors c4's orchestrator Promise.all pattern)
 * to also confirm per-segment isolation in practice.
 *
 * Usage: npx tsx src/scripts/test-editor-agent-prompt.ts
 *
 * Cost: ~$0.005-0.01 × 5 segments = ~$0.025-0.05 per run.
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

async function main() {
  console.log('🧪 editor-agent (c3) prompt test — 5 production segments\n');
  const t0 = Date.now();
  const rows = await pickSegments();
  console.log(`\n  Picked ${rows.length} segments across types: ${rows.map((r) => r.segment_type).join(', ')}\n`);

  // Build inputs with synthesized slot_role assignments (hook for first,
  // close for last, body otherwise) and v1.2.1 render-context.
  const totalDurationS = rows.reduce(
    (acc, r) => acc + (Number(r.end_s) - Number(r.start_s)),
    0,
  );
  const targetDurationS = 30;
  const inputs = rows.map((row, i) =>
    inputFromRow(
      row,
      pickSlotRole(i, rows.length),
      i,
      rows.length,
      totalDurationS,
      targetDurationS,
    ),
  );

  // Run in parallel — mirrors orchestrator Promise.all.
  console.log('  Calling refineSegmentBoundary in parallel...\n');
  const outcomes = await Promise.all(inputs.map((i) => refineSegmentBoundary(i)));
  const wallMs = Date.now() - t0;

  console.log('\n── Per-segment outcomes ──');
  for (let i = 0; i < outcomes.length; i++) {
    const row = rows[i];
    const inp = inputs[i];
    const o = outcomes[i];
    console.log(`\n[${i + 1}/${outcomes.length}] ${row.segment_type}/${row.id}`);
    console.log(`    ${summarize(o, inp)}`);
    if (o.kind === 'refined_ok' || o.kind === 'no_change_needed') {
      console.log(`    reasoning: ${o.reasoning.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    if (o.clamps.length > 0) {
      console.log(`    clamps: ${o.clamps.join(', ')}`);
    }

    // Per-row mechanical assertions
    assert(
      `[${i + 1}] outcome kind valid`,
      ['refined_ok', 'no_change_needed', 'fallback'].includes(o.kind),
    );
    assert(
      `[${i + 1}] refined within original`,
      o.refinedStartS >= inp.originalStartS - 1e-9 && o.refinedEndS <= inp.originalEndS + 1e-9,
    );
    if (o.kind !== 'fallback') {
      assert(`[${i + 1}] refined duration >= 1.5s`, o.refinedEndS - o.refinedStartS >= 1.5 - 1e-9);
    }
  }

  // Aggregate stats
  const byKind: Record<string, number> = { refined_ok: 0, no_change_needed: 0, fallback: 0 };
  let totalCost = 0;
  let totalRefinedDelta = 0;
  for (let i = 0; i < outcomes.length; i++) {
    byKind[outcomes[i].kind] = (byKind[outcomes[i].kind] || 0) + 1;
    totalCost += outcomes[i].costUsd;
    if (outcomes[i].kind === 'refined_ok') {
      const inp = inputs[i];
      const o = outcomes[i];
      totalRefinedDelta +=
        Math.abs(o.refinedStartS - inp.originalStartS) +
        Math.abs(o.refinedEndS - inp.originalEndS);
    }
  }

  console.log('\n── Aggregate ──');
  console.log(`  refined_ok:        ${byKind.refined_ok}`);
  console.log(`  no_change_needed:  ${byKind.no_change_needed}`);
  console.log(`  fallback:          ${byKind.fallback}`);
  console.log(`  total cost:        $${totalCost.toFixed(5)}`);
  console.log(`  parallel wall_ms:  ${wallMs}`);
  console.log(`  sum |refined Δ|:   ${totalRefinedDelta.toFixed(2)}s (across refined_ok rows)`);

  // Per-segment isolation check: every outcome must have completed regardless
  // of others.
  assert('all outcomes returned (isolation OK)', outcomes.length === inputs.length);

  // Cost sanity check
  assert(
    'aggregate cost in projected range ($0.005-0.10)',
    totalCost >= 0.001 && totalCost < 0.10,
    `total=$${totalCost.toFixed(5)}`,
  );

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ editor-agent c3 prompt test pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
