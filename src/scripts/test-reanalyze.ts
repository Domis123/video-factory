/**
 * Re-analyze assets with the updated segment-analyzer prompt and compare
 * old vs new segments side-by-side. READ-ONLY — does NOT write to DB.
 *
 * Usage:
 *   npx tsx src/scripts/test-reanalyze.ts --brand nordpilates --limit 3
 *   npx tsx src/scripts/test-reanalyze.ts --asset-id <uuid>
 *
 * Prompt loading: gemini-segments.ts reads the .md file via readFileSync
 * at module load time. Since tsx transpiles on-the-fly and the path
 * resolves to the source .md, changes to segment-analyzer.md are picked
 * up immediately — no `npm run build` needed.
 */

import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { analyzeClipSegments, type SegmentAnalysis } from '../lib/gemini-segments.js';

// ── Parse CLI args ──

function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

const brandId = getArg('brand', 'nordpilates');
const limit = parseInt(getArg('limit', '3'), 10);
const assetIdFilter = getArg('asset-id', '');

const WORK_DIR = '/tmp/video-factory/reanalyze';

// ── Types ──

interface AssetRow {
  id: string;
  brand_id: string;
  r2_key: string;
  pre_normalized_r2_key: string | null;
  duration_seconds: number | null;
  filename: string | null;
}

interface SegmentRow {
  id: string;
  parent_asset_id: string;
  segment_type: string;
  description: string;
  visual_tags: string[];
  start_s: number;
  end_s: number;
  quality_score: number;
  has_speech: boolean;
  motion_intensity: number;
}

// ── Helpers ──

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function avgExerciseDuration(segments: { segment_type: string; start_s: number; end_s: number }[]): number {
  const exercises = segments.filter((s) => s.segment_type === 'exercise');
  if (exercises.length === 0) return 0;
  const total = exercises.reduce((sum, s) => sum + (s.end_s - s.start_s), 0);
  return total / exercises.length;
}

function countExerciseNames(segments: { description: string; segment_type: string }[]): number {
  const exerciseKeywords = [
    'cat-cow', 'glute bridge', 'dead bug', 'bird-dog', 'plank',
    'leg lift', 'crunch', 'bicycle', 'v-up', 'side-lying',
    'wall slide', 'wall angel', 'thread the needle', 'shoulder tap',
    'hollow hold', 'roll-up', 'teaser', 'hundred', 'swimming',
    'side bend', 'lunge', 'squat', 'push-up', 'pike',
  ];
  let count = 0;
  for (const s of segments) {
    if (s.segment_type !== 'exercise' && s.segment_type !== 'hold') continue;
    const desc = s.description.toLowerCase();
    if (exerciseKeywords.some((kw) => desc.includes(kw))) count++;
  }
  return count;
}

function countSubjectAppearance(segments: { description: string }[]): number {
  const appearanceSignals = [
    /\b(brunette|blonde|black-?hair|red-?hair|brown-?hair)\b/i,
    /\b(wearing|dressed in|sports bra|leggings|activewear|tank top|outfit)\b/i,
    /\b(ponytail|bun|braids|loose hair)\b/i,
  ];
  let count = 0;
  for (const s of segments) {
    if (appearanceSignals.some((re) => re.test(s.description))) count++;
  }
  return count;
}

// ── Main ──

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('  Segment Analyzer Re-analysis — Side-by-Side Comparison');
console.log('  Prompt loaded from source .md at import time (no build needed)');
console.log('═══════════════════════════════════════════════════════════════════════\n');

// 1. Find assets with existing segments
let query = supabaseAdmin
  .from('assets')
  .select('id, brand_id, r2_key, pre_normalized_r2_key, duration_seconds, filename');

if (assetIdFilter) {
  query = query.eq('id', assetIdFilter);
} else {
  query = query.eq('brand_id', brandId);
}

query = query.order('created_at', { ascending: true });

const { data: assets, error: assetErr } = await query;
if (assetErr || !assets) {
  console.error('Failed to fetch assets:', assetErr?.message);
  process.exit(1);
}

// Filter to only assets that have segments
const { data: segParents, error: segParentErr } = await supabaseAdmin
  .from('asset_segments')
  .select('parent_asset_id');

if (segParentErr) {
  console.error('Failed to fetch segment parents:', segParentErr.message);
  process.exit(1);
}

const parentsWithSegments = new Set((segParents ?? []).map((r) => r.parent_asset_id));
const candidates = (assets as AssetRow[]).filter((a) => parentsWithSegments.has(a.id));

