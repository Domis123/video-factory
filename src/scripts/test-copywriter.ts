/**
 * W7 Gate A smoke — three-tier test of the Copywriter (writeCopyForStoryboard).
 *
 * Tier 1: 5 fresh seeds end-to-end through Planner (W3) → retrieveCandidates (W4)
 *   → pickClipsForStoryboard (W5) → writeCopyForStoryboard (W7). Cross-seed
 *   homogenization check asserts ≥4/5 distinct opening syntax on hook text AND
 *   on per_slot[0] overlay text.
 *
 *   Note: the W7 brief's original Tier 1 assumed disk-cached W3/W5 artifacts
 *   (w3-gate-a-*.json, w5-gate-a-*.json). Those don't exist as JSON — only as
 *   console-log .txt artifacts. So Tier 1 here runs the full pipeline fresh.
 *   Gemini is on company credits (CLAUDE.md), so the cost jump is acceptable.
 *
 * Tier 2: operator-sanity assertions pulled from Tier 1 seeds 1 (routine-ish)
 *   and 3 (aesthetic-ambient-ish). Asserts form-aware overlay distribution
 *   and subject-stance-aware voice consistency signals.
 *
 * Tier 3: one synthetic OSR-collision case. Takes Tier 1 seed 1's storyboard,
 *   force-injects setting.on_screen_text="DAY 14" into slot 1's snapshot,
 *   re-runs Copywriter, asserts slot 1's overlay.text does not contain the
 *   string (case-insensitive).
 *
 * Usage: npx tsx src/scripts/test-copywriter.ts
 *
 * Cost (estimate): Gemini-only; company credits per CLAUDE.md. Wall-time the
 * real cost. Roughly 5 × (Planner 15s + Director 30s + Copywriter 10s) ≈
 * 4-5 minutes total.
 */

import { planVideo } from '../agents/planner-v2.js';
import { retrieveCandidates } from '../agents/candidate-retrieval-v2.js';
import { loadBrandPersona } from '../agents/brand-persona.js';
import { embedText } from '../lib/clip-embed.js';
import { pickClipsForStoryboard } from '../agents/visual-director.js';
import {
  writeCopyForStoryboard,
  fetchCopywriterSnapshots,
  type CopywriterSegmentSnapshot,
} from '../agents/copywriter-v2.js';
import type { PlannerOutput } from '../types/planner-output.js';
import type { StoryboardPicks } from '../types/slot-pick.js';
import type { BrandPersona } from '../types/brand-persona.js';
import type { CopyPackage } from '../types/copywriter-output.js';

const BRAND_ID = 'nordpilates';

const SEEDS: string[] = [
  // Seed 1 — routine-sequence lean (used as Tier 2 baseline + Tier 3 basis)
  'morning pilates routine for hip mobility',
  // Seed 2 — specific-pain-promise lean
  '3 moves that relieved my lower back after desk work',
  // Seed 3 — aesthetic-ambient lean (Tier 2 canary)
  'slow sunday stretching with the windows open',
  // Seed 4 — microtutorial lean
  'how to set up your pelvic floor for every exercise',
  // Seed 5 — confessional-vulnerability lean
  'what six months of pilates taught me about my hips',
];

interface Tier1Result {
  seed: string;
  plannerOutput?: PlannerOutput;
  picks?: StoryboardPicks;
  snapshots?: Map<string, CopywriterSegmentSnapshot>;
  copyPackage?: CopyPackage;
  wall_ms: number;
  ok: boolean;
  error?: string;
}

