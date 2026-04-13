import { createInterface } from 'node:readline';
import { mkdir, unlink, readFile, stat } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile, uploadFile } from '../lib/r2-storage.js';
import { exec } from '../lib/exec.js';

const WORK_DIR = '/tmp/video-factory/clip-backfill';

interface SegmentRow {
  id: string;
  parent_asset_id: string;
  brand_id: string;
  start_s: number;
  end_s: number;
}

// ── 1. Query segments without clip_r2_key ──

console.log('\n🔄 Backfill: pre-trimmed clips for existing asset_segments\n');

const { data: segments, error: segErr } = await supabaseAdmin
  .from('asset_segments')
  .select('id, parent_asset_id, brand_id, start_s, end_s')
  .is('clip_r2_key', null)
  .order('parent_asset_id', { ascending: true }); // group by parent for cache efficiency

if (segErr || !segments) {
  console.error('Failed to fetch segments:', segErr?.message);
  process.exit(1);
}

if (segments.length === 0) {
  console.log('All segments already have clip_r2_key. Nothing to backfill.');
  process.exit(0);
}

// ── 2. Confirmation ──

console.log(`Found ${segments.length} segments to process`);
console.log(`Estimated time: ~10-20 minutes (serial ffmpeg + R2 upload)`);
console.log(`Estimated storage: ~${(segments.length * 4).toFixed(0)} MB in R2`);
console.log('');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) => {
  rl.question('Proceed? (y/N): ', resolve);
});
rl.close();

if (answer.trim().toLowerCase() !== 'y') {
  console.log('Aborted by operator.');
  process.exit(0);
}

// ── 3. Resolve parent r2_keys ──

const parentIds = [...new Set(segments.map((s) => s.parent_asset_id))];
const { data: parents, error: parentErr } = await supabaseAdmin
  .from('assets')
  .select('id, r2_key')
  .in('id', parentIds);

if (parentErr || !parents) {
  console.error('Failed to fetch parent assets:', parentErr?.message);
  process.exit(1);
}

const parentR2Map = new Map<string, string>();
for (const p of parents) {
  parentR2Map.set(p.id, p.r2_key);
}

// ── 4. Process serially with parent caching ──

const startTime = Date.now();
let succeeded = 0;
let failedCount = 0;
let totalBytes = 0;
const parentCache = new Map<string, string>(); // r2_key → local path

await mkdir(WORK_DIR, { recursive: true });

try {
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx] as SegmentRow;
    const parentR2Key = parentR2Map.get(seg.parent_asset_id);

    if (!parentR2Key) {
      console.warn(`[clip-backfill] (${idx + 1}/${segments.length}) segment=${seg.id} — skipping (orphaned parent)`);
      failedCount++;
      continue;
    }

    const clipPath = `${WORK_DIR}/${seg.id}.mp4`;

    try {
      // Download parent if not cached
      let parentPath: string;
      if (parentCache.has(parentR2Key)) {
        parentPath = parentCache.get(parentR2Key)!;
      } else {
        parentPath = `${WORK_DIR}/_parent_${seg.parent_asset_id}.mp4`;
        console.log(`[clip-backfill] Downloading parent: ${parentR2Key}`);
        await downloadToFile(parentR2Key, parentPath);
        parentCache.set(parentR2Key, parentPath);
      }

      // Trim to 720p
      const duration = Number(seg.end_s) - Number(seg.start_s);
      const result = await exec({
        command: 'ffmpeg',
        args: [
          '-y', '-ss', String(seg.start_s), '-i', parentPath,
          '-t', String(duration),
          '-vf', 'scale=-2:720',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          '-c:a', 'aac', '-b:a', '96k',
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
          clipPath,
        ],
      });

      if (result.exitCode !== 0) {
        throw new Error(`ffmpeg exit ${result.exitCode}: ${result.stderr.slice(0, 200)}`);
      }

      // Upload to R2
      const clipR2Key = `segments/${seg.brand_id}/${seg.id}.mp4`;
      const clipBuffer = await readFile(clipPath);
      await uploadFile(clipR2Key, clipBuffer, 'video/mp4');

      const clipStat = await stat(clipPath);
      totalBytes += clipStat.size;

      // Update DB
      const { error: updateErr } = await supabaseAdmin
        .from('asset_segments')
        .update({ clip_r2_key: clipR2Key })
        .eq('id', seg.id);

      if (updateErr) {
        throw new Error(`DB update failed: ${updateErr.message}`);
      }

      succeeded++;
      console.log(
        `[clip-backfill] (${idx + 1}/${segments.length}) segment=${seg.id} → ${clipR2Key} (${(clipStat.size / 1024 / 1024).toFixed(1)} MB)`,
      );
    } catch (err) {
      console.error(`[clip-backfill] (${idx + 1}/${segments.length}) FAILED segment=${seg.id}:`, (err as Error).message);
      failedCount++;
    } finally {
      await unlink(clipPath).catch(() => {});
    }
  }
} finally {
  // Cleanup parent cache
  for (const [, localPath] of parentCache) {
    await unlink(localPath).catch(() => {});
  }
  parentCache.clear();
}

// ── 5. Summary ──

const elapsed = Date.now() - startTime;
const minutes = Math.floor(elapsed / 60000);
const seconds = Math.floor((elapsed % 60000) / 1000);

console.log('\n========== Clip Backfill Summary ==========');
console.log(`Processed:   ${succeeded + failedCount} / ${segments.length} segments`);
console.log(`Succeeded:   ${succeeded}`);
console.log(`Failed:      ${failedCount}`);
console.log(`R2 storage:  ${(totalBytes / 1024 / 1024).toFixed(1)} MB added`);
console.log(`Duration:    ${minutes}m ${seconds}s`);
console.log('============================================\n');

process.exit(failedCount > 0 && succeeded === 0 ? 1 : 0);
