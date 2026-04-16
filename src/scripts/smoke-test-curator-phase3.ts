/**
 * Phase 3 W2 curator smoke test — dev-only harness.
 *
 * Generates 3 Phase 3 briefs (one per nordpilates video_type), caches them
 * as fixture files, then feeds each to Curator V2 via the updated Phase 3
 * dispatch path. Prints full Pro reasoning traces for operator vibe-check.
 *
 * Read-only: no Supabase writes to jobs/job_events, no BullMQ.
 * Costs ~$1.00-1.30 on first run (CD + curator), ~$0.60-1.00 on re-run (curator only).
 *
 * Usage:
 *   ENABLE_PHASE_3_CD=true npx tsx src/scripts/smoke-test-curator-phase3.ts
 */

import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrandConfig, Phase3CreativeBrief } from '../types/database.js';
import { supabaseAdmin } from '../config/supabase.js';
import { generateBriefPhase3, lastGenerationStats } from '../agents/creative-director-phase3.js';
import { curateWithV2, type CuratorV2Brief, type CuratorV2Result } from '../agents/asset-curator-v2.js';
import type { BriefSlot } from '../agents/curator-v2-retrieval.js';

// ── Config ──

const BRAND_ID = 'nordpilates';

const SEEDS: { videoType: string; ideaSeed: string }[] = [
  { videoType: 'workout-demo', ideaSeed: 'a quick lower-body sequence for tight hips after sitting all day' },
  { videoType: 'tips-listicle', ideaSeed: 'three pilates cues that fix your plank form instantly' },
  { videoType: 'transformation', ideaSeed: 'what a week of daily pilates actually felt like' },
];

const FIXTURE_DIR = resolve(
  new URL('.', import.meta.url).pathname,
  'fixtures',
);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'to',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'this', 'that', 'it',
  'from', 'as', 'be', 'has', 'have', 'not', 'no',
]);

// ── Helpers ──

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const result: string[] = [];
  for (const w of a) {
    if (b.has(w)) result.push(w);
  }
  return result;
}

