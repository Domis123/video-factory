/**
 * Phase 3 W3 — Copywriter smoke test.
 * Loads cached Phase 3 briefs from W2 fixtures, calls generateCopy for each,
 * prints overlay analysis with char_target compliance.
 *
 * Usage: npx tsx src/scripts/smoke-test-copywriter-phase3.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';
import { generateCopy } from '../agents/copywriter.js';
import type { BrandConfig, Phase3CreativeBrief, CopyPackage } from '../types/database.js';

const BRAND_ID = 'nordpilates';

const FIXTURE_DIR = resolve(
  new URL('.', import.meta.url).pathname,
  'fixtures',
);

const VIDEO_TYPES = ['workout-demo', 'tips-listicle', 'transformation'] as const;

function fixturePath(videoType: string): string {
  return resolve(FIXTURE_DIR, `smoke-w2-${videoType}.json`);
}

function loadBrief(videoType: string): Phase3CreativeBrief {
  const raw = readFileSync(fixturePath(videoType), 'utf-8');
  return JSON.parse(raw) as Phase3CreativeBrief;
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

interface OverlayAnalysis {
  slotIndex: number;
  expectedStyle: string;
  charTarget: number;
  actualText: string;
  actualChars: number;
  delta: number;
  deltaPercent: number;
  withinTolerance: boolean;
  flagged: boolean;
}

function analyzeOverlays(brief: Phase3CreativeBrief, copy: CopyPackage): OverlayAnalysis[] {
  const results: OverlayAnalysis[] = [];

  for (let i = 0; i < brief.segments.length; i++) {
    const seg = brief.segments[i];
    const overlay = copy.overlays.find((ov) => ov.segment_id === i);

    const actualText = overlay?.text ?? overlay?.sub_overlays?.[0]?.text ?? '';
    const actualChars = actualText.length;
    const charTarget = seg.text_overlay.char_target;
    const delta = actualChars - charTarget;
    const deltaPercent = charTarget > 0 ? (delta / charTarget) * 100 : 0;

    results.push({
      slotIndex: i,
      expectedStyle: seg.text_overlay.style,
      charTarget,
      actualText,
      actualChars,
      delta,
      deltaPercent,
      withinTolerance: Math.abs(deltaPercent) <= 20,
      flagged: deltaPercent > 20,
    });
  }

  return results;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ABORT: ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }

  console.log(`Phase 3 W3 copywriter smoke test — ${VIDEO_TYPES.length} video types, brand=${BRAND_ID}`);
  console.log(`Fixture dir: ${FIXTURE_DIR}`);
  console.log('');

  const brandConfig = await fetchBrand(BRAND_ID);
  const overallStart = Date.now();

  let totalSlots = 0;
  let totalOverlays = 0;
  let totalWithinTolerance = 0;
  let totalFlagged = 0;
  let totalNoneWithText = 0;
  let totalMissing = 0;

  for (const videoType of VIDEO_TYPES) {
    const bar = '='.repeat(80);
    console.log('');
    console.log(bar);
    console.log(`VIDEO TYPE: ${videoType}`);
    console.log(bar);

    const brief = loadBrief(videoType);
    console.log(`  Slots: ${brief.segments.length}`);
    console.log(`  Duration: ${brief.total_duration_target}s`);
    console.log(`  Creative vision: "${brief.creative_direction.creative_vision.slice(0, 120)}..."`);
    console.log('');

    const t0 = Date.now();
    const copy = await generateCopy({ brief, brandConfig });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Claude call: ${elapsed}s`);
    console.log('');

    // Overlay analysis
    const analyses = analyzeOverlays(brief, copy);

    console.log('  --- OVERLAYS ---');
    for (const a of analyses) {
      const flag = a.flagged ? ' *** OVER +20% ***' : '';
      const tolerance = a.withinTolerance ? 'OK' : 'MISS';
      console.log(
        `  Slot ${a.slotIndex} [${a.expectedStyle}] target=${a.charTarget} actual=${a.actualChars} ` +
        `delta=${a.delta > 0 ? '+' : ''}${a.delta} (${a.deltaPercent > 0 ? '+' : ''}${a.deltaPercent.toFixed(0)}%) ` +
        `${tolerance}${flag}`,
      );
      console.log(`    Text: "${a.actualText}"`);
    }

    // Check "none" style slots
    const noneWithText = analyses.filter(
      (a) => a.expectedStyle === 'none' && a.actualText.length > 0,
    );
    if (noneWithText.length > 0) {
      console.log('');
      console.log(`  WARNING: ${noneWithText.length} "none"-style slot(s) got non-empty text:`);
      for (const a of noneWithText) {
        console.log(`    Slot ${a.slotIndex}: "${a.actualText}"`);
      }
    }

    // Check missing overlays
    const coveredSlots = new Set(copy.overlays.map((ov) => ov.segment_id));
    const missingSlots = [];
    for (let i = 0; i < brief.segments.length; i++) {
      if (!coveredSlots.has(i)) missingSlots.push(i);
    }
    if (missingSlots.length > 0) {
      console.log(`  WARNING: Missing overlays for slots: ${missingSlots.join(', ')}`);
    }

    // Hook variants
    console.log('');
    console.log('  --- HOOK VARIANTS ---');
    for (const h of copy.hook_variants) {
      console.log(`    [${h.style}] "${h.text}"`);
    }

    // Platform captions
    console.log('');
    console.log('  --- CAPTIONS (first 100 chars) ---');
    console.log(`    TikTok:    "${copy.captions.tiktok.slice(0, 100)}"`);
    console.log(`    Instagram: "${copy.captions.instagram.slice(0, 100)}"`);
    console.log(`    YouTube:   "${copy.captions.youtube.slice(0, 100)}"`);

    // Accumulate totals
    totalSlots += brief.segments.length;
    totalOverlays += copy.overlays.length;
    totalWithinTolerance += analyses.filter((a) => a.withinTolerance).length;
    totalFlagged += analyses.filter((a) => a.flagged).length;
    totalNoneWithText += noneWithText.length;
    totalMissing += missingSlots.length;
  }

  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(80));
  console.log('GRAND SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Video types tested: ${VIDEO_TYPES.length}`);
  console.log(`  Total slots: ${totalSlots}`);
  console.log(`  Total overlays generated: ${totalOverlays}`);
  console.log(`  char_target within ±20%: ${totalWithinTolerance}/${totalSlots}`);
  console.log(`  char_target over +20%: ${totalFlagged}`);
  console.log(`  "none"-style with text: ${totalNoneWithText}`);
  console.log(`  Missing overlays: ${totalMissing}`);
  console.log(`  Total wall time: ${totalElapsed}s`);
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
