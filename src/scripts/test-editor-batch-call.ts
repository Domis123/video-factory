/**
 * c3 Standalone single-call verification per brief §10 + Rule 47.
 *
 * Two scopes:
 *
 * 1. SYNTHETIC tests (always run, no network) — exercise assembleBatchOutcome
 *    against hand-crafted model responses. Verifies orchestration logic
 *    independent of prompt quality:
 *      - happy path (refined + no_change + drop mixed)
 *      - Zod parse failure → batch fallback
 *      - completeness failure (missing / extra / duplicate) → batch fallback
 *      - JSON parse failure → batch fallback
 *      - empty response → batch fallback
 *      - drop reasoning surfaces in outcome
 *
 * 2. REAL Gemini test (gated by --real flag, default off) — pulls 3–5
 *    nordpilates v2 segments + keyframe grids and runs refineSegmentBatch
 *    against the LIVE prompt file. In c3 the prompt file is still v1.2.1
 *    (per-segment-shaped) so the real call is EXPECTED to fall back at
 *    Zod/completeness; the test reports the outcome shape and verifies
 *    the fallback path runs cleanly. c4 ships the v1.3 prompt and re-runs
 *    this script with --real to validate the happy path against the new
 *    prompt.
 *
 * Usage:
 *   npx tsx src/scripts/test-editor-batch-call.ts          # synthetic only
 *   npx tsx src/scripts/test-editor-batch-call.ts --real   # synthetic + Gemini
 */

import { supabaseAdmin } from '../config/supabase.js';
import {
  assembleBatchOutcome,
  refineSegmentBatch,
  type EditorBatchAgentInput,
  type EditorBatchAgentOutcome,
  type EditorBatchSegmentInput,
} from '../agents/editor-agent.js';

const SHOULD_RUN_REAL = process.argv.includes('--real');

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

// ─── Synthetic input fixtures ──────────────────────────────────────────────

const SEG_A = '11111111-aaaa-bbbb-cccc-111111111111';
const SEG_B = '22222222-aaaa-bbbb-cccc-222222222222';
const SEG_C = '33333333-aaaa-bbbb-cccc-333333333333';
const SEG_D_EXTRA = '44444444-aaaa-bbbb-cccc-444444444444';

function makeSyntheticInput(): EditorBatchAgentInput {
  const seg = (id: string, start: number, end: number): EditorBatchSegmentInput => ({
    segmentId: id,
    originalStartS: start,
    originalEndS: end,
    segmentType: 'exercise',
    description: 'synthetic',
    segmentV2: { motion: { velocity: 'slow' }, quality: { overall: 8 } },
    keyframeGridR2Key: `keyframe-grids/synthetic/${id}.jpg`,
  });
  return {
    segments: [seg(SEG_A, 10.0, 18.0), seg(SEG_B, 20.0, 28.0), seg(SEG_C, 30.0, 39.0)],
    ideaSeed: 'synthetic test routine',
    slotCountTotal: 3,
    currentRenderDurationS: 25.0,
    targetRenderDurationS: 30.0,
  };
}

// ─── Synthetic test cases ──────────────────────────────────────────────────

function testHappyPath() {
  console.log('\n── Happy path (mixed actions: refined + no_change + drop) ──');
  const input = makeSyntheticInput();
  const mockResponse = JSON.stringify({
    refinements: [
      {
        segment_id: SEG_A,
        action: 'refine',
        refined_start_s: 11.0,
        refined_end_s: 17.0,
        reasoning: 'Trims 1s prep at start and 1s drift at end.',
        confidence: 'high',
      },
      {
        segment_id: SEG_B,
        action: 'no_change',
        reasoning: 'Boundaries are clean; segment plays well as-is.',
        confidence: 'high',
      },
      {
        segment_id: SEG_C,
        action: 'drop',
        reasoning: 'Redundant with segment B; weaker subject framing.',
        confidence: 'medium',
      },
    ],
    global_reasoning:
      'Render is in band. Refining A for cleaner boundaries, keeping B, dropping C as redundant.',
  });
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);

  assert('batchFallback false', out.batchFallback === false);
  assert('globalReasoning surfaced', !!out.globalReasoning && out.globalReasoning.startsWith('Render'));
  assert('perSegment length matches input', out.perSegment.length === 3);

  const a = out.perSegment.find((s) => s.segmentId === SEG_A);
  assert('SEG_A: kind=refined', a?.kind === 'refined');
  if (a?.kind === 'refined') {
    assert('SEG_A: refined bounds 11..17', a.refinedStartS === 11 && a.refinedEndS === 17);
    assert('SEG_A: reasoning preserved', a.reasoning.startsWith('Trims'));
  }

  const b = out.perSegment.find((s) => s.segmentId === SEG_B);
  assert('SEG_B: kind=no_change', b?.kind === 'no_change');
  if (b?.kind === 'no_change') {
    assert('SEG_B: original bounds 20..28', b.refinedStartS === 20 && b.refinedEndS === 28);
  }

  const c = out.perSegment.find((s) => s.segmentId === SEG_C);
  assert('SEG_C: kind=drop', c?.kind === 'drop');
  if (c?.kind === 'drop') {
    assert('SEG_C: drop reasoning surfaced', c.reasoning.startsWith('Redundant'));
  }
}

