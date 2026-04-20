/**
 * Smoke test for library inventory.
 *
 * Usage:
 *   npx tsx src/scripts/smoke-test-inventory.ts [brandId]
 *
 * Default brand: nordpilates
 *
 * File: src/scripts/smoke-test-inventory.ts
 */

import { getLibraryInventory } from '../agents/library-inventory.js';

async function main() {
  const brandId = process.argv[2] || 'nordpilates';

  console.log(`\n🔍 Fetching library inventory for brand: ${brandId}\n`);

  const inventory = await getLibraryInventory(brandId);

  console.log('─── Summary (this is what the CD sees) ───\n');
  console.log(inventory.summary);

  console.log('\n─── Raw counts ───\n');
  console.log(`  Exercise segments: ${inventory.totalExerciseSegments}`);
  console.log(`  Hold segments:     ${inventory.totalHoldSegments}`);
  console.log(`  Talking-head:      ${inventory.talkingHeadCount}`);
  console.log(`  B-roll:            ${inventory.bRollCount}`);

  console.log('\n─── Body region detail ───\n');
  const sorted = Object.entries(inventory.bodyRegions)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [region, info] of sorted) {
    console.log(`  ${region} (${info.count} clips):`);
    if (info.exercises.length > 0) {
      console.log(`    exercises: ${info.exercises.join(', ')}`);
    } else {
      console.log(`    exercises: (none tagged)`);
    }
  }

  // Validation checks
  console.log('\n─── Validation ───\n');

  const totalTagged = Object.values(inventory.bodyRegions)
    .reduce((sum, r) => sum + r.count, 0);
  const totalSegments = inventory.totalExerciseSegments + inventory.totalHoldSegments;

  // Some segments have multiple body-part tags, so totalTagged >= totalSegments is expected
  console.log(`  Total segments: ${totalSegments}`);
  console.log(`  Body-region tag hits: ${totalTagged} (includes multi-tag segments)`);

  if (totalSegments === 0) {
    console.log('  ❌ No exercise/hold segments found — check brand_id and quality_score filter');
  } else {
    console.log('  ✅ Inventory populated');
  }

  // Check for exercise-name tag extraction
  const allExercises = new Set<string>();
  for (const info of Object.values(inventory.bodyRegions)) {
    for (const ex of info.exercises) allExercises.add(ex);
  }
  console.log(`  Unique exercise-name tags extracted: ${allExercises.size}`);

  if (allExercises.size < 5) {
    console.log('  ⚠ Few exercise names extracted — the exercise tag filter may be too aggressive');
    console.log(`    Extracted: ${[...allExercises].join(', ')}`);
  } else {
    console.log(`  ✅ Good exercise variety: ${[...allExercises].slice(0, 15).join(', ')}${allExercises.size > 15 ? ', ...' : ''}`);
  }
}

main().catch(err => {
  console.error('💥 Failed:', err.message);
  process.exit(1);
});
