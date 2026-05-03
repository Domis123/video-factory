/**
 * Gate A trigger script for Editor agent v1.2 (c5.6).
 *
 * Flow:
 *   1. DELETE FROM simple_pipeline_render_history WHERE brand_id='nordpilates'
 *      (operator-decided — acceptable trade-off; see kickoff item 4).
 *   2. Verify /simple-pipeline/check-readiness for nordpilates ⇒ ok:true.
 *   3. For each of 6 idea seeds, insert + enqueue:
 *      a. with-Editor job   (editorDisabled=false)
 *      b. baseline job      (editorDisabled=true)
 *      → 12 jobs total, paired by seed.
 *   4. Poll jobs.status until all 12 reach human_qa or
 *      simple_pipeline_failed.
 *   5. For each completed job, collect editor_outcome from job_events
 *      payload (logged on the human_qa transition by c4 wiring), preview
 *      URL, M-O-M picks, refined boundaries, wall + cost, per-segment
 *      outcome breakdown.
 *   6. Emit machine-readable JSON dump to /tmp/editor-gate-a-raw.json
 *      (artifact source-of-truth for c6's docs/diagnostics writeup).
 *
 * Concurrency=1 worker means all 12 renders run sequentially; expect
 * ~12-15 min wall time end-to-end.
 *
 * Modes:
 *   --dry-run : log everything the script would do (real readiness check
 *               only — no Supabase writes, no BullMQ enqueue, no Gemini).
 *               Used at end of c5.6 for pre-deploy verification.
 *
 *   (default) : run the full Gate A batch. Should only be invoked AFTER
 *               operator deploys feat branch to VPS and confirms via
 *               planning chat.
 *
 * Usage:
 *   npx tsx src/scripts/run-editor-gate-a.ts --dry-run
 *   npx tsx src/scripts/run-editor-gate-a.ts          # live run
 */

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { supabaseAdmin } from '../config/supabase.js';
import { createQueue, QUEUE_NAMES } from '../config/redis.js';
import { checkSimplePipelineReadiness } from '../orchestrator/simple-pipeline/readiness.js';

const BRAND_ID = 'nordpilates';

// v1.2.1 fresh seeds (replaces the original v1.2 c6 seeds 2026-05-01).
// Mix is intentional per brief: 5 specific seeds testing M-O-M slot count
// + same-parent redundancy + Editor pacing; seed #6 is feel-shaped and
// tests the vague-seed handling section of the M-O-M v1.0.1 prompt.
const IDEA_SEEDS: string[] = [
  'morning core flow for tight hips',
  'pilates breathing reset',
  'slow leg circles for stiff knees',
  'gentle full body wakeup',
  'posture correction for desk workers',
  'pilates stretches that feel like rest',
];

const RAW_DUMP_PATH = '/tmp/editor-gate-a-raw.json';

// Polling parameters. Each render ~60-90s wall; with 12 sequential, expect
// 12-18 min total. Poll every 15s with a 30 min ceiling.
const POLL_INTERVAL_MS = 15_000;
const POLL_CEILING_MS = 30 * 60 * 1000;

// c5.9: sleep BETWEEN insert+enqueue iterations to defeat the burst-rate
// cap on Upstash that took down c6 attempts 1-3. Override via env var
// EDITOR_GATE_A_SLEEP_MS for the kickoff's 2000→5000 retry path.
const SLEEP_BETWEEN_PAIRS_MS = Number(process.env['EDITOR_GATE_A_SLEEP_MS'] ?? 2000);

interface PlannedJob {
  jobId: string;
  seed: string;
  variant: 'with_editor' | 'baseline';
  editorDisabled: boolean;
}

interface CollectedJob {
  jobId: string;
  seed: string;
  variant: 'with_editor' | 'baseline';
  editorDisabled: boolean;
  finalStatus: string;
  startedAt: string | null;
  completedAt: string | null;
  wallTimeS: number | null;
  // From the human_qa transition payload
  rKey: string | null;
  previewUrl: string | null;
  durationS: number | null;
  parentAssetId: string | null;
  segmentIds: string[] | null;
  slotCount: number | null;
  totalCostUsd: number | null;
  agentCostUsd: number | null;
  overlayCostUsd: number | null;
  editorCostUsd: number | null;
  editorOutcome: Record<string, unknown> | null;
  failureReason: string | null;
}

