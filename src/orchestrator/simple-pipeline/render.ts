/**
 * Simple Pipeline render — ffmpeg pipeline.
 *
 * Four sequential ffmpeg passes:
 *   A) Per-segment normalize: scale + pad to 1080x1920, lock to 30fps,
 *      apply brand color grade preset / LUT. Encodes each segment to a
 *      common codec/dimension/fps so concat demuxer can join them.
 *   B) Concat segments via concat demuxer. Single output preserving UGC
 *      audio.
 *   C) Overlay text (drawtext, lower-third, brand-font with drop shadow)
 *      + brand logo PNG (bottom-right, 0.85 opacity, ~15% composition
 *      height). Single filter_complex pass, video-only re-encode, audio
 *      copied through.
 *   D) Mix UGC audio + brand-pool music at -16 dB equivalent (uses the
 *      existing buildAudioMixCommand which does sidechain ducking).
 *
 * For meme path (slot_count=1), pass A runs once for the single segment;
 * pass B is a passthrough copy. Same code path otherwise.
 *
 * Output: 1080x1920 / 30fps / CRF 18 MP4. Uploaded to R2 at
 * `rendered/{brand_id}/{YYYY-MM}/{jobId}-simple-pipeline.mp4`.
 *
 * File: src/orchestrator/simple-pipeline/render.ts
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import {
  buildAudioMixCommand,
  type FfCommand,
} from '../../lib/ffmpeg.js';
import { execOrThrow } from '../../lib/exec.js';
import { buildGradingFilter, type ColorPreset } from '../../lib/color-grading.js';
import { downloadToFile, uploadFile } from '../../lib/r2-storage.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface RenderInput {
  jobId: string;
  brandId: string;
  format: 'routine' | 'meme';
  /** Picked segment IDs in render order (length 1 for meme, 2-5 for routine). */
  segmentIds: string[];
  overlayText: string;
  /** R2 key for the music track. */
  musicR2Key: string;
}

export interface RenderResult {
  r2Key: string;
  durationS: number;
  workDir: string;
}

// ─── Module-load constants ─────────────────────────────────────────────────

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const CRF = 18;
const X264_PRESET = 'medium'; // 'slow' is too slow for ~30-60s wall budget

const WORK_ROOT = `${env.RENDER_TEMP_DIR}/simple-pipeline`;

// Font candidates checked in order. Override with SIMPLE_PIPELINE_FONT_FILE env var.
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
];

