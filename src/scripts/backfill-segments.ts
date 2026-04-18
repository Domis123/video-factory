import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile, deleteFile } from '../lib/r2-storage.js';
import { analyzeClipSegments } from '../lib/gemini-segments.js';
import { processSegmentsForAsset } from '../lib/segment-processor.js';

const COST_PER_MINUTE = 0.12; // Gemini Pro approximate $/min
const BACKFILL_DIR = '/tmp/video-factory/backfill';

// ── CLI args ──

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const reprocessMode = hasFlag('reprocess');
const dryRun = hasFlag('dry-run');
const brandFilter = getArg('brand');

if (reprocessMode && !brandFilter) {
  console.error('Error: --reprocess requires --brand <brand_id>');
  console.error('Usage: npm run backfill:segments -- --reprocess --brand nordpilates [--dry-run]');
  process.exit(1);
}

interface BackfillAsset {
  id: string;
  brand_id: string;
  r2_key: string;
  pre_normalized_r2_key: string | null;
  duration_seconds: number | null;
  filename: string | null;
}

interface OldSegmentRow {
  id: string;
  keyframe_r2_key: string | null;
  clip_r2_key: string | null;
}

// ── 1. Query assets ──

const modeLabel = reprocessMode
  ? `Reprocess (re-segment ALL assets for "${brandFilter}"${dryRun ? ', DRY RUN' : ''})`
  : 'Backfill (unprocessed assets only)';

console.log(`\n🔄 Backfill: asset_segments — ${modeLabel}\n`);

let query = supabaseAdmin
  .from('assets')
  .select('id, brand_id, r2_key, pre_normalized_r2_key, duration_seconds, filename')
  .order('created_at', { ascending: true });

if (brandFilter) {
  query = query.eq('brand_id', brandFilter);
}

const { data: allAssets, error: allErr } = await query;

if (allErr || !allAssets) {
  console.error('Failed to fetch assets:', allErr?.message);
  process.exit(1);
}

let toProcess: BackfillAsset[];

if (reprocessMode) {
  // Reprocess: target ALL assets for the brand
  toProcess = allAssets as BackfillAsset[];
} else {
  // Original behavior: only assets without segments
  const { data: processedIds, error: segErr } = await supabaseAdmin
    .from('asset_segments')
    .select('parent_asset_id');

  if (segErr) {
    console.error('Failed to fetch existing segments:', segErr.message);
    process.exit(1);
  }

  const processedSet = new Set((processedIds ?? []).map((r) => r.parent_asset_id));
  toProcess = (allAssets as BackfillAsset[]).filter((a) => !processedSet.has(a.id));
}

if (toProcess.length === 0) {
  console.log(reprocessMode
    ? `No assets found for brand "${brandFilter}". Nothing to reprocess.`
    : 'All assets already have segments. Nothing to backfill.');
  process.exit(0);
}

// ── 2. Cost preview + confirmation ──

const totalMinutes = toProcess.reduce((sum, a) => sum + ((a.duration_seconds ?? 0) / 60), 0);
const estimatedCost = totalMinutes * COST_PER_MINUTE;

console.log(`Found ${toProcess.length} assets to ${reprocessMode ? 'reprocess' : 'process'}${brandFilter ? ` for brand "${brandFilter}"` : ''}`);
console.log(`Total: ${totalMinutes.toFixed(1)} minutes of video`);
console.log(`Estimated cost: $${estimatedCost.toFixed(2)} at Gemini Pro pricing (~$${COST_PER_MINUTE}/min)`);
if (dryRun) console.log('🏜️  DRY RUN — no changes will be made');
console.log('');

