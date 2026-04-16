/**
 * Test harness for preNormalizeParent().
 *
 * Usage:
 *   npx tsx src/scripts/test-pre-normalize.ts /path/to/source.mov nordpilates
 *
 * Downloads nothing — expects a local file. To get one from R2:
 *   npx tsx -e "import {downloadToFile} from './src/lib/r2-storage.js'; downloadToFile('assets/nordpilates/SOME_UUID.MOV', '/tmp/test-clip.mov')"
 *
 * Prints input/output stats, ffprobe of normalized file, R2 key written.
 * Cleans up local normalized file. Does NOT delete from R2.
 */

import 'dotenv/config';
import { stat, unlink } from 'node:fs/promises';
import { execOrThrow } from '../lib/exec.js';
import { buildProbeCommand } from '../lib/ffmpeg.js';
import { preNormalizeParent } from '../lib/parent-normalizer.js';

async function main() {
  const inputPath = process.argv[2];
  const brandId = process.argv[3] ?? 'nordpilates';

  if (!inputPath) {
    console.error('Usage: npx tsx src/scripts/test-pre-normalize.ts <local-file> [brand_id]');
    process.exit(1);
  }

  const inputStat = await stat(inputPath);
  const inputMb = (inputStat.size / 1024 / 1024).toFixed(1);
  console.log(`Input: ${inputPath} (${inputMb} MB)`);

  const assetId = `test-${Date.now()}`;
  console.log(`Asset ID: ${assetId}, Brand: ${brandId}`);
  console.log('Normalizing...\n');

  const result = await preNormalizeParent({
    inputPath,
    brandId,
    assetId,
    outputDir: '/tmp/video-factory',
  });

  const outputMb = (result.fileSizeBytes / 1024 / 1024).toFixed(1);
  const ratio = (result.fileSizeBytes / inputStat.size * 100).toFixed(0);
  console.log('='.repeat(60));
  console.log('PRE-NORMALIZE RESULT');
  console.log('='.repeat(60));
  console.log(`Input size:     ${inputMb} MB`);
  console.log(`Output size:    ${outputMb} MB (${ratio}% of input)`);
  console.log(`Encode time:    ${(result.encodeMs / 1000).toFixed(1)}s`);
  console.log(`Duration:       ${result.durationS.toFixed(1)}s`);
  console.log(`R2 key:         ${result.r2Key}`);
  console.log(`Local path:     ${result.localPath}`);
  console.log('');

  console.log('FFPROBE OUTPUT:');
  const probeRaw = await execOrThrow(buildProbeCommand(result.localPath));
  const probe = JSON.parse(probeRaw);
  const video = probe.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
  const audio = probe.streams?.find((s: Record<string, unknown>) => s.codec_type === 'audio');
  console.log(`  Video: ${video?.codec_name} ${video?.width}x${video?.height} ${video?.pix_fmt} ${video?.r_frame_rate}fps`);
  if (audio) {
    console.log(`  Audio: ${audio.codec_name} ${audio.sample_rate}Hz ${audio.channels}ch`);
  } else {
    console.log('  Audio: none');
  }
  console.log('');

  await unlink(result.localPath).catch(() => {});
  console.log('Local file cleaned up. R2 file preserved for inspection.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
