import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { uploadFile } from '../lib/r2-storage.js';
import { buildProbeCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import { analyzeClip } from '../lib/gemini.js';
import { analyzeClipMetadata } from '../lib/clip-analysis.js';
import { analyzeClipSegments } from '../lib/gemini-segments.js';
import { processSegmentsForAsset } from '../lib/segment-processor.js';
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

  // 2. Gemini clip analysis
  console.log(`[ingestion] Analyzing clip with Gemini...`);
  const analysis = await analyzeClip(input.filePath);
  console.log(`[ingestion] Analyzed: ${analysis.content_type}, mood=${analysis.mood}, quality=${analysis.quality_score}`);
  console.log(`[ingestion] Description: ${analysis.detailed_description}`);
  if (analysis.usable_segments.length > 0) {
    console.log(`[ingestion] Found ${analysis.usable_segments.length} usable segments`);
  }

  // 2b. FFmpeg clip metadata (color, motion, brightness)
  console.log(`[ingestion] Extracting visual metadata with FFmpeg...`);
  const clipMeta = await analyzeClipMetadata(input.filePath);
  console.log(`[ingestion] Color: ${clipMeta.dominant_color_hex}, Motion: ${clipMeta.motion_intensity}, Brightness: ${clipMeta.avg_brightness}, Cuts: ${clipMeta.scene_cuts}`);

  // 3. Upload to R2
  const stream = createReadStream(input.filePath);
  await uploadFile(r2Key, stream, 'video/mp4');
  console.log(`[ingestion] Uploaded to R2: ${r2Key}`);

  // 4. Insert into Supabase
  const allTags = [...analysis.tags];
  if (description) allTags.push(description);

  const row = {
    id: assetId,
    brand_id: brandId,
    drive_file_id: input.driveFileId ?? null,
    r2_key: r2Key,
    r2_url: `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${r2Key}`,
    filename: input.filename ?? null,
    duration_seconds: probe.duration_seconds,
    resolution: probe.resolution,
    aspect_ratio: probe.aspect_ratio,
    file_size_mb: probe.file_size_mb,
    content_type: analysis.content_type,
    mood: analysis.mood,
    quality_score: analysis.quality_score,
    has_speech: analysis.has_speech,
    transcript_summary: analysis.transcript_summary,
    visual_elements: analysis.visual_elements,
    usable_segments: analysis.usable_segments,
    dominant_color_hex: clipMeta.dominant_color_hex,
    motion_intensity: clipMeta.motion_intensity,
    avg_brightness: clipMeta.avg_brightness,
    scene_cuts: clipMeta.scene_cuts,
    tags: allTags,
  };

  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  console.log(`[ingestion] Asset saved: ${assetId}`);

  // ── Phase 1: Sub-clip segmentation (additive, non-blocking) ──
  // Produces asset_segments rows alongside the legacy assets row.
  // On failure, log and continue — the legacy row is already written
  // and the backfill script can re-process later.
  try {
    const durationSeconds = probe.duration_seconds ?? 0;
    if (durationSeconds > 0) {
      const brandContext = `Brand: ${brandId}. ${description || 'UGC content.'}`;
      const segments = await analyzeClipSegments(input.filePath, durationSeconds, brandContext);
      console.log(`[ingestion] ${segments.length} segments identified for asset ${assetId}`);

      const inserted = await processSegmentsForAsset(assetId, brandId, input.filePath, segments);
      console.log(`[ingestion] ${inserted} asset_segments rows written for asset ${assetId}`);
    } else {
      console.warn(`[ingestion] Skipping segmentation: no duration for asset ${assetId}`);
    }
  } catch (segErr) {
    console.error(`[ingestion] Segmentation failed for asset ${assetId}:`, segErr);
    // Do NOT rethrow. Legacy assets row is already written. Backfill can re-run later.
  }

  return data as Asset;
}

// BullMQ processor (used when running as a queue worker)
export async function ingestionProcessor(job: { data: IngestionInput }) {
  return ingestAsset(job.data);
}
