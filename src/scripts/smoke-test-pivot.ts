/**
 * Architecture pivot smoke test.
 *
 * Validates that the Creative Director:
 *   1. Reads the library inventory before designing.
 *   2. Emits `body_focus` on every body/exercise/hold slot.
 *   3. Stays within the body regions that actually exist in the library.
 *
 * Does NOT call the curator or copywriter — those have their own smoke tests
 * and live live tests cost more. This is the cheapest possible end-to-end
 * proof that the inventory wiring is reaching the model.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx src/scripts/smoke-test-pivot.ts [brandId]
 *
 * Default brand: nordpilates. Cost: ~$0.05–0.20 (single Sonnet brief).
 *
 * File: src/scripts/smoke-test-pivot.ts
 */

import 'dotenv/config';
import { supabaseAdmin } from '../config/supabase.js';
import { generateBriefPhase3 } from '../agents/creative-director-phase3.js';
import { getLibraryInventory } from '../agents/library-inventory.js';
import type { BrandConfig } from '../types/database.js';

async function main() {
  const brandId = process.argv[2] || 'nordpilates';
  const ideaSeed = process.argv[3] || '3 pilates moves to wake up your core';

  console.log(`\n🧪 Architecture pivot smoke test`);
  console.log(`   brand:     ${brandId}`);
  console.log(`   idea_seed: "${ideaSeed}"\n`);

  // 1. Load brand config
  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brand_configs')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (brandErr || !brand) {
    throw new Error(`Brand ${brandId} not found: ${brandErr?.message ?? 'no row'}`);
  }
  const brandConfig = brand as BrandConfig;

  // 2. Pre-fetch inventory so we can cross-check what the CD ought to design for
  const inventory = await getLibraryInventory(brandId);
  const validBodyRegions = new Set(Object.keys(inventory.bodyRegions));
  console.log(
    `📚 Library: ${inventory.totalExerciseSegments} ex / ${inventory.totalHoldSegments} hold / ` +
      `${inventory.talkingHeadCount} TH / ${inventory.bRollCount} b-roll, ` +
      `${validBodyRegions.size} body regions\n`,
  );

  // 3. Generate brief — this internally calls getLibraryInventory again and
  // injects the summary into the user message. We don't intercept; we just
  // verify the CD's output reflects it.
  const startMs = Date.now();
  const brief = await generateBriefPhase3({ ideaSeed, brandConfig });
  const wallMs = Date.now() - startMs;

  console.log(`✅ Brief generated in ${(wallMs / 1000).toFixed(1)}s\n`);
  console.log(`   video_type:      ${brief.video_type}`);
  console.log(`   slot_count:      ${brief.creative_direction.slot_count}`);
  console.log(`   color_treatment: ${brief.creative_direction.color_treatment}`);
  console.log(`   total duration:  ${brief.total_duration_target}s`);
  console.log(`   creative_vision: "${brief.creative_direction.creative_vision.slice(0, 80)}..."\n`);

  // 4. Inspect each segment for body_focus + content_type
  console.log(`─── Per-slot body_focus ───\n`);
  let bodyFocusPresent = 0;
  let bodyFocusMissingExpected = 0;
  let bodyFocusOutOfLibrary = 0;
  const exerciseTypes = new Set(['exercise', 'hold', 'workout', 'demo']);

  for (let i = 0; i < brief.segments.length; i++) {
    const seg = brief.segments[i];
    const ct = seg.clip_requirements.content_type.join(',');
    const body = seg.clip_requirements.body_focus;
    const expectsBody = seg.clip_requirements.content_type.some((t) =>
      exerciseTypes.has(t.toLowerCase()),
    );

    let status = '  ';
    if (body) {
      bodyFocusPresent++;
      if (!validBodyRegions.has(body)) {
        bodyFocusOutOfLibrary++;
        status = '⚠️ '; // outside library
      } else {
        status = '✅';
      }
    } else if (expectsBody) {
      bodyFocusMissingExpected++;
      status = '❌'; // exercise/hold slot with no body_focus
    } else {
      status = '— '; // talking-head/b-roll, body_focus null is fine
    }

    console.log(
      `${status} slot ${i} (${seg.type}, ct=${ct}): body_focus=${body === null ? 'null' : `"${body}"`}`,
    );
  }

  // 5. Verdict
  console.log(`\n─── Verdict ───\n`);
  console.log(`   body_focus set:                  ${bodyFocusPresent} / ${brief.segments.length} slots`);
  console.log(`   body_focus missing on ex/hold:   ${bodyFocusMissingExpected}`);
  console.log(`   body_focus outside library:      ${bodyFocusOutOfLibrary}`);

  const failures: string[] = [];
  if (bodyFocusMissingExpected > 0) {
    failures.push(`${bodyFocusMissingExpected} exercise/hold slot(s) missing body_focus`);
  }
  if (bodyFocusOutOfLibrary > 0) {
    failures.push(`${bodyFocusOutOfLibrary} body_focus value(s) not in library inventory`);
  }

  if (failures.length === 0) {
    console.log(`\n✅ PASS — architecture pivot wiring looks correct.\n`);
    process.exit(0);
  } else {
    console.log(`\n❌ FAIL:`);
    for (const f of failures) console.log(`   - ${f}`);
    console.log(``);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 Failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
