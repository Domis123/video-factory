/**
 * c5 unit tests — resolveTrimWindow().
 *
 * Pure arithmetic; no DB, no Gemini, no R2.
 *
 * Usage: npx tsx src/scripts/test-render-trim-window.ts
 */

import { resolveTrimWindow } from '../orchestrator/simple-pipeline/render.js';

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

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function testPreNormalizedNoRefined() {
  console.log('\n── pre_normalized + no refined bounds ──');
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_normalized',
  });
  assert('uses original start (absolute)', close(r.trimStartS, 10.0));
  assert('uses original end (absolute)', close(r.trimEndS, 18.0));
  assert('usedRefined=false', r.usedRefined === false);
}

function testPreNormalizedWithRefined() {
  console.log('\n── pre_normalized + refined.refined=true ──');
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_normalized',
    refined: { startS: 11.2, endS: 16.5, refined: true },
  });
  assert('uses refined start (absolute)', close(r.trimStartS, 11.2));
  assert('uses refined end (absolute)', close(r.trimEndS, 16.5));
  assert('usedRefined=true', r.usedRefined === true);
}

function testPreNormalizedRefinedFalse() {
  console.log('\n── pre_normalized + refined.refined=false (no_change/fallback) ──');
  // editor-step packs no_change/fallback as { startS: orig, endS: orig, refined: false }
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_normalized',
    refined: { startS: 10.0, endS: 18.0, refined: false },
  });
  assert('bounds match original', close(r.trimStartS, 10.0) && close(r.trimEndS, 18.0));
  assert('usedRefined=false (refined flag was false)', r.usedRefined === false);
}

function testPreTrimmedClipNoRefined() {
  console.log('\n── pre_trimmed_clip + no refined bounds ──');
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_trimmed_clip',
  });
  // Clip file's time-axis is 0..(end-start) = 0..8s. Both args clip-relative.
  assert('clip-relative start = 0', close(r.trimStartS, 0.0));
  assert('clip-relative end = duration (8s)', close(r.trimEndS, 8.0));
}

function testPreTrimmedClipWithRefined() {
  console.log('\n── pre_trimmed_clip + refined bounds ──');
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_trimmed_clip',
    refined: { startS: 11.2, endS: 16.5, refined: true },
  });
  // Refined absolute 11.2..16.5 → clip-relative 1.2..6.5
  assert('clip-relative start offset by origStartS', close(r.trimStartS, 1.2));
  assert('clip-relative end offset by origStartS', close(r.trimEndS, 6.5));
  assert('usedRefined=true', r.usedRefined === true);
}

function testDefensiveClampWiden() {
  console.log('\n── defensive clamp: refined widens beyond original ──');
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_normalized',
    refined: { startS: 5.0, endS: 25.0, refined: true },
  });
  assert('start clamped UP to origStartS', close(r.trimStartS, 10.0));
  assert('end clamped DOWN to origEndS', close(r.trimEndS, 18.0));
  // usedRefined stays true even when bounds were re-clamped
  assert('usedRefined=true (caller asked for refined)', r.usedRefined === true);
}

function testDefensiveClampInverted() {
  console.log('\n── defensive clamp: refined fully inverted ──');
  // refined.startS > origEndS — should clamp both to original endpoints
  const r = resolveTrimWindow({
    origStartS: 10.0,
    origEndS: 18.0,
    parentSourceKind: 'pre_normalized',
    refined: { startS: 30.0, endS: 40.0, refined: true },
  });
  assert('start clamped to origEndS (upper bound)', close(r.trimStartS, 18.0));
  assert('end clamped to origEndS', close(r.trimEndS, 18.0));
}

async function main() {
  console.log('🧪 resolveTrimWindow (c5) unit tests\n');
  testPreNormalizedNoRefined();
  testPreNormalizedWithRefined();
  testPreNormalizedRefinedFalse();
  testPreTrimmedClipNoRefined();
  testPreTrimmedClipWithRefined();
  testDefensiveClampWiden();
  testDefensiveClampInverted();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ resolveTrimWindow c5 unit tests pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