// ─── Step 1: cooldown clear ───────────────────────────────────────────────

async function clearCooldown(dryRun: boolean): Promise<number> {
  if (dryRun) {
    const { count } = await supabaseAdmin
      .from('simple_pipeline_render_history')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', BRAND_ID);
    console.log(`  [dry-run] WOULD DELETE ${count ?? 0} simple_pipeline_render_history rows for brand=${BRAND_ID}`);
    return count ?? 0;
  }
  const { count, error } = await supabaseAdmin
    .from('simple_pipeline_render_history')
    .delete({ count: 'exact' })
    .eq('brand_id', BRAND_ID);
  if (error) throw new Error(`cooldown clear failed: ${error.message}`);
  console.log(`  Deleted ${count ?? 0} simple_pipeline_render_history rows for brand=${BRAND_ID}`);
  return count ?? 0;
}

// ─── Step 2: readiness ─────────────────────────────────────────────────────

async function verifyReadiness(): Promise<void> {
  const r = await checkSimplePipelineReadiness(BRAND_ID);
  if (!r.ok) {
    throw new Error(`Brand ${BRAND_ID} not ready: ${r.reason}`);
  }
  console.log(`  ✓ ${BRAND_ID} ready for Simple Pipeline jobs`);
}

// ─── Step 3: insert + enqueue (c5.8 hardening: per-pair atomicity + rollback) ──

interface InsertEnqueueOutcome {
  planned: PlannedJob[];
  insertFailures: number;
  enqueueFailuresWithRollback: number;
  /**
   * Worst case: enqueue failed AND the post-failure DELETE rollback also
   * failed. Resulting Postgres row is orphaned (status=pending, no BullMQ
   * job). Operator-side cleanup needed if this is non-zero.
   */
  rollbackFailures: number;
}

