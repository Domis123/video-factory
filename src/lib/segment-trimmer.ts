import { mkdir, unlink, stat } from 'node:fs/promises';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { downloadToFile } from './r2-storage.js';
import { exec } from './exec.js';
import { env } from '../config/env.js';

// ── Types ──

export interface TrimmedSegment {
  segmentId: string;
  localPath: string;
  geminiFileName: string | null;
  durationSeconds: number;
}

// ── Trim a segment from its R2 parent clip ──

/**
 * Downloads a parent clip from R2, trims the segment range via ffmpeg,
 * and returns the local trimmed file path.
 *
 * Strategy: try stream-copy first (fast, lossless). If ffmpeg fails
 * (common with HEVC/iOS UGC), retry with libx264 re-encode.
 */
export async function trimSegmentFromR2(
  parentAssetR2Key: string,
  startS: number,
  endS: number,
  segmentId: string,
  workDir: string,
): Promise<TrimmedSegment> {
  await mkdir(workDir, { recursive: true });

  const parentPath = `${workDir}/_parent_${segmentId}.mp4`;
  const outPath = `${workDir}/${segmentId}.mp4`;
  const duration = endS - startS;

  // 1. Download parent from R2
  console.log(`[segment-trimmer] Downloading ${parentAssetR2Key} for segment ${segmentId}...`);
  await downloadToFile(parentAssetR2Key, parentPath);

  try {
    // 2. Try stream copy first
    const copyResult = await exec({
      command: 'ffmpeg',
      args: [
        '-y', '-ss', String(startS), '-i', parentPath,
        '-t', String(duration),
        '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        outPath,
      ],
    });

    if (copyResult.exitCode !== 0) {
      // 3. Fallback: re-encode
      console.warn(`[segment-trimmer] Stream copy failed for ${segmentId}, re-encoding...`);
      const encodeResult = await exec({
        command: 'ffmpeg',
        args: [
          '-y', '-ss', String(startS), '-i', parentPath,
          '-t', String(duration),
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
          '-c:a', 'aac',
          '-avoid_negative_ts', 'make_zero',
          outPath,
        ],
      });

      if (encodeResult.exitCode !== 0) {
        throw new Error(
          `ffmpeg re-encode failed for segment ${segmentId} (exit ${encodeResult.exitCode}): ${encodeResult.stderr}`,
        );
      }
    }

    return {
      segmentId,
      localPath: outPath,
      geminiFileName: null,
      durationSeconds: duration,
    };
  } finally {
    // 4. Always delete the parent temp file
    await unlink(parentPath).catch(() => {});
  }
}

// ── Upload trimmed segments to Gemini Files API ──

/**
 * Uploads an array of trimmed segments to Gemini Files API in parallel,
 * polls each until ACTIVE, and mutates each segment's geminiFileName.
 */
export async function uploadSegmentsToGemini(
  segments: TrimmedSegment[],
): Promise<TrimmedSegment[]> {
  const fileManager = new GoogleAIFileManager(env.GEMINI_API_KEY);

  await Promise.all(
    segments.map(async (seg) => {
      // Upload
      const uploadResult = await fileManager.uploadFile(seg.localPath, {
        mimeType: 'video/mp4',
        displayName: `curator-candidate-${seg.segmentId}`,
      });

      let file = uploadResult.file;
      seg.geminiFileName = file.name;

      // Poll until ACTIVE
      while (file.state === FileState.PROCESSING) {
        console.log(`[segment-trimmer] Gemini file ${file.name} still processing, waiting 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        file = await fileManager.getFile(file.name);
      }

      if (file.state === FileState.FAILED) {
        throw new Error(
          `Gemini file processing failed for segment ${seg.segmentId}: ${file.error?.message ?? 'unknown'}`,
        );
      }

      console.log(`[segment-trimmer] Gemini file ACTIVE: ${file.name} (segment ${seg.segmentId})`);
    }),
  );

  return segments;
}

// ── Cleanup Gemini files (call in finally) ──

/**
 * Deletes uploaded Gemini files. Logs warnings on failure — safe to call in finally.
 */
export async function cleanupGeminiSegments(
  segments: TrimmedSegment[],
): Promise<void> {
  const fileManager = new GoogleAIFileManager(env.GEMINI_API_KEY);

  for (const seg of segments) {
    if (!seg.geminiFileName) continue;
    try {
      await fileManager.deleteFile(seg.geminiFileName);
      console.log(`[segment-trimmer] Deleted Gemini file: ${seg.geminiFileName}`);
    } catch (err) {
      console.warn(
        `[segment-trimmer] Failed to delete Gemini file ${seg.geminiFileName}: ${(err as Error).message}`,
      );
    }
  }
}