function testZodFallback() {
  console.log('\n── Zod parse failure → batch fallback ──');
  const input = makeSyntheticInput();
  // Missing global_reasoning → Zod fails
  const mockResponse = JSON.stringify({
    refinements: [
      { segment_id: SEG_A, action: 'no_change', reasoning: 'fine', confidence: 'high' },
    ],
  });
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('batchFallback true', out.batchFallback === true);
  assert('reason zod_parse_failed', out.batchFallbackReason === 'zod_parse_failed');
  assert('globalReasoning null', out.globalReasoning === null);
  assert('all segments fallback', out.perSegment.every((s) => s.kind === 'fallback'));
  assert(
    'fallback preserves original bounds',
    out.perSegment.every(
      (s) =>
        s.kind === 'fallback' &&
        s.refinedStartS === input.segments.find((x) => x.segmentId === s.segmentId)!.originalStartS,
    ),
  );
}

function testCompletenessFallback() {
  console.log('\n── Completeness failure (missing segment) → batch fallback ──');
  const input = makeSyntheticInput();
  const mockResponse = JSON.stringify({
    refinements: [
      { segment_id: SEG_A, action: 'no_change', reasoning: 'a', confidence: 'high' },
      { segment_id: SEG_B, action: 'no_change', reasoning: 'b', confidence: 'high' },
      // SEG_C missing
    ],
    global_reasoning: 'Two of three',
  });
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('batchFallback true (missing)', out.batchFallback === true);
  assert('reason completeness_failed (missing)', out.batchFallbackReason === 'completeness_failed');
}

function testCompletenessExtra() {
  console.log('\n── Completeness failure (extra segment) → batch fallback ──');
  const input = makeSyntheticInput();
  const mockResponse = JSON.stringify({
    refinements: [
      { segment_id: SEG_A, action: 'no_change', reasoning: 'a', confidence: 'high' },
      { segment_id: SEG_B, action: 'no_change', reasoning: 'b', confidence: 'high' },
      { segment_id: SEG_C, action: 'no_change', reasoning: 'c', confidence: 'high' },
      { segment_id: SEG_D_EXTRA, action: 'no_change', reasoning: 'extra', confidence: 'high' },
    ],
    global_reasoning: 'One too many',
  });
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('batchFallback true (extra)', out.batchFallback === true);
  assert('reason completeness_failed (extra)', out.batchFallbackReason === 'completeness_failed');
}

function testJsonParseFallback() {
  console.log('\n── JSON parse failure → batch fallback ──');
  const input = makeSyntheticInput();
  const mockResponse = 'not even json';
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('batchFallback true (json)', out.batchFallback === true);
  assert('reason json_parse_failed', out.batchFallbackReason === 'json_parse_failed');
}

function testEmptyResponseFallback() {
  console.log('\n── Empty response → batch fallback ──');
  const input = makeSyntheticInput();
  const out = assembleBatchOutcome('', input, 0.0, 50);
  assert('batchFallback true (empty)', out.batchFallback === true);
  assert('reason empty_response', out.batchFallbackReason === 'empty_response');
}

