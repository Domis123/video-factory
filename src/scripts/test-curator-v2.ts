import { curateWithV2, type CuratorV2Brief } from '../agents/asset-curator-v2.js';

const TEST_BRIEF: CuratorV2Brief = {
  brandId: 'nordpilates',
  slots: [
    { index: 0, description: 'hook: arresting visual of woman starting a core workout', valid_segment_types: ['exercise', 'hold'], min_quality: 7 },
    { index: 1, description: 'demo: oblique-targeting core exercise like side plank or crunch', valid_segment_types: ['exercise'], min_quality: 7 },
    { index: 2, description: 'demo: abs-focused movement showing controlled progression', valid_segment_types: ['exercise', 'hold'], min_quality: 6 },
    { index: 3, description: 'transition: brief reset between exercises', valid_segment_types: ['transition', 'b-roll'], min_quality: 5 },
    { index: 4, description: 'closer: strong finishing pose or cool-down stretch', valid_segment_types: ['hold', 'cooldown'], min_quality: 7 },
  ],
};

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

async function main() {
  console.log('\n🎬 Curator V2 — End-to-End Test\n');
  console.log(`Brand: ${TEST_BRIEF.brandId}`);
  console.log(`Slots: ${TEST_BRIEF.slots.length}`);
  console.log('');

  const startTime = Date.now();
  let proCalls = 0;

  const results = await curateWithV2(TEST_BRIEF);

  const totalMs = Date.now() - startTime;

  console.log('\n========== Results ==========\n');

  for (const r of results) {
    const slot = TEST_BRIEF.slots.find((s) => s.index === r.slotIndex);
    console.log(`Slot ${r.slotIndex}: ${slot?.description.slice(0, 50)}...`);
    console.log(`  Segment: ${r.segmentId || '(none)'}`);
    console.log(`  Parent R2: ${r.parentR2Key || '(none)'}`);
    console.log(`  Trim: ${r.trimStartS}s – ${r.trimEndS}s`);
    console.log(`  Score: ${r.score}/10`);
    console.log(`  Reasoning: ${r.reasoning}`);
    console.log(`  Candidates evaluated: ${r.candidateCount}`);
    console.log('');

    // Count Pro calls: 1 per slot + 1 if self-critique triggered (score < 7)
    proCalls += 1;
    if (r.score > 0 && r.score < 7) proCalls += 1;
  }

  // Assertions
  check(`All ${TEST_BRIEF.slots.length} slots returned`, results.length === TEST_BRIEF.slots.length);

  const nonPlaceholder = results.filter((r) => r.score > 0);
  check(`All slots have non-placeholder picks (${nonPlaceholder.length}/${results.length})`, nonPlaceholder.length === results.length);

  const highQuality = results.filter((r) => r.score >= 7);
  check(`All picks scored >= 7 (${highQuality.length}/${results.length})`, highQuality.length === results.length);

  // Variety: warn if 3+ slots share the same parent, but don't fail for minor overlap
  const uniqueParents = new Set(results.filter((r) => r.parentR2Key).map((r) => r.parentR2Key));
  console.log(`  Unique parent assets: ${uniqueParents.size}/${results.length}`);
  const parentCounts = new Map<string, number>();
  for (const r of results) {
    if (r.parentR2Key) parentCounts.set(r.parentR2Key, (parentCounts.get(r.parentR2Key) ?? 0) + 1);
  }
  const maxReuse = Math.max(...parentCounts.values(), 0);
  check(`No parent used 3+ times (max reuse: ${maxReuse})`, maxReuse < 3);

  // Summary
  const estCost = proCalls * 0.04; // rough estimate per Pro call with video
  console.log('========== Summary ==========');
  console.log(`Wall time:  ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Pro calls:  ~${proCalls}`);
  console.log(`Est. cost:  ~$${estCost.toFixed(2)}`);
  console.log(`Passed:     ${passed}/${passed + failed}`);
  console.log(`Failed:     ${failed}`);
  console.log('=============================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
