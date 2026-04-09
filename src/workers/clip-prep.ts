import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { buildTrimCommand, buildNormalizeCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import { buildGradingFilter, type ColorPreset } from '../lib/color-grading.js';
import type { ContextPacket } from '../types/database.js';

export interface ClipPrepResult {
  jobId: string;
  clipsDir: string;
  preparedClips: PreparedClip[];
}

export interface PreparedClip {
  segmentId: number;
  localPath: string;
  r2Key: string;
  trimStart: number;
  trimEnd: number;
}

export interface ClipPrepOptions {
  /** Local path to downloaded .cube LUT file (null = no LUT) */
  lutPath?: string | null;
  /** Brand color grade preset */
  colorPreset?: ColorPreset | null;
  /** Per-asset brightness values from ingestion (keyed by r2_key) */
  assetBrightness?: Record<string, number>;
}

export async function prepareClips(
  jobId: string,
  contextPacket: ContextPacket,
  options: ClipPrepOptions = {},
): Promise<ClipPrepResult> {
  const workDir = join(env.RENDER_TEMP_DIR, jobId);
  const rawDir = join(workDir, 'raw');
  const clipsDir = join(workDir, 'clips');
  await mkdir(rawDir, { recursive: true });
  await mkdir(clipsDir, { recursive: true });

  const preparedClips: PreparedClip[] = [];
  const selections = contextPacket.clips.clip_selections;

  for (const sel of selections) {
    // Handle single clip or multi-clip segments
    const clips = sel.clips ?? [
      { asset_id: sel.asset_id!, r2_key: sel.r2_key!, trim: sel.trim! },
    ];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const suffix = clips.length > 1 ? `_${i}` : '';
      const rawPath = join(rawDir, `seg${sel.segment_id}${suffix}_raw.mp4`);
      const trimmedPath = join(clipsDir, `seg${sel.segment_id}${suffix}_trimmed.mp4`);
      const normalizedPath = join(clipsDir, `seg${sel.segment_id}${suffix}.mp4`);

      // 1. Download from R2
      console.log(`[clip-prep] Downloading ${clip.r2_key}`);
      await downloadToFile(clip.r2_key, rawPath);

      // 2. Trim
      if (clip.trim) {
        console.log(`[clip-prep] Trimming ${clip.trim.start_s}s → ${clip.trim.end_s}s`);
        await execOrThrow(buildTrimCommand(rawPath, trimmedPath, clip.trim.start_s, clip.trim.end_s));
      }

      // 3. Normalize to 1080x1920 30fps h264 -14 LUFS
      const inputForNorm = clip.trim ? trimmedPath : rawPath;
      console.log(`[clip-prep] Normalizing to 1080x1920 30fps`);
      await execOrThrow(buildNormalizeCommand(inputForNorm, normalizedPath));

      // 4. Color grading (auto-level + brand LUT or preset)
      if (options.colorPreset || options.lutPath) {
        const gradedPath = join(clipsDir, `seg${sel.segment_id}${suffix}_graded.mp4`);
        const gradingFilter = buildGradingFilter({
          preset: options.colorPreset ?? null,
          lutPath: options.lutPath ?? null,
          avgBrightness: options.assetBrightness?.[clip.r2_key] ?? null,
        });
        console.log(`[clip-prep] Color grading: ${options.lutPath ? 'LUT' : options.colorPreset}`);
        await execOrThrow({
          command: 'ffmpeg',
          args: [
            '-y', '-i', normalizedPath,
            '-vf', gradingFilter,
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            gradedPath,
          ],
        });
        // Replace normalized with graded
        await execOrThrow({ command: 'mv', args: [gradedPath, normalizedPath] });
      }

      preparedClips.push({
        segmentId: sel.segment_id,
        localPath: normalizedPath,
        r2Key: clip.r2_key,
        trimStart: clip.trim?.start_s ?? 0,
        trimEnd: clip.trim?.end_s ?? 0,
      });
    }
  }

  // Clean up raw downloads
  await rm(rawDir, { recursive: true, force: true });

  console.log(`[clip-prep] Prepared ${preparedClips.length} clips in ${clipsDir}`);
  return { jobId, clipsDir, preparedClips };
}
