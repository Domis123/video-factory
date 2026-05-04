/**
 * Unit tests for editor-agent-schema.ts.
 *
 * No network calls. No DB calls. Pure schema + clamp logic.
 *
 * Usage: npx tsx src/scripts/test-editor-agent-schema.ts
 */

import {
  applyBatchClamps,
  applyClamps,
  editorBatchOutputSchema,
  editorBatchRefinementSchema,
  editorRefinementSchema,
  renderContextFieldsSchema,
  validateBatchCompleteness,
  validateEditorBatchOutput,
  validateEditorRefinement,
  validateRenderContextFields,
  type BatchClampOutcome,
  type ClampOutcome,
  type EditorBatchOutput,
  type EditorBatchRefinement,
  type EditorRefinement,
  type RenderContextFields,
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

function testRenderContextFields() {
  console.log('\n── Render context fields (v1.2.1 input expansion) ──');

  const valid: RenderContextFields = {
    slotCountTotal: 4,
    currentRenderDurationS: 28.5,
    targetRenderDurationS: 30,
  };
  const parsed = validateRenderContextFields(valid);
  assert(
    'Valid render-context parses',
    parsed.slotCountTotal === 4 &&
      parsed.currentRenderDurationS === 28.5 &&
      parsed.targetRenderDurationS === 30,
  );

  // Boundary: 1-slot meme bypass would not invoke Editor anyway, but the
  // schema accepts slotCountTotal=1 since render-context fields apply to
  // the routine path which has min=2; we keep the floor permissive here.
  const oneSlot = renderContextFieldsSchema.safeParse({ ...valid, slotCountTotal: 1 });
  assert('slotCountTotal=1 accepted', oneSlot.success);

  // Reject zero / negative slots
  const zeroSlot = renderContextFieldsSchema.safeParse({ ...valid, slotCountTotal: 0 });
  assert('slotCountTotal=0 rejected', !zeroSlot.success);

  // Reject non-integer slot count
  const fracSlot = renderContextFieldsSchema.safeParse({ ...valid, slotCountTotal: 3.5 });
  assert('non-integer slotCountTotal rejected', !fracSlot.success);

  // Reject too many slots (sanity ceiling)
  const tooMany = renderContextFieldsSchema.safeParse({ ...valid, slotCountTotal: 11 });
  assert('slotCountTotal=11 rejected (ceiling=10)', !tooMany.success);

  // Reject negative duration
  const negDuration = renderContextFieldsSchema.safeParse({ ...valid, currentRenderDurationS: -1 });
  assert('negative currentRenderDurationS rejected', !negDuration.success);

  // Accept zero current duration (theoretical: M-O-M picked 0-length segments;
  // shouldn't happen but the schema doesn't need to enforce it)
  const zeroDur = renderContextFieldsSchema.safeParse({ ...valid, currentRenderDurationS: 0 });
  assert('currentRenderDurationS=0 accepted', zeroDur.success);

  // Reject zero target duration (target=0 makes no sense)
  const zeroTarget = renderContextFieldsSchema.safeParse({ ...valid, targetRenderDurationS: 0 });
  assert('targetRenderDurationS=0 rejected', !zeroTarget.success);

  // Reject missing field
  const missingField = { slotCountTotal: 4, currentRenderDurationS: 28.5 };
  const missingResult = renderContextFieldsSchema.safeParse(missingField);
  assert('missing targetRenderDurationS rejected', !missingResult.success);

  // Reject wrong type
  const wrongType = { ...valid, slotCountTotal: '4' };
  const wrongTypeResult = renderContextFieldsSchema.safeParse(wrongType);
  assert('string slotCountTotal rejected', !wrongTypeResult.success);
}

// ─── v1.3 batch schema parsing ─────────────────────────────────────────────

const VALID_UUID_2 = '22222222-3333-4444-5555-666666666666';
const VALID_UUID_3 = '33333333-4444-5555-6666-777777777777';

function testBatchSchema() {
  console.log('\n── Batch schema parsing (v1.3) ──');

  // action='refine' requires refined_*_s
  const refineValid: EditorBatchRefinement = {
    segment_id: VALID_UUID,
    action: 'refine',
    refined_start_s: 11.2,
    refined_end_s: 16.5,
    reasoning: 'Trims prep before first rep.',
    confidence: 'high',
  };
  const refineParsed = editorBatchRefinementSchema.parse(refineValid);
  assert('action=refine with bounds parses', refineParsed.action === 'refine');

  // action='refine' WITHOUT refined_*_s → rejected
  const refineMissing = {
    segment_id: VALID_UUID,
    action: 'refine',
    reasoning: 'should fail',
    confidence: 'medium',
  };
  const refineMissingResult = editorBatchRefinementSchema.safeParse(refineMissing);
  assert('action=refine without bounds rejected', !refineMissingResult.success);

  // action='no_change' WITHOUT refined_*_s → accepted
  const noChange: EditorBatchRefinement = {
    segment_id: VALID_UUID,
    action: 'no_change',
    reasoning: 'segment is fine as-is',
    confidence: 'high',
  };
  const noChangeParsed = editorBatchRefinementSchema.parse(noChange);
  assert('action=no_change without bounds parses', noChangeParsed.action === 'no_change');

  // action='drop' WITHOUT refined_*_s → accepted
  const drop: EditorBatchRefinement = {
    segment_id: VALID_UUID,
    action: 'drop',
    reasoning: 'preparation footage with no payoff',
    confidence: 'medium',
  };
  const dropParsed = editorBatchRefinementSchema.parse(drop);
  assert('action=drop without bounds parses', dropParsed.action === 'drop');

  // Invalid action enum
  const badAction = { ...refineValid, action: 'kill' };
  const badActionResult = editorBatchRefinementSchema.safeParse(badAction);
  assert('out-of-enum action rejected', !badActionResult.success);

  // Empty reasoning still rejected
  const noReason = { ...refineValid, reasoning: '' };
  const noReasonResult = editorBatchRefinementSchema.safeParse(noReason);
  assert('empty reasoning rejected (batch)', !noReasonResult.success);

  // Batch wrapper schema
  const batch: EditorBatchOutput = {
    refinements: [refineValid, noChange, drop],
    global_reasoning: 'Trim segment 1, keep segment 2, drop segment 3 (weak prep).',
  };
  const batchParsed = validateEditorBatchOutput(batch);
  assert('batch wrapper parses', batchParsed.refinements.length === 3);
  assert('batch global_reasoning preserved', batchParsed.global_reasoning.startsWith('Trim'));

  // Empty refinements rejected
  const emptyBatch = { refinements: [], global_reasoning: 'nothing' };
  const emptyBatchResult = editorBatchOutputSchema.safeParse(emptyBatch);
  assert('empty refinements array rejected', !emptyBatchResult.success);

  // Empty global_reasoning rejected
  const noGlobal = { refinements: [refineValid], global_reasoning: '' };
  const noGlobalResult = editorBatchOutputSchema.safeParse(noGlobal);
  assert('empty global_reasoning rejected', !noGlobalResult.success);
}

// ─── Batch completeness check ──────────────────────────────────────────────

function testBatchCompleteness() {
  console.log('\n── Batch completeness check ──');

  const a: EditorBatchRefinement = {
    segment_id: VALID_UUID,
    action: 'no_change',
    reasoning: 'a',
    confidence: 'high',
  };
  const b: EditorBatchRefinement = {
    segment_id: VALID_UUID_2,
    action: 'no_change',
    reasoning: 'b',
    confidence: 'high',
  };
  const c: EditorBatchRefinement = {
    segment_id: VALID_UUID_3,
    action: 'no_change',
    reasoning: 'c',
    confidence: 'high',
  };

  const happy: EditorBatchOutput = {
    refinements: [a, b, c],
    global_reasoning: 'all three handled',
  };
  const happyResult = validateBatchCompleteness(happy, [VALID_UUID, VALID_UUID_2, VALID_UUID_3]);
  assert('completeness ok on perfect match', happyResult.ok);

  // Order doesn't matter
  const happyReordered = validateBatchCompleteness(happy, [
    VALID_UUID_3,
    VALID_UUID,
    VALID_UUID_2,
  ]);
  assert('completeness ok regardless of order', happyReordered.ok);

  // Missing segment
  const missingExpected = [VALID_UUID, VALID_UUID_2, VALID_UUID_3, '44444444-5555-6666-7777-888888888888'];
  const missingResult = validateBatchCompleteness(happy, missingExpected);
  assert('completeness fails on missing', !missingResult.ok);
  if (!missingResult.ok) {
    assert(
      'completeness reports missing segment',
      missingResult.issues.some(
        (i) => i.kind === 'missing' && i.segmentId === '44444444-5555-6666-7777-888888888888',
      ),
    );
  }

  // Extra segment in output
  const extra: EditorBatchOutput = {
    refinements: [a, b, c, { ...a, segment_id: '55555555-6666-7777-8888-999999999999' }],
    global_reasoning: 'one too many',
  };
  const extraResult = validateBatchCompleteness(extra, [VALID_UUID, VALID_UUID_2, VALID_UUID_3]);
  assert('completeness fails on extra', !extraResult.ok);
  if (!extraResult.ok) {
    assert(
      'completeness reports extra segment',
      extraResult.issues.some((i) => i.kind === 'extra'),
    );
  }

  // Duplicate segment_id in output
  const dup: EditorBatchOutput = {
    refinements: [a, a, b, c],
    global_reasoning: 'a appears twice',
  };
  const dupResult = validateBatchCompleteness(dup, [VALID_UUID, VALID_UUID_2, VALID_UUID_3]);
  assert('completeness fails on duplicate', !dupResult.ok);
  if (!dupResult.ok) {
    assert(
      'completeness reports duplicate segment',
      dupResult.issues.some((i) => i.kind === 'duplicate' && i.segmentId === VALID_UUID),
    );
  }
}

// ─── Batch clamp logic ─────────────────────────────────────────────────────

function testBatchClamps() {
  console.log('\n── Batch clamp logic (v1.3) ──');

  const refineBase: EditorBatchRefinement = {
    segment_id: VALID_UUID,
    action: 'refine',
    refined_start_s: 11.0,
    refined_end_s: 16.0,
    reasoning: 'baseline',
    confidence: 'medium',
  };

  // Happy path — refine within original
  const happy = applyBatchClamps(refineBase, ORIGINAL);
  assert('refine happy: kind refined_ok', happy.kind === 'refined_ok');
  if (happy.kind === 'refined_ok') {
    assert('refine happy: bounds preserved', happy.refinedStartS === 11.0 && happy.refinedEndS === 16.0);
  }

  // action=no_change short-circuits
  const noChange = applyBatchClamps(
    { segment_id: VALID_UUID, action: 'no_change', reasoning: 'fine', confidence: 'high' },
    ORIGINAL,
  );
  assert('action=no_change: kind no_change', noChange.kind === 'no_change');
  if (noChange.kind === 'no_change') {
    assert(
      'no_change returns original bounds',
      noChange.refinedStartS === ORIGINAL.startS && noChange.refinedEndS === ORIGINAL.endS,
    );
    assert('no_change clamp tag', noChange.clamps[0] === 'outcome:no_change');
  }

  // action=drop emits drop outcome with reasoning preserved
  const drop = applyBatchClamps(
    {
      segment_id: VALID_UUID,
      action: 'drop',
      reasoning: 'redundant with picked segment 2; weak hook quality',
      confidence: 'medium',
    },
    ORIGINAL,
  );
  assert('action=drop: kind drop', drop.kind === 'drop');
  if (drop.kind === 'drop') {
    assert('drop preserves reasoning', drop.reasoning.startsWith('redundant'));
    assert('drop clamp tag', drop.clamps[0] === 'outcome:drop');
  }

  // Refine path: clamp:start_widened
  const startWide = applyBatchClamps({ ...refineBase, refined_start_s: 8.5 }, ORIGINAL);
  assert('refine start_widened: kind refined_ok', startWide.kind === 'refined_ok');
  if (startWide.kind === 'refined_ok') {
    assert('refine start_widened: clamped', startWide.refinedStartS === ORIGINAL.startS);
    assert('refine start_widened: tag', startWide.clamps.includes('clamp:start_widened'));
  }

  // Refine path: clamp:end_widened
  const endWide = applyBatchClamps({ ...refineBase, refined_end_s: 19.5 }, ORIGINAL);
  assert('refine end_widened: kind refined_ok', endWide.kind === 'refined_ok');
  if (endWide.kind === 'refined_ok') {
    assert('refine end_widened: clamped', endWide.refinedEndS === ORIGINAL.endS);
  }

  // Refine path: duration_floor fallback
  const tooShort = applyBatchClamps(
    { ...refineBase, refined_start_s: 14.0, refined_end_s: 15.0 },
    ORIGINAL,
  );
  assert('refine too_short: kind fallback', tooShort.kind === 'fallback');
  if (tooShort.kind === 'fallback') {
    assert('refine too_short: reason floor', tooShort.reason === 'duration_floor_violated');
  }

  // Refine path: invalid_range fallback
  const inverted = applyBatchClamps(
    { ...refineBase, refined_start_s: 16.0, refined_end_s: 12.0 },
    ORIGINAL,
  );
  assert('refine inverted: kind fallback', inverted.kind === 'fallback');
  if (inverted.kind === 'fallback') {
    assert('refine inverted: reason invalid_range', inverted.reason === 'invalid_range');
  }

  // Edge case: action=refine but missing refined_*_s (slips past schema somehow)
  const missingBounds = applyBatchClamps(
    { segment_id: VALID_UUID, action: 'refine', reasoning: 'broken', confidence: 'low' },
    ORIGINAL,
  );
  assert('refine missing bounds: kind fallback', missingBounds.kind === 'fallback');
  if (missingBounds.kind === 'fallback') {
    assert(
      'refine missing bounds: reason missing_refined_bounds',
      missingBounds.reason === 'missing_refined_bounds',
    );
  }

  // Tagged-union dispatch covers all 4 kinds
  const examples: BatchClampOutcome[] = [
    { kind: 'refined_ok', refinedStartS: 0, refinedEndS: 1, clamps: [] },
    { kind: 'no_change', refinedStartS: 0, refinedEndS: 1, clamps: ['outcome:no_change'] },
    { kind: 'drop', reasoning: 'x', clamps: ['outcome:drop'] },
    { kind: 'fallback', reason: 'invalid_range', refinedStartS: 0, refinedEndS: 1, clamps: [] },
  ];
  for (const o of examples) {
    let dispatched = false;
    switch (o.kind) {
      case 'refined_ok':
      case 'no_change':
      case 'drop':
      case 'fallback':
        dispatched = true;
    }
    assert(`batch tagged-union dispatch: ${o.kind}`, dispatched);
  }
}

async function main() {
  console.log('🧪 editor-agent-schema unit tests\n');
  testSchema();
  testClamps();
  testTaggedUnion();
  testRenderContextFields();
  testBatchSchema();
  testBatchCompleteness();
  testBatchClamps();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ All editor-agent-schema unit tests pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
