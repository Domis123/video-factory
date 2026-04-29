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
  buildTrimCommand,
  type FfCommand,
} from '../../lib/ffmpeg.js';
import { exec, execOrThrow } from '../../lib/exec.js';
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

// Composition height (used for logo scaling). Width is implicit via H*9/16
// in the overlay filter chain. fps is set by the pre_normalized parent
// (30fps from parent-normalizer.ts at ingest); we don't re-set it.
const HEIGHT = 1920;
const CRF = 18;

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

    // 2. Download unique parent files (cached across same-parent segments) +
    //    music + logo. Routine path with N segments from one parent: 1
    //    parent download + N ffmpeg-trims. Meme path: 1 parent download + 1
    //    trim. Replaces the old "download N pre-trimmed 720p clips" pattern.
    const parentLocalByR2Key = new Map<string, string>();
    const uniqueParentR2Keys = [...new Set(segments.map((s) => s.parentR2Key))];
    console.log(
      `[render] downloading ${uniqueParentR2Keys.length} unique parent(s) for ${segments.length} segment(s)`,
    );
    await Promise.all(
      uniqueParentR2Keys.map(async (r2Key, idx) => {
        const local = resolve(workDir, `parent-${idx.toString().padStart(2, '0')}.mp4`);
        await downloadToFile(r2Key, local);
        parentLocalByR2Key.set(r2Key, local);
      }),
    );
    const musicLocal = resolve(workDir, 'music.mp3');
    const logoLocal = resolve(workDir, 'logo.png');
    await Promise.all([
      downloadToFile(input.musicR2Key, musicLocal),
      downloadToFile(brand.logoR2Key, logoLocal),
    ]);

    // 3. Pass A: ffmpeg-trim each segment from its cached parent. Uses
    //    `-c copy` (no re-encode) — pre_normalized parents are already
    //    1080×1920 30fps libx264 yuv420p AAC 44.1kHz, so a stream copy
    //    produces a frame-aligned trim with zero quality loss. Concat
    //    demuxer in pass B requires identical codecs across segments,
    //    which `-c copy` from the same parent guarantees.
    const trimmedPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const out = resolve(workDir, `trim-${i.toString().padStart(2, '0')}.mp4`);
      const parentLocal = parentLocalByR2Key.get(s.parentR2Key)!;
      await execOrThrow(buildTrimCommand(parentLocal, out, s.trimStartS, s.trimEndS));
      trimmedPaths.push(out);
    }

    // 4. Pass B: concat (or passthrough for single-segment meme)
    const concatPath = resolve(workDir, 'concat.mp4');
    if (trimmedPaths.length === 1) {
      await execOrThrow({ command: 'cp', args: [trimmedPaths[0], concatPath] });
    } else {
      const concatList = resolve(workDir, 'concat.txt');
      await writeFile(
        concatList,
        trimmedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf-8',
      );
      await execOrThrow(buildConcatCommand(concatList, concatPath));
    }

    // 5. Pass C: color grade + overlay text + logo. Single re-encode of the
    //    full concat at libx264 CRF 18 slow — the only re-encode of pixel
    //    data in this whole pipeline (parent was CRF 22 medium at ingest;
    //    Pass A's `-c copy` trim adds none). Net: two re-encodes of any
    //    given frame across the parent's lifecycle (CRF 22 medium at ingest
    //    + CRF 18 slow here). No upscale; no per-segment re-encode loop.
    const overlayPath = resolve(workDir, 'overlay.mp4');
    const gradeFilter = buildGradingFilter({
      preset: brand.colorPreset,
      lutPath: null, // LUTs deferred to a follow-up; preset is sufficient for v1
      avgBrightness: null,
    });
    await execOrThrow(
      buildOverlayCommand({
        videoPath: concatPath,
        logoPath: logoLocal,
        outputPath: overlayPath,
        overlayText: input.overlayText,
        fontFile,
        primaryColorHex: brand.primaryColorHex,
        gradeFilter,
      }),
    );

    // 6. Pass D: audio mix.
    //
    // Three audio paths, classified from the concatenated UGC overlay:
    //   - 'no_audio':   overlay has no audio stream at all.
    //                   Use music-only at 0.7. (c10 hotfix branch.)
    //   - 'no_speech':  overlay has audio but it's continuous noise/ambient
    //                   without natural speech pauses (silence_ratio below
    //                   the SPEECH_PAUSE_RATIO_FLOOR threshold). Round 3
    //                   addition: extends the c10 mute branch to cover loud-
    //                   non-speech audio (room noise, equipment hum, creator
    //                   music) that fights with our chosen track.
    //                   Use music-only at 0.7. Same path as 'no_audio'.
    //   - 'has_speech': overlay has audio with natural speech pauses (counts,
    //                   instructions, talking-head). Mix at -16 dB with
    //                   sidechain ducking — preserves speech intelligibility
    //                   over music.
    //
    // Threshold: silence_ratio is the fraction of the overlay duration spent
    // below -30 dB for ≥0.4s windows. Natural speech sits in 15-30%; pure
    // music or steady noise sits below ~5%. Threshold of 0.15 errs toward
    // muting (conservative — avoids music-vs-noise fights), so a clip with
    // very brief speech and a lot of background noise may be muted. Falls
    // open to operator catching it in QA review.
    const finalPath = resolve(workDir, 'final.mp4');
    const audioClass = await classifyOverlayAudio(overlayPath);
    if (audioClass === 'has_speech') {
      console.log(`[render] UGC has speech (silence_ratio≥0.15); mixing with music ducking at -16 dB`);
      await execOrThrow(
        buildAudioMixCommand(overlayPath, musicLocal, finalPath, 0.158, { ducking: true }),
      );
    } else {
      console.log(`[render] UGC ${audioClass === 'no_audio' ? 'has no audio stream' : 'has no speech (silence_ratio<0.15)'}; using music-only at volume 0.7`);
      await execOrThrow(buildMusicOnlyCommand(overlayPath, musicLocal, finalPath, 0.7));
    }

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
  /** Color grade filter chain (from buildGradingFilter). Empty string = no grade. */
  gradeFilter: string;
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

  // Pass C filter chain on input 0 (the concat'd video):
  //   1. <gradeFilter>  — color grade (preset or LUT)
  //   2. drawtext       — overlay text
  // Then overlay logo from input 1.
  // Single re-encode (libx264 -preset slow -crf 18) since pre_normalized
  // parent + concat -c copy carried the source through losslessly to here.
  const drawtextFilter =
    `drawtext=fontfile='${escapedFont}':` +
    `text='${escapedText}':` +
    `fontsize=${FONT_SIZE}:` +
    `fontcolor=white:` +
    `box=1:boxcolor=black@0.35:boxborderw=${TEXT_BOX_PADDING}:` +
    `shadowcolor=black@0.6:shadowx=${SHADOW_OFFSET}:shadowy=${SHADOW_OFFSET}:` +
    `x=(w-text_w)/2:` +
    `y=h*${TEXT_Y_PCT}-text_h/2`;

  const videoChain = opts.gradeFilter
    ? `${opts.gradeFilter},${drawtextFilter}`
    : drawtextFilter;

  const filterComplex = [
    `[0:v]${videoChain}[vt]`,
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
      '-preset', 'slow', // CRF 18 slow — matches Phase 3.5's buildNormalizeCommand
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

async function probeHasAudio(path: string): Promise<boolean> {
  const out = await execOrThrow({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ],
  });
  return out.trim() === 'audio';
}

