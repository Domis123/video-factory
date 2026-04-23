/**
 * W5 Gate A smoke — end-to-end Planner (W3) → retrieveCandidates (W4) →
 * pickClipsForStoryboard (W5). 3 seed storyboards. Prints per-slot picks,
 * per-slot reasoning, per-slot latency, parallel speedup ratio, aggregate
 * stats (wall, cost est., cross-parent warnings), full structural checks.
 *
 * Usage: npx tsx src/scripts/test-visual-director.ts
 *
 * Cost (estimate): 3 × ~5.5 slots × ~$0.07 = ~$1.15/run.
 */

import { planVideo } from '../agents/planner-v2.js';
import { retrieveCandidates } from '../agents/candidate-retrieval-v2.js';
import { loadBrandPersona } from '../agents/brand-persona.js';
import { embedText } from '../lib/clip-embed.js';
import { pickClipsForStoryboard } from '../agents/visual-director.js';
import type { PlannerOutput, PlannerSlot } from '../types/planner-output.js';
import type { CandidateSet } from '../types/candidate-set.js';
import type { StoryboardPicks } from '../types/slot-pick.js';

const BRAND_ID = 'nordpilates';
const PER_SLOT_COST_USD = 0.07;

const SEEDS: string[] = [
  'morning pilates routine for hip mobility',
  '3 glute exercises that feel better than they should',
  'day in the life of a pilates teacher',
];

interface StoryboardResult {
  seed: string;
  plannerOutput?: PlannerOutput;
  candidateSets?: CandidateSet[];
  picks?: StoryboardPicks;
  wall_ms: number;
  ok: boolean;
  error?: string;
  retrievalMs?: number;
  directorMs?: number;
  crossParentWarnings: number;
}

