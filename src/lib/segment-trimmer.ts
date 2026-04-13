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
  geminiFileUri: string | null;
  durationSeconds: number;
}

// ── Trim a segment from its R2 parent clip ──

/**
 * Downloads a parent clip from R2, trims the segment range via ffmpeg,
 * and returns the local trimmed file path.
 *
 * Always re-encodes to 720p libx264 CRF 28 to keep trimmed files small
 * (~3-8 MB for 5-15s segments). Stream-copy was dropped because 4K UGC
 * produced 79 MB trims that bottlenecked Gemini uploads.
 *
 * Optional parentCache avoids re-downloading the same parent file across
 * multiple trims. When provided, the caller owns the lifecycle — parent
 * files are NOT deleted after each trim. Call cleanupParentCache() in finally.
 */
export async function trimSegmentFromR2(
  parentAssetR2Key: string,
  startS: number,
  endS: number,
  segmentId: string,
  workDir: string,
  parentCache?: Map<string, string>,
): Promise<TrimmedSegment> {
  await mkdir(workDir, { recursive: true });

  const outPath = `${workDir}/${segmentId}.mp4`;
  const duration = endS - startS;
  const usingCache = parentCache !== undefined;

  // 1. Resolve parent path — check cache first
  let parentPath: string;
  let cacheHit = false;

  if (usingCache && parentCache.has(parentAssetR2Key)) {
    parentPath = parentCache.get(parentAssetR2Key)!;
    cacheHit = true;
  } else {
    parentPath = `${workDir}/_parent_${segmentId}.mp4`;
    console.log(`[segment-trimmer] Downloading ${parentAssetR2Key} for segment ${segmentId}...`);
    await downloadToFile(parentAssetR2Key, parentPath);
    if (usingCache) {
      parentCache.set(parentAssetR2Key, parentPath);
    }
  }

  if (cacheHit) {
    console.log(`[segment-trimmer] Cache hit for ${parentAssetR2Key} (segment ${segmentId})`);
  }

  try {
    // 2. Re-encode to 720p — small files for Gemini analysis
    const result = await exec({
      command: 'ffmpeg',
      args: [
        '-y', '-ss', String(startS), '-i', parentPath,
        '-t', String(duration),
        '-vf', 'scale=-2:720',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero',
        outPath,
      ],
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg trim+downscale failed for segment ${segmentId} (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    return {
      segmentId,
      localPath: outPath,
      geminiFileName: null,
      geminiFileUri: null,
      durationSeconds: duration,
    };
  } finally {
    // 3. Delete parent temp file only when NOT using cache
    if (!usingCache) {
      await unlink(parentPath).catch(() => {});
    }
  }
}

// ── Parent cache cleanup ──

/**
 * Deletes all cached parent files. Call in finally after all trims are done.
 */
export async function cleanupParentCache(
  cache: Map<string, string>,
): Promise<void> {
  for (const [r2Key, localPath] of cache) {
    try {
      await unlink(localPath);
      console.log(`[segment-trimmer] Cleaned up cached parent: ${r2Key}`);
    } catch {
      // File may already be gone — that's fine
    }
  }
  cache.clear();
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
      seg.geminiFileUri = file.uri;

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

      // Update URI after polling (may have changed)
      seg.geminiFileUri = file.uri;
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