async function insertAndEnqueue(
  dryRun: boolean,
  /**
   * c5.8 synthetic-test hook. When set, the enqueue at this index throws a
   * simulated error to exercise the rollback path. Has no effect in live
   * runs (default undefined).
   */
  simulateEnqueueFailureAt?: number,
  /**
   * c5.9 partial-run cap. When set, only the first N seeds get queued
   * (= 2N iterations, or N iterations with noBaseline). Used by --max-pairs
   * verification to test that sleep spacing defeats the Upstash burst cap
   * before running full Gate A.
   */
  maxPairs?: number,
  /**
   * v1.2.1 single-arm flag. When true, only the with_editor variant is
   * enqueued per seed (no v1.1-baseline arm). Used for operator-judgment
   * Gate A reviews that compare against memory rather than strict A/B.
   */
  noBaseline?: boolean,
): Promise<InsertEnqueueOutcome> {
  const planned: PlannedJob[] = [];
  const seeds = maxPairs !== undefined ? IDEA_SEEDS.slice(0, maxPairs) : IDEA_SEEDS;
  const variants = noBaseline
    ? (['with_editor'] as const)
    : (['with_editor', 'baseline'] as const);
  for (const seed of seeds) {
    for (const variant of variants) {
      const jobId = randomUUID();
      const editorDisabled = variant === 'baseline';
      planned.push({ jobId, seed, variant, editorDisabled });
    }
  }

  if (dryRun) {
    console.log(`  [dry-run] WOULD INSERT ${planned.length} jobs:`);
    for (const job of planned) {
      console.log(
        `    ${job.variant.padEnd(12)} editor=${job.editorDisabled ? 'OFF' : 'ON '} ` +
          `jobId=${job.jobId.slice(0, 8)}...  seed="${job.seed.slice(0, 50)}${job.seed.length > 50 ? '...' : ''}"`,
      );
    }
    console.log(`  [dry-run] WOULD ENQUEUE ${planned.length} BullMQ jobs to ${QUEUE_NAMES.simple_pipeline} queue`);
    console.log(`  [dry-run] (insert+enqueue per-pair with rollback on enqueue failure)`);
    return { planned, insertFailures: 0, enqueueFailuresWithRollback: 0, rollbackFailures: 0 };
  }

  // Live: insert + enqueue per-pair so a single Redis hiccup doesn't strand
  // a Postgres row in simple_pipeline_pending with no BullMQ counterpart.
  // Pre-c5.8 behavior was batch insert then sequential enqueue — vulnerable
  // to partial-enqueue desync as observed in c6 attempts 1+2.
  const queue = createQueue(QUEUE_NAMES.simple_pipeline);
  let insertFailures = 0;
  let enqueueFailuresWithRollback = 0;
  let rollbackFailures = 0;
  let succeeded = 0;

  try {
    for (let idx = 0; idx < planned.length; idx++) {
      const j = planned[idx];

      // Step 3a: insert one row.
      try {
        const { error } = await supabaseAdmin.from('jobs').insert({
          id: j.jobId,
          brand_id: BRAND_ID,
          idea_seed: j.seed,
          status: 'simple_pipeline_pending' as const,
          video_type: 'workout-demo',
        });
        if (error) throw new Error(error.message);
      } catch (err) {
        console.warn(
          `  ⚠ insert failed for ${j.variant} ${j.jobId.slice(0, 8)}: ${(err as Error).message}; skipping enqueue`,
        );
        insertFailures++;
        continue;
      }

      // Step 3b: enqueue. On failure, roll back the insert.
      try {
        if (simulateEnqueueFailureAt === idx) {
          throw new Error('SIMULATED enqueue failure (c5.8 rollback test)');
        }
        await queue.add('gate-a-c6', {
          jobId: j.jobId,
          format: 'routine',
          clipsMode: 'agent_picks',
          overlayMode: 'generate',
          editorDisabled: j.editorDisabled,
        });
        succeeded++;
      } catch (enqErr) {
        console.warn(
          `  ⚠ enqueue failed for ${j.variant} ${j.jobId.slice(0, 8)}: ${(enqErr as Error).message}; rolling back insert`,
        );
        try {
          const { error: delErr } = await supabaseAdmin
            .from('jobs')
            .delete()
            .eq('id', j.jobId)
            .eq('brand_id', BRAND_ID)
            .eq('status', 'simple_pipeline_pending');
          if (delErr) throw new Error(delErr.message);
          console.log(`     ↩ rollback OK (deleted ${j.jobId.slice(0, 8)})`);
          enqueueFailuresWithRollback++;
        } catch (rbErr) {
          console.error(
            `     ❌ ROLLBACK FAILED for ${j.jobId.slice(0, 8)}: ${(rbErr as Error).message}. ` +
              `Postgres row is orphaned (status=pending, no BullMQ). Manual cleanup needed.`,
          );
          rollbackFailures++;
        }
      }

      // c5.9: sleep between iterations (not after the last). Defeats the
      // Upstash burst-rate cap that took down c6 attempts 1-3.
      if (idx < planned.length - 1) {
        await sleep(SLEEP_BETWEEN_PAIRS_MS);
      }
    }
    console.log(
      `  insert+enqueue done: succeeded=${succeeded} insertFails=${insertFailures} ` +
        `enqueueFails(rolled-back)=${enqueueFailuresWithRollback} rollbackFails=${rollbackFailures} ` +
        `(sleep between pairs: ${SLEEP_BETWEEN_PAIRS_MS}ms)`,
    );
  } finally {
    await queue.close();
  }

  return { planned, insertFailures, enqueueFailuresWithRollback, rollbackFailures };
}

// ─── Step 4: poll ──────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['human_qa', 'simple_pipeline_failed', 'failed']);

