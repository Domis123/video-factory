/**
 * c1.0.1.1 standalone test for Match-Or-Match v1.0.1 routine prompt.
 *
 * Calls the picker against the 6 fresh nordpilates seeds from the v1.2.1
 * brief, captures per-seed slot count + segment selection, and verifies:
 *
 *   - Median slot count ≥ 4 (kickoff halt-condition: <4 → halt)
 *   - No 3+ adjacent picks from the same parent (kickoff halt-condition:
 *     same-parent 3+ consecutive → halt)
 *   - Reasoning explicitly cites a constraint when slot_count < 4
 *     (informational, not a mechanical fail)
 *
 * Adjacency definition: two picks are "adjacent in the parent" if their
 * indices in the parent's segments-sorted-by-start_s list are consecutive
 * (e.g., parent has 12 segments by time, picks include parent indices
 * [3, 4, 5] → 3 adjacent picks → halt).
 *
 * No render. Dry-run of the picker only. Cost: 6 × ~$0.05 = ~$0.30.
 *
 * Usage: npx tsx src/scripts/test-match-or-match-prompt.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import { callMatchOrMatchAgent } from '../agents/match-or-match-agent.js';

const BRAND_ID = 'nordpilates';

// 6 fresh seeds from v1.2.1 brief Gate A section.
const SEEDS: string[] = [
  'morning core flow for tight hips',
  'pilates breathing reset',
  'slow leg circles for stiff knees',
  'gentle full body wakeup',
  'posture correction for desk workers',
  'pilates stretches that feel like rest',
];

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

interface SeedRun {
  seed: string;
  parentAssetId: string;
  segmentIds: string[];
  slotCount: number;
  reasoning: string;
  costUsd: number;
  /** Parent-relative indices (sorted by start_s) for each picked segment. */
  parentIndices: number[];
  /** Maximum run of adjacent parent indices in the picked set. */
  maxAdjacentRun: number;
}

async function fetchParentIndices(
  parentAssetId: string,
  pickedIds: string[],
): Promise<number[]> {
  // Get all segments of the parent, ordered by start_s, with index.
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, start_s')
    .eq('parent_asset_id', parentAssetId)
    .order('start_s', { ascending: true });
  if (error) throw new Error(`fetchParentIndices: ${error.message}`);
  if (!data) throw new Error(`fetchParentIndices: no data for parent ${parentAssetId}`);
  const idToIdx = new Map<string, number>();
  for (let i = 0; i < data.length; i++) {
    idToIdx.set((data[i] as { id: string }).id, i);
  }
  return pickedIds.map((id) => {
    const idx = idToIdx.get(id);
    if (idx === undefined) {
      throw new Error(
        `Picked id=${id} not found among parent ${parentAssetId.slice(0, 8)}'s segments`,
      );
    }
    return idx;
  });
}

/**
 * Given a list of (possibly unsorted) parent indices, find the longest
 * run of consecutive integers when sorted. E.g., [4, 7, 5, 6] sorted is
 * [4,5,6,7] → run length 4. Used to detect 3+ adjacent picks.
 */
function maxAdjacentRunLength(indices: number[]): number {
  if (indices.length === 0) return 0;
  const sorted = [...indices].sort((a, b) => a - b);
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

async function runOneSeed(seed: string): Promise<SeedRun> {
  console.log(`\n── Seed: "${seed}" ──`);
  const t0 = Date.now();
  const result = await callMatchOrMatchAgent({
    brandId: BRAND_ID,
    ideaSeed: seed,
    format: 'routine',
    excludedParents: [],
    excludedSegments: [],
  });
  const wallMs = Date.now() - t0;
  if (result.format !== 'routine') {
    throw new Error(`Expected routine result, got ${result.format}`);
  }

  const parentIndices = await fetchParentIndices(result.parentAssetId, result.segmentIds);
  const maxRun = maxAdjacentRunLength(parentIndices);

  console.log(
    `  parent=${result.parentAssetId.slice(0, 8)}  slot_count=${result.slotCount}  ` +
      `parentIndices=[${parentIndices.join(',')}]  maxAdjacentRun=${maxRun}  ` +
      `cost=$${result.costUsd.toFixed(4)}  wall=${wallMs}ms`,
  );
  console.log(`  reasoning: ${result.reasoning.replace(/\s+/g, ' ').slice(0, 240)}`);

  return {
    seed,
    parentAssetId: result.parentAssetId,
    segmentIds: result.segmentIds,
    slotCount: result.slotCount,
    reasoning: result.reasoning,
    costUsd: result.costUsd,
    parentIndices,
    maxAdjacentRun: maxRun,
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  console.log('🧪 Match-Or-Match routine prompt test (v1.0.1) — 6 fresh seeds\n');

  const runs: SeedRun[] = [];
  for (const seed of SEEDS) {
    runs.push(await runOneSeed(seed));
  }

  // Aggregate
  const slotCounts = runs.map((r) => r.slotCount);
  const slotCountMedian = median(slotCounts);
  const totalCost = runs.reduce((acc, r) => acc + r.costUsd, 0);
  const distribution: Record<number, number> = {};
  for (const c of slotCounts) distribution[c] = (distribution[c] || 0) + 1;

  console.log('\n══════ Aggregate ══════');
  console.log(`  Slot counts: ${slotCounts.join(', ')}`);
  console.log(`  Distribution: ${JSON.stringify(distribution)}`);
  console.log(`  Median slot count: ${slotCountMedian}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Max adjacent run per seed: ${runs.map((r) => r.maxAdjacentRun).join(', ')}`);

  // Per-run mechanical assertions
  console.log('\n── Per-seed mechanical assertions ──');
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    assert(
      `[${i + 1}] slot_count in [2,5]`,
      r.slotCount >= 2 && r.slotCount <= 5,
      `got ${r.slotCount}`,
    );
    assert(
      `[${i + 1}] segment_ids length matches slot_count`,
      r.segmentIds.length === r.slotCount,
    );
    // Halt-condition: 3+ adjacent picks from same parent
    assert(
      `[${i + 1}] no 3+ adjacent picks (max run=${r.maxAdjacentRun})`,
      r.maxAdjacentRun < 3,
      `parentIndices=[${r.parentIndices.join(',')}]`,
    );
    if (r.slotCount < 4) {
      // Informational: reasoning should cite a constraint when slot_count < 4
      const reasoningLower = r.reasoning.toLowerCase();
      const cites =
        reasoningLower.includes('library') ||
        reasoningLower.includes('redundan') ||
        reasoningLower.includes('coheren') ||
        reasoningLower.includes('feel') ||
        reasoningLower.includes('weak') ||
        reasoningLower.includes('fewer');
      console.log(
        `  [${i + 1}] slot_count=${r.slotCount} (<4) — reasoning ${cites ? 'CITES' : 'DOES NOT CITE'} a constraint`,
      );
    }
  }

  // Aggregate halt-conditions
  console.log('\n── Aggregate halt-conditions ──');
  assert(
    `median slot count >= 4 (halt-condition: <4 fails)`,
    slotCountMedian >= 4,
    `got ${slotCountMedian}`,
  );
  assert(
    `no seed produced 3+ adjacent picks (halt-condition: any 3+ fails)`,
    runs.every((r) => r.maxAdjacentRun < 3),
  );
  assert(
    `aggregate cost in projected range ($0.10-0.50)`,
    totalCost >= 0.05 && totalCost < 0.50,
    `got $${totalCost.toFixed(4)}`,
  );

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ Match-Or-Match v1.0.1 prompt test pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
