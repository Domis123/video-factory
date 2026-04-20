import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, readFile as readTextFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile, uploadFile, deleteFile } from '../lib/r2-storage.js';
import { extractKeyframe } from '../lib/keyframe-extractor.js';
import { embedImage } from '../lib/clip-embed.js';
import { exec } from '../lib/exec.js';
import { analyzeParentEndToEndV2 } from '../agents/gemini-segments-v2-batch.js';
import { projectV2ToV1Columns } from '../lib/segment-v2-projection.js';
import type { SegmentV2 } from '../agents/segment-analyzer-v2-schema.js';
import {
  DEFAULT_CHECKPOINT_DIR,
  newCheckpoint,
  readCheckpoint,
  writeCheckpoint,
  type Checkpoint,
} from './backfill-checkpoints.js';

const INGESTION_MODEL = process.env['GEMINI_INGESTION_MODEL'] || 'gemini-3.1-pro-preview';
const BACKFILL_TMP = '/tmp/video-factory/backfill-v2';

// ── CLI ──

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const dryRun = hasFlag('dry-run');
const resume = hasFlag('resume');
const brandArg = getArg('brand');
const parentArg = getArg('parent');
const parentsFileArg = getArg('parents-file');
const parallelRaw = Number(getArg('parallel') ?? '4');
const PARALLEL = Math.min(4, Math.max(1, Number.isFinite(parallelRaw) ? parallelRaw : 4));
const CHECKPOINT_DIR = DEFAULT_CHECKPOINT_DIR;

if (!parentArg && !parentsFileArg && !brandArg) {
  console.error('Error: must specify at least one of --parent, --parents-file, or --brand');
  console.error('Usage: npx tsx src/scripts/backfill-segments-v2.ts [--dry-run] [--resume]');
  console.error('       [--brand <id>] [--parent <uuid>] [--parents-file <path>] [--parallel N]');
  process.exit(1);
}

interface ParentRow {
  id: string;
  brand_id: string;
  pre_normalized_r2_key: string | null;
  r2_key: string;
  duration_seconds: number | null;
  filename: string | null;
}

interface OldSegmentRow {
  id: string;
  keyframe_r2_key: string | null;
  clip_r2_key: string | null;
}