type OverlayAudioClass = 'no_audio' | 'no_speech' | 'has_speech';
const SPEECH_NOISE_FLOOR_DB = -30; // silencedetect threshold
const SPEECH_PAUSE_MIN_S = 0.4; // shortest pause counted as silence
const SPEECH_PAUSE_RATIO_FLOOR = 0.15; // below this = continuous noise / no speech

/**
 * Classify the audio of a concatenated overlay to decide between music-only
 * and sidechain-ducked mix in Pass D.
 *
 * Round 3 (2026-04-29): extends c10's binary has-audio check with a
 * silencedetect-based speech-pause heuristic. Continuous audio (creator
 * music, HVAC, equipment hum) sits below 0.05 silence ratio; speech
 * naturally lands at 0.15+ due to inhalation and word pauses. The 0.15
 * floor is conservative — it errs toward muting on edge cases.
 */
async function classifyOverlayAudio(path: string): Promise<OverlayAudioClass> {
  if (!(await probeHasAudio(path))) return 'no_audio';

  // ffmpeg silencedetect emits silence_start / silence_end / silence_duration
  // lines on stderr. We don't decode video, just route audio through the
  // filter and discard output. Use exec() (not execOrThrow) since we need
  // stderr regardless of exit code (and silencedetect via -f null often
  // exits with non-zero on the pipe close anyway).
  const result = await exec({
    command: 'ffmpeg',
    args: [
      '-nostats',
      '-i', path,
      '-af', `silencedetect=noise=${SPEECH_NOISE_FLOOR_DB}dB:d=${SPEECH_PAUSE_MIN_S}`,
      '-f', 'null',
      '-',
    ],
  });

  const totalDur = await ffprobeDuration(path);
  if (totalDur <= 0) return 'no_audio';

  let totalSilenceS = 0;
  for (const line of result.stderr.split('\n')) {
    const m = line.match(/silence_duration:\s*([\d.]+)/);
    if (m) totalSilenceS += Number(m[1]);
  }
  const silenceRatio = totalSilenceS / totalDur;
  console.log(
    `[render] silence_ratio=${silenceRatio.toFixed(3)} (${totalSilenceS.toFixed(2)}s silent / ${totalDur.toFixed(2)}s total, threshold=${SPEECH_PAUSE_RATIO_FLOOR})`,
  );
  return silenceRatio < SPEECH_PAUSE_RATIO_FLOOR ? 'no_speech' : 'has_speech';
}

