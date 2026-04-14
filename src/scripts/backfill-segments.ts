import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { analyzeClipSegments } from '../lib/gemini-segments.js';
import { processSegmentsForAsset } from '../lib/segment-processor.js';

const COST_PER_MINUTE = 0.12; // Gemini Pro approximate $/min
const BACKFILL_DIR = '/tmp/video-factory/backfill';

interface BackfillAsset {
  id: string;
  brand_id: string;
  r2_key: string;
  duration_seconds: number | null;
  filename: string | null;
}

// ── 1. Query un-processed assets ──
// supabase-js doesn't support NOT EXISTS directly, so fetch all assets
// and subtract those that already have segments.

console.log('\n🔄 Backfill: asset_segments for existing assets\n');

const { data: allAssets, error: allErr } = await supabaseAdmin
  .from('assets')
  .select('id, brand_id, r2_key, duration_seconds, filename')
  .order('created_at', { ascending: true });

if (allErr || !allAssets) {
  console.error('Failed to fetch assets:', allErr?.message);
  process.exit(1);
}

const { data: processedIds, error: segErr } = await supabaseAdmin
  .from('asset_segments')
  .select('parent_asset_id');

if (segErr) {
  console.error('Failed to fetch existing segments:', segErr.message);
  process.exit(1);
}

const processedSet = new Set((processedIds ?? []).map((r) => r.parent_asset_id));
const toProcess: BackfillAsset[] = allAssets.filter((a) => !processedSet.has(a.id));

if (toProcess.length === 0) {
  console.log('All assets already have segments. Nothing to backfill.');
  process.exit(0);
}

// ── 2. Cost preview + confirmation ──

const totalMinutes = toProcess.reduce((sum, a) => sum + ((a.duration_seconds ?? 0) / 60), 0);
const estimatedCost = totalMinutes * COST_PER_MINUTE;

console.log(`Found ${toProcess.length} assets to process`);
console.log(`Total: ${totalMinutes.toFixed(1)} minutes of video`);
console.log(`Estimated cost: $${estimatedCost.toFixed(2)} at Gemini Pro pricing (~$${COST_PER_MINUTE}/min)`);
console.log('');

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

// ── 3. Process serially ──

const startTime = Date.now();
let succeeded = 0;
let failedCount = 0;
let totalSegments = 0;

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

    // a. Download source from R2
    console.log(`[backfill] (${idx + 1}/${toProcess.length}) Downloading ${asset.r2_key}...`);
    await downloadToFile(asset.r2_key, localPath);

    // b. Fetch brand context
    const { data: brand } = await supabaseAdmin
      .from('brand_configs')
      .select('voice_guidelines, allowed_video_types')
      .eq('brand_id', asset.brand_id)
      .single();

    const brandContext = brand
      ? `Brand: ${asset.brand_id}. ${brand.voice_guidelines ?? ''} Video types: ${(brand.allowed_video_types ?? []).join(', ')}.`
      : `Brand: ${asset.brand_id}. UGC content.`;

    // c. Analyze segments
    const segments = await analyzeClipSegments(localPath, duration, brandContext);

    // d. Process segments (keyframe + embed + R2 + insert)
    const inserted = await processSegmentsForAsset(asset.id, asset.brand_id, localPath, segments);
    totalSegments += inserted;
    succeeded++;

    console.log(`[backfill] (${idx + 1}/${toProcess.length}) asset=${asset.id} → ${inserted} segments created`);
  } catch (err) {
    console.error(`[backfill] (${idx + 1}/${toProcess.length}) FAILED asset=${asset.id}:`, err);
    failedCount++;
  } finally {
    // e. Clean up temp file
    await unlink(localPath).catch(() => {});
  }

  // f. Sleep 2s between clips (Gemini rate limits)
  if (idx < toProcess.length - 1) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ── 4. Summary ──

const elapsed = Date.now() - startTime;
const minutes = Math.floor(elapsed / 60000);
const seconds = Math.floor((elapsed % 60000) / 1000);

console.log('\n========== Backfill Summary ==========');
console.log(`Processed:   ${succeeded + failedCount} / ${toProcess.length} assets`);
console.log(`Succeeded:   ${succeeded} (${totalSegments} segments total)`);
console.log(`Failed:      ${failedCount}`);
console.log(`Est. cost:   $${estimatedCost.toFixed(2)}`);
console.log(`Duration:    ${minutes}m ${seconds}s`);
console.log('======================================\n');

process.exit(failedCount > 0 && succeeded === 0 ? 1 : 0);