async function runOneStoryboard(seed: string): Promise<StoryboardResult> {
  const wallT0 = Date.now();
  const result: StoryboardResult = {
    seed,
    wall_ms: 0,
    ok: false,
    crossParentWarnings: 0,
  };
  try {
    const persona = await loadBrandPersona(BRAND_ID);

    // 1. Planner.
    const plannerOutput = await planVideo({ idea_seed: seed, brand_id: BRAND_ID });
    result.plannerOutput = plannerOutput;

    // 2. Retrieve candidates per-slot (parallel).
    const retT0 = Date.now();
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
    result.retrievalMs = Date.now() - retT0;
    result.candidateSets = candidateSets;

    // 3. Visual Director.
    const dirT0 = Date.now();
    const picks = await pickClipsForStoryboard({
      plannerOutput,
      candidateSets,
      brandPersona: persona,
    });
    result.directorMs = Date.now() - dirT0;
    result.picks = picks;

    // 4. Structural assertions.
    assertStoryboardShape(plannerOutput, candidateSets, picks);

    // 5. Count cross-parent warnings on primary slots.
    // picks.picks is sorted by slot_index; rebuild an index from slot_index → pick.
    const pickBySlotIndex = new Map(picks.picks.map((p) => [p.slot_index, p]));
    const primaryPicks = plannerOutput.slots
      .filter((s) => s.subject_role === 'primary')
      .map((s) => pickBySlotIndex.get(s.slot_index))
      .filter((p): p is NonNullable<typeof p> => !!p);
    let prior: string | null = null;
    for (const p of primaryPicks) {
      if (prior && p.parent_asset_id !== prior) result.crossParentWarnings++;
      prior = p.parent_asset_id;
    }

    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.wall_ms = Date.now() - wallT0;
  return result;
}

function assertStoryboardShape(
  plannerOutput: PlannerOutput,
  candidateSets: CandidateSet[],
  picks: StoryboardPicks,
): void {
  if (picks.picks.length !== plannerOutput.slots.length) {
    throw new Error(
      `picks length ${picks.picks.length} !== slots length ${plannerOutput.slots.length}`,
    );
  }
  for (const pick of picks.picks) {
    // slot_index is an identifier, not a position — look up by value.
    const pos = plannerOutput.slots.findIndex((s) => s.slot_index === pick.slot_index);
    if (pos === -1) {
      throw new Error(
        `pick has slot_index=${pick.slot_index} but no matching slot in plannerOutput`,
      );
    }
    const slot = plannerOutput.slots[pos];
    const cs = candidateSets[pos];
    const found = cs.candidates.find((c) => c.segment_id === pick.picked_segment_id);
    if (!found) {
      throw new Error(
        `pick.picked_segment_id ${pick.picked_segment_id} (slot ${pick.slot_index}) not in its candidate set`,
      );
    }
    if (pick.in_point_s < found.start_s - 1e-6 || pick.out_point_s > found.end_s + 1e-6) {
      throw new Error(
        `pick slot ${pick.slot_index} in/out ${pick.in_point_s}/${pick.out_point_s} outside segment bounds ${found.start_s}/${found.end_s}`,
      );
    }
    if (pick.out_point_s - pick.in_point_s < 1.0 - 1e-6) {
      throw new Error(
        `pick slot ${pick.slot_index} duration ${(pick.out_point_s - pick.in_point_s).toFixed(3)}s < 1.0s floor`,
      );
    }
  }
}

function fmtPick(slot: PlannerSlot, candidateSet: CandidateSet, pick: StoryboardPicks['picks'][number]): string {
  const lines: string[] = [];
  lines.push(
    `  [slot ${pick.slot_index}] role=${slot.slot_role}  target=${slot.target_duration_s}s  energy=${slot.energy}  subject_role=${slot.subject_role}`,
  );
  lines.push(
    `      narrative_beat: ${slot.narrative_beat}`,
  );
  lines.push(
    `      body_focus: ${slot.body_focus ? JSON.stringify(slot.body_focus) : 'null'}  segment_types: [${slot.segment_type_preferences.join(',')}]`,
  );
  lines.push(
    `      pool: ${candidateSet.candidates.length} candidates (strict=${candidateSet.relaxation_summary.strict_match_count}, relax_used=[${candidateSet.relaxation_summary.relaxations_used.join(',')}])`,
  );
  lines.push(
    `      PICK: ${pick.picked_segment_id}  parent=${pick.parent_asset_id.slice(0, 8)}  in=${pick.in_point_s.toFixed(2)}  out=${pick.out_point_s.toFixed(2)}  dur=${pick.duration_s.toFixed(2)}s`,
  );
  lines.push(
    `      diagnostics: similarity=${pick.similarity.toFixed(4)}  was_relaxed=${pick.was_relaxed_match}  same_parent_as_primary=${pick.same_parent_as_primary}  latency=${pick.latency_ms}ms`,
  );
  lines.push(`      reasoning: ${pick.reasoning}`);
  return lines.join('\n');
}

function printStoryboardReport(i: number, r: StoryboardResult): void {
  console.log(`\n============================================================`);
  console.log(`STORYBOARD ${i + 1}/${SEEDS.length}   seed: ${JSON.stringify(r.seed)}`);
  console.log(`============================================================`);
  console.log(`  wall_ms: ${r.wall_ms}  retrieval_ms: ${r.retrievalMs ?? '-'}  director_ms: ${r.directorMs ?? '-'}`);
  if (!r.ok || !r.plannerOutput || !r.candidateSets || !r.picks) {
    console.log(`  STATUS: FAIL`);
    console.log(`  error: ${r.error}`);
    return;
  }
  const po = r.plannerOutput;
  console.log(`  STATUS: PASS`);
  console.log(`  plan: form=${po.form_id}  hook=${po.hook_mechanism}  posture=${po.posture}  slot_count=${po.slot_count}`);
  console.log(`        creative_vision: ${po.creative_vision}`);
  console.log(`  picks: total_latency_ms=${r.picks.total_latency_ms}  parallel_speedup_ratio=${r.picks.parallel_speedup_ratio}  cross_parent_warnings=${r.crossParentWarnings}`);
  console.log('');
  for (const pick of r.picks.picks) {
    const pos = po.slots.findIndex((s) => s.slot_index === pick.slot_index);
    if (pos === -1) continue;
    const slot = po.slots[pos];
    const cs = r.candidateSets[pos];
    console.log(fmtPick(slot, cs, pick));
    console.log('');
  }
}

async function main(): Promise<void> {
  console.log('=== W5 Visual Director — Gate A smoke ===');
  console.log(`brand:   ${BRAND_ID}`);
  console.log(`seeds:   ${JSON.stringify(SEEDS)}`);
  console.log('');

  const results: StoryboardResult[] = [];
  for (let i = 0; i < SEEDS.length; i++) {
    const r = await runOneStoryboard(SEEDS[i]);
    results.push(r);
    printStoryboardReport(i, r);
  }

  // Aggregate.
  console.log('\n============================================================');
  console.log('AGGREGATE');
  console.log('============================================================');
  const passed = results.filter((r) => r.ok).length;
  const totalWall = results.reduce((a, r) => a + r.wall_ms, 0);
  const totalSlots = results.reduce(
    (a, r) => a + (r.picks?.picks.length ?? 0),
    0,
  );
  const estCost = totalSlots * PER_SLOT_COST_USD;
  const totalWarnings = results.reduce((a, r) => a + r.crossParentWarnings, 0);

  console.log(`  passed:                    ${passed}/${results.length}`);
  console.log(`  total_wall_ms:             ${totalWall}`);
  console.log(`  total_slots_across_boards: ${totalSlots}`);
  console.log(`  est_gemini_cost_usd:       $${estCost.toFixed(2)}  (@ ~$${PER_SLOT_COST_USD}/slot)`);
  console.log(`  cross_parent_warnings:     ${totalWarnings}`);
  console.log('');

  console.log('  per-storyboard speedup:');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sp = r.picks ? r.picks.parallel_speedup_ratio : 'n/a';
    console.log(`    ${i + 1}: ${r.ok ? 'PASS' : 'FAIL'}  wall=${r.wall_ms}ms  speedup=${sp}  slots=${r.picks?.picks.length ?? 0}  cross_parent_warn=${r.crossParentWarnings}`);
  }

  // Slot role distribution across all picked slots.
  const roleCounts: Record<string, number> = {};
  for (const r of results) {
    if (!r.plannerOutput) continue;
    for (const s of r.plannerOutput.slots) {
      roleCounts[s.slot_role] = (roleCounts[s.slot_role] ?? 0) + 1;
    }
  }
  console.log('');
  console.log(`  slot_role_distribution:    ${JSON.stringify(roleCounts)}`);

  if (passed < results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('test-visual-director fatal:', err);
  process.exit(1);
});