/**
 * Audio mix when the video has no UGC audio stream. Just attaches music
 * at `musicVolume` linear amplitude. Sidechain ducking is unnecessary
 * (no UGC track to duck against) and would fail anyway due to missing
 * [0:a] reference.
 */
function buildMusicOnlyCommand(
  videoPath: string,
  musicPath: string,
  outputPath: string,
  musicVolume: number,
): FfCommand {
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', videoPath,
      '-i', musicPath,
      '-filter_complex', `[1:a]volume=${musicVolume}[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ],
  };
}

// ─── Supabase fetchers ─────────────────────────────────────────────────────

interface FetchedSegment {
  id: string;
  parentAssetId: string;
  /**
   * R2 key of the source the render path will trim from. Prefer
   * `assets.pre_normalized_r2_key` (1080×1920 30fps libx264 CRF 22 medium —
   * single ingest re-encode, ready for `-c copy` trim). Fallback to
   * `asset_segments.clip_r2_key` (720p CRF 28 pre-trimmed) only if the
   * parent has no normalized version — defensive for any pre-W5 rows that
   * survived the clean-slate.
   */
  parentR2Key: string;
  parentSourceKind: 'pre_normalized' | 'pre_trimmed_clip';
  trimStartS: number;
  trimEndS: number;
}

async function fetchSegmentsInOrder(segmentIds: string[]): Promise<FetchedSegment[]> {
  const { data: segs, error: segErr } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, clip_r2_key, start_s, end_s')
    .in('id', segmentIds);
  if (segErr) {
    throw new Error(`renderSimplePipeline: failed to fetch segments: ${segErr.message}`);
  }
  if (!segs || segs.length === 0) {
    throw new Error(`renderSimplePipeline: no segments found for ids=[${segmentIds.join(', ')}]`);
  }

  const parentIds = [...new Set(segs.map((r: any) => r.parent_asset_id as string))];
  const { data: parents, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id, pre_normalized_r2_key')
    .in('id', parentIds);
  if (parentErr) {
    throw new Error(`renderSimplePipeline: failed to fetch parents: ${parentErr.message}`);
  }
  const parentByid = new Map((parents ?? []).map((p: any) => [p.id, p]));

  const segsById = new Map(segs.map((r: any) => [r.id, r as any]));
  const ordered: FetchedSegment[] = [];
  for (const id of segmentIds) {
    const row = segsById.get(id);
    if (!row) {
      throw new Error(`renderSimplePipeline: segment id=${id} not found in asset_segments`);
    }
    const parent = parentByid.get(row.parent_asset_id);
    const preNormalized = parent?.pre_normalized_r2_key as string | null | undefined;

    let parentR2Key: string;
    let parentSourceKind: 'pre_normalized' | 'pre_trimmed_clip';
    if (preNormalized) {
      parentR2Key = preNormalized;
      parentSourceKind = 'pre_normalized';
    } else if (row.clip_r2_key) {
      console.warn(
        `[render] segment ${id}: parent has no pre_normalized_r2_key; ` +
          `falling back to clip_r2_key (720p CRF 28). Quality will be degraded.`,
      );
      parentR2Key = row.clip_r2_key;
      parentSourceKind = 'pre_trimmed_clip';
    } else {
      throw new Error(
        `renderSimplePipeline: segment id=${id} has neither parent.pre_normalized_r2_key ` +
          `nor clip_r2_key. Cannot render.`,
      );
    }

    ordered.push({
      id: row.id,
      parentAssetId: row.parent_asset_id,
      parentR2Key,
      parentSourceKind,
      trimStartS: parentSourceKind === 'pre_trimmed_clip' ? 0 : Number(row.start_s),
      trimEndS:
        parentSourceKind === 'pre_trimmed_clip'
          ? Number(row.end_s) - Number(row.start_s)
          : Number(row.end_s),
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
