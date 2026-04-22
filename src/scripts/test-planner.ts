/**
 * W3 Gate A smoke: runs 5 idea seeds through the Planner agent, prints
 * structured output + latency, asserts Zod + semantic clean. Exits non-zero
 * if any seed fails.
 *
 * Usage: npx tsx src/scripts/test-planner.ts
 *
 * Designed to NOT hide failures — each seed's exception is captured and the
 * next seed continues. Final summary tells you "3/5 passed" in one run.
 */

import { normalizeToken } from '../lib/text-normalize.js';
import { getLibraryInventory } from '../agents/library-inventory-v2.js';
import { planVideo } from '../agents/planner-v2.js';
import type { PlannerOutput, PlannerSlot } from '../types/planner-output.js';

const BRAND_ID = 'nordpilates';

const TEST_SEEDS: string[] = [
  'morning pilates routine for hip mobility',
  '3 glute exercises that feel better than they should',
  'soft golden-hour pilates aesthetic, no teaching',
  'the one cue that changed my plank',
  'day in the life of a pilates teacher',
];

interface SeedResult {
  idx: number;
  seed: string;
  ok: boolean;
  wall_ms: number;
  output?: PlannerOutput;
  error?: string;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`text-normalize assert failed [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function runTextNormalizeChecks(): void {
  console.log('=== text-normalize self-check ===');
  assertEqual(normalizeToken('Glute Bridge'), 'glute bridge', 'Glute Bridge');
  assertEqual(normalizeToken('glute-bridge'), 'glute bridge', 'glute-bridge');
  assertEqual(normalizeToken('side-lying leg lifts'), 'side lying leg lift', 'side-lying leg lifts');
  assertEqual(normalizeToken('Plank to Downward Dog Flow'), 'plank to downward dog flow', 'Plank to Downward Dog Flow');
  assertEqual(normalizeToken('yoga-mat'), 'yoga mat', 'yoga-mat');
  assertEqual(normalizeToken('dumbbells'), 'dumbbell', 'dumbbells');
  assertEqual(normalizeToken('analysis'), 'analysis', 'analysis (keeps -is)');
  assertEqual(normalizeToken('glass'), 'glass', 'glass (keeps -ss)');
  console.log('  all text-normalize checks passed.\n');
}

function slotRolesSummary(slots: PlannerSlot[]): string {
  return `[${slots.map((s) => s.slot_role).join(', ')}]`;
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

function firstWord(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^[^\s,.;:—-]+/);
  return m ? m[0] : trimmed.slice(0, 20);
}

function countBy<T extends string | number>(xs: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const key = String(x);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function printSeedReport(r: SeedResult): void {
  console.log(`--- Seed ${r.idx + 1}/${TEST_SEEDS.length} (${r.wall_ms} ms) ---`);
  console.log(`  seed: ${JSON.stringify(r.seed)}`);
  if (!r.ok || !r.output) {
    console.log(`  STATUS: FAIL`);
    console.log(`  error: ${r.error}`);
    return;
  }
  const o = r.output;
  console.log(`  STATUS: PASS`);
  console.log(`  form_id:        ${o.form_id}`);
  console.log(`  hook_mechanism: ${o.hook_mechanism}`);
  console.log(`  posture:        ${o.posture}`);
  console.log(`  slot_count:     ${o.slot_count}`);
  console.log(`  music_intent:   ${o.music_intent}`);
  console.log(`  audience_framing: ${JSON.stringify(o.audience_framing)}`);
  console.log(`  subject_consistency: ${o.subject_consistency}`);
  console.log(`  slot_roles:     ${slotRolesSummary(o.slots)}`);
  console.log(`  creative_vision: ${firstLine(o.creative_vision)}`);
}

async function main(): Promise<void> {
  runTextNormalizeChecks();

  // Inventory snapshot so Domis can read it at Gate A.
  console.log('=== library inventory snapshot ===');
  const inv = await getLibraryInventory(BRAND_ID);
  console.log(JSON.stringify(inv, null, 2));
  console.log('');

  const results: SeedResult[] = [];
  for (let i = 0; i < TEST_SEEDS.length; i++) {
    const seed = TEST_SEEDS[i];
    const t0 = Date.now();
    try {
      const output = await planVideo({ idea_seed: seed, brand_id: BRAND_ID });
      results.push({ idx: i, seed, ok: true, wall_ms: Date.now() - t0, output });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ idx: i, seed, ok: false, wall_ms: Date.now() - t0, error: msg });
    }
  }

  console.log('=== per-seed planner results ===');
  for (const r of results) printSeedReport(r);

  const passed = results.filter((r) => r.ok).length;
  const totalMs = results.reduce((a, r) => a + r.wall_ms, 0);
  console.log('');
  console.log('=== summary ===');
  console.log(`  passed:       ${passed}/${results.length}`);
  console.log(`  total wall:   ${totalMs} ms`);
  console.log(`  avg per seed: ${Math.round(totalMs / results.length)} ms`);

  // Variance report across the soft dimensions — music_intent, slot_count,
  // creative_vision opening word, form_id, hook_mechanism, posture.
  const okOutputs = results.filter((r) => r.ok && r.output).map((r) => r.output!);
  if (okOutputs.length > 0) {
    console.log('');
    console.log('=== variance ===');
    console.log(`  music_intent:        ${JSON.stringify(countBy(okOutputs.map((o) => o.music_intent)))}`);
    console.log(`  slot_count:          ${JSON.stringify(countBy(okOutputs.map((o) => o.slot_count)))}`);
    console.log(`  creative_vision[0]:  ${JSON.stringify(countBy(okOutputs.map((o) => firstWord(o.creative_vision))))}`);
    console.log(`  form_id:             ${JSON.stringify(countBy(okOutputs.map((o) => o.form_id)))}`);
    console.log(`  hook_mechanism:      ${JSON.stringify(countBy(okOutputs.map((o) => o.hook_mechanism)))}`);
    console.log(`  posture:             ${JSON.stringify(countBy(okOutputs.map((o) => o.posture)))}`);
    console.log('');
    console.log('  per-seed openings:');
    for (let i = 0; i < okOutputs.length; i++) {
      const o = okOutputs[i];
      console.log(`    ${i + 1}: ${o.form_id} / ${o.music_intent} / ${o.slot_count} slots / "${firstWord(o.creative_vision)}..."`);
    }
  }

  if (passed < results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('test-planner fatal:', err);
  process.exit(1);
});