function truncate(text: string, max = 100): string {
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

function fixturePath(videoType: string): string {
  return resolve(FIXTURE_DIR, `smoke-w2-${videoType}.json`);
}

// ── Segment-like interface for buildSlotDescription (mirrors dispatcher) ──

interface SegmentLike {
  type: string;
  label?: string;
  clip_requirements: {
    content_type: string[];
    mood: string | string[];
    visual_elements?: string[];
  };
}

function buildSlotDescription(seg: SegmentLike): string {
  const parts: string[] = [];
  parts.push(`${seg.type} segment`);
  if (seg.label) parts.push(`(${seg.label})`);
  if (seg.clip_requirements.content_type.length > 0) {
    parts.push(`showing: ${seg.clip_requirements.content_type.join(', ')}`);
  }
  const mood = Array.isArray(seg.clip_requirements.mood)
    ? seg.clip_requirements.mood.join('/')
    : seg.clip_requirements.mood;
  if (mood) parts.push(`mood: ${mood}`);
  if (seg.clip_requirements.visual_elements?.length) {
    parts.push(`with: ${seg.clip_requirements.visual_elements.join(', ')}`);
  }
  return parts.join(', ');
}

function mapContentTypesToSegmentTypes(seg: SegmentLike): string[] {
  const typeMap: Record<string, string[]> = {
    'workout': ['exercise', 'hold'],
    'exercise': ['exercise'],
    'demo': ['exercise', 'hold'],
    'hold': ['hold'],
    'transition': ['transition', 'b-roll'],
    'b-roll': ['b-roll'],
    'talking-head': ['talking-head'],
    'cooldown': ['cooldown'],
    'setup': ['setup'],
  };
  const result = new Set<string>();
  for (const ct of seg.clip_requirements.content_type) {
    const mapped = typeMap[ct.toLowerCase()];
    if (mapped) for (const t of mapped) result.add(t);
  }
  if (result.size === 0) {
    result.add('exercise');
    result.add('hold');
    result.add('b-roll');
  }
  return [...result];
}

// ── Brief generation (with cache) ──

async function getBrief(
  seed: { videoType: string; ideaSeed: string },
  brandConfig: BrandConfig,
): Promise<{ brief: Phase3CreativeBrief; fromCache: boolean; cdStats: typeof lastGenerationStats }> {
  const fp = fixturePath(seed.videoType);

  if (existsSync(fp)) {
    console.log(`[smoke] Cache HIT for ${seed.videoType}: ${fp}`);
    const brief = JSON.parse(readFileSync(fp, 'utf-8')) as Phase3CreativeBrief;
    return {
      brief,
      fromCache: true,
      cdStats: { firstAttemptOk: true, correctiveAttempted: false, inputTokens: 0, outputTokens: 0 },
    };
  }

  console.log(`[smoke] Cache MISS for ${seed.videoType}, calling Phase 3 CD...`);
  const brief = await generateBriefPhase3({ ideaSeed: seed.ideaSeed, brandConfig });
  const cdStats = { ...lastGenerationStats };

  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(fp, JSON.stringify(brief, null, 2));
  console.log(`[smoke] Cached brief to ${fp}`);

  return { brief, fromCache: false, cdStats };
}

// ── Build CuratorV2Brief via Phase 3 path (mirrors dispatcher) ──

function buildV2Brief(brief: Phase3CreativeBrief): CuratorV2Brief {
  const isPhase3 = 'creative_direction' in brief;
  if (!isPhase3) {
    throw new Error('Expected Phase 3 brief but creative_direction missing — discriminator failed');
  }

  return {
    brandId: brief.brand_id,
    creative_vision: brief.creative_direction.creative_vision,
    slots: brief.segments.map((seg, i): BriefSlot => ({
      index: i,
      description: buildSlotDescription(seg),
      valid_segment_types: mapContentTypesToSegmentTypes(seg),
      min_quality: seg.clip_requirements.min_quality ?? 5,
      aesthetic_guidance: seg.clip_requirements.aesthetic_guidance,
    })),
  };
}

// ── Main ──

interface VideoTypeReport {
  videoType: string;
  slotCount: number;
  uniqueParents: number;
  uniqueSegmentTypes: number;
  cdFromCache: boolean;
  cdCorrective: boolean;
  cdTokensIn: number;
  cdTokensOut: number;
  curatorWallMs: number;
  slots: SlotReport[];
  visionOverlapRatio: string;
  flaggedSlots: number[];
}

interface SlotReport {
  index: number;
  description: string;
  aestheticGuidance: string;
  pickedSegmentId: string;
  pickedSegmentType: string;
  pickedQuality: number;
  pickedDescription: string;
  reasoning: string;
  score: number;
  candidateCount: number;
  aestheticOverlap: number;
  aestheticOverlapWords: string[];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ABORT: ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('ABORT: GEMINI_API_KEY not set.');
    process.exit(1);
  }

  console.log(`Phase 3 W2 curator smoke test — ${SEEDS.length} video types, brand=${BRAND_ID}`);
  console.log(`Fixture cache: ${FIXTURE_DIR}`);
  console.log('');

  const brandConfig = await fetchBrand(BRAND_ID);
  const reports: VideoTypeReport[] = [];
  const overallStart = Date.now();

  for (const seed of SEEDS) {
    const bar = '='.repeat(80);
    console.log('');
    console.log(bar);
    console.log(`VIDEO TYPE: ${seed.videoType}`);
    console.log(`IDEA SEED: "${seed.ideaSeed}"`);
    console.log(bar);

    // 1. Get or generate brief
    const { brief, fromCache, cdStats } = await getBrief(seed, brandConfig);

    console.log(`  video_type from CD: ${brief.video_type}`);
    console.log(`  slot_count: ${brief.creative_direction.slot_count}`);
    console.log(`  color_treatment: ${brief.creative_direction.color_treatment}`);
    console.log(`  CD cache: ${fromCache ? 'HIT' : 'MISS'}`);
    if (!fromCache) {
      console.log(`  CD first_attempt_ok: ${cdStats.firstAttemptOk}`);
      console.log(`  CD corrective: ${cdStats.correctiveAttempted}`);
      console.log(`  CD tokens: in=${cdStats.inputTokens}, out=${cdStats.outputTokens}`);
    }
    console.log('');

    console.log('CREATIVE VISION:');
    console.log(`  ${brief.creative_direction.creative_vision}`);
    console.log('');

    // Warn on empty/trivial aesthetic_guidance
    brief.segments.forEach((seg, i) => {
      const ag = seg.clip_requirements.aesthetic_guidance;
      if (!ag || ag.trim().length < 10) {
        console.warn(`  WARNING: Slot ${i} has trivial aesthetic_guidance: "${ag ?? '(empty)'}"`);
      }
    });

    // 2. Build CuratorV2Brief via Phase 3 path
    const v2Brief = buildV2Brief(brief);

    // Verify the assembly
    console.log('CURATOR V2 BRIEF ASSEMBLY:');
    console.log(`  creative_vision present: ${!!v2Brief.creative_vision}`);
    console.log(`  slots: ${v2Brief.slots.length}`);
    v2Brief.slots.forEach((s) => {
      console.log(`  slot ${s.index}: aesthetic_guidance=${s.aesthetic_guidance ? 'YES (' + s.aesthetic_guidance.length + ' chars)' : 'MISSING'}`);
    });
    console.log('');

    // 3. Run curator
    console.log('CALLING CURATOR V2...');
    const curatorStart = Date.now();
    const results = await curateWithV2(v2Brief);
    const curatorWallMs = Date.now() - curatorStart;
    console.log(`  Curator wall time: ${(curatorWallMs / 1000).toFixed(1)}s`);
    console.log('');

    // 4. Build slot reports
    const visionTokens = tokenize(brief.creative_direction.creative_vision);
    const slotReports: SlotReport[] = [];
    let visionOverlapCount = 0;

    console.log('SLOT RESULTS:');
    for (let i = 0; i < v2Brief.slots.length; i++) {
      const slot = v2Brief.slots[i];
      const result = results.find((r) => r.slotIndex === i);
      if (!result) {
        console.log(`  Slot ${i}: NO RESULT`);
        continue;
      }

      const aestheticTokens = tokenize(slot.aesthetic_guidance ?? '');
      const reasoningTokens = tokenize(result.reasoning);
      const aOverlap = intersection(aestheticTokens, reasoningTokens);

      const vOverlap = intersection(visionTokens, reasoningTokens);
      if (vOverlap.length > 0) visionOverlapCount++;

      const sr: SlotReport = {
        index: i,
        description: slot.description,
        aestheticGuidance: slot.aesthetic_guidance ?? '(none)',
        pickedSegmentId: result.segmentId,
        pickedSegmentType: '', // filled below
        pickedQuality: result.score,
        pickedDescription: '', // filled below
        reasoning: result.reasoning,
        score: result.score,
        candidateCount: result.candidateCount,
        aestheticOverlap: aOverlap.length,
        aestheticOverlapWords: aOverlap,
      };
      slotReports.push(sr);

      const divider = '-'.repeat(60);
      console.log(`  ${divider}`);
      console.log(`  SLOT ${i}`);
      console.log(`    description: ${truncate(slot.description)}`);
      console.log(`    aesthetic_guidance: ${slot.aesthetic_guidance ?? '(none)'}`);
      console.log(`    candidates: ${result.candidateCount}`);
      console.log(`    PICKED: segment=${result.segmentId}`);
      console.log(`    parent: ${result.parentR2Key}`);
      console.log(`    trim: ${result.trimStartS.toFixed(1)}s – ${result.trimEndS.toFixed(1)}s`);
      console.log(`    PRO SCORE: ${result.score}/10`);
      console.log(`    PRO REASONING: ${result.reasoning}`);
      console.log(`    aesthetic overlap: ${aOverlap.length} words [${aOverlap.join(', ')}]`);
      console.log(`    vision overlap: ${vOverlap.length} words [${vOverlap.join(', ')}]`);

      if (aOverlap.length === 0 && (slot.aesthetic_guidance ?? '').length > 10) {
        console.log(`    ** FLAG: zero aesthetic overlap with non-trivial guidance — operator should review **`);
      }
    }

    // 5. Summary block
    const uniqueParents = new Set(results.filter((r) => r.parentR2Key).map((r) => r.parentR2Key)).size;
    const uniqueTypes = new Set(slotReports.map((s) => s.pickedSegmentType)).size;
    const flagged = slotReports
      .filter((s) => s.aestheticOverlap === 0 && s.aestheticGuidance.length > 10 && s.aestheticGuidance !== '(none)')
      .map((s) => s.index);

    const visionRatio = `${visionOverlapCount}/${v2Brief.slots.length}`;

    console.log('');
    console.log(`SUMMARY for ${seed.videoType}:`);
    console.log(`  Total slots: ${v2Brief.slots.length}`);
    console.log(`  Unique parent clips: ${uniqueParents}`);
    console.log(`  Vision overlap ratio: ${visionRatio} slots reference vision terms`);
    console.log(`  Flagged (0 aesthetic overlap): ${flagged.length > 0 ? flagged.join(', ') : 'none'}`);
    console.log(`  Curator wall time: ${(curatorWallMs / 1000).toFixed(1)}s`);

    reports.push({
      videoType: seed.videoType,
      slotCount: v2Brief.slots.length,
      uniqueParents,
      uniqueSegmentTypes: uniqueTypes,
      cdFromCache: fromCache,
      cdCorrective: cdStats.correctiveAttempted,
      cdTokensIn: cdStats.inputTokens,
      cdTokensOut: cdStats.outputTokens,
      curatorWallMs,
      slots: slotReports,
      visionOverlapRatio: visionRatio,
      flaggedSlots: flagged,
    });
  }

  // ── Grand summary ──
  const totalWallMs = Date.now() - overallStart;
  const bar = '='.repeat(80);
  console.log('');
  console.log(bar);
  console.log('GRAND SUMMARY');
  console.log(bar);

  for (const r of reports) {
    console.log(`  ${r.videoType}: ${r.slotCount} slots, ${r.uniqueParents} unique parents, vision=${r.visionOverlapRatio}, flagged=[${r.flaggedSlots.join(',')}], curator=${(r.curatorWallMs / 1000).toFixed(1)}s`);
  }

  const totalCdTokensIn = reports.reduce((s, r) => s + r.cdTokensIn, 0);
  const totalCdTokensOut = reports.reduce((s, r) => s + r.cdTokensOut, 0);
  const cdCost = (totalCdTokensIn / 1_000_000) * 3 + (totalCdTokensOut / 1_000_000) * 15;

  console.log('');
  console.log(`  CD tokens (non-cached): in=${totalCdTokensIn}, out=${totalCdTokensOut} (~$${cdCost.toFixed(4)})`);
  console.log(`  Total wall time: ${(totalWallMs / 1000).toFixed(1)}s`);
  console.log(bar);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
