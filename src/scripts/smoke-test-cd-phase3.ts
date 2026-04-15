/**
 * Phase 3 CD smoke test — dev-only harness.
 *
 * Runs 5 representative idea seeds across nordpilates + carnimeat through the
 * Phase 3 Creative Director, validates each brief via Zod (already enforced
 * inside generateBriefPhase3), and prints them in a readable shape so Domis can
 * eye-review quality.
 *
 * Requires ENABLE_PHASE_3_CD=true in the environment so the dispatcher routes
 * to Phase 3. Read-only on brand_configs. No Supabase writes, no Jobs inserts.
 *
 * Costs ~$0.10–0.20 at Sonnet 4.6 rates per 5-brief run.
 */

import 'dotenv/config';
import type { BrandConfig, Phase3CreativeBrief } from '../types/database.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { generateBriefDispatched } from '../agents/creative-director-dispatch.js';
import { lastGenerationStats } from '../agents/creative-director-phase3.js';

interface Fixture {
  brand: string;
  ideaSeed: string;
  expectedVideoType: string;
}

const FIXTURES: Fixture[] = [
  { brand: 'nordpilates', ideaSeed: '5 minute pilates abs burner for busy moms', expectedVideoType: 'workout-demo' },
  { brand: 'nordpilates', ideaSeed: 'my 30-day pilates transformation results', expectedVideoType: 'transformation' },
  { brand: 'nordpilates', ideaSeed: '3 mistakes beginners make in pilates', expectedVideoType: 'tips-listicle' },
  { brand: 'carnimeat', ideaSeed: '5-minute high-protein breakfast in one pan', expectedVideoType: 'recipe-walkthrough' },
  { brand: 'carnimeat', ideaSeed: 'why butter is back: 3 nutrition myths debunked', expectedVideoType: 'tips-listicle' },
  { brand: 'highdiet', ideaSeed: 'follow along: 7-minute morning energy workout', expectedVideoType: 'workout-demo' },
];

// Sonnet 4.6 pricing ($/MTok). Used purely for rough smoke-test cost estimation.
const PRICE_INPUT_PER_MTOK = 3;
const PRICE_OUTPUT_PER_MTOK = 15;

interface FixtureResult {
  fixture: Fixture;
  brief: Phase3CreativeBrief | null;
  error: Error | null;
  firstAttemptOk: boolean;
  correctiveAttempted: boolean;
  inputTokens: number;
  outputTokens: number;
  colorViolation: boolean;
  signalMappingMatched: boolean;
  wallMs: number;
}

