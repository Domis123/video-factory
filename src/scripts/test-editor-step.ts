/**
 * c4 standalone test — runEditorStep helper that the Simple Pipeline
 * orchestrator calls between Match-Or-Match and the render step.
 *
 * Two paths exercised:
 *   1. ROUTINE — 3 production segments. Confirms editor_invoked=true,
 *      observability payload populated, refinedBoundsBySegmentId map covers
 *      all picked ids.
 *   2. MEME    — 1 segment, format='meme'. Confirms editor_invoked=false,
 *      zero cost, zero wall, no Gemini call (bypass).
 *
 * Usage: npx tsx src/scripts/test-editor-step.ts
 *
 * Cost: ~$0.005-0.015 (routine path runs 3 Gemini calls in parallel; meme
 * path is offline).
 */

import { supabaseAdmin } from '../config/supabase.js';
import { runEditorStep } from '../orchestrator/simple-pipeline/editor-step.js';

const BRAND_ID = 'nordpilates';
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

async function pickRoutineSegments(n: number): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id')
    .eq('brand_id', BRAND_ID)
    .eq('segment_type', 'exercise')
    .not('segment_v2', 'is', null)
    .not('keyframe_grid_r2_key', 'is', null)
    .order('quality_score', { ascending: false })
    .limit(n);
  if (error) throw error;
  if (!data || data.length < n) {
    throw new Error(`pickRoutineSegments: only ${data?.length ?? 0} eligible segments, need ${n}`);
  }
  return data.map((r: { id: string }) => r.id);
}

async function pickMemeSegment(): Promise<string> {
  const ids = await pickRoutineSegments(1);
  return ids[0];
}

async function testRoutinePath() {
  console.log('\n── ROUTINE: 3-segment editor step ──');
  const segmentIds = await pickRoutineSegments(3);
  const t0 = Date.now();
  const result = await runEditorStep({
    jobId: 'test-c4-routine',
    segmentIds,
    ideaSeed: IDEA_SEED,
    format: 'routine',
  });
  const wallMs = Date.now() - t0;

  console.log(`\n  Result:`);
  console.log(`    editor_invoked:        ${result.outcome.editor_invoked}`);
  console.log(`    segments_total:        ${result.outcome.segments_total}`);
  console.log(`    segments_refined:      ${result.outcome.segments_refined}`);
  console.log(`    segments_no_change:    ${result.outcome.segments_no_change}`);
  console.log(`    segments_fallback:     ${result.outcome.segments_fallback}`);
  console.log(`    fallback_reasons:      ${JSON.stringify(result.outcome.fallback_reasons)}`);
  console.log(`    editor_wall_ms:        ${result.outcome.editor_wall_ms}`);
  console.log(`    editor_cost_usd:       $${result.outcome.editor_cost_usd.toFixed(5)}`);
  console.log(`    refined map size:      ${result.refinedBoundsBySegmentId.size}`);
  console.log(`    test wall (overall):   ${wallMs}ms`);

  assert('routine: editor_invoked=true', result.outcome.editor_invoked === true);
  assert('routine: segments_total=3', result.outcome.segments_total === 3);
  assert(
    'routine: counts sum to total',
    result.outcome.segments_refined + result.outcome.segments_no_change + result.outcome.segments_fallback === 3,
  );
  assert(
    'routine: refined map covers all picked ids',
    result.refinedBoundsBySegmentId.size === 3 &&
      segmentIds.every((id) => result.refinedBoundsBySegmentId.has(id)),
  );
  assert('routine: wall_ms reported', result.outcome.editor_wall_ms > 0);
  assert(
    'routine: cost in projected range ($0.001-0.06)',
    result.outcome.editor_cost_usd >= 0.001 && result.outcome.editor_cost_usd < 0.06,
    `cost=$${result.outcome.editor_cost_usd}`,
  );

  // Per-segment isolation: every picked id must have a bounds entry, refined or not.
  for (const id of segmentIds) {
    const b = result.refinedBoundsBySegmentId.get(id);
    assert(`routine: id=${id.slice(0, 8)} has bounds`, !!b);
    if (b) {
      assert(
        `routine: id=${id.slice(0, 8)} duration >= 1.5s`,
        b.endS - b.startS >= 1.5 - 1e-9,
      );
    }
  }
}

async function testMemePath() {
  console.log('\n── MEME: 1-segment editor bypass ──');
  const segmentId = await pickMemeSegment();
  const t0 = Date.now();
  const result = await runEditorStep({
    jobId: 'test-c4-meme',
    segmentIds: [segmentId],
    ideaSeed: IDEA_SEED,
    format: 'meme',
  });
  const wallMs = Date.now() - t0;

  console.log(`\n  Result:`);
  console.log(`    editor_invoked:        ${result.outcome.editor_invoked}`);
  console.log(`    segments_total:        ${result.outcome.segments_total}`);
  console.log(`    editor_cost_usd:       $${result.outcome.editor_cost_usd.toFixed(5)}`);
  console.log(`    editor_wall_ms:        ${result.outcome.editor_wall_ms}`);
  console.log(`    refined map size:      ${result.refinedBoundsBySegmentId.size}`);
  console.log(`    test wall (overall):   ${wallMs}ms`);

  assert('meme: editor_invoked=false', result.outcome.editor_invoked === false);
  assert('meme: segments_total=1 (count of picked)', result.outcome.segments_total === 1);
  assert('meme: zero cost', result.outcome.editor_cost_usd === 0);
  assert(
    'meme: refined map empty (no bypass entries needed)',
    result.refinedBoundsBySegmentId.size === 0,
  );
  assert('meme: bypass is fast (<200ms)', wallMs < 200);
  assert('meme: zero refined/no_change/fallback counts', (
    result.outcome.segments_refined === 0 &&
    result.outcome.segments_no_change === 0 &&
    result.outcome.segments_fallback === 0
  ));
}

async function main() {
  console.log('🧪 editor-step (c4) integration test\n');
  await testRoutinePath();
  await testMemePath();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ editor-step c4 test pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
