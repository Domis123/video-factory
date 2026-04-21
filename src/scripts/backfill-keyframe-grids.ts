/**
 * Phase 4 Part B W1 — backfill keyframe_grid_r2_key for existing v2 segments.
 *
 * Per-parent batching: download each parent ONCE, generate grids for all its
 * unprocessed segments against the local file, delete ONCE. 2-way parallel
 * across parent groups. Checkpointed to survive kill/restart.
 *
 * Flags:
 *   --smoke [N]   Run on N diverse segments (≥3 parents, ≥3 segment_types). Default N=5.
 *   --full        Run on every v2 segment where keyframe_grid_r2_key IS NULL.
 *   --dry-run     Print the plan (queries, groupings, expected row count) without
 *                 downloading, generating, or uploading anything.
 *   --resume      Reuse the existing checkpoint if present. Default ON when the
 *                 checkpoint file exists; pass --no-resume to force a fresh start.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-keyframe-grids.ts --smoke 5
 *   npx tsx src/scripts/backfill-keyframe-grids.ts --full
 *   npx tsx src/scripts/backfill-keyframe-grids.ts --full --dry-run
 *
 * Checkpoint directory:
 *   default:  ${cwd}/backups/checkpoints-w1-YYYYMMDD
 *   override: BACKFILL_CHECKPOINT_DIR=/home/video-factory/backups/checkpoints-w1-YYYYMMDD
 *
 * Failure handling: per-parent or per-segment failures are logged to failures.log
 * next to the checkpoint and the run continues. No single failure halts the batch.
 */

import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile, getPresignedUrl } from '../lib/r2-storage.js';
import { generateAndStoreGrid, type GridRow } from '../lib/keyframe-grid.js';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface CliArgs {
  mode: 'smoke' | 'full';
  smokeCount: number;
  dryRun: boolean;
  resume: boolean;
  printSignedUrls: boolean;
}

interface TargetRow extends GridRow {
  parent_asset_id: string;
  parent_r2_key: string;
  segment_type: string;
}

