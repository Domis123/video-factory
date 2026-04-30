/**
 * Unit tests for editor-agent-schema.ts.
 *
 * No network calls. No DB calls. Pure schema + clamp logic.
 *
 * Usage: npx tsx src/scripts/test-editor-agent-schema.ts
 */

import {
  applyClamps,
  editorRefinementSchema,
  validateEditorRefinement,
  type ClampOutcome,
  type EditorRefinement,
} from '../agents/editor-agent-schema.js';

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

const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const ORIGINAL = { startS: 10.0, endS: 18.0 };

// ─── Schema parsing ────────────────────────────────────────────────────────

function testSchema() {
  console.log('\n── Schema parsing ──');

  const valid: EditorRefinement = {
    segment_id: VALID_UUID,
    refined_start_s: 11.2,
    refined_end_s: 16.5,
    reasoning: 'Trims the half-second prep before the first rep.',
    confidence: 'high',
    no_change_needed: false,
  };
  const parsed = validateEditorRefinement(valid);
  assert('Valid refinement parses', parsed.segment_id === VALID_UUID);
  assert('Confidence enum preserved', parsed.confidence === 'high');

  // Missing required field
  const missing = { ...valid } as Record<string, unknown>;
  delete missing.reasoning;
  const missingResult = editorRefinementSchema.safeParse(missing);
  assert('Missing reasoning rejected', !missingResult.success);

  // Wrong type
  const wrongType = { ...valid, refined_start_s: 'not a number' };
  const wrongTypeResult = editorRefinementSchema.safeParse(wrongType);
  assert('String for refined_start_s rejected', !wrongTypeResult.success);

  // Bad UUID
  const badUuid = { ...valid, segment_id: 'not-a-uuid' };
  const badUuidResult = editorRefinementSchema.safeParse(badUuid);
  assert('Non-UUID segment_id rejected', !badUuidResult.success);

  // Bad confidence enum
  const badEnum = { ...valid, confidence: 'extreme' };
  const badEnumResult = editorRefinementSchema.safeParse(badEnum);
  assert('Out-of-enum confidence rejected', !badEnumResult.success);

  // Empty reasoning
  const emptyReason = { ...valid, reasoning: '' };
  const emptyReasonResult = editorRefinementSchema.safeParse(emptyReason);
  assert('Empty reasoning rejected', !emptyReasonResult.success);
}

// ─── Clamp logic ───────────────────────────────────────────────────────────

