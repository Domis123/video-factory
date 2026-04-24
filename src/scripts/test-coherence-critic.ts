/**
 * W6 Gate A smoke — end-to-end Planner (W3) → retrieveCandidates (W4) →
 * pickClipsForStoryboard (W5) → reviewStoryboard (W6) on 3 real seeds, plus
 * 3 synthetic failure cases with hard assertions:
 *   - Synthetic A: forced duplicate segment across slots → MUST flag
 *     duplicate_segment_across_slots AND verdict in ('revise','reject').
 *   - Synthetic B: forced duration under floor → MUST flag duration_mismatch
 *     with severity 'high'.
 *   - Synthetic C (W8): forced structural-revise scenario — basis plan is
 *     mutated to commit to `single_exercise_deep_dive` on an exercise the
 *     library can't support. Critic receives the REAL library inventory and
 *     MUST emit verdict in ('revise','reject') with `revise_scope='structural'`.
 *
 * Usage: npx tsx src/scripts/test-coherence-critic.ts
 *
 * Cost (estimate): 6 × ~$0.06 Critic calls + 3 × 5.5 slots × ~$0.07 Director =
 *   ~$0.35 Critic + ~$1.15 Director = ~$1.50/run. Critic cost bumped from $0.05
 *   pre-W8 because the prompt now carries the library inventory payload.
 *
 * Synthetic cases reuse the first real storyboard's picks + brand persona to
 * avoid re-running Planner/W4/W5 for handcrafted failure scenarios.
 */

import { planVideo } from '../agents/planner-v2.js';
import { retrieveCandidates } from '../agents/candidate-retrieval-v2.js';
import { loadBrandPersona } from '../agents/brand-persona.js';
import { getLibraryInventory } from '../agents/library-inventory-v2.js';
import { embedText } from '../lib/clip-embed.js';
import { pickClipsForStoryboard } from '../agents/visual-director.js';
import { reviewStoryboard, fetchSnapshots } from '../agents/coherence-critic.js';
import type { PlannerOutput } from '../types/planner-output.js';
import type { StoryboardPicks, SlotPick } from '../types/slot-pick.js';
import type { CriticVerdict } from '../types/critic-verdict.js';
import type { BrandPersona } from '../types/brand-persona.js';
import type { LibraryInventory } from '../types/library-inventory.js';
import type { CandidateMetadataSnapshot } from '../agents/coherence-critic.js';

const BRAND_ID = 'nordpilates';
const CRITIC_COST_USD = 0.06;

const SEEDS: string[] = [
  'morning pilates routine for hip mobility',
  '3 glute exercises that feel better than they should',
  'day in the life of a pilates teacher',
];

interface RealResult {
  kind: 'real';
  seed: string;
  plannerOutput?: PlannerOutput;
  picks?: StoryboardPicks;
  verdict?: CriticVerdict;
  wall_ms: number;
  ok: boolean;
  error?: string;
}

interface SyntheticResult {
  kind: 'synthetic';
  name: string;
  verdict?: CriticVerdict;
  wall_ms: number;
  ok: boolean;
  error?: string;
  assertion_pass: boolean;
  assertion_detail: string;
}

type Result = RealResult | SyntheticResult;