if (candidates.length === 0) {
  console.log('No assets found with existing segments. Nothing to compare.');
  process.exit(0);
}

const selected = candidates.slice(0, limit);
console.log(`Found ${candidates.length} assets with segments. Testing ${selected.length}.\n`);

// 2. Process each asset
for (const asset of selected) {
  const duration = asset.duration_seconds ?? 0;
  if (duration <= 0) {
    console.log(`Skipping ${asset.filename ?? asset.id}: no duration\n`);
    continue;
  }

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`Asset: ${asset.filename ?? '(no filename)'} (${asset.id})`);
  console.log(`Duration: ${duration.toFixed(1)}s`);

  // 2a. Fetch old segments
  const { data: oldSegRows, error: oldErr } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, segment_type, description, visual_tags, start_s, end_s, quality_score, has_speech, motion_intensity')
    .eq('parent_asset_id', asset.id)
    .order('start_s', { ascending: true });

  if (oldErr || !oldSegRows) {
    console.error(`  Failed to fetch old segments: ${oldErr?.message}`);
    continue;
  }

  const oldSegs = oldSegRows as SegmentRow[];

  // 2b. Download video from R2
  const r2Key = asset.pre_normalized_r2_key ?? asset.r2_key;
  const localPath = join(WORK_DIR, `${asset.id}.mp4`);

  console.log(`Downloading: ${r2Key}`);
  try {
    await downloadToFile(r2Key, localPath);
  } catch (dlErr) {
    console.error(`  Download failed: ${(dlErr as Error).message}`);
    continue;
  }

  // 2c. Run new analysis
  let newSegs: SegmentAnalysis[];
  try {
    const brandContext = `Brand: ${asset.brand_id}. UGC content.`;
    console.log('Analyzing with updated prompt...');
    newSegs = await analyzeClipSegments(localPath, duration, brandContext);
  } catch (analyzeErr) {
    console.error(`  Analysis failed: ${(analyzeErr as Error).message}`);
    await unlink(localPath).catch(() => {});
    continue;
  }

  // 2d. Clean up downloaded file
  await unlink(localPath).catch(() => {});

  // 2e. Print comparison
  console.log(`OLD: ${oldSegs.length} segments | NEW: ${newSegs.length} segments`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Old segments
  console.log('── OLD SEGMENTS ──');
  for (let i = 0; i < oldSegs.length; i++) {
    const s = oldSegs[i];
    const dur = (s.end_s - s.start_s).toFixed(1);
    console.log(`  [${i}] ${pad(s.segment_type, 12)} ${s.start_s.toFixed(1).padStart(6)}s - ${s.end_s.toFixed(1).padStart(6)}s (${dur.padStart(5)}s) q=${s.quality_score}`);
    console.log(`      "${s.description}"`);
    console.log(`      tags: [${(s.visual_tags ?? []).map((t) => `"${t}"`).join(', ')}]`);
  }

  // New segments
  console.log('\n── NEW SEGMENTS ──');
  for (let i = 0; i < newSegs.length; i++) {
    const s = newSegs[i];
    const dur = (s.end_s - s.start_s).toFixed(1);
    console.log(`  [${i}] ${pad(s.segment_type, 12)} ${s.start_s.toFixed(1).padStart(6)}s - ${s.end_s.toFixed(1).padStart(6)}s (${dur.padStart(5)}s) q=${s.quality_score}`);
    console.log(`      "${s.description}"`);
    console.log(`      tags: [${s.visual_tags.map((t) => `"${t}"`).join(', ')}]`);
  }

  // Summary
  const oldAvg = avgExerciseDuration(oldSegs);
  const newAvg = avgExerciseDuration(newSegs);
  const oldNames = countExerciseNames(oldSegs);
  const newNames = countExerciseNames(newSegs);
  const oldAppear = countSubjectAppearance(oldSegs);
  const newAppear = countSubjectAppearance(newSegs);
  const segDelta = newSegs.length - oldSegs.length;
  const segDeltaStr = segDelta >= 0 ? `+${segDelta}` : `${segDelta}`;

  console.log('\n── SUMMARY ──');
  console.log(`  Segment count: ${oldSegs.length} → ${newSegs.length} (${segDeltaStr})`);
  console.log(`  Avg exercise duration: ${oldAvg.toFixed(1)}s → ${newAvg.toFixed(1)}s`);
  console.log(`  Exercise names found: ${oldNames} → ${newNames}`);
  console.log(`  Subject appearance mentioned: ${oldAppear}/${oldSegs.length} → ${newAppear}/${newSegs.length}`);
  console.log('');
}

console.log('Done. No database writes were made.');