const CONCURRENCY = 2;
const CHECKPOINT_PERSIST_EVERY = 20;

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let mode: 'smoke' | 'full' = 'smoke';
  let smokeCount = 5;
  let dryRun = false;
  let resume = true;
  let printSignedUrls = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') {
      mode = 'smoke';
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        smokeCount = parseInt(next, 10);
        i++;
      }
    } else if (a === '--full') {
      mode = 'full';
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--resume') {
      resume = true;
    } else if (a === '--no-resume') {
      resume = false;
    } else if (a === '--print-signed-urls') {
      printSignedUrls = true;
    } else {
      console.error(`[backfill-keyframe-grids] unknown flag: ${a}`);
      process.exit(1);
    }
  }

  if (mode === 'smoke' && (!Number.isFinite(smokeCount) || smokeCount < 1)) {
    console.error(`[backfill-keyframe-grids] --smoke requires a positive integer`);
    process.exit(1);
  }

  return { mode, smokeCount, dryRun, resume, printSignedUrls };
}

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function loadTargets(args: CliArgs): Promise<TargetRow[]> {
  // PostgREST can't JOIN for us easily; fetch segments first, then map parents.
  // Use select options to pull segment_v2->editorial via .select with arrow syntax
  // — but supabase-js doesn't expand JSONB path selects cleanly, so we fetch the
  // full jsonb and pick the fields in-process. 720 rows is trivial.
  const segQuery = supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, brand_id, segment_type, start_s, end_s, segment_v2')
    .not('segment_v2', 'is', null)
    .is('keyframe_grid_r2_key', null)
    .order('parent_asset_id', { ascending: true })
    .order('start_s', { ascending: true });

  const { data: segs, error: segErr } = await segQuery;
  if (segErr) throw new Error(`segment query failed: ${segErr.message}`);
  if (!segs) return [];

  const parentIds = Array.from(new Set(segs.map((s) => s.parent_asset_id as string)));
  if (parentIds.length === 0) return [];

  const { data: parents, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id, r2_key, pre_normalized_r2_key')
    .in('id', parentIds);
  if (parentErr) throw new Error(`parent query failed: ${parentErr.message}`);

  const parentMap = new Map<string, string>();
  for (const p of parents ?? []) {
    const key = (p.pre_normalized_r2_key as string | null) || (p.r2_key as string | null);
    if (key) parentMap.set(p.id as string, key);
  }

  const rows: TargetRow[] = [];
  for (const s of segs) {
    const parentR2Key = parentMap.get(s.parent_asset_id as string);
    if (!parentR2Key) {
      console.warn(
        `[backfill-keyframe-grids] parent ${s.parent_asset_id} has no r2_key — skipping segment ${s.id}`,
      );
      continue;
    }
    const ed = (s.segment_v2 as { editorial?: { best_in_point_s?: number; best_out_point_s?: number } } | null)?.editorial;
    rows.push({
      id: s.id as string,
      parent_asset_id: s.parent_asset_id as string,
      brand_id: s.brand_id as string,
      segment_type: (s.segment_type as string) ?? 'unknown',
      start_s: Number(s.start_s),
      end_s: Number(s.end_s),
      best_in_point_s: typeof ed?.best_in_point_s === 'number' ? ed.best_in_point_s : null,
      best_out_point_s: typeof ed?.best_out_point_s === 'number' ? ed.best_out_point_s : null,
      parent_r2_key: parentR2Key,
    });
  }

  if (args.mode === 'full') return rows;

  // Smoke selection: span ≥3 parents and ≥3 segment_types if the candidate pool allows.
  return pickDiverseSmokeSample(rows, args.smokeCount);
}

function pickDiverseSmokeSample(rows: TargetRow[], n: number): TargetRow[] {
  if (rows.length <= n) return rows;

  // Shuffle deterministically per-run (Math.random is fine — smoke is exploratory).
  const shuffled = [...rows].sort(() => Math.random() - 0.5);

  const picked: TargetRow[] = [];
  const typesSeen = new Set<string>();
  const parentsSeen = new Set<string>();

  // Pass 1: prefer new type AND new parent
  for (const r of shuffled) {
    if (picked.length >= n) break;
    if (!typesSeen.has(r.segment_type) && !parentsSeen.has(r.parent_asset_id)) {
      picked.push(r);
      typesSeen.add(r.segment_type);
      parentsSeen.add(r.parent_asset_id);
    }
  }
  // Pass 2: fill with new types (repeated parents OK)
  for (const r of shuffled) {
    if (picked.length >= n) break;
    if (picked.includes(r)) continue;
    if (!typesSeen.has(r.segment_type)) {
      picked.push(r);
      typesSeen.add(r.segment_type);
      parentsSeen.add(r.parent_asset_id);
    }
  }
  // Pass 3: fill remaining with anything
  for (const r of shuffled) {
    if (picked.length >= n) break;
    if (picked.includes(r)) continue;
    picked.push(r);
    typesSeen.add(r.segment_type);
    parentsSeen.add(r.parent_asset_id);
  }

  console.log(
    `[backfill-keyframe-grids] smoke sample: ${picked.length} segments across ${parentsSeen.size} parents and ${typesSeen.size} types (${[...typesSeen].join(',')})`,
  );
  if (parentsSeen.size < 3) {
    console.warn(
      `[backfill-keyframe-grids] WARNING: only ${parentsSeen.size} distinct parents in smoke sample (target ≥3)`,
    );
  }
  if (typesSeen.size < 3) {
    console.warn(
      `[backfill-keyframe-grids] WARNING: only ${typesSeen.size} distinct segment_types in smoke sample (target ≥3)`,
    );
  }
  return picked;
}

async function loadCheckpoint(checkpointPath: string): Promise<Set<string>> {
  if (!existsSync(checkpointPath)) return new Set();
  try {
    const raw = await readFile(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw) as { processed: string[] };
    return new Set(parsed.processed ?? []);
  } catch (err) {
    console.warn(
      `[backfill-keyframe-grids] checkpoint load failed (${(err as Error).message}); starting fresh`,
    );
    return new Set();
  }
}

async function persistCheckpoint(checkpointPath: string, processed: Set<string>): Promise<void> {
  const payload = JSON.stringify({ processed: [...processed], updated_at: new Date().toISOString() });
  await writeFile(checkpointPath, payload, 'utf8');
}

type PromiseTask<T> = () => Promise<T>;

async function promisePool<T>(tasks: PromiseTask<T>[], concurrency: number): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= tasks.length) return;
          await tasks[idx]().catch((err) => {
            console.error(`[backfill-keyframe-grids] worker task ${idx} unhandled error:`, err);
          });
        }
      })(),
    );
  }
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs();
  const checkpointDir =
    process.env.BACKFILL_CHECKPOINT_DIR ||
    join(process.cwd(), 'backups', `checkpoints-w1-${todayYYYYMMDD()}`);
  const checkpointPath = join(checkpointDir, 'checkpoint.json');
  const failuresPath = join(checkpointDir, 'failures.log');
  await mkdir(checkpointDir, { recursive: true });

  console.log(`[backfill-keyframe-grids] mode=${args.mode}${args.mode === 'smoke' ? ` n=${args.smokeCount}` : ''} dryRun=${args.dryRun} resume=${args.resume}`);
  console.log(`[backfill-keyframe-grids] checkpoint_dir=${checkpointDir}`);

  const processed = args.resume ? await loadCheckpoint(checkpointPath) : new Set<string>();
  console.log(`[backfill-keyframe-grids] checkpoint: ${processed.size} already-processed segment ids`);

  const targets = await loadTargets(args);
  const pending = targets.filter((t) => !processed.has(t.id));
  console.log(
    `[backfill-keyframe-grids] targets: ${targets.length} candidate rows, ${pending.length} pending after checkpoint filter`,
  );

  // Group by parent
  const byParent = new Map<string, TargetRow[]>();
  for (const t of pending) {
    let bucket = byParent.get(t.parent_asset_id);
    if (!bucket) {
      bucket = [];
      byParent.set(t.parent_asset_id, bucket);
    }
    bucket.push(t);
  }
  console.log(`[backfill-keyframe-grids] parent groups: ${byParent.size}`);

  if (args.dryRun) {
    console.log('');
    console.log('═══ DRY RUN PLAN ═══');
    for (const [pid, segs] of byParent) {
      console.log(
        `  parent ${pid} — ${segs.length} segments: ${segs.map((s) => `${s.segment_type}:${s.id.slice(0, 8)}`).join(', ')}`,
      );
    }
    console.log('');
    console.log(
      `Would download ${byParent.size} parent file(s) and generate ${pending.length} grids.`,
    );
    return;
  }

  const signedUrlsForReport: Array<{ segmentId: string; segmentType: string; r2Key: string; signedUrl?: string; sizeBytes: number; warnings: string[] }> = [];
  const tStart = Date.now();
  let succeeded = 0;
  let failed = 0;
  const warningBuckets = { windowFallback: 0, missingTiles: 0 };
  let sinceLastCheckpoint = 0;

  const tasks: PromiseTask<void>[] = [...byParent.entries()].map(([parentId, segs]) => async () => {
    const tParent = Date.now();
    const parentLocalPath = join('/tmp', `w1-backfill-${parentId}.mp4`);
    try {
      try {
        await downloadToFile(segs[0].parent_r2_key, parentLocalPath);
      } catch (err) {
        const msg = `[${new Date().toISOString()}] parent ${parentId} download FAILED (${(err as Error).message}); skipping ${segs.length} segments: ${segs.map((s) => s.id).join(',')}\n`;
        await appendFile(failuresPath, msg).catch(() => {});
        console.error(msg.trim());
        failed += segs.length;
        return;
      }

      for (const seg of segs) {
        const tSeg = Date.now();
        try {
          const outcome = await generateAndStoreGrid(parentLocalPath, {
            id: seg.id,
            brand_id: seg.brand_id,
            start_s: seg.start_s,
            end_s: seg.end_s,
            best_in_point_s: seg.best_in_point_s,
            best_out_point_s: seg.best_out_point_s,
          });
          processed.add(seg.id);
          sinceLastCheckpoint++;
          succeeded++;

          if (outcome.fellBackToSegmentBounds) warningBuckets.windowFallback++;
          if (outcome.missingTileIndices.length > 0) warningBuckets.missingTiles++;

          if (args.mode === 'smoke') {
            let signed: string | undefined;
            if (args.mode === 'smoke') {
              try {
                signed = await getPresignedUrl(outcome.r2Key, 1800); // 30 min
              } catch (err) {
                console.warn(`[backfill-keyframe-grids] signed URL failed for ${outcome.r2Key}: ${(err as Error).message}`);
              }
            }
            signedUrlsForReport.push({
              segmentId: seg.id,
              segmentType: seg.segment_type,
              r2Key: outcome.r2Key,
              signedUrl: signed,
              sizeBytes: outcome.sizeBytes,
              warnings: outcome.warnings,
            });
          }

          console.log(
            `[backfill-keyframe-grids] ✓ ${seg.segment_type} ${seg.id.slice(0, 8)} (${outcome.sizeBytes >> 10}KB) in ${((Date.now() - tSeg) / 1000).toFixed(1)}s`,
          );

          if (sinceLastCheckpoint >= CHECKPOINT_PERSIST_EVERY) {
            await persistCheckpoint(checkpointPath, processed);
            sinceLastCheckpoint = 0;
          }
        } catch (err) {
          failed++;
          const msg = `[${new Date().toISOString()}] segment ${seg.id} (parent ${parentId}) FAILED: ${(err as Error).message}\n`;
          await appendFile(failuresPath, msg).catch(() => {});
          console.error(`[backfill-keyframe-grids] ✗ ${seg.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      await rm(parentLocalPath, { force: true }).catch(() => {});
      console.log(
        `[backfill-keyframe-grids] parent ${parentId} done (${segs.length} segs) in ${((Date.now() - tParent) / 1000).toFixed(1)}s`,
      );
    }
  });

  await promisePool(tasks, CONCURRENCY);

  await persistCheckpoint(checkpointPath, processed);

  const elapsed = (Date.now() - tStart) / 1000;
  console.log('');
  console.log('═══ BACKFILL SUMMARY ═══');
  console.log(`  mode:                ${args.mode}`);
  console.log(`  segments_processed:  ${succeeded}`);
  console.log(`  segments_failed:     ${failed}`);
  console.log(`  parents_touched:     ${byParent.size}`);
  console.log(`  warnings_window_fb:  ${warningBuckets.windowFallback}`);
  console.log(`  warnings_miss_tiles: ${warningBuckets.missingTiles}`);
  console.log(`  elapsed_seconds:     ${elapsed.toFixed(1)}`);
  console.log(`  checkpoint:          ${checkpointPath}`);
  console.log(`  failures_log:        ${failuresPath}`);

  if (args.mode === 'full') {
    const { count, error } = await supabaseAdmin
      .from('asset_segments')
      .select('*', { count: 'exact', head: true })
      .not('segment_v2', 'is', null)
      .is('keyframe_grid_r2_key', null);
    if (error) {
      console.warn(`  final_verification:  FAILED (${error.message})`);
    } else {
      console.log(`  remaining_null:      ${count ?? 'unknown'} (target: 0)`);
    }
  }

  if (signedUrlsForReport.length > 0) {
    console.log('');
    console.log('═══ SMOKE ARTIFACTS ═══');
    for (const r of signedUrlsForReport) {
      console.log(`  - ${r.segmentType} ${r.segmentId}`);
      console.log(`      r2_key:   ${r.r2Key}`);
      console.log(`      size_kb:  ${(r.sizeBytes / 1024).toFixed(1)}`);
      if (r.warnings.length > 0) console.log(`      warn:     ${r.warnings.join('; ')}`);
      if (r.signedUrl) console.log(`      signed:   ${r.signedUrl}`);
    }
  }
}

main().catch((err) => {
  console.error('[backfill-keyframe-grids] UNHANDLED ERROR:', err);
  process.exit(1);
});
