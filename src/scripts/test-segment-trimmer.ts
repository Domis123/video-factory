import { mkdir, rm, stat } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import { execOrThrow } from '../lib/exec.js';
import {
  trimSegmentFromR2,
  uploadSegmentsToGemini,
  cleanupGeminiSegments,
} from '../lib/segment-trimmer.js';

const WORK_DIR = '/tmp/test-trimmer';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

async function main() {
  console.log('\n🔧 Segment Trimmer — Integration Test\n');

  // Clean up any previous run
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });

  // ── 1. Pick a test segment ──

  console.log('1. Picking a high-quality exercise segment...');
  const { data: segment, error: segErr } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, start_s, end_s, duration_s, segment_type, quality_score, description')
    .eq('segment_type', 'exercise')
    .gte('quality_score', 8)
    .limit(1)
    .single();

  if (segErr || !segment) {
    console.error('Failed to find a test segment:', segErr?.message ?? 'no rows');
    console.log('Trying any segment with quality >= 7...');
    const { data: fallback, error: fbErr } = await supabaseAdmin
      .from('asset_segments')
      .select('id, parent_asset_id, start_s, end_s, duration_s, segment_type, quality_score, description')
      .gte('quality_score', 7)
      .limit(1)
      .single();

    if (fbErr || !fallback) {
      console.error('No suitable segment found:', fbErr?.message ?? 'no rows');
      process.exit(1);
    }
    Object.assign(segment!, fallback);
  }

  // Resolve parent r2_key
  const { data: parent, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('r2_key')
    .eq('id', segment!.parent_asset_id)
    .single();

  if (parentErr || !parent) {
    console.error('Failed to resolve parent asset:', parentErr?.message ?? 'no row');
    process.exit(1);
  }

  const seg = segment!;
  console.log(`  Segment: ${seg.id}`);
  console.log(`  Type: ${seg.segment_type}, Quality: ${seg.quality_score}`);
  console.log(`  Parent R2 key: ${parent.r2_key}`);
  console.log(`  Range: ${seg.start_s}s – ${seg.end_s}s (${seg.duration_s}s)`);
  console.log(`  Description: ${seg.description?.slice(0, 80)}...`);

  // ── 2. Trim segment ──

  console.log('\n2. Trimming segment from R2 parent...');
  const trimmed = await trimSegmentFromR2(
    parent.r2_key,
    Number(seg.start_s),
    Number(seg.end_s),
    seg.id,
    WORK_DIR,
  );

  const fileStat = await stat(trimmed.localPath);
  console.log(`  Output: ${trimmed.localPath}`);
  console.log(`  File size: ${(fileStat.size / 1024).toFixed(1)} KB`);

  // ffprobe to verify duration
  const probeJson = await execOrThrow({
    command: 'ffprobe',
    args: [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', trimmed.localPath,
    ],
  });
  const probe = JSON.parse(probeJson);
  const probeDuration = parseFloat(probe.format.duration);
  const expectedDuration = Number(seg.end_s) - Number(seg.start_s);

  console.log(`  ffprobe duration: ${probeDuration.toFixed(2)}s (expected ~${expectedDuration.toFixed(2)}s)`);

  const sizeKB = fileStat.size / 1024;
  const sizeMB = sizeKB / 1024;
  check(`Trimmed file size between 100 KB and 10 MB (got ${sizeMB.toFixed(2)} MB)`, sizeKB > 100 && sizeMB < 10);
  check(
    `ffprobe duration within ±0.5s of expected (${probeDuration.toFixed(2)} vs ${expectedDuration.toFixed(2)})`,
    Math.abs(probeDuration - expectedDuration) <= 0.5,
  );

  // ── 3. Upload to Gemini ──

  console.log('\n3. Uploading trimmed segment to Gemini Files API...');
  await uploadSegmentsToGemini([trimmed]);

  check('Gemini file name assigned', trimmed.geminiFileName !== null && trimmed.geminiFileName.length > 0);
  console.log(`  Gemini file: ${trimmed.geminiFileName}`);
  console.log('  State: ACTIVE ✓');

  // ── 4. Cleanup ──

  console.log('\n4. Cleaning up Gemini files...');
  await cleanupGeminiSegments([trimmed]);

  // ── Summary ──

  console.log('\n========== Results ==========');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}`);
  console.log('=============================\n');

  // Cleanup local files
  await rm(WORK_DIR, { recursive: true, force: true });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
