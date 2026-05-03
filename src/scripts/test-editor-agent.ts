/**
 * Standalone smoke for editor-agent.ts (c2).
 *
 * Two test phases:
 *
 *   1. OFFLINE — exercise the fallback paths that never reach Gemini:
 *      - missing keyframe_grid_r2_key
 *      - missing segment_v2
 *      No network calls, no cost, no DB writes.
 *
 *   2. ONLINE (default ON) — pull one v2-analyzed nordpilates segment with a
 *      keyframe grid populated, run refineSegmentBoundary against it, print
 *      the outcome. Confirms wiring end-to-end (R2 fetch → Gemini Pro
 *      multimodal call → Zod parse → clamp → outcome).
 *
 * Skip the online phase by setting `EDITOR_AGENT_TEST_OFFLINE=1`.
 *
 * Usage: npx tsx src/scripts/test-editor-agent.ts
 *
 * Cost (online phase): ~$0.005-0.01 for one Gemini Pro call. The c3 test
 * covers prompt quality across multiple production segments — this c2 test
 * is just wiring.
 */

import { supabaseAdmin } from '../config/supabase.js';
import {
  refineSegmentBoundary,
  type EditorAgentInput,
  type EditorAgentOutcome,
} from '../agents/editor-agent.js';

const BRAND_ID = 'nordpilates';
const ONLINE = process.env['EDITOR_AGENT_TEST_OFFLINE'] !== '1';

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

async function offlinePhase() {
  console.log('\n── OFFLINE: input-validation fallbacks ──');

  const baseInput: EditorAgentInput = {
    segmentId: '11111111-2222-3333-4444-555555555555',
    originalStartS: 10.0,
    originalEndS: 18.0,
    segmentType: 'exercise',
    description: 'glute bridge with single-leg lift',
    editorUse: 'mid-routine power beat',
    segmentV2: { motion: { velocity: 'medium' } },
    keyframeGridR2Key: 'keyframe-grids/nordpilates/abc.jpg',
    ideaSeed: '5-min morning glute flow',
    slotRole: 'body',
    // v1.2.1 render-context (synthetic values for offline test)
    slotCountTotal: 4,
    slotIndex: 1,
    currentRenderDurationS: 32,
    targetRenderDurationS: 30,
  };

  // Missing keyframe_grid_r2_key
  const missingGrid = await refineSegmentBoundary({
    ...baseInput,
    keyframeGridR2Key: null,
  });
  assert(
    'missing keyframe_grid → fallback',
    missingGrid.kind === 'fallback' && missingGrid.reason === 'missing_keyframe_grid',
  );
  if (missingGrid.kind === 'fallback') {
    assert(
      'missing keyframe_grid: bounds preserved',
      missingGrid.refinedStartS === baseInput.originalStartS &&
        missingGrid.refinedEndS === baseInput.originalEndS,
    );
    assert('missing keyframe_grid: zero cost', missingGrid.costUsd === 0);
  }

  // Missing segment_v2
  const missingV2 = await refineSegmentBoundary({
    ...baseInput,
    segmentV2: null,
  });
  assert(
    'missing segment_v2 → fallback',
    missingV2.kind === 'fallback' && missingV2.reason === 'missing_segment_v2',
  );
  if (missingV2.kind === 'fallback') {
    assert(
      'missing segment_v2: bounds preserved',
      missingV2.refinedStartS === baseInput.originalStartS &&
        missingV2.refinedEndS === baseInput.originalEndS,
    );
  }
}