function resolveFontFile(): string {
  const override = process.env['SIMPLE_PIPELINE_FONT_FILE'];
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`SIMPLE_PIPELINE_FONT_FILE=${override} does not exist`);
    }
    return override;
  }
  for (const p of FONT_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `simple-pipeline render: no font file found. Tried [${FONT_CANDIDATES.join(', ')}]. ` +
      `Install one of the candidates or set SIMPLE_PIPELINE_FONT_FILE.`,
  );
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function renderSimplePipeline(input: RenderInput): Promise<RenderResult> {
  if (input.segmentIds.length === 0) {
    throw new Error('renderSimplePipeline: segmentIds must not be empty');
  }
  if (input.format === 'meme' && input.segmentIds.length !== 1) {
    throw new Error(
      `renderSimplePipeline: meme format requires exactly 1 segment, got ${input.segmentIds.length}`,
    );
  }
  if (input.format === 'routine' && (input.segmentIds.length < 2 || input.segmentIds.length > 5)) {
    throw new Error(
      `renderSimplePipeline: routine format requires 2-5 segments, got ${input.segmentIds.length}`,
    );
  }

  const workDir = resolve(WORK_ROOT, input.jobId);
  await mkdir(workDir, { recursive: true });

  try {
    const fontFile = resolveFontFile();
    console.log(`[render] jobId=${input.jobId} format=${input.format} segments=${input.segmentIds.length}`);
    console.log(`[render] workDir=${workDir} fontFile=${fontFile}`);

    // 1. Fetch segment + brand metadata
    const segments = await fetchSegmentsInOrder(input.segmentIds);
    const brand = await fetchBrandRenderConfig(input.brandId);

    // 2. Download all clips + music + logo (parallel where possible)
    const clipPaths = await Promise.all(
      segments.map(async (s, i) => {
        const local = resolve(workDir, `clip-${i.toString().padStart(2, '0')}.mp4`);
        await downloadToFile(s.clipR2Key, local);
        return local;
      }),
    );
    const musicLocal = resolve(workDir, 'music.mp3');
    const logoLocal = resolve(workDir, 'logo.png');
    await Promise.all([
      downloadToFile(input.musicR2Key, musicLocal),
      downloadToFile(brand.logoR2Key, logoLocal),
    ]);

    // 3. Pass A: per-segment normalize (scale + pad + grade)
    const normalizedPaths: string[] = [];
    for (let i = 0; i < clipPaths.length; i++) {
      const out = resolve(workDir, `norm-${i.toString().padStart(2, '0')}.mp4`);
      const gradeFilter = buildGradingFilter({
        preset: brand.colorPreset,
        lutPath: null, // LUTs deferred to a follow-up; preset is sufficient for v1
        avgBrightness: null,
      });
      await execOrThrow(buildPerSegmentNormalize(clipPaths[i], out, gradeFilter));
      normalizedPaths.push(out);
    }

    // 4. Pass B: concat (or symlink/passthrough for single segment)
    const concatPath = resolve(workDir, 'concat.mp4');
    if (normalizedPaths.length === 1) {
      // Meme path: just rename — no concat work needed
      await execOrThrow({
        command: 'cp',
        args: [normalizedPaths[0], concatPath],
      });
    } else {
      const concatList = resolve(workDir, 'concat.txt');
      await writeFile(
        concatList,
        normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf-8',
      );
      await execOrThrow(buildConcatCommand(concatList, concatPath));
    }

    // 5. Pass C: overlay text + logo (preserves UGC audio with -c:a copy)
    const overlayPath = resolve(workDir, 'overlay.mp4');
    await execOrThrow(
      buildOverlayCommand({
        videoPath: concatPath,
        logoPath: logoLocal,
        outputPath: overlayPath,
        overlayText: input.overlayText,
        fontFile,
        primaryColorHex: brand.primaryColorHex,
      }),
    );

    // 6. Pass D: mix UGC audio + music (sidechain ducking on by default).
    //    -16 dB ≈ 0.158 linear amplitude
    const finalPath = resolve(workDir, 'final.mp4');
    await execOrThrow(
      buildAudioMixCommand(overlayPath, musicLocal, finalPath, 0.158, { ducking: true }),
    );

    // 7. Probe duration
    const durationS = await ffprobeDuration(finalPath);

    // 8. Upload to R2
    const now = new Date();
    const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r2Key = `rendered/${input.brandId}/${yyyyMm}/${input.jobId}-simple-pipeline.mp4`;
    const buffer = await readFile(finalPath);
    await uploadFile(r2Key, buffer, 'video/mp4');
    console.log(`[render] uploaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB → ${r2Key}, duration=${durationS.toFixed(1)}s`);

    return { r2Key, durationS, workDir };
  } catch (err) {
    console.error(`[render] FAIL jobId=${input.jobId}: ${(err as Error).message}`);
    throw err;
  }
}

/** Optional cleanup the orchestrator may invoke once R2 upload is confirmed. */
export async function cleanupRenderWorkdir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true });
}

// ─── Sub-commands ──────────────────────────────────────────────────────────

