/**
 * c5.8 synthetic test for the trigger script's rollback path.
 *
 * Exercises the rollback DELETE statement that fires when an enqueue
 * failure follows a successful Postgres insert. No Redis dependency —
 * just inserts a synthetic row, runs the same rollback DELETE shape used
 * in run-editor-gate-a.ts, verifies the row is gone, and reports.
 *
 * Why this exists: c6 attempts 1+2 stranded 12 Postgres rows because
 * insert and enqueue weren't atomic. Pre-c5.8 the script had no rollback
 * at all. Post-c5.8 it has one. This test proves the rollback shape
 * works.
 *
 * Cleanup safety: uses a clearly-marked synthetic idea_seed and verifies
 * row count drops back to its pre-test baseline.
 *
 * Usage: npx tsx src/scripts/test-gate-a-rollback.ts
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';

const BRAND_ID = 'nordpilates';
const SYNTHETIC_SEED = `__c5.8 rollback test ${randomUUID()}__`;

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log('🧪 c5.8 rollback path synthetic test\n');

  const jobId = randomUUID();
  console.log(`  test_job_id: ${jobId}`);
  console.log(`  test_seed:   ${SYNTHETIC_SEED}`);

  // Pre-baseline
  const { count: pre } = await supabaseAdmin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('id', jobId);
  console.log(`  pre-baseline rows for this id: ${pre}`);
  assert('pre-baseline is 0', pre === 0);

  // Step 1: insert (mirrors trigger script's per-pair insert shape)
  console.log('\n── INSERT (mirrors trigger script per-pair insert) ──');
  const { error: insErr } = await supabaseAdmin.from('jobs').insert({
    id: jobId,
    brand_id: BRAND_ID,
    idea_seed: SYNTHETIC_SEED,
    status: 'simple_pipeline_pending' as const,
    video_type: 'workout-demo',
  });
  assert('insert succeeded', !insErr, insErr?.message);

  const { count: postIns } = await supabaseAdmin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('id', jobId);
  assert('row exists after insert', postIns === 1);

  // Step 2: simulate enqueue failure → run rollback DELETE (mirrors trigger
  // script's catch handler; same .eq() guards).
  console.log('\n── SIMULATED enqueue failure → rollback DELETE ──');
  const { error: delErr, count: deleted } = await supabaseAdmin
    .from('jobs')
    .delete({ count: 'exact' })
    .eq('id', jobId)
    .eq('brand_id', BRAND_ID)
    .eq('status', 'simple_pipeline_pending');
  assert('rollback DELETE succeeded', !delErr, delErr?.message);
  assert('rollback DELETE removed exactly 1 row', deleted === 1, `deleted=${deleted}`);

  // Step 3: verify row gone
  const { count: postDel } = await supabaseAdmin
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('id', jobId);
  assert('row is gone post-rollback', postDel === 0);

  // Step 4: defensive — what if rollback fires twice (e.g., a retry-loop
  // double-rolls)? The .eq guards mean a second DELETE on the same id with
  // brand_id+status filters should be a no-op (count=0), not an error.
  console.log('\n── Defensive: idempotent rollback (second DELETE) ──');
  const { error: del2Err, count: deleted2 } = await supabaseAdmin
    .from('jobs')
    .delete({ count: 'exact' })
    .eq('id', jobId)
    .eq('brand_id', BRAND_ID)
    .eq('status', 'simple_pipeline_pending');
  assert('idempotent rollback does not error', !del2Err, del2Err?.message);
  assert('idempotent rollback affects 0 rows', deleted2 === 0);

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ c5.8 rollback path test pass.\n');
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
