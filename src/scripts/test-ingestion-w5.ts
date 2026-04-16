/**
 * W5 integration test: calls ingestAsset() directly with a real clip.
 * Verifies pre_normalized_r2_key is populated and segments are trimmed
 * from the normalized parent.
 *
 * Usage:
 *   npx tsx src/scripts/test-ingestion-w5.ts
 *
 * Downloads a small nordpilates clip from R2, ingests as carnimeat_w5-test,
 * verifies the result, then cleans up DB rows (leaves R2 objects).
 */

import 'dotenv/config';
import { mkdir, unlink } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { execOrThrow } from '../lib/exec.js';
import { buildProbeCommand } from '../lib/ffmpeg.js';
import { ingestAsset } from '../workers/ingestion.js';

const TEST_BRAND = 'carnimeat';
const TEST_FILENAME = `carnimeat_w5-test-${Date.now()}.MOV`;
const SOURCE_R2_KEY = 'assets/nordpilates/93bce975-4f34-45fd-bc47-407340458efc.MOV';
const WORK_DIR = '/tmp/video-factory/w5-test';

async function main() {
  await mkdir(WORK_DIR, { recursive: true });
  const localPath = `${WORK_DIR}/source.MOV`;

  console.log(`Downloading test clip from R2: ${SOURCE_R2_KEY}`);
  await downloadToFile(SOURCE_R2_KEY, localPath);
  console.log('Downloaded.\n');

  console.log('Running ingestAsset()...\n');
  const started = Date.now();
  const asset = await ingestAsset({
    filePath: localPath,
    brandId: TEST_BRAND,
    filename: TEST_FILENAME,
  });
  const wallMs = Date.now() - started;
  console.log(`\ningestAsset completed in ${(wallMs / 1000).toFixed(1)}s\n`);

  // ── Verification 1: assets row has pre_normalized_r2_key ──
  console.log('='.repeat(60));
  console.log('VERIFICATION');
  console.log('='.repeat(60));

  const { data: assetRow } = await supabaseAdmin
    .from('assets')
    .select('id, brand_id, r2_key, pre_normalized_r2_key, duration_seconds')
    .eq('id', asset.id)
    .single();

  console.log(`\n1. Asset row:`);
  console.log(`   id: ${assetRow?.id}`);
  console.log(`   brand_id: ${assetRow?.brand_id}`);
  console.log(`   r2_key: ${assetRow?.r2_key}`);
  console.log(`   pre_normalized_r2_key: ${assetRow?.pre_normalized_r2_key}`);
  const normOk = !!assetRow?.pre_normalized_r2_key?.startsWith('parents/normalized/');
  console.log(`   ${normOk ? '✓' : '✗'} pre_normalized_r2_key populated`);

  // ── Verification 2: asset_segments exist ──
  const { data: segments } = await supabaseAdmin
    .from('asset_segments')
    .select('id, segment_index, segment_type, clip_r2_key, start_s, end_s')
    .eq('parent_asset_id', asset.id)
    .order('segment_index');

  console.log(`\n2. Segments: ${segments?.length ?? 0} rows`);
  const segOk = (segments?.length ?? 0) > 0;
  console.log(`   ${segOk ? '✓' : '✗'} segments created`);

  // ── Verification 3: probe a segment clip ──
  let clipOk = false;
  if (segments && segments.length > 0) {
    const seg = segments.find(s => s.clip_r2_key) ?? segments[0];
    if (seg.clip_r2_key) {
      const clipPath = `${WORK_DIR}/check-clip.mp4`;
      await downloadToFile(seg.clip_r2_key, clipPath);
      const probeRaw = await execOrThrow(buildProbeCommand(clipPath));
      const probe = JSON.parse(probeRaw);
      const video = probe.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
      const audio = probe.streams?.find((s: Record<string, unknown>) => s.codec_type === 'audio');

      console.log(`\n3. Segment clip probe (${seg.clip_r2_key}):`);
      console.log(`   Video: ${video?.codec_name} ${video?.width}x${video?.height} ${video?.pix_fmt} ${video?.r_frame_rate}`);
      if (audio) {
        console.log(`   Audio: ${audio.codec_name} ${audio.sample_rate}Hz ${audio.channels}ch`);
      } else {
        console.log('   Audio: none');
      }
      const height = video?.height as number | undefined;
      clipOk = height === 720;
      console.log(`   ${clipOk ? '✓' : '✗'} segment trimmed from normalized parent (720p height from 1080p source)`);
      await unlink(clipPath).catch(() => {});
    } else {
      console.log('\n3. No segment has clip_r2_key — cannot verify trim source');
    }
  }

  // ── Summary ──
  const allOk = normOk && segOk && clipOk;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${allOk ? 'ALL CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗'}`);
  console.log(`${'='.repeat(60)}`);

  // ── Cleanup DB rows (cascade handles segments) ──
  console.log('\nCleaning up DB rows...');
  const { error: delErr } = await supabaseAdmin
    .from('assets')
    .delete()
    .eq('id', asset.id);
  if (delErr) {
    console.warn(`Cleanup failed: ${delErr.message}. Manual cleanup needed for asset ${asset.id}`);
  } else {
    console.log(`Deleted asset ${asset.id} + cascaded segments.`);
  }

  await unlink(localPath).catch(() => {});
  console.log('R2 objects left in place for manual inspection.');

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
