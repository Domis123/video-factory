import { supabaseAdmin } from '../config/supabase.js';
import { ingestAsset } from '../workers/ingestion.js';
import { transitionJob, logEvent, VALID_TRANSITIONS } from '../lib/job-manager.js';
import { buildProbeCommand, buildNormalizeCommand, buildTrimCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import { getPresignedUrl, deleteFile } from '../lib/r2-storage.js';
import { runQAChecks, allChecksPassed } from '../workers/qa-checker.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobStatus } from '../types/database.js';

const TEST_VIDEO = '/Users/eglemuznikaite/Documents/video-factory/video/babies.mov';
const TEST_BRAND = 'nordpilates';
const TEMP_DIR = '/tmp/video-factory-test';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: ${msg}`);
    failed++;
  }
}

console.log('\n🧪 Pipeline Integration Test\n');
await mkdir(TEMP_DIR, { recursive: true });

// ── Test 1: FFprobe ──
console.log('FFprobe:');
let probeDuration = 0;
await test('Probe test video', async () => {
  const raw = await execOrThrow(buildProbeCommand(TEST_VIDEO));
  const info = JSON.parse(raw);
  const dur = parseFloat(info.format?.duration ?? '0');
  const video = info.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
  console.log(`     Duration: ${dur.toFixed(1)}s, Resolution: ${video?.width}x${video?.height}, Codec: ${video?.codec_name}`);
  probeDuration = dur;
  if (dur === 0) throw new Error('Duration is 0');
});

// ── Test 2: FFmpeg trim ──
console.log('\nFFmpeg:');
const trimmedPath = join(TEMP_DIR, 'trimmed.mov');
await test('Trim first 3 seconds', async () => {
  const end = Math.min(3, probeDuration);
  await execOrThrow(buildTrimCommand(TEST_VIDEO, trimmedPath, 0, end));
});

// ── Test 3: FFmpeg normalize ──
const normalizedPath = join(TEMP_DIR, 'normalized.mp4');
await test('Normalize to 1080x1920 30fps', async () => {
  await execOrThrow(buildNormalizeCommand(trimmedPath, normalizedPath));
});

// ── Test 4: Verify normalized output ──
await test('Verify normalized video specs', async () => {
  const raw = await execOrThrow(buildProbeCommand(normalizedPath));
  const info = JSON.parse(raw);
  const video = info.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
  console.log(`     Normalized: ${video?.width}x${video?.height}, codec=${video?.codec_name}`);
  if (video?.width !== 1080 || video?.height !== 1920) {
    throw new Error(`Expected 1080x1920, got ${video?.width}x${video?.height}`);
  }
});

// ── Test 5: Ingestion (R2 + Supabase) ──
console.log('\nIngestion:');
let assetId = '';
await test('Ingest test video → R2 + Supabase', async () => {
  const asset = await ingestAsset({
    filePath: TEST_VIDEO,
    brandId: TEST_BRAND,
    filename: 'babies.mov',
  });
  assetId = asset.id;
  console.log(`     Asset ID: ${asset.id}`);
  console.log(`     R2 Key: ${asset.r2_key}`);
  console.log(`     Size: ${asset.file_size_mb}MB, Duration: ${asset.duration_seconds}s`);
});

await test('Verify asset in Supabase', async () => {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Asset not found');
  console.log(`     Brand: ${data.brand_id}, Content type: ${data.content_type}`);
});

await test('Generate presigned URL', async () => {
  const { data } = await supabaseAdmin
    .from('assets')
    .select('r2_key')
    .eq('id', assetId)
    .single();
  const url = await getPresignedUrl(data!.r2_key);
  console.log(`     Preview: ${url.slice(0, 80)}...`);
});

// ── Test 6: Job Manager (state machine) ──
console.log('\nJob Manager:');
let jobId = '';
await test('Create test job', async () => {
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .insert({
      brand_id: TEST_BRAND,
      status: 'idea_seed',
      idea_seed: 'Test pipeline: babies video',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  jobId = data.id;
  console.log(`     Job ID: ${jobId}`);
});

await test('Transition: idea_seed → planning', async () => {
  await transitionJob(jobId, 'idea_seed', 'planning', { test: true });
});

await test('Transition: planning → brief_review', async () => {
  await transitionJob(jobId, 'planning', 'brief_review', { test: true });
});

await test('Reject invalid transition: brief_review → rendering', async () => {
  try {
    await transitionJob(jobId, 'brief_review', 'rendering');
    throw new Error('Should have thrown TransitionError');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('Invalid transition')) throw err;
    console.log(`     Correctly blocked: ${msg}`);
  }
});

await test('Transition: brief_review → queued (approve)', async () => {
  await transitionJob(jobId, 'brief_review', 'queued', { decision: 'approve' });
});

await test('Verify job_events logged', async () => {
  const { data, error } = await supabaseAdmin
    .from('job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  console.log(`     ${data.length} events logged: ${data.map((e: Record<string, unknown>) => `${e.from_status}→${e.to_status}`).join(', ')}`);
});

// ── Test 7: QA Checker ──
console.log('\nQA Checker:');
await test('Run 8 QA checks on normalized video', async () => {
  const results = await runQAChecks({
    videoPath: normalizedPath,
    syncResult: null,
    expectedDurationRange: [1, 60],
    hasTextOverlays: false,
  });
  const checks = Object.entries(results);
  for (const [name, check] of checks) {
    console.log(`     ${(check as {passed:boolean}).passed ? '✅' : '❌'} ${name}: ${(check as {details:string}).details}`);
  }
  console.log(`     Overall: ${allChecksPassed(results) ? 'ALL PASSED' : 'SOME FAILED'}`);
});

// ── Cleanup ──
console.log('\nCleanup:');
await test('Delete test job + events', async () => {
  await supabaseAdmin.from('job_events').delete().eq('job_id', jobId);
  await supabaseAdmin.from('jobs').delete().eq('id', jobId);
});

await test('Delete test asset from Supabase + R2', async () => {
  const { data } = await supabaseAdmin
    .from('assets')
    .select('r2_key')
    .eq('id', assetId)
    .single();
  if (data) {
    await deleteFile(data.r2_key);
    await supabaseAdmin.from('assets').delete().eq('id', assetId);
  }
});

// ── Summary ──
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