function wordWrap(text: string, width = 80): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function truncate(text: string, max = 80): string {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

async function fetchBrand(brandId: string): Promise<BrandConfig> {
  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .select('*')
    .eq('brand_id', brandId)
    .single();
  if (error || !data) {
    throw new Error(`Failed to fetch brand_config for ${brandId}: ${error?.message ?? 'no row'}`);
  }
  return data as BrandConfig;
}

async function runFixture(fixture: Fixture, index: number, total: number): Promise<FixtureResult> {
  const brand = await fetchBrand(fixture.brand);
  const allowed = brand.allowed_color_treatments;

  const result: FixtureResult = {
    fixture,
    brief: null,
    error: null,
    firstAttemptOk: false,
    correctiveAttempted: false,
    inputTokens: 0,
    outputTokens: 0,
    colorViolation: false,
    signalMappingMatched: false,
    wallMs: 0,
  };

  const started = Date.now();
  try {
    const dispatched = await generateBriefDispatched({
      ideaSeed: fixture.ideaSeed,
      brandConfig: brand,
    });
    result.wallMs = Date.now() - started;

    if (dispatched.phase !== 'phase3') {
      throw new Error(
        `Dispatcher returned phase=${dispatched.phase}. ENABLE_PHASE_3_CD appears not to be read. ` +
          `env.ENABLE_PHASE_3_CD=${env.ENABLE_PHASE_3_CD}. Aborting — this is an env loading bug.`,
      );
    }

    result.brief = dispatched.brief;
    result.firstAttemptOk = lastGenerationStats.firstAttemptOk;
    result.correctiveAttempted = lastGenerationStats.correctiveAttempted;
    result.inputTokens = lastGenerationStats.inputTokens;
    result.outputTokens = lastGenerationStats.outputTokens;

    const picked = dispatched.brief.creative_direction.color_treatment;
    if (allowed !== null && !allowed.includes(picked)) {
      result.colorViolation = true;
    }

    result.signalMappingMatched = dispatched.brief.video_type === fixture.expectedVideoType;
  } catch (err) {
    result.error = err as Error;
    result.wallMs = Date.now() - started;
    // Stats may still be populated from an attempt before the throw
    result.firstAttemptOk = lastGenerationStats.firstAttemptOk;
    result.correctiveAttempted = lastGenerationStats.correctiveAttempted;
    result.inputTokens = lastGenerationStats.inputTokens;
    result.outputTokens = lastGenerationStats.outputTokens;
  }

  printFixture(result, allowed, index, total);
  return result;
}

function printFixture(r: FixtureResult, allowed: string[] | null, index: number, total: number) {
  const bar = '='.repeat(80);
  console.log('');
  console.log(bar);
  console.log(`FIXTURE ${index + 1}/${total} — ${r.fixture.brand} — "${r.fixture.ideaSeed}"`);
  console.log(bar);

  if (r.error) {
    console.log(`STATUS:               FAILED`);
    console.log(`Wall time:            ${r.wallMs}ms`);
    console.log(`first_attempt_ok:     ${r.firstAttemptOk}`);
    console.log(`corrective_attempted: ${r.correctiveAttempted}`);
    console.log(`tokens:               in=${r.inputTokens}, out=${r.outputTokens}`);
    console.log('');
    console.log('ERROR:');
    console.log(r.error.message);
    console.log('');
    if ('stack' in r.error && r.error.stack) {
      console.log(r.error.stack.split('\n').slice(0, 8).join('\n'));
    }
    return;
  }

  const brief = r.brief!;
  const picked = brief.creative_direction.color_treatment;
  const colorNote = allowed === null
    ? `   (no restriction — all 8 allowed)`
    : r.colorViolation
      ? `   ✗ VIOLATION — not in allowed: ${allowed.join(', ')}`
      : `   ✓ (in allowed: ${allowed.join(', ')})`;

  const signalMark = r.signalMappingMatched ? '✓' : '✗';
  console.log(`video_type:           ${brief.video_type}   ${signalMark} (expected: ${r.fixture.expectedVideoType})`);
  console.log(`slot_count:           ${brief.creative_direction.slot_count}`);
  console.log(`color_treatment:      ${picked}${colorNote}`);
  console.log(`energy_per_slot:      [${brief.creative_direction.energy_per_slot.join(', ')}]`);
  console.log(`total_duration:       ${brief.total_duration_target}s`);
  console.log(`composition_id:       ${brief.composition_id}`);
  console.log(`vibe:                 ${brief.vibe ?? '(null)'}`);
  console.log(`caption_preset:       ${brief.caption_preset}`);
  console.log(`first_attempt_ok:     ${r.firstAttemptOk}`);
  console.log(`corrective_attempted: ${r.correctiveAttempted}`);
  console.log(`tokens:               in=${r.inputTokens}, out=${r.outputTokens}`);
  console.log(`wall time:            ${r.wallMs}ms`);
  console.log('');

  console.log('CREATIVE VISION:');
  console.log(wordWrap(brief.creative_direction.creative_vision, 80));
  console.log('');

  console.log('SEGMENTS:');
  brief.segments.forEach((seg, i) => {
    const ov = seg.text_overlay;
    const typeCol = seg.type.padEnd(7);
    const pacingCol = seg.pacing.padEnd(6);
    const transCol = `${seg.transition_in} → ${seg.internal_cut_style}`.padEnd(32);
    console.log(
      `  [${i}] ${typeCol} | ${seg.cut_duration_target_s}s | ${pacingCol} | ${transCol} | overlay: ${ov.style} ${ov.animation} (${ov.char_target} chars)`,
    );
    const cr = seg.clip_requirements;
    console.log(`      mood: ${cr.mood}, content_type: [${cr.content_type.join(', ')}], has_speech: ${cr.has_speech}, min_quality: ${cr.min_quality}`);
    console.log(`      visual_elements: [${cr.visual_elements.join(', ')}]`);
    console.log(`      aesthetic_guidance: "${truncate(cr.aesthetic_guidance, 80)}"`);
  });
  console.log('');

  const m = brief.audio.music;
  console.log('AUDIO:');
  console.log(`  strategy: ${brief.audio.strategy}`);
  console.log(`  music: { mood: ${m.mood}, tempo: ${m.tempo}, energy_level: ${m.energy_level}, volume_level: ${m.volume_level} }`);
  console.log(`  pinned_track_id: ${m.pinned_track_id ?? 'null'}`);
}

function printSummary(results: FixtureResult[], totalWallMs: number) {
  const total = results.length;
  const generated = results.filter((r) => r.brief !== null).length;
  const firstAttemptPasses = results.filter((r) => r.firstAttemptOk).length;
  const correctiveRetries = results.filter((r) => r.correctiveAttempted).length;
  const violations = results.filter((r) => r.colorViolation).length;
  const signalMatches = results.filter((r) => r.signalMappingMatched).length;
  const failed = results.filter((r) => r.error !== null).length;
  const inTotal = results.reduce((s, r) => s + r.inputTokens, 0);
  const outTotal = results.reduce((s, r) => s + r.outputTokens, 0);
  const costUsd = (inTotal / 1_000_000) * PRICE_INPUT_PER_MTOK + (outTotal / 1_000_000) * PRICE_OUTPUT_PER_MTOK;

  const bar = '='.repeat(80);
  console.log('');
  console.log(bar);
  console.log('SMOKE TEST SUMMARY');
  console.log(bar);
  console.log(`Briefs generated:           ${generated}/${total}`);
  console.log(`Zod first-attempt passes:   ${firstAttemptPasses}/${total}`);
  console.log(`Zod corrective retries:     ${correctiveRetries}/${total}`);
  console.log(`Color-treatment violations: ${violations}/${total}`);
  console.log(`Signal-mapping correct:     ${signalMatches}/${total}`);
  console.log(`Failed (no brief):          ${failed}/${total}`);
  console.log(`Tokens used:                in=${inTotal}, out=${outTotal}`);
  console.log(`Total cost (estimated):     ~$${costUsd.toFixed(4)}`);
  console.log(`Total wall time:            ${(totalWallMs / 1000).toFixed(1)}s`);
  console.log(bar);
}

async function main() {
  if (!env.ENABLE_PHASE_3_CD) {
    console.error('ABORT: ENABLE_PHASE_3_CD is not true. Run with:\n  ENABLE_PHASE_3_CD=true npx tsx src/scripts/smoke-test-cd-phase3.ts');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ABORT: ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }

  console.log(`🧪 Phase 3 CD smoke test — ${FIXTURES.length} fixtures against live Claude Sonnet 4.6`);
  const brands = Array.from(new Set(FIXTURES.map((f) => f.brand))).join(', ');
  console.log(`   brands: ${brands}`);
  console.log(`   ENABLE_PHASE_3_CD=${env.ENABLE_PHASE_3_CD}`);

  const results: FixtureResult[] = [];
  const runStart = Date.now();

  for (let i = 0; i < FIXTURES.length; i++) {
    const fixture = FIXTURES[i];
    try {
      const r = await runFixture(fixture, i, FIXTURES.length);
      results.push(r);
    } catch (err) {
      // runFixture already traps per-brief failures. Anything reaching here is an
      // abort-level error (e.g., dispatcher returned phase2 → env bug).
      console.error(`\n💥 ABORTING at fixture ${i + 1}: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const totalWallMs = Date.now() - runStart;
  printSummary(results, totalWallMs);

  const anyFailed = results.some((r) => r.error !== null);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