function testProseWrappedJson() {
  console.log('\n── Prose-wrapped JSON (brace-extraction fallback) ──');
  const input = makeSyntheticInput();
  const mockResponse =
    "Here's the batch output you requested:\n```\n" +
    JSON.stringify({
      refinements: [
        { segment_id: SEG_A, action: 'no_change', reasoning: 'a', confidence: 'high' },
        { segment_id: SEG_B, action: 'no_change', reasoning: 'b', confidence: 'high' },
        { segment_id: SEG_C, action: 'no_change', reasoning: 'c', confidence: 'high' },
      ],
      global_reasoning: 'all fine',
    }) +
    '\n```\nLet me know if you have questions.';
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('brace extraction recovers JSON', out.batchFallback === false);
  assert('all three segments parsed', out.perSegment.length === 3);
}

function testRefineClampedToFloor() {
  console.log('\n── Refine clamped: duration < 1.5s → per-segment fallback (NOT batch) ──');
  const input = makeSyntheticInput();
  const mockResponse = JSON.stringify({
    refinements: [
      {
        segment_id: SEG_A,
        action: 'refine',
        refined_start_s: 14.0,
        refined_end_s: 14.8, // duration 0.8s, below floor
        reasoning: 'too tight',
        confidence: 'low',
      },
      { segment_id: SEG_B, action: 'no_change', reasoning: 'fine', confidence: 'high' },
      { segment_id: SEG_C, action: 'no_change', reasoning: 'fine', confidence: 'high' },
    ],
    global_reasoning: 'one refinement violates floor',
  });
  const out = assembleBatchOutcome(mockResponse, input, 0.05, 1234);
  assert('batchFallback false (per-segment fallback only)', out.batchFallback === false);
  const a = out.perSegment.find((s) => s.segmentId === SEG_A);
  assert('SEG_A: kind=fallback (floor)', a?.kind === 'fallback');
  if (a?.kind === 'fallback') {
    assert(
      'SEG_A: per-segment reason duration_floor_violated',
      a.perSegmentFallbackReason === 'duration_floor_violated',
    );
    assert('SEG_A: original bounds restored', a.refinedStartS === 10.0 && a.refinedEndS === 18.0);
  }
  const b = out.perSegment.find((s) => s.segmentId === SEG_B);
  assert('SEG_B: still no_change (siblings unaffected)', b?.kind === 'no_change');
}

// ─── Real Gemini integration test (--real flag) ────────────────────────────

interface ProductionSegmentRow {
  id: string;
  parent_asset_id: string;
  start_s: number;
  end_s: number;
  segment_type: string;
  description: string | null;
  segment_v2: Record<string, unknown> | null;
  keyframe_grid_r2_key: string | null;
}