async function resolveTargetParents(): Promise<ParentRow[]> {
  let query = supabaseAdmin
    .from('assets')
    .select('id, brand_id, pre_normalized_r2_key, r2_key, duration_seconds, filename')
    .order('created_at', { ascending: true });

  if (parentArg) query = query.eq('id', parentArg);
  if (brandArg) query = query.eq('brand_id', brandArg);

  const { data, error } = await query;
  if (error) throw new Error(`assets query failed: ${error.message}`);
  let rows = (data ?? []) as ParentRow[];

  if (parentsFileArg) {
    const ids = (await readTextFile(parentsFileArg, 'utf-8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const idSet = new Set(ids);
    rows = rows.filter((r) => idSet.has(r.id));
  }

  return rows;
}

async function fetchBrandContext(brandId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('brand_configs')
    .select('voice_guidelines, allowed_video_types')
    .eq('brand_id', brandId)
    .single();
  if (!data) return `Brand: ${brandId}. UGC content.`;
  const voice = data.voice_guidelines ?? '';
  const types = Array.isArray(data.allowed_video_types) ? data.allowed_video_types.join(', ') : '';
  return `Brand: ${brandId}. ${voice} Video types: ${types}.`;
}

async function processOneParent(parent: ParentRow): Promise<Checkpoint> {
  const t0 = Date.now();
  const cp = newCheckpoint(parent.id, parent.brand_id);

  if (!dryRun) {
    await writeCheckpoint(CHECKPOINT_DIR, cp);
  }

  const r2Key = parent.pre_normalized_r2_key ?? parent.r2_key;
  const localPath = `${BACKFILL_TMP}/${parent.id}-${randomUUID()}.mp4`;
  await mkdir(dirname(localPath), { recursive: true });

  try {
    console.log(`[backfill-v2] parent=${parent.id} brand=${parent.brand_id} — downloading ${r2Key}`);
    await downloadToFile(r2Key, localPath);

    const brandContext = await fetchBrandContext(parent.brand_id);

    const v2Result = await analyzeParentEndToEndV2(localPath, brandContext);
    cp.v2_segment_count = v2Result.segments.length;
    console.log(
      `[backfill-v2] parent=${parent.id} — v2 returned ${v2Result.segments.length} segments in ${v2Result.timings.totalMs}ms`,
    );

    if (dryRun) {
      for (let i = 0; i < v2Result.segments.length; i++) {
        const v1 = projectV2ToV1Columns(v2Result.segments[i]);
        console.log(
          `[backfill-v2]   dry-run [${i}] ${v1.start_s}-${v1.end_s}s type=${v1.segment_type} motion_intensity=${v1.motion_intensity} quality=${v1.quality_score} speech=${v1.has_speech} best_used_as=[${v1.best_used_as.join(',')}] tags=${v1.visual_tags.length}`,
        );
      }

      cp.status = 'complete';
      cp.completed_at = new Date().toISOString();
      cp.wall_time_ms = Date.now() - t0;
      return cp;
    }

    // Real run: destroy-and-rebuild.
    // 1) Fetch old segment rows (id + R2 keys) for this parent.
    const { data: oldSegs, error: oldErr } = await supabaseAdmin
      .from('asset_segments')
      .select('id, keyframe_r2_key, clip_r2_key')
      .eq('parent_asset_id', parent.id);
    if (oldErr) throw new Error(`fetch old segments failed: ${oldErr.message}`);
    const old = (oldSegs ?? []) as OldSegmentRow[];

    // 2) Delete old R2 files (best-effort — orphans are acceptable).
    for (const s of old) {
      if (s.clip_r2_key) {
        try {
          await deleteFile(s.clip_r2_key);
          cp.r2_operations.old_clips_deleted.push(s.clip_r2_key);
        } catch (err) {
          console.warn(`[backfill-v2] Failed to delete old clip ${s.clip_r2_key}: ${(err as Error).message}`);
        }
      }
      if (s.keyframe_r2_key) {
        try {
          await deleteFile(s.keyframe_r2_key);
          cp.r2_operations.old_keyframes_deleted.push(s.keyframe_r2_key);
        } catch (err) {
          console.warn(`[backfill-v2] Failed to delete old keyframe ${s.keyframe_r2_key}: ${(err as Error).message}`);
        }
      }
    }

    // 3) Delete old DB rows.
    if (old.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from('asset_segments')
        .delete()
        .eq('parent_asset_id', parent.id);
      if (delErr) throw new Error(`delete old rows failed: ${delErr.message}`);
      cp.db_operations.old_rows_deleted = old.length;
    }

    // 4) Insert new segments (cut clip, keyframe, embed, row).
    for (let i = 0; i < v2Result.segments.length; i++) {
      const seg: SegmentV2 = v2Result.segments[i];
      const v1 = projectV2ToV1Columns(seg);
      const segmentUuid = randomUUID();

      const midpoint = (seg.start_s + seg.end_s) / 2;
      const keyframePath = `${BACKFILL_TMP}/keyframes/${segmentUuid}.jpg`;
      await mkdir(dirname(keyframePath), { recursive: true });
      await extractKeyframe(localPath, midpoint, keyframePath);
      const keyframeBuffer = await readFile(keyframePath);
      const embedding = await embedImage(keyframeBuffer);
      const keyframeR2Key = `keyframes/${parent.brand_id}/${segmentUuid}.jpg`;
      await uploadFile(keyframeR2Key, keyframeBuffer, 'image/jpeg');
      cp.r2_operations.keyframes_uploaded.push(keyframeR2Key);

      let clipR2Key: string | null = null;
      const clipPath = `${BACKFILL_TMP}/clips/${segmentUuid}.mp4`;
      await mkdir(dirname(clipPath), { recursive: true });
      const trimResult = await exec({
        command: 'ffmpeg',
        args: [
          '-y', '-ss', String(seg.start_s), '-i', localPath,
          '-t', String(seg.end_s - seg.start_s),
          '-vf', 'scale=-2:720',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          '-c:a', 'aac', '-b:a', '96k',
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
          clipPath,
        ],
      });

      if (trimResult.exitCode === 0) {
        const st = await stat(clipPath);
        clipR2Key = `segments/${parent.brand_id}/${segmentUuid}.mp4`;
        const clipBuffer = await readFile(clipPath);
        await uploadFile(clipR2Key, clipBuffer, 'video/mp4');
        cp.r2_operations.clips_uploaded.push(clipR2Key);
        console.log(`[backfill-v2]   [${i}] clip ${clipR2Key} (${(st.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.warn(`[backfill-v2]   [${i}] clip trim failed (exit ${trimResult.exitCode})`);
      }
      await unlink(clipPath).catch(() => {});

      const { error: insertErr } = await supabaseAdmin.from('asset_segments').insert({
        id: segmentUuid,
        parent_asset_id: parent.id,
        brand_id: parent.brand_id,
        segment_index: i,
        start_s: v1.start_s,
        end_s: v1.end_s,
        segment_type: v1.segment_type,
        description: v1.description,
        visual_tags: v1.visual_tags,
        best_used_as: v1.best_used_as,
        motion_intensity: v1.motion_intensity,
        recommended_duration_s: v1.recommended_duration_s,
        has_speech: v1.has_speech,
        quality_score: v1.quality_score,
        keyframe_r2_key: keyframeR2Key,
        clip_r2_key: clipR2Key,
        embedding: `[${embedding.join(',')}]`,
        ingestion_model: INGESTION_MODEL,
        segment_v2: seg,
      });

      await unlink(keyframePath).catch(() => {});

      if (insertErr) {
        throw new Error(`insert segment ${i} failed: ${insertErr.message}`);
      }
      cp.db_operations.new_rows_inserted += 1;
    }

    cp.status = 'complete';
    cp.completed_at = new Date().toISOString();
    cp.wall_time_ms = Date.now() - t0;
    await writeCheckpoint(CHECKPOINT_DIR, cp);
    return cp;
  } catch (err) {
    cp.status = 'failed';
    cp.error = (err as Error).message;
    cp.wall_time_ms = Date.now() - t0;
    if (!dryRun) await writeCheckpoint(CHECKPOINT_DIR, cp);
    throw err;
  } finally {
    await unlink(localPath).catch(() => {});
  }
}

async function runWorker(queue: ParentRow[], workerId: number, results: Map<string, Checkpoint>, errors: Map<string, string>): Promise<void> {
  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) return;
    console.log(`[backfill-v2][w${workerId}] Starting parent ${parent.id}`);
    try {
      const cp = await processOneParent(parent);
      results.set(parent.id, cp);
      console.log(
        `[backfill-v2][w${workerId}] parent=${parent.id} status=${cp.status} segments=${cp.v2_segment_count} wall=${cp.wall_time_ms}ms`,
      );
    } catch (err) {
      errors.set(parent.id, (err as Error).message);
      console.error(`[backfill-v2][w${workerId}] parent=${parent.id} FAILED: ${(err as Error).message}`);
    }
  }
}

async function main() {
  console.log(`[backfill-v2] Starting (dry_run=${dryRun} parallel=${PARALLEL} resume=${resume} brand=${brandArg ?? '-'} parent=${parentArg ?? '-'} parents_file=${parentsFileArg ?? '-'})`);
  console.log(`[backfill-v2] Model: ${INGESTION_MODEL}`);
  console.log(`[backfill-v2] Checkpoint dir: ${CHECKPOINT_DIR}`);

  const allParents = await resolveTargetParents();
  console.log(`[backfill-v2] Resolved ${allParents.length} candidate parent(s)`);

  let toProcess: ParentRow[] = allParents;
  if (resume && existsSync(CHECKPOINT_DIR)) {
    const filtered: ParentRow[] = [];
    for (const p of allParents) {
      const cp = await readCheckpoint(CHECKPOINT_DIR, p.id);
      if (!cp) { filtered.push(p); continue; }
      if (cp.status === 'complete') {
        console.log(`[backfill-v2] --resume: skipping ${p.id} (already complete)`);
        continue;
      }
      if (cp.status === 'in-progress') {
        console.warn(`[backfill-v2] --resume: parent ${p.id} has IN-PROGRESS checkpoint from ${cp.started_at}. Skipping for manual review — do NOT auto-recover.`);
        continue;
      }
      filtered.push(p); // failed → retry
    }
    toProcess = filtered;
  }

  if (toProcess.length === 0) {
    console.log('[backfill-v2] Nothing to do.');
    process.exit(0);
  }

  console.log(`[backfill-v2] Will process ${toProcess.length} parent(s) with ${PARALLEL} worker(s)`);

  const queue = [...toProcess];
  const results = new Map<string, Checkpoint>();
  const errors = new Map<string, string>();

  const workers: Promise<void>[] = [];
  for (let w = 0; w < PARALLEL; w++) {
    workers.push(runWorker(queue, w + 1, results, errors));
  }
  await Promise.all(workers);

  const complete = [...results.values()].filter((c) => c.status === 'complete').length;
  const totalNewRows = [...results.values()].reduce((s, c) => s + c.db_operations.new_rows_inserted, 0);
  const totalOldDeleted = [...results.values()].reduce((s, c) => s + c.db_operations.old_rows_deleted, 0);
  const totalClipsUp = [...results.values()].reduce((s, c) => s + c.r2_operations.clips_uploaded.length, 0);
  const totalKeyframesUp = [...results.values()].reduce((s, c) => s + c.r2_operations.keyframes_uploaded.length, 0);

  console.log('\n========== backfill-v2 summary ==========');
  console.log(`Mode:            ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Parents:         ${toProcess.length} targeted, ${complete} complete, ${errors.size} failed`);
  console.log(`v2 segments seen: ${[...results.values()].reduce((s, c) => s + c.v2_segment_count, 0)}`);
  console.log(`DB old rows deleted: ${totalOldDeleted}`);
  console.log(`DB new rows inserted: ${totalNewRows}`);
  console.log(`R2 clips uploaded: ${totalClipsUp}`);
  console.log(`R2 keyframes uploaded: ${totalKeyframesUp}`);
  if (errors.size > 0) {
    console.log('\nFailures:');
    for (const [id, msg] of errors) console.log(`  ${id}: ${msg}`);
  }
  console.log('=========================================\n');

  process.exit(errors.size > 0 && complete === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[backfill-v2] FATAL:', err);
  process.exit(1);
});