async function runRealStoryboard(
  seed: string,
  libraryInventory: LibraryInventory,
): Promise<RealResult> {
  const wallT0 = Date.now();
  const result: RealResult = { kind: 'real', seed, wall_ms: 0, ok: false };
  try {
    const persona = await loadBrandPersona(BRAND_ID);
    const plannerOutput = await planVideo({ idea_seed: seed, brand_id: BRAND_ID });
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

    const verdict = await reviewStoryboard({
      plannerOutput,
      picks,
      brandPersona: persona,
      libraryInventory,
    });
    result.verdict = verdict;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.wall_ms = Date.now() - wallT0;
  return result;
}

async function runSyntheticDuplicate(
  basis: RealResult,
  persona: BrandPersona,
  libraryInventory: LibraryInventory,
): Promise<SyntheticResult> {
  const wallT0 = Date.now();
  const result: SyntheticResult = {
    kind: 'synthetic',
    name: 'A: forced duplicate_segment_across_slots',
    wall_ms: 0,
    ok: false,
    assertion_pass: false,
    assertion_detail: '',
  };
  if (!basis.plannerOutput || !basis.picks) {
    result.error = 'synthetic A requires a real basis storyboard; basis failed upstream';
    result.wall_ms = Date.now() - wallT0;
    return result;
  }
  try {
    // Need at least 2 picks. If <2, bail with descriptive error.
    if (basis.picks.picks.length < 2) {
      throw new Error(
        `basis storyboard has only ${basis.picks.picks.length} pick(s); need ≥2 to force duplicate`,
      );
    }
    // Force pick[1] to equal pick[0]'s segment_id + parent + in/out (preserve
    // each pick's slot_index and the required duration floor).
    const originalPicks = basis.picks.picks;
    const donor = originalPicks[0];
    const target = originalPicks[1];
    const forgedSecond: SlotPick = {
      ...target,
      picked_segment_id: donor.picked_segment_id,
      parent_asset_id: donor.parent_asset_id,
      in_point_s: donor.in_point_s,
      out_point_s: donor.out_point_s,
      duration_s: donor.duration_s,
      reasoning:
        target.reasoning +
        ' [SYNTHETIC: forged to match slot 0 segment for duplicate-detection test]',
    };
    const forgedPicks: StoryboardPicks = {
      ...basis.picks,
      picks: [donor, forgedSecond, ...originalPicks.slice(2)],
    };

    // Supabase only has 1 row for the duplicated segment — reuse its snapshot.
    const uniqueSegmentIds = Array.from(
      new Set(forgedPicks.picks.map((p) => p.picked_segment_id)),
    );
    const uniqueSnapshots = await fetchSnapshots(uniqueSegmentIds);
    const snapshotById = new Map(uniqueSnapshots.map((s) => [s.segment_id, s]));
    const snapshots: CandidateMetadataSnapshot[] = forgedPicks.picks.map((p) => {
      const s = snapshotById.get(p.picked_segment_id);
      if (!s) throw new Error(`[synthetic-A] snapshot missing for ${p.picked_segment_id}`);
      return s;
    });

    const verdict = await reviewStoryboard({
      plannerOutput: basis.plannerOutput,
      picks: forgedPicks,
      brandPersona: persona,
      candidateSnapshots: snapshots,
      libraryInventory,
    });
    result.verdict = verdict;
    result.ok = true;

    const hasIssue = verdict.issues.some(
      (i) => i.issue_type === 'duplicate_segment_across_slots',
    );
    const verdictInExpected = verdict.verdict === 'revise' || verdict.verdict === 'reject';
    result.assertion_pass = hasIssue && verdictInExpected;
    result.assertion_detail =
      `issue_present=${hasIssue} verdict=${verdict.verdict} revise_scope=${verdict.revise_scope} (expected: revise|reject)`;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.assertion_detail = `threw: ${result.error}`;
  }
  result.wall_ms = Date.now() - wallT0;
  return result;
}

async function runSyntheticDurationMismatch(
  basis: RealResult,
  persona: BrandPersona,
  libraryInventory: LibraryInventory,
): Promise<SyntheticResult> {
  const wallT0 = Date.now();
  const result: SyntheticResult = {
    kind: 'synthetic',
    name: 'B: forced duration_mismatch (under floor)',
    wall_ms: 0,
    ok: false,
    assertion_pass: false,
    assertion_detail: '',
  };
  if (!basis.plannerOutput || !basis.picks) {
    result.error = 'synthetic B requires a real basis storyboard; basis failed upstream';
    result.wall_ms = Date.now() - wallT0;
    return result;
  }
  try {
    // Shrink every pick's trim to ~0.5s (use 1.0s to stay above the schema's
    // min-duration Zod rule; 1.0 × slot_count < 8s floor for all tested
    // storyboards which have 4–5 slots, so total stays under floor).
    const shrunk: SlotPick[] = basis.picks.picks.map((p) => {
      const newOut = p.in_point_s + 1.0;
      return {
        ...p,
        out_point_s: newOut,
        duration_s: 1.0,
        reasoning:
          p.reasoning +
          ' [SYNTHETIC: trimmed to 1.0s for duration-floor-detection test]',
      };
    });
    const forgedPicks: StoryboardPicks = { ...basis.picks, picks: shrunk };

    const uniqueSegmentIds = Array.from(
      new Set(forgedPicks.picks.map((p) => p.picked_segment_id)),
    );
    const uniqueSnapshots = await fetchSnapshots(uniqueSegmentIds);
    const snapshotById = new Map(uniqueSnapshots.map((s) => [s.segment_id, s]));
    const snapshots: CandidateMetadataSnapshot[] = forgedPicks.picks.map((p) => {
      const s = snapshotById.get(p.picked_segment_id);
      if (!s) throw new Error(`[synthetic-B] snapshot missing for ${p.picked_segment_id}`);
      return s;
    });

    const verdict = await reviewStoryboard({
      plannerOutput: basis.plannerOutput,
      picks: forgedPicks,
      brandPersona: persona,
      candidateSnapshots: snapshots,
      libraryInventory,
    });
    result.verdict = verdict;
    result.ok = true;

    const durationIssue = verdict.issues.find(
      (i) => i.issue_type === 'duration_mismatch',
    );
    const hasHigh = durationIssue?.severity === 'high';
    result.assertion_pass = !!durationIssue && hasHigh;
    result.assertion_detail = `issue_present=${!!durationIssue} severity=${durationIssue?.severity ?? 'n/a'} revise_scope=${verdict.revise_scope} (expected severity: high)`;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.assertion_detail = `threw: ${result.error}`;
  }
  result.wall_ms = Date.now() - wallT0;
  return result;
}

async function runSyntheticStructural(
  basis: RealResult,
  persona: BrandPersona,
  libraryInventory: LibraryInventory,
): Promise<SyntheticResult> {
  const wallT0 = Date.now();
  const result: SyntheticResult = {
    kind: 'synthetic',
    name: 'C: forced structural revise (W8 revise_scope test)',
    wall_ms: 0,
    ok: false,
    assertion_pass: false,
    assertion_detail: '',
  };
  if (!basis.plannerOutput || !basis.picks) {
    result.error = 'synthetic C requires a real basis storyboard; basis failed upstream';
    result.wall_ms = Date.now() - wallT0;
    return result;
  }
  try {
    // Pick an exercise name that the library demonstrably does NOT have enough
    // of to support `single_exercise_deep_dive`. `top_exercises` is capped at
    // 30 entries (post-normalization). Any name NOT in that list has at most
    // a handful of segments — unambiguously under-supported for a deep dive.
    // Use a clearly out-of-library target to keep the assertion robust.
    const unsupportedExercise = 'handstand push-up';
    const forgedPlanner: PlannerOutput = {
      ...basis.plannerOutput,
      form_id: 'single_exercise_deep_dive',
      creative_vision: `Deep dive on ${unsupportedExercise} — 6 progressive variations of the same exercise demonstrated across the storyboard`,
    };

    // Real snapshots — we don't fake the picks; the point is that the PLAN is
    // wrong given the library, not that the picks are duplicates.
    const uniqueSegmentIds = Array.from(
      new Set(basis.picks.picks.map((p) => p.picked_segment_id)),
    );
    const uniqueSnapshots = await fetchSnapshots(uniqueSegmentIds);
    const snapshotById = new Map(uniqueSnapshots.map((s) => [s.segment_id, s]));
    const snapshots: CandidateMetadataSnapshot[] = basis.picks.picks.map((p) => {
      const s = snapshotById.get(p.picked_segment_id);
      if (!s) throw new Error(`[synthetic-C] snapshot missing for ${p.picked_segment_id}`);
      return s;
    });

    const verdict = await reviewStoryboard({
      plannerOutput: forgedPlanner,
      picks: basis.picks,
      brandPersona: persona,
      candidateSnapshots: snapshots,
      libraryInventory,
    });
    result.verdict = verdict;
    result.ok = true;

    // A `reject` verdict also routes to re-plan, so it's an acceptable outcome.
    // The key signal is: Critic used the library inventory to flag the mismatch
    // and did NOT approve.
    const verdictNotApprove = verdict.verdict !== 'approve';
    const scopeIsStructural =
      verdict.verdict === 'revise'
        ? verdict.revise_scope === 'structural'
        : true; // reject case — revise_scope is don't-care
    result.assertion_pass = verdictNotApprove && scopeIsStructural;
    result.assertion_detail = `verdict=${verdict.verdict} revise_scope=${verdict.revise_scope} (expected: verdict!=approve AND (verdict=reject OR revise_scope=structural))`;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.assertion_detail = `threw: ${result.error}`;
  }
  result.wall_ms = Date.now() - wallT0;
  return result;
}

function printRealReport(i: number, r: RealResult): void {
  console.log(`\n============================================================`);
  console.log(`STORYBOARD ${i + 1}/${SEEDS.length}   seed: ${JSON.stringify(r.seed)}`);
  console.log(`============================================================`);
  console.log(`  wall_ms: ${r.wall_ms}`);
  if (!r.ok || !r.plannerOutput || !r.picks || !r.verdict) {
    console.log(`  STATUS: FAIL`);
    console.log(`  error: ${r.error}`);
    return;
  }
  console.log(`  STATUS: PASS`);
  console.log(
    `  plan: form=${r.plannerOutput.form_id} hook=${r.plannerOutput.hook_mechanism} posture=${r.plannerOutput.posture} slot_count=${r.plannerOutput.slot_count}`,
  );
  console.log(`        creative_vision: ${r.plannerOutput.creative_vision}`);
  console.log(
    `  picks: ${r.picks.picks.length} total, director_latency=${r.picks.total_latency_ms}ms`,
  );
  console.log('');
  console.log(`  CRITIC VERDICT: ${r.verdict.verdict}   latency_ms=${r.verdict.latency_ms}`);
  console.log(`  overall_reasoning: ${r.verdict.overall_reasoning}`);
  if (r.verdict.issues.length === 0) {
    console.log(`  issues: (none)`);
  } else {
    console.log(`  issues (${r.verdict.issues.length}):`);
    for (const issue of r.verdict.issues) {
      console.log(
        `    - [${issue.severity}] ${issue.issue_type}  slots=[${issue.affected_slot_indices.join(',')}]`,
      );
      console.log(`        note: ${issue.note}`);
      if (issue.suggested_fix) {
        console.log(`        fix:  ${issue.suggested_fix}`);
      }
    }
  }
}

function printSyntheticReport(r: SyntheticResult): void {
  console.log(`\n============================================================`);
  console.log(`SYNTHETIC   ${r.name}`);
  console.log(`============================================================`);
  console.log(`  wall_ms: ${r.wall_ms}`);
  console.log(`  ASSERTION: ${r.assertion_pass ? 'PASS' : 'FAIL'}   ${r.assertion_detail}`);
  if (!r.ok || !r.verdict) {
    console.log(`  STATUS: FAIL`);
    console.log(`  error: ${r.error}`);
    return;
  }
  console.log(`  CRITIC VERDICT: ${r.verdict.verdict}   latency_ms=${r.verdict.latency_ms}`);
  console.log(`  overall_reasoning: ${r.verdict.overall_reasoning}`);
  if (r.verdict.issues.length === 0) {
    console.log(`  issues: (none)`);
  } else {
    console.log(`  issues (${r.verdict.issues.length}):`);
    for (const issue of r.verdict.issues) {
      console.log(
        `    - [${issue.severity}] ${issue.issue_type}  slots=[${issue.affected_slot_indices.join(',')}]`,
      );
      console.log(`        note: ${issue.note}`);
      if (issue.suggested_fix) {
        console.log(`        fix:  ${issue.suggested_fix}`);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('=== W6 Coherence Critic — Gate A smoke ===');
  console.log(`brand:   ${BRAND_ID}`);
  console.log(`seeds:   ${JSON.stringify(SEEDS)}`);
  console.log(
    `synthetic: [A: forced duplicate, B: forced duration-under-floor, C: forced structural-revise]`,
  );
  console.log('');

  const persona = await loadBrandPersona(BRAND_ID);
  const libraryInventory = await getLibraryInventory(BRAND_ID);
  console.log(
    `library_inventory: parents=${libraryInventory.totals.parents} segments=${libraryInventory.totals.segments} top_exercises=${libraryInventory.top_exercises.length}`,
  );
  console.log('');

  const realResults: RealResult[] = [];
  for (let i = 0; i < SEEDS.length; i++) {
    const r = await runRealStoryboard(SEEDS[i], libraryInventory);
    realResults.push(r);
    printRealReport(i, r);
  }

  // Pick the first successful real storyboard as the basis for synthetics.
  const basis = realResults.find((r) => r.ok && r.picks && r.plannerOutput);
  if (!basis) {
    console.log('\nNo successful real storyboard to base synthetics on — skipping.');
    process.exitCode = 1;
    return;
  }

  const synthA = await runSyntheticDuplicate(basis, persona, libraryInventory);
  printSyntheticReport(synthA);
  const synthB = await runSyntheticDurationMismatch(basis, persona, libraryInventory);
  printSyntheticReport(synthB);
  const synthC = await runSyntheticStructural(basis, persona, libraryInventory);
  printSyntheticReport(synthC);

  // Aggregate.
  console.log('\n============================================================');
  console.log('AGGREGATE');
  console.log('============================================================');
  const realPassed = realResults.filter((r) => r.ok).length;
  const totalWall =
    realResults.reduce((a, r) => a + r.wall_ms, 0) +
    synthA.wall_ms +
    synthB.wall_ms +
    synthC.wall_ms;
  const verdictDist: Record<string, number> = {};
  const reviseScopeDist: Record<string, number> = {};
  const issueDist: Record<string, number> = {};
  const allVerdicts: (CriticVerdict | undefined)[] = [
    ...realResults.map((r) => r.verdict),
    synthA.verdict,
    synthB.verdict,
    synthC.verdict,
  ];
  for (const v of allVerdicts) {
    if (!v) continue;
    verdictDist[v.verdict] = (verdictDist[v.verdict] ?? 0) + 1;
    reviseScopeDist[v.revise_scope] = (reviseScopeDist[v.revise_scope] ?? 0) + 1;
    for (const i of v.issues) {
      issueDist[i.issue_type] = (issueDist[i.issue_type] ?? 0) + 1;
    }
  }
  const totalCriticCalls =
    realPassed + (synthA.ok ? 1 : 0) + (synthB.ok ? 1 : 0) + (synthC.ok ? 1 : 0);
  const estCriticCost = totalCriticCalls * CRITIC_COST_USD;
  const criticLatencies = [
    ...realResults.map((r) => r.verdict?.latency_ms ?? 0),
    synthA.verdict?.latency_ms ?? 0,
    synthB.verdict?.latency_ms ?? 0,
    synthC.verdict?.latency_ms ?? 0,
  ].filter((n) => n > 0);
  const avgLatency =
    criticLatencies.length > 0
      ? Math.round(criticLatencies.reduce((a, b) => a + b, 0) / criticLatencies.length)
      : 0;

  console.log(`  real_storyboards:          ${realPassed}/${realResults.length} PASS`);
  console.log(`  synthetic_A_assertion:     ${synthA.assertion_pass ? 'PASS' : 'FAIL'}  ${synthA.assertion_detail}`);
  console.log(`  synthetic_B_assertion:     ${synthB.assertion_pass ? 'PASS' : 'FAIL'}  ${synthB.assertion_detail}`);
  console.log(`  synthetic_C_assertion:     ${synthC.assertion_pass ? 'PASS' : 'FAIL'}  ${synthC.assertion_detail}`);
  console.log(`  total_wall_ms:             ${totalWall}`);
  console.log(`  total_critic_calls:        ${totalCriticCalls}`);
  console.log(`  est_critic_cost_usd:       $${estCriticCost.toFixed(2)}  (@ ~$${CRITIC_COST_USD}/call)`);
  console.log(`  avg_critic_latency_ms:     ${avgLatency}`);
  console.log(`  verdict_distribution:      ${JSON.stringify(verdictDist)}`);
  console.log(`  revise_scope_distribution: ${JSON.stringify(reviseScopeDist)}`);
  console.log(`  issue_type_distribution:   ${JSON.stringify(issueDist)}`);

  const allPass =
    realPassed === realResults.length &&
    synthA.assertion_pass &&
    synthB.assertion_pass &&
    synthC.assertion_pass;
  if (!allPass) process.exitCode = 1;
}

main().catch((err) => {
  console.error('test-coherence-critic fatal:', err);
  process.exit(1);
});
