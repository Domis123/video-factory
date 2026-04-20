import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { env } from '../config/env.js';
import { analyzeParentEndToEndV2 } from '../agents/gemini-segments-v2-batch.js';
import { SegmentV2Schema } from '../agents/segment-analyzer-v2-schema.js';

const DEFAULT_PARENT_ID = 'd644e28d-d3cc-47c5-a304-b9ae3fe87d95';
const BRAND_CONTEXT = 'nordpilates — pilates/flexibility/wellness content';
const ARTIFACT_DIR = '/tmp/w0b3-smoke';

async function main() {
  const parentId = process.argv[2] ?? DEFAULT_PARENT_ID;
  console.log(`[smoke-parent-v2] Model: ${env.GEMINI_INGESTION_MODEL}`);
  console.log(`[smoke-parent-v2] Parent: ${parentId}`);
  console.log(`[smoke-parent-v2] Brand context: ${BRAND_CONTEXT}`);

  const { data: parent, error } = await supabaseAdmin
    .from('assets')
    .select('id, pre_normalized_r2_key, r2_key, duration_seconds')
    .eq('id', parentId)
    .single();
  if (error || !parent) throw new Error(`assets lookup failed: ${error?.message ?? 'not found'}`);

  const r2Key = parent.pre_normalized_r2_key ?? parent.r2_key;
  if (!r2Key) throw new Error(`No r2 key on parent ${parentId}`);
  console.log(`[smoke-parent-v2] R2 key: ${r2Key}`);
  console.log(`[smoke-parent-v2] DB duration: ${parent.duration_seconds}s`);

  const localPath = `${env.RENDER_TEMP_DIR}/smoke-parent-${randomUUID()}.mp4`;
  console.log(`[smoke-parent-v2] Downloading to ${localPath}...`);
  const dlStart = Date.now();
  await downloadToFile(r2Key, localPath);
  console.log(`[smoke-parent-v2] Downloaded in ${Date.now() - dlStart}ms`);

  await mkdir(ARTIFACT_DIR, { recursive: true });

  let result;
  try {
    result = await analyzeParentEndToEndV2(localPath, BRAND_CONTEXT);
  } finally {
    await unlink(localPath).catch(() => {});
  }

  const validationFailures: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < result.segments.length; i++) {
    const parsed = SegmentV2Schema.safeParse(result.segments[i]);
    if (!parsed.success) {
      validationFailures.push({ index: i, error: parsed.error.message });
    }
  }

  const transcriptViolations: number[] = [];
  for (let i = 0; i < result.segments.length; i++) {
    const seg = result.segments[i];
    if (seg.audio.has_speech && seg.audio.transcript_snippet === null) {
      transcriptViolations.push(i);
    }
  }

  const artifact = {
    parent_asset_id: parentId,
    r2_key: r2Key,
    db_duration_s: parent.duration_seconds,
    model: env.GEMINI_INGESTION_MODEL,
    brand_context: BRAND_CONTEXT,
    counters: result.counters,
    timings: result.timings,
    boundaries: result.boundaries,
    segments: result.segments,
    validation_failures: validationFailures,
    transcript_violations: transcriptViolations,
  };

  const artifactPath = `${ARTIFACT_DIR}/${parentId}.json`;
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2));

  console.log('\n=== SMOKE RESULTS ===');
  console.log(`Segments: ${result.segments.length}`);
  console.log(`Uploads: ${result.counters.uploads} (expected 1)`);
  console.log(`Deletes: ${result.counters.deletes} (expected 1)`);
  console.log(`Upload wall: ${result.timings.uploadMs}ms`);
  console.log(`Active poll wall: ${result.timings.activePollMs}ms`);
  console.log(`Pass 1 wall: ${result.timings.pass1Ms}ms`);
  console.log(`Pass 2 walls (ms): [${result.timings.pass2Ms.join(', ')}]`);
  console.log(`Pass 2 total: ${result.timings.pass2Ms.reduce((a, b) => a + b, 0)}ms`);
  console.log(`Delete wall: ${result.timings.deleteMs}ms`);
  console.log(`TOTAL wall: ${result.timings.totalMs}ms (${(result.timings.totalMs / 1000).toFixed(1)}s)`);
  console.log(`Zod validation failures: ${validationFailures.length}`);
  console.log(`Transcript violations (has_speech=true, snippet=null): ${transcriptViolations.length}`);
  console.log(`Artifact: ${artifactPath}`);

  if (result.counters.uploads !== 1 || result.counters.deletes !== 1) {
    console.error('\nFAILURE: upload/delete count mismatch. Batching is NOT working correctly.');
    process.exit(2);
  }
  if (validationFailures.length > 0) {
    console.error('\nFAILURE: Zod validation failures.');
    process.exit(3);
  }
  if (transcriptViolations.length > 0) {
    console.error('\nFAILURE: Rule 37 transcript hard constraint violated.');
    process.exit(4);
  }
  console.log('\nSMOKE PASSED.');
}

main().catch((err) => {
  console.error('[smoke-parent-v2] FATAL:', err);
  process.exit(1);
});