interface Tier3Result {
  name: string;
  copyPackage?: CopyPackage;
  wall_ms: number;
  ok: boolean;
  assertion_pass: boolean;
  assertion_detail: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 — fresh end-to-end per seed
// ─────────────────────────────────────────────────────────────────────────────

async function runTier1Seed(
  seed: string,
  persona: BrandPersona,
): Promise<Tier1Result> {
  const t0 = Date.now();
  const result: Tier1Result = { seed, wall_ms: 0, ok: false };
  try {
    const plannerOutput = await planVideo({
      idea_seed: seed,
      brand_id: BRAND_ID,
    });
    result.plannerOutput = plannerOutput;

    const candidateSets = await Promise.all(
      plannerOutput.slots.map(async (slot) => {
        const embedding = await embedText(slot.narrative_beat);
        return retrieveCandidates({
          slot,
          queryEmbedding: embedding,
          brandId: BRAND_ID,
        });
      }),
    );

    const picks = await pickClipsForStoryboard({
      plannerOutput,
      candidateSets,
      brandPersona: persona,
    });
    result.picks = picks;

    const snapshots = await fetchCopywriterSnapshots(
      picks.picks.map((p) => p.picked_segment_id),
    );
    result.snapshots = snapshots;

    const copyPackage = await writeCopyForStoryboard({
      plannerOutput,
      picks,
      brandPersona: persona,
      segmentSnapshots: snapshots,
    });
    result.copyPackage = copyPackage;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.wall_ms = Date.now() - t0;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3 — synthetic OSR collision
// ─────────────────────────────────────────────────────────────────────────────

async function runTier3Collision(
  basis: Tier1Result,
  persona: BrandPersona,
): Promise<Tier3Result> {
  const t0 = Date.now();
  const result: Tier3Result = {
    name: 'synthetic OSR collision: inject "DAY 14" into slot 1 snapshot',
    wall_ms: 0,
    ok: false,
    assertion_pass: false,
    assertion_detail: '',
  };
  if (!basis.plannerOutput || !basis.picks || !basis.snapshots) {
    result.error = 'tier-3 requires a successful Tier 1 basis; basis failed upstream';
    result.wall_ms = Date.now() - t0;
    return result;
  }
  try {
    if (basis.picks.picks.length < 2) {
      throw new Error(
        `basis storyboard has ${basis.picks.picks.length} picks; need ≥2 to target slot 1`,
      );
    }

    // Force-inject on_screen_text on slot 1's picked segment's snapshot.
    const slot1Pick = basis.picks.picks.find((p) => p.slot_index === 1);
    if (!slot1Pick) {
      throw new Error('basis storyboard has no slot_index=1 pick');
    }
    const forgedSnapshots = new Map(basis.snapshots);
    const originalSnap = forgedSnapshots.get(slot1Pick.picked_segment_id);
    if (!originalSnap) {
      throw new Error(
        `basis snapshots missing slot 1 segment ${slot1Pick.picked_segment_id}`,
      );
    }
    const forgedSnap: CopywriterSegmentSnapshot = {
      ...originalSnap,
      setting: { ...originalSnap.setting, on_screen_text: 'DAY 14' },
    };
    forgedSnapshots.set(slot1Pick.picked_segment_id, forgedSnap);

    const copyPackage = await writeCopyForStoryboard({
      plannerOutput: basis.plannerOutput,
      picks: basis.picks,
      brandPersona: persona,
      segmentSnapshots: forgedSnapshots,
    });
    result.copyPackage = copyPackage;
    result.ok = true;

    // Validate assertion: slot 1's overlay.text does not contain "DAY 14"
    // (case-insensitive substring).
    const slot1Entry = copyPackage.per_slot.find(
      (s) => s.slot_id === 'slot-1',
    );
    if (!slot1Entry) {
      result.assertion_detail = `copyPackage.per_slot has no slot-1 entry`;
      result.assertion_pass = false;
      return result;
    }
    const overlayText = slot1Entry.overlay.text ?? '';
    const collides = overlayText.toLowerCase().includes('day 14');
    result.assertion_pass = !collides;
    result.assertion_detail = collides
      ? `slot 1 overlay.text ${JSON.stringify(overlayText)} CONTAINS "day 14"`
      : `slot 1 overlay.text ${JSON.stringify(overlayText)} does not contain "day 14"`;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    // An OnScreenTextCollisionError thrown by semantic validation IS the
    // intended enforcement path — count it as a PASS of the collision guard.
    if (result.error && result.error.includes('OnScreenTextCollisionError')) {
      result.assertion_pass = true;
      result.assertion_detail = `semantic validation threw OnScreenTextCollisionError as expected (model emitted colliding text; guard fired)`;
    } else {
      result.assertion_detail = `threw: ${result.error}`;
    }
  }
  result.wall_ms = Date.now() - t0;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Homogenization check
// ─────────────────────────────────────────────────────────────────────────────

function openingSyntaxSignature(text: string | null): string {
  if (!text) return '__NULL__';
  const cleaned = text.trim().replace(/^["'`]/, '');
  // Signature = first two words, lowercased. Good enough to detect "most people"
  // vs "the difference" vs "let's go" patterns without collapsing legitimate
  // distinct phrasings.
  const words = cleaned.split(/\s+/).slice(0, 2).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return words.filter((w) => w.length > 0).join(' ');
}

function distinctSignatures(signatures: string[]): number {
  return new Set(signatures.filter((s) => s && s !== '__NULL__')).size;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function printTier1Report(i: number, r: Tier1Result): void {
  console.log(`\n============================================================`);
  console.log(`TIER 1  seed ${i + 1}/${SEEDS.length}: ${JSON.stringify(r.seed)}`);
  console.log(`============================================================`);
  console.log(`  wall_ms: ${r.wall_ms}`);
  if (!r.ok || !r.plannerOutput || !r.picks || !r.copyPackage) {
    console.log(`  STATUS: FAIL`);
    console.log(`  error: ${r.error}`);
    return;
  }
  const pkg = r.copyPackage;
  console.log(`  STATUS: PASS`);
  console.log(
    `  plan: form=${r.plannerOutput.form_id} hook_mech=${r.plannerOutput.hook_mechanism} subject=${r.plannerOutput.subject_consistency} slots=${r.plannerOutput.slot_count}`,
  );
  console.log(`        creative_vision: ${r.plannerOutput.creative_vision}`);
  console.log('');
  console.log(`  HOOK     (${pkg.hook.delivery}) ${JSON.stringify(pkg.hook.text)}`);
  console.log(`           mechanism_tie: ${pkg.hook.mechanism_tie}`);
  console.log(`  CTA      ${pkg.cta_text === null ? '(null)' : JSON.stringify(pkg.cta_text)}`);
  console.log(`  CANONICAL ${JSON.stringify(pkg.captions.canonical)}`);
  console.log(`  TIKTOK   ${JSON.stringify(pkg.captions.tiktok)}`);
  console.log(`  HASHTAGS [${pkg.hashtags.join(' ')}]`);
  console.log(`  OVERLAYS:`);
  for (const slot of pkg.per_slot) {
    const text = slot.overlay.text ?? '(none)';
    const timing = `${slot.overlay.start_time_s.toFixed(2)}→${slot.overlay.end_time_s.toFixed(2)}s`;
    console.log(`    ${slot.slot_id}  type=${slot.overlay.type.padEnd(7)} ${timing}  ${JSON.stringify(text)}`);
  }
  console.log(`  META: retry_count=${pkg.metadata.retry_count} temperature=${pkg.metadata.temperature}`);
}

function printTier3Report(r: Tier3Result): void {
  console.log(`\n============================================================`);
  console.log(`TIER 3  ${r.name}`);
  console.log(`============================================================`);
  console.log(`  wall_ms: ${r.wall_ms}`);
  console.log(`  ASSERTION: ${r.assertion_pass ? 'PASS' : 'FAIL'}   ${r.assertion_detail}`);
  if (r.error && !r.assertion_pass) {
    console.log(`  error: ${r.error}`);
  }
  if (r.copyPackage) {
    const slot1 = r.copyPackage.per_slot.find((s) => s.slot_id === 'slot-1');
    if (slot1) {
      console.log(`  slot-1 overlay: type=${slot1.overlay.type} text=${JSON.stringify(slot1.overlay.text)}`);
      console.log(`  slot-1 reasoning: ${slot1.reasoning}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== W7 Copywriter — Gate A smoke (three tiers) ===');
  console.log(`brand:   ${BRAND_ID}`);
  console.log(`seeds:   ${SEEDS.length} (tier 1 runs all; tier 2 asserts on seeds 1+3; tier 3 bases on seed 1)`);
  console.log('');

  const persona = await loadBrandPersona(BRAND_ID);
  const tier1Results: Tier1Result[] = [];
  for (let i = 0; i < SEEDS.length; i++) {
    const r = await runTier1Seed(SEEDS[i], persona);
    tier1Results.push(r);
    printTier1Report(i, r);
  }

  // ─── Tier 1 cross-seed homogenization check ───
  console.log(`\n============================================================`);
  console.log(`TIER 1 — cross-seed homogenization`);
  console.log(`============================================================`);
  const okResults = tier1Results.filter((r) => r.ok && r.copyPackage);
  const hookSigs = okResults.map((r) => openingSyntaxSignature(r.copyPackage!.hook.text));
  const slot0Sigs = okResults.map((r) => {
    const slot0 = r.copyPackage!.per_slot.find((s) => s.slot_id === 'slot-0');
    return openingSyntaxSignature(slot0?.overlay.text ?? null);
  });
  const hookDistinct = distinctSignatures(hookSigs);
  const slot0Distinct = distinctSignatures(slot0Sigs);
  const hookHomogenizationPass = hookDistinct >= Math.ceil(okResults.length * 0.8);
  const slot0HomogenizationPass = slot0Distinct >= Math.ceil(okResults.length * 0.8);
  console.log(
    `  hook opening signatures:  [${hookSigs.map((s) => JSON.stringify(s)).join(', ')}]`,
  );
  console.log(
    `    distinct=${hookDistinct}/${okResults.length}   ${hookHomogenizationPass ? 'PASS' : 'FAIL'} (threshold: ≥${Math.ceil(okResults.length * 0.8)})`,
  );
  console.log(
    `  slot-0 overlay signatures: [${slot0Sigs.map((s) => JSON.stringify(s)).join(', ')}]`,
  );
  console.log(
    `    distinct=${slot0Distinct}/${okResults.length}   ${slot0HomogenizationPass ? 'PASS' : 'FAIL'} (threshold: ≥${Math.ceil(okResults.length * 0.8)})`,
  );

  // ─── Tier 2 — operator-sanity assertions on seeds 1 and 3 ───
  console.log(`\n============================================================`);
  console.log(`TIER 2 — operator-sanity on seeds 1 (routine-lean) and 3 (aesthetic-ambient-lean)`);
  console.log(`============================================================`);
  const tier2Assertions: Array<{ name: string; pass: boolean; detail: string }> = [];
  const seed1 = tier1Results[0];
  const seed3 = tier1Results[2];
  if (seed1.ok && seed1.copyPackage && seed1.plannerOutput) {
    const labelCount = seed1.copyPackage.per_slot.filter((s) => s.overlay.type === 'label').length;
    const noneCount = seed1.copyPackage.per_slot.filter((s) => s.overlay.type === 'none').length;
    const form = seed1.plannerOutput.form_id;
    // Soft assertion: routine-shape seeds should lean toward informational density.
    // Heuristic: more label/count/cue than none, OR form is not a mood-forward form.
    const infoTypes = seed1.copyPackage.per_slot.filter((s) =>
      ['label', 'count', 'cue'].includes(s.overlay.type),
    ).length;
    const pass = infoTypes >= noneCount;
    tier2Assertions.push({
      name: `seed-1 form=${form}: info-lean overlay distribution (label+count+cue ≥ none)`,
      pass,
      detail: `info_types=${infoTypes} label=${labelCount} none=${noneCount}`,
    });
  } else {
    tier2Assertions.push({
      name: 'seed-1 routine-lean checks',
      pass: false,
      detail: 'seed 1 Tier 1 failed',
    });
  }
  if (seed3.ok && seed3.copyPackage && seed3.plannerOutput) {
    const captionCount = seed3.copyPackage.per_slot.filter((s) => s.overlay.type === 'caption').length;
    const noneCount = seed3.copyPackage.per_slot.filter((s) => s.overlay.type === 'none').length;
    const infoTypes = seed3.copyPackage.per_slot.filter((s) =>
      ['label', 'count'].includes(s.overlay.type),
    ).length;
    // Soft assertion: aesthetic-ambient-shape seeds should lean toward sparse/mood.
    // Heuristic: caption+none ≥ info-dense label+count.
    const moodLean = captionCount + noneCount;
    const pass = moodLean >= infoTypes;
    tier2Assertions.push({
      name: `seed-3 form=${seed3.plannerOutput.form_id}: mood-lean overlay distribution (caption+none ≥ label+count)`,
      pass,
      detail: `caption=${captionCount} none=${noneCount} label+count=${infoTypes}`,
    });
    // CTA-nullability soft check: aesthetic-ambient seeds can legitimately have null CTA
    tier2Assertions.push({
      name: `seed-3 CTA nullability: aesthetic-ambient may emit null CTA`,
      pass: true, // informational only — pass regardless of outcome
      detail: `cta_text=${seed3.copyPackage.cta_text === null ? 'null' : JSON.stringify(seed3.copyPackage.cta_text)}`,
    });
  } else {
    tier2Assertions.push({
      name: 'seed-3 aesthetic-ambient checks',
      pass: false,
      detail: 'seed 3 Tier 1 failed',
    });
  }
  for (const a of tier2Assertions) {
    console.log(`  ${a.pass ? 'PASS' : 'FAIL'}   ${a.name}`);
    console.log(`         ${a.detail}`);
  }

  // ─── Tier 3 — synthetic OSR collision ───
  const basis = tier1Results.find((r) => r.ok && r.picks && r.plannerOutput && r.snapshots);
  let tier3: Tier3Result;
  if (!basis) {
    tier3 = {
      name: 'synthetic OSR collision',
      wall_ms: 0,
      ok: false,
      assertion_pass: false,
      assertion_detail: 'no successful Tier 1 basis to base synthetic on',
    };
    console.log(`\nNo successful Tier 1 result — skipping Tier 3.`);
  } else {
    tier3 = await runTier3Collision(basis, persona);
    printTier3Report(tier3);
  }

  // ─── Aggregate ───
  console.log('\n============================================================');
  console.log('AGGREGATE');
  console.log('============================================================');
  const tier1Passed = okResults.length;
  const tier2Passed = tier2Assertions.filter((a) => a.pass).length;
  const totalWall = tier1Results.reduce((a, r) => a + r.wall_ms, 0) + tier3.wall_ms;
  console.log(`  tier_1_seeds_ok:           ${tier1Passed}/${tier1Results.length}`);
  console.log(`  tier_1_hook_homogenization: ${hookHomogenizationPass ? 'PASS' : 'FAIL'} (${hookDistinct}/${okResults.length} distinct)`);
  console.log(`  tier_1_slot0_homogenization: ${slot0HomogenizationPass ? 'PASS' : 'FAIL'} (${slot0Distinct}/${okResults.length} distinct)`);
  console.log(`  tier_2_operator_sanity:    ${tier2Passed}/${tier2Assertions.length} pass`);
  console.log(`  tier_3_osr_collision:      ${tier3.assertion_pass ? 'PASS' : 'FAIL'}  ${tier3.assertion_detail}`);
  console.log(`  total_wall_ms:             ${totalWall}`);
  const overallPass =
    tier1Passed === tier1Results.length &&
    hookHomogenizationPass &&
    slot0HomogenizationPass &&
    tier2Passed === tier2Assertions.length &&
    tier3.assertion_pass;
  console.log(`  OVERALL:                   ${overallPass ? 'PASS' : 'FAIL'}`);
  if (!overallPass) process.exitCode = 1;
}

main().catch((err) => {
  console.error('test-copywriter fatal:', err);
  process.exit(1);
});