function buildPerSegmentNormalize(
  inputPath: string,
  outputPath: string,
  gradeFilter: string,
): FfCommand {
  // scale → pad → fps → color grade → encode
  const vf = [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${FPS}`,
    gradeFilter,
  ]
    .filter(Boolean)
    .join(',');

  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', X264_PRESET,
      '-crf', String(CRF),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      outputPath,
    ],
  };
}

function buildConcatCommand(concatListPath: string, outputPath: string): FfCommand {
  // Concat demuxer requires identical codecs/dims/fps — Pass A guarantees this.
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      outputPath,
    ],
  };
}

interface OverlayCommandOpts {
  videoPath: string;
  logoPath: string;
  outputPath: string;
  overlayText: string;
  fontFile: string;
  primaryColorHex: string; // e.g. "#E8B4A2"
}

function buildOverlayCommand(opts: OverlayCommandOpts): FfCommand {
  // Lower-third Y position: 78% from top
  const TEXT_Y_PCT = 0.78;
  const FONT_SIZE = 64;
  const TEXT_BOX_PADDING = 16;
  const SHADOW_OFFSET = 4;

  // Logo sized to ~15% composition height
  const LOGO_HEIGHT = Math.round(HEIGHT * 0.15);
  const LOGO_OPACITY = 0.85;
  const LOGO_MARGIN = 36;

  const escapedText = escapeForDrawtext(opts.overlayText);
  const escapedFont = opts.fontFile.replace(/:/g, '\\:'); // ffmpeg drawtext

  // Filter_complex:
  //   [0:v] drawtext... [vt]
  //   [1:v] format=rgba,colorchannelmixer=aa=0.85,scale=-1:LOGO_HEIGHT [logo]
  //   [vt][logo] overlay=W-w-LOGO_MARGIN:H-h-LOGO_MARGIN [vout]
  const drawtextFilter =
    `drawtext=fontfile='${escapedFont}':` +
    `text='${escapedText}':` +
    `fontsize=${FONT_SIZE}:` +
    `fontcolor=white:` +
    `box=1:boxcolor=black@0.35:boxborderw=${TEXT_BOX_PADDING}:` +
    `shadowcolor=black@0.6:shadowx=${SHADOW_OFFSET}:shadowy=${SHADOW_OFFSET}:` +
    `x=(w-text_w)/2:` +
    `y=h*${TEXT_Y_PCT}-text_h/2`;

  const filterComplex = [
    `[0:v]${drawtextFilter}[vt]`,
    `[1:v]format=rgba,colorchannelmixer=aa=${LOGO_OPACITY},scale=-1:${LOGO_HEIGHT}[logo]`,
    `[vt][logo]overlay=W-w-${LOGO_MARGIN}:H-h-${LOGO_MARGIN}[vout]`,
  ].join(';');

  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', opts.videoPath,
      '-i', opts.logoPath,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', X264_PRESET,
      '-crf', String(CRF),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      opts.outputPath,
    ],
  };
}

/** Escape characters meaningful to ffmpeg's drawtext filter syntax. */
function escapeForDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

async function ffprobeDuration(path: string): Promise<number> {
  const out = await execOrThrow({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ],
  });
  return Number(out.trim()) || 0;
}

// ─── Supabase fetchers ─────────────────────────────────────────────────────

interface FetchedSegment {
  id: string;
  parentAssetId: string;
  clipR2Key: string;
  startS: number;
  endS: number;
}

async function fetchSegmentsInOrder(segmentIds: string[]): Promise<FetchedSegment[]> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, clip_r2_key, start_s, end_s')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`renderSimplePipeline: failed to fetch segments: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`renderSimplePipeline: no segments found for ids=[${segmentIds.join(', ')}]`);
  }
  // Must preserve agent-emitted order. .in() doesn't guarantee order.
  const byId = new Map(data.map((r: any) => [r.id, r as any]));
  const ordered: FetchedSegment[] = [];
  for (const id of segmentIds) {
    const row = byId.get(id);
    if (!row) {
      throw new Error(`renderSimplePipeline: segment id=${id} not found in asset_segments`);
    }
    if (!row.clip_r2_key) {
      throw new Error(
        `renderSimplePipeline: segment id=${id} has no clip_r2_key. Phase 2.5 backfill required.`,
      );
    }
    ordered.push({
      id: row.id,
      parentAssetId: row.parent_asset_id,
      clipR2Key: row.clip_r2_key,
      startS: Number(row.start_s),
      endS: Number(row.end_s),
    });
  }
  return ordered;
}

interface BrandRenderConfig {
  logoR2Key: string;
  primaryColorHex: string;
  colorPreset: ColorPreset | null;
}

async function fetchBrandRenderConfig(brandId: string): Promise<BrandRenderConfig> {
  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .select('logo_r2_key, primary_color, color_grade_preset')
    .eq('brand_id', brandId)
    .single();
  if (error) {
    throw new Error(`renderSimplePipeline: failed to fetch brand_configs for ${brandId}: ${error.message}`);
  }
  if (!data.logo_r2_key) {
    throw new Error(`renderSimplePipeline: brand ${brandId} has no logo_r2_key`);
  }
  return {
    logoR2Key: data.logo_r2_key,
    primaryColorHex: data.primary_color,
    colorPreset: (data.color_grade_preset as ColorPreset | null) ?? null,
  };
}
