import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { env } from '../config/env.js';
import { uploadFile } from '../lib/r2-storage.js';
import { buildExportCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import type { PlatformOutputs } from '../types/database.js';

type Platform = 'tiktok' | 'instagram' | 'youtube';

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube'];

const MAX_SIZE_MB: Record<Platform, number> = {
  tiktok: 287,
  instagram: 100,
  youtube: 256,
};

export interface ExportResult {
  outputs: PlatformOutputs;
  localPaths: Record<Platform, string>;
}

export async function exportPlatforms(
  jobId: string,
  brandId: string,
  inputVideoPath: string,
  slug: string,
): Promise<ExportResult> {
  const workDir = join(env.RENDER_TEMP_DIR, jobId, 'exports');
  const date = new Date().toISOString().slice(0, 10);
  const month = date.slice(0, 7);

  const outputs: PlatformOutputs = {};
  const localPaths: Record<string, string> = {};

  for (const platform of PLATFORMS) {
    const filename = `${date}_${slug}_v1_${platform}.mp4`;
    const localPath = join(workDir, filename);
    const r2Key = `rendered/${brandId}/${month}/${filename}`;

    // Encode for platform
    console.log(`[exporter] Encoding for ${platform}: ${filename}`);
    await execOrThrow(buildExportCommand(inputVideoPath, localPath, platform));

    // Verify file size
    const fileStat = await stat(localPath);
    const sizeMb = fileStat.size / (1024 * 1024);
    if (sizeMb > MAX_SIZE_MB[platform]) {
      console.warn(`[exporter] WARNING: ${platform} export is ${sizeMb.toFixed(1)}MB (max ${MAX_SIZE_MB[platform]}MB)`);
    }

    // Upload to R2
    console.log(`[exporter] Uploading ${r2Key} (${sizeMb.toFixed(1)}MB)`);
    const stream = createReadStream(localPath);
    await uploadFile(r2Key, stream, 'video/mp4');

    outputs[platform] = r2Key;
    localPaths[platform] = localPath;
    console.log(`[exporter] ${platform} done: ${r2Key}`);
  }

  return { outputs, localPaths };
}