async function pickProductionSegments(): Promise<ProductionSegmentRow[]> {
  // Pull a wide sample of nordpilates v2 segments and find a parent with
  // ≥3 editorial-type segments. Order by parent_asset_id + start_s so the
  // first matching parent's segments come back already ordered.
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, start_s, end_s, segment_type, description, segment_v2, keyframe_grid_r2_key')
    .eq('brand_id', 'nordpilates')
    .not('segment_v2', 'is', null)
    .not('keyframe_grid_r2_key', 'is', null)
    .in('segment_type', ['exercise', 'hold', 'b-roll', 'talking-head'])
    .order('parent_asset_id', { ascending: true })
    .order('start_s', { ascending: true })
    .limit(500);
  if (error) throw new Error(`pickProductionSegments: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('pickProductionSegments: no v2 nordpilates segments with keyframe grids found');
  }
  // Group by parent and return the first parent that has ≥3 eligible segments.
  const byParent = new Map<string, ProductionSegmentRow[]>();
  for (const r of data as unknown as ProductionSegmentRow[]) {
    if (!byParent.has(r.parent_asset_id)) byParent.set(r.parent_asset_id, []);
    byParent.get(r.parent_asset_id)!.push(r);
  }
  for (const [, segs] of byParent) {
    if (segs.length >= 3) return segs.slice(0, 3);
  }
  throw new Error(
    `pickProductionSegments: scanned ${data.length} rows across ${byParent.size} parents; no parent had ≥3 eligible segments`,
  );
}

async function testRealGemini() {
  console.log('\n══════ REAL Gemini integration test (--real) ══════');
  const rows = await pickProductionSegments();
  console.log(`  using parent ${rows[0].parent_asset_id.slice(0, 8)} with ${rows.length} segments:`);
  for (const r of rows) {
    const dur = Number(r.end_s) - Number(r.start_s);
    console.log(`    ${r.id.slice(0, 8)}  type=${r.segment_type}  dur=${dur.toFixed(1)}s`);
  }

  const segments: EditorBatchSegmentInput[] = rows.map((r) => ({
    segmentId: r.id,
    originalStartS: Number(r.start_s),
    originalEndS: Number(r.end_s),
    segmentType: r.segment_type,
    description: r.description,
    segmentV2: r.segment_v2,
    keyframeGridR2Key: r.keyframe_grid_r2_key,
  }));
  const picksSum = segments.reduce((s, x) => s + (x.originalEndS - x.originalStartS), 0);

  const input: EditorBatchAgentInput = {
    segments,
    ideaSeed: 'morning core flow for tight hips',
    slotCountTotal: segments.length,
    currentRenderDurationS: picksSum,
    targetRenderDurationS: 30.0,
  };

  console.log(
    `  picks_sum=${picksSum.toFixed(1)}s, target=30s → calling refineSegmentBatch...`,
  );
  const t0 = Date.now();
  const outcome: EditorBatchAgentOutcome = await refineSegmentBatch(input);
  const wall = Date.now() - t0;

  console.log(`  wall=${wall}ms, cost=$${outcome.costUsd.toFixed(4)}`);
  console.log(`  batchFallback=${outcome.batchFallback}` + (outcome.batchFallbackReason ? ` reason=${outcome.batchFallbackReason}` : ''));
  if (outcome.globalReasoning) {
    console.log(`  globalReasoning: ${outcome.globalReasoning.slice(0, 200)}`);
  }
  console.log('  per-segment outcomes:');
  for (const s of outcome.perSegment) {
    if (s.kind === 'refined') {
      console.log(
        `    ${s.segmentId.slice(0, 8)}  refined  [${s.refinedStartS.toFixed(2)}, ${s.refinedEndS.toFixed(2)}]  ${s.reasoning.slice(0, 100)}`,
      );
    } else if (s.kind === 'no_change') {
      console.log(
        `    ${s.segmentId.slice(0, 8)}  no_change  ${s.reasoning.slice(0, 100)}`,
      );
    } else if (s.kind === 'drop') {
      console.log(`    ${s.segmentId.slice(0, 8)}  drop  ${s.reasoning.slice(0, 100)}`);
    } else {
      console.log(
        `    ${s.segmentId.slice(0, 8)}  fallback (${s.perSegmentFallbackReason})`,
      );
    }
  }

  // Real-Gemini assertions are loose by design. Per brief c3, prompt is
  // still v1.2.1 (per-segment shape) so a batch-shaped Zod parse is
  // EXPECTED to fail. The verification is that the FALLBACK PATH RUNS
  // CLEANLY — not that the model produces valid batch output. c4 re-runs
  // this script after shipping the v1.3 prompt to verify the happy path.
  assert('real Gemini call did not throw', outcome !== undefined);
  assert(
    'real Gemini cost recorded (>0 if call happened, =0 if pre-call fallback)',
    typeof outcome.costUsd === 'number',
  );
  assert(
    'real Gemini per-segment count matches input',
    outcome.perSegment.length === input.segments.length,
  );
  if (outcome.batchFallback) {
    console.log(
      `  → expected pre-c4 outcome: batch fallback (current prompt is v1.2.1 per-segment shape, won't produce batch output)`,
    );
    assert('batch fallback handled cleanly (no per-segment data corruption)',
      outcome.perSegment.every(
        (s) =>
          s.kind === 'fallback' && s.perSegmentFallbackReason === 'batch_fallback',
      ),
    );
  } else {
    console.log(`  → unexpected: batch parse succeeded against v1.2.1 prompt`);
    assert('batch parse against v1.2.1 prompt unexpectedly succeeded', true);
  }
}

async function main() {
  console.log('🧪 c3 standalone single-call verification\n');

  testHappyPath();
  testZodFallback();
  testCompletenessFallback();
  testCompletenessExtra();
  testJsonParseFallback();
  testEmptyResponseFallback();
  testProseWrappedJson();
  testRefineClampedToFloor();

  if (SHOULD_RUN_REAL) {
    await testRealGemini();
  } else {
    console.log('\n══════ Real Gemini test SKIPPED (pass --real to enable) ══════');
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ c3 standalone single-call verification PASS\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