async function pollUntilDone(jobIds: string[]): Promise<Map<string, string>> {
  const t0 = Date.now();
  const finalStatusByJobId = new Map<string, string>();
  console.log(`  Polling ${jobIds.length} jobs every ${POLL_INTERVAL_MS / 1000}s (ceiling ${POLL_CEILING_MS / 60_000}min)...`);

  while (Date.now() - t0 < POLL_CEILING_MS) {
    const { data, error } = await supabaseAdmin
      .from('jobs')
      .select('id, status')
      .in('id', jobIds);
    if (error) {
      console.warn(`    poll error (continuing): ${error.message}`);
    } else if (data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        const status = (row as { status: string }).status;
        counts[status] = (counts[status] || 0) + 1;
        if (TERMINAL_STATUSES.has(status)) {
          finalStatusByJobId.set((row as { id: string }).id, status);
        }
      }
      const elapsedMin = ((Date.now() - t0) / 60_000).toFixed(1);
      console.log(`    [${elapsedMin}min] ${JSON.stringify(counts)}  (terminal: ${finalStatusByJobId.size}/${jobIds.length})`);
      if (finalStatusByJobId.size === jobIds.length) {
        return finalStatusByJobId;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `pollUntilDone: timeout after ${POLL_CEILING_MS / 60_000}min. ` +
      `Reached terminal: ${finalStatusByJobId.size}/${jobIds.length}.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step 5: collect outcomes ──────────────────────────────────────────────

async function collectOutcomes(planned: PlannedJob[]): Promise<CollectedJob[]> {
  const jobIds = planned.map((p) => p.jobId);

  const { data: jobRows, error: jobErr } = await supabaseAdmin
    .from('jobs')
    .select('id, status, created_at, updated_at, rendered_video_r2_key, preview_url')
    .in('id', jobIds);
  if (jobErr) throw new Error(`collectOutcomes: jobs fetch failed: ${jobErr.message}`);

  const { data: eventRows, error: evErr } = await supabaseAdmin
    .from('job_events')
    .select('job_id, from_status, to_status, payload, created_at')
    .in('job_id', jobIds);
  if (evErr) throw new Error(`collectOutcomes: job_events fetch failed: ${evErr.message}`);

  const jobById = new Map(
    (jobRows ?? []).map((r) => [(r as { id: string }).id, r as Record<string, unknown>]),
  );
  const eventsByJobId = new Map<string, Array<Record<string, unknown>>>();
  for (const ev of eventRows ?? []) {
    const e = ev as Record<string, unknown>;
    const jid = e['job_id'] as string;
    if (!eventsByJobId.has(jid)) eventsByJobId.set(jid, []);
    eventsByJobId.get(jid)!.push(e);
  }

  const collected: CollectedJob[] = [];
  for (const p of planned) {
    const job = jobById.get(p.jobId);
    const events = eventsByJobId.get(p.jobId) ?? [];

    // The human_qa transition payload carries everything we need.
    const humanQaEvent = events.find(
      (e) => (e['to_status'] as string) === 'human_qa',
    );
    const failedEvent = events.find(
      (e) => (e['to_status'] as string) === 'simple_pipeline_failed' || (e['to_status'] as string) === 'failed',
    );
    const payload = (humanQaEvent?.['payload'] as Record<string, unknown> | undefined) ?? {};

    const startedAt = (job?.['created_at'] as string | undefined) ?? null;
    const completedAt = humanQaEvent
      ? ((humanQaEvent['created_at'] as string | undefined) ?? null)
      : ((failedEvent?.['created_at'] as string | undefined) ?? null);
    const wallTimeS =
      startedAt && completedAt
        ? (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
        : null;

    collected.push({
      jobId: p.jobId,
      seed: p.seed,
      variant: p.variant,
      editorDisabled: p.editorDisabled,
      finalStatus: (job?.['status'] as string | undefined) ?? 'unknown',
      startedAt,
      completedAt,
      wallTimeS,
      rKey: (job?.['rendered_video_r2_key'] as string | null | undefined) ?? null,
      previewUrl: (job?.['preview_url'] as string | null | undefined) ?? null,
      durationS: (payload['duration_s'] as number | null | undefined) ?? null,
      parentAssetId: (payload['parent_asset_id'] as string | null | undefined) ?? null,
      segmentIds: (payload['segment_ids'] as string[] | null | undefined) ?? null,
      slotCount: (payload['slot_count'] as number | null | undefined) ?? null,
      totalCostUsd: (payload['total_cost_usd'] as number | null | undefined) ?? null,
      agentCostUsd: (payload['agent_cost_usd'] as number | null | undefined) ?? null,
      overlayCostUsd: (payload['overlay_cost_usd'] as number | null | undefined) ?? null,
      editorCostUsd: (payload['editor_cost_usd'] as number | null | undefined) ?? null,
      editorOutcome: (payload['editor_outcome'] as Record<string, unknown> | undefined) ?? null,
      failureReason: failedEvent
        ? ((failedEvent['payload'] as Record<string, unknown> | undefined)?.['error'] as string | undefined) ?? 'failed'
        : null,
    });
  }
  return collected;
}

// ─── Main ──────────────────────────────────────────────────────────────────

function parseMaxPairs(): number | undefined {
  const flag = process.argv.find((a) => a.startsWith('--max-pairs='));
  if (!flag) return undefined;
  const v = Number(flag.split('=')[1]);
  if (!Number.isFinite(v) || v < 1 || v > IDEA_SEEDS.length) {
    throw new Error(
      `--max-pairs must be 1..${IDEA_SEEDS.length}; got "${flag.split('=')[1]}"`,
    );
  }
  return v;
}

async function cleanupCanary(planned: PlannedJob[]): Promise<void> {
  console.log('\n── Cleanup canary state ──');
  // BullMQ FIRST per Rule 43 #9: drain queue before deleting Postgres rows
  // so the worker can't grab a job mid-cleanup. obliterate({force:true})
  // wipes waiting + active; an in-flight active render's completion will
  // throw on a non-existent queue, which is acceptable noise for a canary.
  const queue = createQueue(QUEUE_NAMES.simple_pipeline);
  try {
    await queue.obliterate({ force: true });
    console.log(`  ✓ obliterated simple_pipeline BullMQ queue`);
  } catch (err) {
    console.warn(`  ⚠ obliterate threw (proceeding to Postgres cleanup): ${(err as Error).message}`);
  } finally {
    await queue.close();
  }

  // Postgres: delete the rows we inserted, regardless of current status
  // (worker may have transitioned some to simple_pipeline_rendering during
  // the canary window).
  const ids = planned.map((p) => p.jobId);
  const { error, count } = await supabaseAdmin
    .from('jobs')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', BRAND_ID);
  if (error) {
    console.error(`  ❌ Postgres cleanup failed: ${error.message}. Manual cleanup needed for IDs: ${ids.join(', ')}`);
  } else {
    console.log(`  ✓ deleted ${count}/${ids.length} canary rows from jobs`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noBaseline = process.argv.includes('--no-baseline');
  const maxPairs = parseMaxPairs();
  const verifyMode = maxPairs !== undefined;
  const variantsPerSeed = noBaseline ? 1 : 2;
  const tag = dryRun
    ? 'DRY RUN'
    : verifyMode
      ? `VERIFY (--max-pairs=${maxPairs}${noBaseline ? ', --no-baseline' : ''})`
      : noBaseline
        ? 'LIVE (--no-baseline, single-arm)'
        : 'LIVE';
  console.log(`\n🎯 Editor agent Gate A trigger — ${tag}\n`);
  if (verifyMode) {
    console.log(`  Sleep between pairs: ${SLEEP_BETWEEN_PAIRS_MS}ms`);
    console.log(`  Will skip steps 4 (poll) and 5 (collect); cleanup after step 3`);
  }
  if (noBaseline) {
    console.log(`  --no-baseline: only with_editor variant enqueued per seed (single-arm Gate A)`);
  }

  console.log('── Step 1: cooldown clear ──');
  await clearCooldown(dryRun);

  console.log('\n── Step 2: readiness ──');
  await verifyReadiness();

  const totalSeeds = maxPairs ?? IDEA_SEEDS.length;
  const totalJobs = totalSeeds * variantsPerSeed;
  const stepLabel = verifyMode ? `verify (${totalJobs} jobs)` : `${totalJobs} jobs`;
  console.log(`\n── Step 3: insert + enqueue ${stepLabel} ──`);
  const ieResult = await insertAndEnqueue(dryRun, undefined, maxPairs, noBaseline);
  const planned = ieResult.planned;

  // c5.8 halt: any insert/enqueue/rollback failure means we don't have a
  // clean 12-job pair set. Stop before polling so we don't try to render
  // against a partial-enqueue state and so the operator sees the failure
  // shape immediately.
  if (
    !dryRun &&
    (ieResult.insertFailures > 0 ||
      ieResult.enqueueFailuresWithRollback > 0 ||
      ieResult.rollbackFailures > 0)
  ) {
    console.error(
      `\n❌ HALT before polling: insert/enqueue had failures ` +
        `(insert=${ieResult.insertFailures}, enqueue-rolled-back=${ieResult.enqueueFailuresWithRollback}, ` +
        `rollback-failed=${ieResult.rollbackFailures}). ` +
        `Don't try to render a partial pair set. Investigate Redis/Postgres health, ` +
        `clean any orphaned rows (rollback-failed count), then retry.`,
    );
    if (verifyMode) {
      console.error(`Verify mode failed — sleep=${SLEEP_BETWEEN_PAIRS_MS}ms did not defeat the burst cap.`);
    }
    process.exit(1);
  }

  // c5.9 verify-mode early exit: skip polling + collection. Cleanup the
  // rows we inserted (BullMQ first, then Postgres) so the operator
  // doesn't have to do it. Verify-mode goal is "did all enqueues
  // succeed?" — proven by reaching this point with zero failures.
  if (verifyMode) {
    console.log(`\n✅ Verify PASS: ${planned.length} enqueues succeeded with sleep=${SLEEP_BETWEEN_PAIRS_MS}ms between pairs.`);
    await cleanupCanary(planned);
    console.log(`\nVerify-mode complete. Sleep value ${SLEEP_BETWEEN_PAIRS_MS}ms defeats the burst cap on this run.`);
    return;
  }

  if (dryRun) {
    console.log('\n── Step 4: poll (skipped in dry-run) ──');
    console.log(`  [dry-run] WOULD POLL jobs.status until all ${planned.length} reach terminal (human_qa or *_failed)`);
    console.log(`  [dry-run] poll interval=${POLL_INTERVAL_MS / 1000}s ceiling=${POLL_CEILING_MS / 60_000}min`);

    console.log('\n── Step 5: collect outcomes (skipped in dry-run) ──');
    console.log(`  [dry-run] WOULD READ jobs + job_events, build CollectedJob[${planned.length}], dump to ${RAW_DUMP_PATH}`);

    const armTag = noBaseline ? 'with-Editor only (single-arm)' : 'with-Editor + baseline (paired)';
    console.log('\n── Dry-run summary ──');
    console.log(`  Planned: ${planned.length} jobs — ${armTag}`);
    console.log(`  Cost projection (live): ~$${(planned.length * 0.025).toFixed(2)} agent calls + ${planned.length * 2}-${planned.length * 2.5} min VPS wall`);
    return;
  }

  console.log('\n── Step 4: poll until all 12 reach human_qa ──');
  await pollUntilDone(planned.map((p) => p.jobId));

  console.log('\n── Step 5: collect outcomes ──');
  const collected = await collectOutcomes(planned);

  await writeFile(RAW_DUMP_PATH, JSON.stringify(collected, null, 2));
  console.log(`  Wrote ${collected.length} job records to ${RAW_DUMP_PATH}`);

  // Quick aggregate summary at the end.
  const successCount = collected.filter((c) => c.finalStatus === 'human_qa').length;
  const failCount = collected.length - successCount;
  console.log('\n── Live-run summary ──');
  console.log(`  Reached human_qa: ${successCount}/${collected.length}`);
  console.log(`  Failed:           ${failCount}/${collected.length}`);
  if (failCount > 0) {
    for (const c of collected) {
      if (c.finalStatus !== 'human_qa') {
        console.log(`    ✗ ${c.variant} ${c.jobId.slice(0, 8)}: ${c.finalStatus} — ${c.failureReason ?? 'no reason'}`);
      }
    }
  }
  console.log(`  Raw dump: ${RAW_DUMP_PATH} (artifact source-of-truth for c6 writeup)`);
}

main().catch((err) => {
  console.error('Trigger script failed:', err);
  process.exit(1);
});
