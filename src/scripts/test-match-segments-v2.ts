/**
 * W4 Gate A smoke: exercises `match_segments_v2` RPC via `retrieveCandidates`
 * across 5 slot specs (different axes of the filter + boost logic), then runs
 * scenario 1 ten times for p50/p95 latency.
 *
 * Usage: npx tsx src/scripts/test-match-segments-v2.ts
 *
 * Assumes the live nordpilates library (~1116 segments, 99.9% v2-populated).
 * Non-zero exit code if any scenario throws or Zod parsing fails.
 */

import { embedText } from '../lib/clip-embed.js';
import { supabaseAdmin } from '../config/supabase.js';
import { retrieveCandidates } from '../agents/candidate-retrieval-v2.js';
import type { PlannerSlot } from '../types/planner-output.js';
import type { CandidateSet, Candidate } from '../types/candidate-set.js';

const BRAND_ID = 'nordpilates';

interface ScenarioSpec {
  name: string;
  seed_phrase: string;
  slot: PlannerSlot;
  expectation: string;
  subjectHintParentAssetId?: string | null;
}

function buildScenarios(subjectHintParent: string | null): ScenarioSpec[] {
  return [
    {
      name: '1-strict-hit-glutes-exercise',
      seed_phrase: 'glute bridge with slow controlled descent',
      slot: {
        slot_index: 0,
        slot_role: 'hook',
        target_duration_s: 3,
        energy: 7,
        body_focus: ['glutes'],
        segment_type_preferences: ['exercise'],
        subject_role: 'primary',
        narrative_beat: 'Opening pattern-interrupt hook: tight glute isolation visual.',
      },
      expectation: '18 candidates, 0 relaxations expected (glutes is high-count).',
    },
    {
      name: '2-body-focus-scarcity-chest',
      seed_phrase: 'chest press and pec engagement',
      slot: {
        slot_index: 1,
        slot_role: 'body',
        target_duration_s: 4,
        energy: 6,
        body_focus: ['chest'],
        segment_type_preferences: ['exercise'],
        subject_role: 'primary',
        narrative_beat: 'Mid-video demo of a less-common chest-focused movement.',
      },
      expectation: 'Some relaxation may fire if strict layer yields <18 (chest count is low).',
    },
    {
      name: '3-talking-head-scarcity-hook',
      seed_phrase: 'direct-to-camera pilates teacher speaking to viewer',
      slot: {
        slot_index: 0,
        slot_role: 'hook',
        target_duration_s: 3,
        energy: 8,
        body_focus: null,
        segment_type_preferences: ['talking-head'],
        subject_role: 'primary',
        narrative_beat: 'Authority-claim opener with direct address.',
      },
      expectation: 'segment_type relaxation must fire (talking-head count <10).',
    },
    {
      name: '4-close-permissive-editorial',
      seed_phrase: 'slow stretch and quiet cooldown pose',
      slot: {
        slot_index: 2,
        slot_role: 'close',
        target_duration_s: 2,
        energy: 3,
        body_focus: null,
        segment_type_preferences: ['cooldown', 'hold'],
        subject_role: 'any',
        narrative_beat: 'Settling close that exhales the video.',
      },
      expectation: '18 candidates; close-slot permissive editorial (demo OR transition).',
    },
    {
      name: '5-subject-hint-parent-boost',
      seed_phrase: 'glute bridge with slow controlled descent',
      slot: {
        slot_index: 1,
        slot_role: 'body',
        target_duration_s: 3,
        energy: 7,
        body_focus: ['glutes'],
        segment_type_preferences: ['exercise'],
        subject_role: 'primary',
        narrative_beat: 'Continuation of the hook exercise from the same take.',
      },
      subjectHintParentAssetId: subjectHintParent,
      expectation: 'Same-parent candidates ranked higher via +0.10 boost (if library supports).',
    },
  ];
}

async function findMultiSegmentParent(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('parent_asset_id')
    .eq('brand_id', BRAND_ID)
    .eq('segment_type', 'exercise')
    .not('segment_v2', 'is', null)
    .limit(500);
  if (error || !data) {
    console.warn(`[test] Could not scan for multi-segment parent: ${error?.message ?? 'no data'}`);
    return null;
  }
  const counts = new Map<string, number>();
  for (const row of data) {
    const pid = (row as { parent_asset_id: string | null }).parent_asset_id;
    if (!pid) continue;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const [pid, n] of counts) {
    if (!best || n > best[1]) best = [pid, n];
  }
  if (!best) return null;
  console.log(`[test] subject-hint parent chosen: ${best[0]} (${best[1]} exercise segments)`);
  return best[0];
}

function fmtCandidate(c: Candidate): string {
  const dur = Number((c.end_s - c.start_s).toFixed(2));
  const bodyRegions = c.matched_body_regions.length
    ? `matched=[${c.matched_body_regions.join(',')}]`
    : 'matched=[]';
  const relax = c.relaxation_applied.length
    ? `relax=[${c.relaxation_applied.join(',')}]`
    : 'relax=[]';
  return (
    `    ${c.segment_id.slice(0, 8)} ${c.segment_type.padEnd(12)} dur=${dur}s ` +
    `sim=${c.similarity.toFixed(3)} boost=${c.boost_score.toFixed(3)} ` +
    `edit=${c.editorial_suitability_for_role} ${bodyRegions} ${relax} ` +
    `parent=${c.parent_asset_id.slice(0, 8)}`
  );
}