function testClamps() {
  console.log('\n── Clamp logic ──');

  const base: EditorRefinement = {
    segment_id: VALID_UUID,
    refined_start_s: 11.0,
    refined_end_s: 16.0,
    reasoning: 'baseline test',
    confidence: 'medium',
    no_change_needed: false,
  };

  // Happy path — refined within original, no clamps fire
  const happy = applyClamps(base, ORIGINAL);
  assert(
    'Happy path returns refined_ok',
    happy.kind === 'refined_ok' && happy.clamps.length === 0,
  );
  if (happy.kind === 'refined_ok') {
    assert('Happy path preserves bounds', happy.refinedStartS === 11.0 && happy.refinedEndS === 16.0);
  }

  // no_change_needed short-circuits
  const noChange = applyClamps({ ...base, no_change_needed: true, refined_start_s: 99, refined_end_s: 100 }, ORIGINAL);
  assert('no_change_needed kind', noChange.kind === 'no_change_needed');
  if (noChange.kind === 'no_change_needed') {
    assert(
      'no_change_needed returns original bounds',
      noChange.refinedStartS === ORIGINAL.startS && noChange.refinedEndS === ORIGINAL.endS,
    );
    assert('no_change_needed clamp tag set', noChange.clamps[0] === 'outcome:no_change_needed');
  }

  // Clamp 1: start_widened — refined_start_s < original_start_s
  const startWide = applyClamps({ ...base, refined_start_s: 8.5 }, ORIGINAL);
  assert('start_widened: kind refined_ok', startWide.kind === 'refined_ok');
  if (startWide.kind === 'refined_ok') {
    assert('start_widened: clamped to original.startS', startWide.refinedStartS === ORIGINAL.startS);
    assert('start_widened: clamp tag set', startWide.clamps.includes('clamp:start_widened'));
  }

  // Clamp 2: end_widened — refined_end_s > original_end_s
  const endWide = applyClamps({ ...base, refined_end_s: 19.5 }, ORIGINAL);
  assert('end_widened: kind refined_ok', endWide.kind === 'refined_ok');
  if (endWide.kind === 'refined_ok') {
    assert('end_widened: clamped to original.endS', endWide.refinedEndS === ORIGINAL.endS);
    assert('end_widened: clamp tag set', endWide.clamps.includes('clamp:end_widened'));
  }

  // Both clamps fire simultaneously
  const bothWide = applyClamps({ ...base, refined_start_s: 5, refined_end_s: 25 }, ORIGINAL);
  assert('both_widened: kind refined_ok', bothWide.kind === 'refined_ok');
  if (bothWide.kind === 'refined_ok') {
    assert(
      'both_widened: both clamps fired',
      bothWide.clamps.includes('clamp:start_widened') && bothWide.clamps.includes('clamp:end_widened'),
    );
    assert(
      'both_widened: both bounds clamped to original',
      bothWide.refinedStartS === ORIGINAL.startS && bothWide.refinedEndS === ORIGINAL.endS,
    );
  }

  // Clamp 3: duration_floor_violated — refined duration < 1.5s
  const tooShort = applyClamps({ ...base, refined_start_s: 14.0, refined_end_s: 15.0 }, ORIGINAL);
  assert('duration_floor: kind fallback', tooShort.kind === 'fallback');
  if (tooShort.kind === 'fallback') {
    assert('duration_floor: reason set', tooShort.reason === 'duration_floor_violated');
    assert(
      'duration_floor: returns original bounds',
      tooShort.refinedStartS === ORIGINAL.startS && tooShort.refinedEndS === ORIGINAL.endS,
    );
  }

  // Clamp 4: invalid_range — refined_start_s >= refined_end_s after clamping
  const inverted = applyClamps({ ...base, refined_start_s: 16.0, refined_end_s: 12.0 }, ORIGINAL);
  assert('invalid_range: kind fallback', inverted.kind === 'fallback');
  if (inverted.kind === 'fallback') {
    assert('invalid_range: reason set', inverted.reason === 'invalid_range');
  }

  // Equal start/end → invalid_range (boundary case for clamp 4)
  const equal = applyClamps({ ...base, refined_start_s: 13.0, refined_end_s: 13.0 }, ORIGINAL);
  assert('equal_bounds: kind fallback', equal.kind === 'fallback');
  if (equal.kind === 'fallback') {
    assert('equal_bounds: reason invalid_range', equal.reason === 'invalid_range');
  }

  // Refined duration EXACTLY 1.5s — should pass (boundary, not violated)
  const exactFloor = applyClamps({ ...base, refined_start_s: 11.0, refined_end_s: 12.5 }, ORIGINAL);
  assert('exact_floor: refined_ok at 1.5s', exactFloor.kind === 'refined_ok');

  // Clamps fire AND duration violated — fallback should win and surface reason
  const wideButShort = applyClamps(
    { ...base, refined_start_s: 5.0, refined_end_s: 10.5 },
    ORIGINAL,
  );
  // refined_start_s clamped to 10.0, end is 10.5 → duration 0.5s → fallback
  assert('wide_but_short: kind fallback', wideButShort.kind === 'fallback');
  if (wideButShort.kind === 'fallback') {
    assert(
      'wide_but_short: clamp fired before fallback',
      wideButShort.clamps.includes('clamp:start_widened'),
    );
    assert(
      'wide_but_short: reason duration_floor_violated',
      wideButShort.reason === 'duration_floor_violated',
    );
  }
}

function testTaggedUnion() {
  console.log('\n── Tagged union exhaustiveness ──');

  const examples: ClampOutcome[] = [
    { kind: 'refined_ok', refinedStartS: 0, refinedEndS: 1, clamps: [] },
    { kind: 'no_change_needed', refinedStartS: 0, refinedEndS: 1, clamps: ['outcome:no_change_needed'] },
    { kind: 'fallback', reason: 'invalid_range', refinedStartS: 0, refinedEndS: 1, clamps: [] },
  ];

  for (const o of examples) {
    let dispatched = false;
    switch (o.kind) {
      case 'refined_ok':
      case 'no_change_needed':
      case 'fallback':
        dispatched = true;
    }
    assert(`tagged-union dispatch: ${o.kind}`, dispatched);
  }
}

async function main() {
  console.log('🧪 editor-agent-schema unit tests\n');
  testSchema();
  testClamps();
  testTaggedUnion();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ All editor-agent-schema unit tests pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
