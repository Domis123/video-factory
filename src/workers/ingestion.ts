import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { uploadFile, deleteFile } from '../lib/r2-storage.js';
import { preNormalizeParent } from '../lib/parent-normalizer.js';
import { buildProbeCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import { analyzeClipMetadata } from '../lib/clip-analysis.js';
import { analyzeClipSegments } from '../lib/gemini-segments.js';
import { processSegmentsForAsset } from '../lib/segment-processor.js';
import { analyzeParentEndToEndV2 } from '../agents/gemini-segments-v2-batch.js';
import { processSegmentsV2ForAsset } from '../lib/segment-processor-v2.js';
import { generateAndStoreGrid } from '../lib/keyframe-grid.js';
import type { Asset } from '../types/database.js';

export interface IngestionInput {
  filePath: string;         // local path to the file (already downloaded from Drive)
  brandId: string;
  driveFileId?: string;
  filename?: string;
}

export interface ProbeData {
  duration_seconds: number | null;
  resolution: string | null;
  aspect_ratio: string | null;
  file_size_mb: number | null;
  codec: string | null;
  has_audio: boolean;
}

async function probeFile(filePath: string): Promise<ProbeData> {
  const raw = await execOrThrow(buildProbeCommand(filePath));
  const info = JSON.parse(raw);

  const videoStream = info.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
  const audioStream = info.streams?.find((s: Record<string, unknown>) => s.codec_type === 'audio');
  const fileStat = await stat(filePath);

  const width = videoStream?.width as number | undefined;
  const height = videoStream?.height as number | undefined;

  return {
    duration_seconds: info.format?.duration ? parseFloat(info.format.duration) : null,
    resolution: width && height ? `${width}x${height}` : null,
    aspect_ratio: width && height ? simplifyRatio(width, height) : null,
    file_size_mb: Math.round((fileStat.size / (1024 * 1024)) * 100) / 100,
    codec: videoStream?.codec_name as string ?? null,
    has_audio: !!audioStream,
  };
}

function simplifyRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

// Parse filename: {brand_id}_{description}.ext
// Falls back to brandId from Drive folder if no underscore found
function parseFilename(filename: string, fallbackBrandId: string): { brandId: string; description: string } {
  const name = filename.replace(/\.[^.]+$/, ''); // strip extension
  const underscoreIdx = name.indexOf('_');
  if (underscoreIdx > 0) {
    return {
      brandId: name.slice(0, underscoreIdx).toLowerCase(),
      description: name.slice(underscoreIdx + 1),
    };
  }
  return { brandId: fallbackBrandId, description: name };
}

// Validate that a brand_id exists in Supabase
async function brandExists(brandId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('brand_configs')
    .select('brand_id')
    .eq('brand_id', brandId)
    .single();
  return !!data;
}

export async function ingestAsset(input: IngestionInput): Promise<Asset> {
  const assetId = randomUUID();
  const ext = extname(input.filename ?? input.filePath) || '.mp4';

  // Parse brand + description from filename, validate brand exists
  const parsed = parseFilename(input.filename ?? '', input.brandId);
  const validBrand = await brandExists(parsed.brandId);
  const brandId = validBrand ? parsed.brandId : input.brandId;
  const description = parsed.description;

  const r2Key = `assets/${brandId}/${assetId}${ext}`;

  console.log(`[ingestion] Processing ${input.filename ?? input.filePath} for ${brandId}`);

  // 1. FFprobe metadata
  const probe = await probeFile(input.filePath);
  console.log(`[ingestion] Probed: ${probe.resolution}, ${probe.duration_seconds}s, ${probe.file_size_mb}MB`);

  // 2. FFmpeg clip metadata (color, motion, brightness) — pure local ffmpeg, no network.
  //    The legacy Gemini Flash analyzeClip() call that used to run here was removed
  //    in fix/remove-legacy-flash-ingest: its output was not consumed by the
  //    Phase 3.5 production path (V2 curator + segment_v2 sidecar own retrieval),
  //    and it was hot-path blocking ingestion on 429 before v2 could run.
  console.log(`[ingestion] Extracting visual metadata with FFmpeg...`);
  const clipMeta = await analyzeClipMetadata(input.filePath);
  console.log(`[ingestion] Color: ${clipMeta.dominant_color_hex}, Motion: ${clipMeta.motion_intensity}, Brightness: ${clipMeta.avg_brightness}, Cuts: ${clipMeta.scene_cuts}`);

  // 3. Upload raw original to R2 (archival copy)
  const stream = createReadStream(input.filePath);
  await uploadFile(r2Key, stream, 'video/mp4');
  console.log(`[ingestion] Uploaded raw to R2: ${r2Key}`);

  // 4. Pre-normalize parent to 1080p H.264 + upload to R2
  let normalizedLocalPath: string | null = null;
  let normR2Key: string | null = null;
  try {
    const normResult = await preNormalizeParent({
      inputPath: input.filePath,
      brandId,
      assetId,
    });
    normalizedLocalPath = normResult.localPath;
    normR2Key = normResult.r2Key;
    console.log(
      `[ingestion] Pre-normalized: ${normR2Key} (${(normResult.fileSizeBytes / 1024 / 1024).toFixed(1)}MB, ${(normResult.encodeMs / 1000).toFixed(1)}s encode)`,
    );
  } catch (normErr) {
    try { await deleteFile(r2Key); } catch { /* swallow */ }
    console.error(`[ingestion] Pre-normalization failed, deleted orphan raw ${r2Key}`);
    throw normErr;
  }

  try {
    // 5. Insert into Supabase. Flash-populated columns (content_type, mood,
    //    quality_score, has_speech, transcript_summary, visual_elements,
    //    usable_segments) are no longer written — retrieval owns these via
    //    segment_v2. Column drop deferred to a later migration so old rows stay
    //    readable for the V1 asset-curator legacy path (currently unreachable
    //    with ENABLE_CURATOR_V2=true, kept for emergency rollback only).
    const row = {
      id: assetId,
      brand_id: brandId,
      drive_file_id: input.driveFileId ?? null,
      r2_key: r2Key,
      pre_normalized_r2_key: normR2Key,
      r2_url: `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${r2Key}`,
      filename: input.filename ?? null,
      duration_seconds: probe.duration_seconds,
      resolution: probe.resolution,
      aspect_ratio: probe.aspect_ratio,
      file_size_mb: probe.file_size_mb,
      dominant_color_hex: clipMeta.dominant_color_hex,
      motion_intensity: clipMeta.motion_intensity,
      avg_brightness: clipMeta.avg_brightness,
      scene_cuts: clipMeta.scene_cuts,
      tags: description ? [description] : [],
    };

    const { data, error } = await supabaseAdmin
      .from('assets')
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    console.log(`[ingestion] Asset saved: ${assetId}`);

    // 6. Sub-clip segmentation (non-blocking) — reads from normalized parent.
    // Flag is read fresh from process.env so flips take effect without rebuild;
    // v1 remains the fallback path.
    const segmentSourcePath = normalizedLocalPath ?? input.filePath;
    try {
      const durationSeconds = probe.duration_seconds ?? 0;
      if (durationSeconds > 0) {
        const brandContext = `Brand: ${brandId}. ${description || 'UGC content.'}`;
        const useV2 = process.env.ENABLE_SEGMENT_V2 === 'true';

        if (useV2) {
          console.log(`[ingestion] ENABLE_SEGMENT_V2=true — running v2 analyzer for asset ${assetId}`);
          const v2Result = await analyzeParentEndToEndV2(segmentSourcePath, brandContext);
          console.log(
            `[ingestion] v2: ${v2Result.segments.length} segments, ${v2Result.counters.uploads} upload(s), ${v2Result.counters.deletes} delete(s), ${v2Result.timings.totalMs}ms wall`,
          );
          const inserted = await processSegmentsV2ForAsset(
            assetId,
            brandId,
            segmentSourcePath,
            v2Result.segments,
          );
          console.log(`[ingestion] ${inserted} asset_segments rows written (v2 dual-write) for asset ${assetId}`);

          // Phase 4 Part B W1 — keyframe-grid generation (flag-gated, non-fatal).
          // Re-query freshly inserted v2 rows by parent to get their canonical ids +
          // editorial windows, then generate one grid per segment reusing the already-
          // local normalized parent. Per-segment failure logs and continues; it does
          // NOT fail ingestion — the row is valid, a null grid column is recoverable
          // via backfill-keyframe-grids.ts.
          if (env.ENABLE_KEYFRAME_GRIDS) {
            const { data: freshRows, error: freshErr } = await supabaseAdmin
              .from('asset_segments')
              .select('id, brand_id, start_s, end_s, segment_v2')
              .eq('parent_asset_id', assetId)
              .not('segment_v2', 'is', null)
              .is('keyframe_grid_r2_key', null);
            if (freshErr) {
              console.warn(`[ingestion] grid: re-query failed for asset ${assetId}: ${freshErr.message}`);
            } else if (freshRows) {
              console.log(`[ingestion] grid: generating ${freshRows.length} grids for asset ${assetId}`);
              for (const r of freshRows) {
                const ed = (r.segment_v2 as { editorial?: { best_in_point_s?: number; best_out_point_s?: number } } | null)?.editorial;
                try {
                  const outcome = await generateAndStoreGrid(segmentSourcePath, {
                    id: r.id as string,
                    brand_id: r.brand_id as string,
                    start_s: Number(r.start_s),
                    end_s: Number(r.end_s),
                    best_in_point_s: typeof ed?.best_in_point_s === 'number' ? ed.best_in_point_s : null,
                    best_out_point_s: typeof ed?.best_out_point_s === 'number' ? ed.best_out_point_s : null,
                  });
                  if (outcome.warnings.length > 0) {
                    console.warn(`[ingestion] grid: segment ${r.id} warnings: ${outcome.warnings.join('; ')}`);
                  }
                } catch (gridErr) {
                  console.warn(
                    `[ingestion] grid: generation failed for segment ${r.id}: ${(gridErr as Error).message}`,
                  );
                }
              }
            }
          }
        } else {
          const segments = await analyzeClipSegments(segmentSourcePath, durationSeconds, brandContext);
          console.log(`[ingestion] ${segments.length} segments identified for asset ${assetId}`);

          const inserted = await processSegmentsForAsset(assetId, brandId, segmentSourcePath, segments);
          console.log(`[ingestion] ${inserted} asset_segments rows written for asset ${assetId}`);
        }
      } else {
        console.warn(`[ingestion] Skipping segmentation: no duration for asset ${assetId}`);
      }
    } catch (segErr) {
      console.error(`[ingestion] Segmentation failed for asset ${assetId}:`, segErr);
    }

    return data as Asset;
  } finally {
    if (normalizedLocalPath) {
      await unlink(normalizedLocalPath).catch(() => {});
    }
  }
}

// BullMQ processor (used when running as a queue worker)
export async function ingestionProcessor(job: { data: IngestionInput }) {
  return ingestAsset(job.data);
}