async function runScenario(spec: ScenarioSpec): Promise<CandidateSet> {
  console.log(`\n=== Scenario ${spec.name} ===`);
  console.log(`  seed_phrase: ${JSON.stringify(spec.seed_phrase)}`);
  console.log(`  slot_role: ${spec.slot.slot_role}`);
  console.log(`  segment_type_preferences: ${JSON.stringify(spec.slot.segment_type_preferences)}`);
  console.log(`  body_focus: ${JSON.stringify(spec.slot.body_focus)}`);
  console.log(`  target_duration_s: ${spec.slot.target_duration_s}`);
  if (spec.subjectHintParentAssetId) {
    console.log(`  subject_hint_parent: ${spec.subjectHintParentAssetId}`);
  }
  console.log(`  expectation: ${spec.expectation}`);

  const queryEmbedding = await embedText(spec.seed_phrase);
  const t0 = Date.now();
  const result = await retrieveCandidates({
    slot: spec.slot,
    queryEmbedding,
    brandId: BRAND_ID,
    subjectHintParentAssetId: spec.subjectHintParentAssetId ?? null,
  });
  const wall = Date.now() - t0;

  console.log(`  total_candidates: ${result.relaxation_summary.total_candidates}`);
  console.log(`  strict_match_count: ${result.relaxation_summary.strict_match_count}`);
  console.log(`  relaxations_used: ${JSON.stringify(result.relaxation_summary.relaxations_used)}`);
  console.log(`  rpc_latency_ms: ${result.latency_ms}`);
  console.log(`  wall_ms: ${wall} (includes embed ~50ms + RPC ${result.latency_ms}ms)`);

  const topN = result.candidates.slice(0, 5);
  console.log(`  top-${topN.length} candidates:`);
  for (const c of topN) console.log(fmtCandidate(c));

  if (spec.subjectHintParentAssetId && result.candidates.length > 0) {
    const sameParentRanks: number[] = [];
    result.candidates.forEach((c, idx) => {
      if (c.parent_asset_id === spec.subjectHintParentAssetId) sameParentRanks.push(idx);
    });
    console.log(`  same-parent ranks (0-indexed): [${sameParentRanks.join(', ')}]`);
    if (sameParentRanks.length > 0) {
      const avgRank = sameParentRanks.reduce((a, b) => a + b, 0) / sameParentRanks.length;
      console.log(`  same-parent mean rank: ${avgRank.toFixed(2)} of ${result.candidates.length}`);
    }
  }

  return result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

async function benchScenarioOne(scenario: ScenarioSpec, runs: number): Promise<void> {
  console.log(`\n=== Benchmark: scenario 1 × ${runs} runs ===`);
  const embedding = await embedText(scenario.seed_phrase);
  const latencies: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = await retrieveCandidates({
      slot: scenario.slot,
      queryEmbedding: embedding,
      brandId: BRAND_ID,
    });
    const wall = Date.now() - t0;
    latencies.push(r.latency_ms);
    console.log(`  run ${i + 1}/${runs}: rpc=${r.latency_ms}ms wall=${wall}ms candidates=${r.candidates.length}`);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  p50_ms: ${p50}`);
  console.log(`  p95_ms: ${p95}`);
  console.log(`  mean_ms: ${mean.toFixed(1)}`);
  console.log(`  min_ms: ${sorted[0]}`);
  console.log(`  max_ms: ${sorted[sorted.length - 1]}`);
}

async function main(): Promise<void> {
  console.log(`[test] brand: ${BRAND_ID}`);
  const subjectParent = await findMultiSegmentParent();
  const scenarios = buildScenarios(subjectParent);

  const results: Array<{ name: string; ok: boolean; error?: string; result?: CandidateSet }> = [];
  for (const s of scenarios) {
    try {
      const r = await runScenario(s);
      results.push({ name: s.name, ok: true, result: r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[test] scenario ${s.name} THREW: ${msg}`);
      results.push({ name: s.name, ok: false, error: msg });
    }
  }

  const benchScenario = scenarios[0];
  try {
    await benchScenarioOne(benchScenario, 10);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[test] bench THREW: ${msg}`);
    process.exitCode = 1;
  }

  console.log('\n=== summary ===');
  const passed = results.filter((r) => r.ok).length;
  console.log(`  scenarios passed: ${passed}/${results.length}`);
  for (const r of results) {
    if (r.ok && r.result) {
      const rs = r.result.relaxation_summary;
      console.log(
        `  ${r.name}: total=${rs.total_candidates} strict=${rs.strict_match_count} ` +
          `relax=[${rs.relaxations_used.join(',')}] latency=${r.result.latency_ms}ms`,
      );
    } else {
      console.log(`  ${r.name}: FAIL — ${r.error}`);
    }
  }
  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[test-match-segments-v2] fatal:', err);
  process.exit(1);
});
