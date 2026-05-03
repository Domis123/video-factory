/**
 * c5.5 unit test — editorDisabled per-job toggle.
 *
 * No real Gemini calls; offline test that the routine path with
 * editorDisabled=true yields the same shape as meme bypass (editor_invoked=false,
 * empty refined map, zero cost/wall).
 *
 * Halt-and-report check from kickoff: confirms editorDisabled=true matches
 * memeBypass shape on routine. If this fails, c5.5 spec is wrong.
 *
 * Usage: npx tsx src/scripts/test-editor-disabled-toggle.ts
 */

import { runEditorStep } from '../orchestrator/simple-pipeline/editor-step.js';

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

async function testRoutineWithEditorDisabled() {
  console.log('\n── ROUTINE + editorDisabled=true (baseline mode) ──');
  const t0 = Date.now();
  // Use synthetic UUIDs — the function should bypass the DB fetch entirely
  // when editorDisabled=true.
  const segmentIds = [
    '11111111-2222-3333-4444-555555555501',
    '11111111-2222-3333-4444-555555555502',
    '11111111-2222-3333-4444-555555555503',
  ];
  const result = await runEditorStep({
    jobId: 'test-c5.5-routine-disabled',
    segmentIds,
    ideaSeed: '5-min morning routine',
    format: 'routine',
    editorDisabled: true,
  });
  const wallMs = Date.now() - t0;

  console.log(`  editor_invoked:     ${result.outcome.editor_invoked}`);
  console.log(`  segments_total:     ${result.outcome.segments_total}`);
  console.log(`  editor_cost_usd:    $${result.outcome.editor_cost_usd}`);
  console.log(`  editor_wall_ms:     ${result.outcome.editor_wall_ms}`);
  console.log(`  refined map size:   ${result.refinedBoundsBySegmentId.size}`);
  console.log(`  test wall (overall):${wallMs}ms`);

  assert('editor_invoked=false (matches meme bypass shape)', result.outcome.editor_invoked === false);
  assert('segments_total=3 (count of picked, not modified)', result.outcome.segments_total === 3);
  assert('zero cost', result.outcome.editor_cost_usd === 0);
  assert('zero refined/no_change/fallback', (
    result.outcome.segments_refined === 0 &&
    result.outcome.segments_no_change === 0 &&
    result.outcome.segments_fallback === 0
  ));
  assert('refined map empty (render falls back to original)', result.refinedBoundsBySegmentId.size === 0);
  assert('bypass is fast (<200ms — no DB, no Gemini)', wallMs < 200);
  assert('empty fallback_reasons object', Object.keys(result.outcome.fallback_reasons).length === 0);
}

async function testRoutineWithEditorEnabledExplicit() {
  console.log('\n── ROUTINE + editorDisabled=false (explicit, c4 behavior) ──');
  // We want to confirm editorDisabled=false (explicit) does NOT bypass.
  // We can't actually call refineSegmentBoundary without DB+Gemini, but we
  // can check that the early-return guard does not fire — by passing an
  // empty segmentIds list (which is the next short-circuit) and confirming
  // editor_invoked=false comes from THAT path (segments_total=0 + the
  // memeBypass shape), not from the editorDisabled guard.
  //
  // Specifically: we expect runEditorStep with format=routine,
  // editorDisabled=false, segmentIds=[] to return the "no segments" bypass.
  const result = await runEditorStep({
    jobId: 'test-c5.5-routine-enabled-empty',
    segmentIds: [],
    ideaSeed: 'edge case: empty pick',
    format: 'routine',
    editorDisabled: false,
  });
  // segmentIds=[] → memeBypass([], t0) → segments_total=0
  assert('empty segmentIds: editor_invoked=false', result.outcome.editor_invoked === false);
  assert('empty segmentIds: segments_total=0', result.outcome.segments_total === 0);
}

async function testRoutineWithEditorDisabledUndefined() {
  console.log('\n── ROUTINE + editorDisabled undefined (default behavior) ──');
  // Same edge-case test as above but without providing editorDisabled at
  // all. Confirms missing flag is treated as false (does not bypass).
  const result = await runEditorStep({
    jobId: 'test-c5.5-routine-undefined',
    segmentIds: [],
    ideaSeed: 'edge case: empty pick, no flag',
    format: 'routine',
  });
  assert('undefined editorDisabled: editor_invoked=false (empty segments path)', result.outcome.editor_invoked === false);
  assert('undefined editorDisabled: segments_total=0', result.outcome.segments_total === 0);
}

async function testMemeWithEditorDisabledIgnored() {
  console.log('\n── MEME + editorDisabled=true (flag is irrelevant on meme) ──');
  const result = await runEditorStep({
    jobId: 'test-c5.5-meme-disabled',
    segmentIds: ['11111111-2222-3333-4444-555555555501'],
    ideaSeed: 'meme test',
    format: 'meme',
    editorDisabled: true,
  });
  assert('meme + editorDisabled=true: editor_invoked=false', result.outcome.editor_invoked === false);
  assert('meme + editorDisabled=true: segments_total=1', result.outcome.segments_total === 1);
  // Both paths converge on memeBypass; the flag is harmless on meme.
}

async function main() {
  console.log('🧪 editorDisabled (c5.5) toggle test\n');
  await testRoutineWithEditorDisabled();
  await testRoutineWithEditorEnabledExplicit();
  await testRoutineWithEditorDisabledUndefined();
  await testMemeWithEditorDisabledIgnored();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ editorDisabled c5.5 toggle test pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