if (!dryRun) {
  const requiredConfirm = estimatedCost > 10 ? 'yes' : 'y';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Proceed? (${requiredConfirm === 'yes' ? 'yes/N' : 'y/N'}): `, resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== requiredConfirm) {
    console.log('Aborted by operator.');
    process.exit(0);
  }
}

// ── 3. Process serially ──

const startTime = Date.now();
let succeeded = 0;
let failedCount = 0;
let totalSegments = 0;
let totalDeleted = 0;

for (let idx = 0; idx < toProcess.length; idx++) {
  const asset = toProcess[idx];
  const localPath = `${BACKFILL_DIR}/${asset.id}.mp4`;

  try {
    const duration = asset.duration_seconds ?? 0;
    if (duration <= 0) {
      console.warn(`[backfill] (${idx + 1}/${toProcess.length}) asset=${asset.id} — skipping (no duration)`);
      failedCount++;
      continue;
    }

    // ── Reprocess: delete old segments + R2 files ──
    if (reprocessMode) {
      const { data: oldSegs, error: oldErr } = await supabaseAdmin
        .from('asset_segments')
        .select('id, keyframe_r2_key, clip_r2_key')
        .eq('parent_asset_id', asset.id);

      if (oldErr) {
        console.error(`[backfill] (${idx + 1}/${toProcess.length}) Failed to fetch old segments for ${asset.id}: ${oldErr.message}`);
        failedCount++;
        continue;
      }

      const oldSegments = (oldSegs ?? []) as OldSegmentRow[];

      if (oldSegments.length > 0) {
        if (dryRun) {
          // Dry run: show what would be deleted
          const r2Keys: string[] = [];
          for (const seg of oldSegments) {
            if (seg.keyframe_r2_key) r2Keys.push(seg.keyframe_r2_key);
            if (seg.clip_r2_key) r2Keys.push(seg.clip_r2_key);
          }
          console.log(`[backfill] (${idx + 1}/${toProcess.length}) DRY RUN: asset=${asset.id} (${asset.filename ?? 'no name'})`);
          console.log(`           Would delete ${oldSegments.length} segments + ${r2Keys.length} R2 files`);
          for (const key of r2Keys) {
            console.log(`           - ${key}`);
          }
          succeeded++;
          continue;
        }

        // Delete R2 files (best-effort — orphaned files are acceptable)
        for (const seg of oldSegments) {
          if (seg.keyframe_r2_key) {
            try {
              await deleteFile(seg.keyframe_r2_key);
            } catch (err) {
              console.warn(`[backfill] Warning: failed to delete keyframe ${seg.keyframe_r2_key}: ${(err as Error).message}`);
            }
          }
          if (seg.clip_r2_key) {
            try {
              await deleteFile(seg.clip_r2_key);
            } catch (err) {
              console.warn(`[backfill] Warning: failed to delete clip ${seg.clip_r2_key}: ${(err as Error).message}`);
            }
          }
        }

        // Delete DB rows
        const { error: delErr } = await supabaseAdmin
          .from('asset_segments')
          .delete()
          .eq('parent_asset_id', asset.id);

        if (delErr) {
          console.error(`[backfill] (${idx + 1}/${toProcess.length}) Failed to delete old segments for ${asset.id}: ${delErr.message}`);
          failedCount++;
          continue;
        }

        totalDeleted += oldSegments.length;
        console.log(`[backfill] Deleted ${oldSegments.length} old segments + R2 files for asset ${asset.id}`);
      }
    }

    if (dryRun) {
      // In non-reprocess dry-run mode (shouldn't happen, but guard)
      succeeded++;
      continue;
    }

    // ── Download source from R2 (prefer normalized parent) ──
    const r2Key = asset.pre_normalized_r2_key ?? asset.r2_key;
    console.log(`[backfill] (${idx + 1}/${toProcess.length}) Downloading ${r2Key}...`);
    await downloadToFile(r2Key, localPath);

    // ── Fetch brand context ──
    const { data: brand } = await supabaseAdmin
      .from('brand_configs')
      .select('voice_guidelines, allowed_video_types')
      .eq('brand_id', asset.brand_id)
      .single();

    const brandContext = brand
      ? `Brand: ${asset.brand_id}. ${brand.voice_guidelines ?? ''} Video types: ${(brand.allowed_video_types ?? []).join(', ')}.`
      : `Brand: ${asset.brand_id}. UGC content.`;

    // ── Analyze segments ──
    const segments = await analyzeClipSegments(localPath, duration, brandContext);

    // ── Process segments (keyframe + embed + R2 + insert) ──
    const inserted = await processSegmentsForAsset(asset.id, asset.brand_id, localPath, segments);
    totalSegments += inserted;
    succeeded++;

    console.log(`[backfill] (${idx + 1}/${toProcess.length}) asset=${asset.id} → ${inserted} segments created`);
  } catch (err) {
    console.error(`[backfill] (${idx + 1}/${toProcess.length}) FAILED asset=${asset.id}:`, err);
    failedCount++;
  } finally {
    // Clean up temp file
    await unlink(localPath).catch(() => {});
  }

  // Progress log every 10 assets
  if ((idx + 1) % 10 === 0) {
    const pct = (((idx + 1) / toProcess.length) * 100).toFixed(1);
    console.log(`[backfill] Progress: ${idx + 1}/${toProcess.length} assets (${pct}%), ${totalSegments} segments inserted`);
  }

  // Rate limit: 2s between assets
  if (idx < toProcess.length - 1) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ── 4. Summary ──

const elapsed = Date.now() - startTime;
const minutes = Math.floor(elapsed / 60000);
const seconds = Math.floor((elapsed % 60000) / 1000);

console.log('\n========== Backfill Summary ==========');
console.log(`Mode:        ${modeLabel}`);
console.log(`Processed:   ${succeeded + failedCount} / ${toProcess.length} assets`);
console.log(`Succeeded:   ${succeeded} (${totalSegments} segments total)`);
if (reprocessMode) {
  console.log(`Deleted:     ${totalDeleted} old segments`);
}
console.log(`Failed:      ${failedCount}`);
console.log(`Est. cost:   $${estimatedCost.toFixed(2)}`);
console.log(`Duration:    ${minutes}m ${seconds}s`);
console.log('======================================\n');

process.exit(failedCount > 0 && succeeded === 0 ? 1 : 0);
