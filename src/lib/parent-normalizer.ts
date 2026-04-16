import { stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createReadStream } from 'node:fs';
import { exec } from './exec.js';
import { buildProbeCommand } from './ffmpeg.js';
import { execOrThrow } from './exec.js';
import { uploadFile } from './r2-storage.js';

export interface PreNormalizeInput {
  inputPath: string;
  brandId: string;
  assetId: string;
  outputDir?: string;
}

export interface PreNormalizeResult {
  localPath: string;
  r2Key: string;
  durationS: number;
  fileSizeBytes: number;
  encodeMs: number;
}

export async function preNormalizeParent(
  input: PreNormalizeInput,
): Promise<PreNormalizeResult> {
  const outDir = input.outputDir ?? dirname(input.inputPath);
  const localPath = `${outDir}/${input.assetId}_normalized.mp4`;
  const r2Key = `parents/normalized/${input.brandId}/${input.assetId}.mp4`;

  const started = Date.now();
  const result = await exec({
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', input.inputPath,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      localPath,
    ],
  });
  const encodeMs = Date.now() - started;

  if (result.exitCode !== 0) {
    await unlink(localPath).catch(() => {});
    throw new Error(
      `ffmpeg pre-normalize failed (exit ${result.exitCode}): ${result.stderr.slice(-500)}`,
    );
  }

  const fileStat = await stat(localPath);

  const probeRaw = await execOrThrow(buildProbeCommand(localPath));
  const probeInfo = JSON.parse(probeRaw);
  const durationS = probeInfo.format?.duration ? parseFloat(probeInfo.format.duration) : 0;

  try {
    const stream = createReadStream(localPath);
    await uploadFile(r2Key, stream, 'video/mp4');
  } catch (uploadErr) {
    await unlink(localPath).catch(() => {});
    throw uploadErr;
  }

  return {
    localPath,
    r2Key,
    durationS,
    fileSizeBytes: fileStat.size,
    encodeMs,
  };
}