async function onlinePhase() {
  console.log('\n── ONLINE: real Gemini call (1 nordpilates segment) ──');

  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, segment_type, description, start_s, end_s, segment_v2, keyframe_grid_r2_key')
    .eq('brand_id', BRAND_ID)
    .not('segment_v2', 'is', null)
    .not('keyframe_grid_r2_key', 'is', null)
    .eq('segment_type', 'exercise')
    .order('quality_score', { ascending: false })
    .limit(1);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    console.log('  ⚠ No nordpilates exercise segments with both segment_v2 and keyframe_grid_r2_key — skipping online phase');
    return;
  }

  const row = data[0] as Record<string, unknown>;
  const v2 = (row['segment_v2'] as Record<string, unknown>) ?? {};

  const origDuration =
    Number(row['end_s']) - Number(row['start_s']);
  const input: EditorAgentInput = {
    segmentId: row['id'] as string,
    originalStartS: Number(row['start_s']),
    originalEndS: Number(row['end_s']),
    segmentType: row['segment_type'] as string,
    description: (row['description'] as string) ?? null,
    editorUse: (v2['editor_use'] as string | undefined) ?? null,
    segmentV2: v2,
    keyframeGridR2Key: row['keyframe_grid_r2_key'] as string,
    ideaSeed: '5-min morning routine to wake up your glutes',
    slotRole: 'body',
    // v1.2.1 render-context (single-segment online smoke; pretend it's slot 1 of 4)
    slotCountTotal: 4,
    slotIndex: 1,
    currentRenderDurationS: origDuration * 4, // approximate; this is just a smoke
    targetRenderDurationS: 30,
  };

  console.log(
    `  segment=${input.segmentId} parent=${row['parent_asset_id']} ` +
      `original=[${input.originalStartS.toFixed(2)}, ${input.originalEndS.toFixed(2)}]s ` +
      `(duration=${(input.originalEndS - input.originalStartS).toFixed(2)}s)`,
  );

  const outcome = await refineSegmentBoundary(input);
  printOutcome(outcome, input);

  // Wiring assertions
  assert('outcome has a kind', !!outcome.kind);
  assert(
    'kind is one of three valid',
    outcome.kind === 'refined_ok' ||
      outcome.kind === 'no_change_needed' ||
      outcome.kind === 'fallback',
  );
  assert(
    'refined bounds within original',
    outcome.refinedStartS >= input.originalStartS - 1e-9 &&
      outcome.refinedEndS <= input.originalEndS + 1e-9,
  );
  if (outcome.kind === 'refined_ok' || outcome.kind === 'no_change_needed') {
    assert('refined duration >= 1.5s', outcome.refinedEndS - outcome.refinedStartS >= 1.5 - 1e-9);
    assert('cost reported', outcome.costUsd >= 0);
    assert('wall ms reported', outcome.wallMs > 0);
  }
}

function printOutcome(o: EditorAgentOutcome, input: EditorAgentInput) {
  const lines: string[] = [];
  lines.push(`  ─── outcome ───`);
  lines.push(`    kind:           ${o.kind}`);
  if (o.kind === 'fallback') {
    lines.push(`    reason:         ${o.reason}`);
  }
  lines.push(
    `    refined:        [${o.refinedStartS.toFixed(2)}, ${o.refinedEndS.toFixed(2)}]s ` +
      `(duration=${(o.refinedEndS - o.refinedStartS).toFixed(2)}s)`,
  );
  const startDelta = o.refinedStartS - input.originalStartS;
  const endDelta = o.refinedEndS - input.originalEndS;
  lines.push(`    delta_start:    ${startDelta >= 0 ? '+' : ''}${startDelta.toFixed(2)}s`);
  lines.push(`    delta_end:      ${endDelta >= 0 ? '+' : ''}${endDelta.toFixed(2)}s`);
  if (o.kind === 'refined_ok' || o.kind === 'no_change_needed') {
    lines.push(`    confidence:     ${o.confidence}`);
    lines.push(`    reasoning:      ${o.reasoning.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  lines.push(`    clamps:         ${o.clamps.length ? o.clamps.join(', ') : '(none)'}`);
  lines.push(`    cost_usd:       $${o.costUsd.toFixed(5)}`);
  lines.push(`    wall_ms:        ${o.wallMs}`);
  console.log(lines.join('\n'));
}

async function main() {
  console.log('🧪 editor-agent (c2) standalone smoke\n');
  await offlinePhase();
  if (ONLINE) {
    await onlinePhase();
  } else {
    console.log('\n── ONLINE phase skipped (EDITOR_AGENT_TEST_OFFLINE=1) ──');
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ editor-agent c2 smoke pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
