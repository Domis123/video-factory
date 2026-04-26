/**
 * W9 Tier 1 Gate A — pre-flip worker-dispatch verification (Q1b).
 *
 * Submits one synthetic Phase 3.5 job through the live BullMQ planning
 * worker against a `pipeline_version=phase35` brand. Verifies that the
 * pre-flip state is intact:
 *
 *   1. Job processes through Phase 3.5 dispatch normally
 *      (reaches `brief_review` on schedule)
 *   2. Zero `partb_*` events in job_events for this job_id
 *   3. shadow_runs row count unchanged (pre vs post)
 *   4. Brand still reads `pipeline_version=phase35` after the run
 *
 * Two checks are operator-side post-run (the script prints the commands):
 *   - Dispatcher log: "Part B not routed for job <id> —
 *     brand pipeline_version=phase35 — Part B disabled"
 *   - Worker memory baseline: ~210MB ± 50MB
 *
 * Test job is cleaned up at end (cascade delete).
 *
 * Cost ~$0 (Phase 3.5 normal cost; no Part B because phase35 brand stays
 * disabled). Matches the cbd6d445 W8 Gate B pattern from
 * src/scripts/verify-phase35-post-w8.ts, extended for Tier 1's stricter
 * shadow_runs delta + brand-state assertions.
 *
 * Per W9_SHADOW_ROLLOUT_BRIEF.md § "Gate A — Tier 1: Pre-flip dispatch
 * verification (Q1b)".
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envMap = Object.fromEntries(
  readFileSync('/Users/eglemuznikaite/Documents/video-factory/.env', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
) as Record<string, string>;

const sb = createClient(envMap.SUPABASE_URL, envMap.SUPABASE_SERVICE_KEY);

const VPS = 'http://95.216.137.35:3000';
const BRAND = 'nordpilates';
const IDEA_SEED = 'w9 tier 1 verification — pre-flip dispatch sanity check';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('W9 Tier 1 — Pre-flip dispatch verification (Q1b)');
  console.log('══════════════════════════════════════════════════════');

  // ── 0. Pre-flight: brand must be phase35 ──────────────────────────────
  const { data: brandRow, error: brandErr } = await sb
    .from('brand_configs')
    .select('brand_id, pipeline_version')
    .eq('brand_id', BRAND)
    .single();
  if (brandErr || !brandRow) {
    console.error(`✗ pre-flight: brand ${BRAND} fetch failed: ${brandErr?.message}`);
    process.exit(1);
  }
  const preBrandVersion = (brandRow as { pipeline_version: string }).pipeline_version;
  if (preBrandVersion !== 'phase35') {
    console.error(
      `✗ pre-flight: brand ${BRAND} pipeline_version=${preBrandVersion}, expected phase35.\n` +
        '  Tier 1 must run before any flip to part_b_shadow. Aborting.',
    );
    process.exit(1);
  }
  console.log(`✓ pre-flight: ${BRAND}.pipeline_version=phase35\n`);

  // ── 1. Pre-snapshot shadow_runs count ────────────────────────────────
  const { count: shadowPre, error: shErr } = await sb
    .from('shadow_runs')
    .select('id', { count: 'exact', head: true });
  if (shErr) {
    console.error(`✗ shadow_runs pre-count failed: ${shErr.message}`);
    process.exit(1);
  }
  console.log(`── snapshot: shadow_runs total rows BEFORE = ${shadowPre ?? 0}\n`);

  console.log('── operator-side checks (run on VPS, capture in artifact) ──');
  console.log('  Worker memory baseline (~210MB ± 50MB):');
  console.log('    ssh root@95.216.137.35 \'systemctl status video-factory | grep Memory\'');
  console.log('  Dispatcher log line (after this script writes the jobId):');
  console.log('    ssh root@95.216.137.35 \'journalctl -u video-factory --since "5 min ago" | grep -F "Part B not routed for job"\'');
  console.log('');

  // ── 2. Insert + enqueue test job ─────────────────────────────────────
  console.log(`── inserting test job (brand=${BRAND}, seed="${IDEA_SEED}") ──`);
  const { data: inserted, error: insErr } = await sb
    .from('jobs')
    .insert({
      brand_id: BRAND,
      status: 'planning',
      idea_seed: IDEA_SEED,
    })
    .select('id, status, created_at')
    .single();
  if (insErr || !inserted) {
    console.error(`✗ insert failed: ${insErr?.message}`);
    process.exit(1);
  }
  const jobId = (inserted as { id: string }).id;
  console.log(`  jobId=${jobId}  status=${(inserted as any).status}\n`);

  console.log('── POST /enqueue ──');
  const enqRes = await fetch(`${VPS}/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: 'planning', jobId }),
  });
  const enqText = await enqRes.text();
  console.log(`  status=${enqRes.status}  body=${enqText}`);
  if (!enqRes.ok) {
    console.error('✗ enqueue failed; cleaning up.');
    await sb.from('jobs').delete().eq('id', jobId);
    process.exit(1);
  }
  console.log('');

  // ── 3. Poll for brief_review (or terminal) ────────────────────────────
  console.log('── polling jobs.status (up to 6 min) ──');
  const deadline = Date.now() + 6 * 60 * 1000;
  let lastStatus = 'planning';
  while (Date.now() < deadline) {
    const { data: cur, error: curErr } = await sb
      .from('jobs')
      .select('status')
      .eq('id', jobId)
      .single();
    if (curErr) {
      console.error(`  poll err: ${curErr.message}`);
    } else {
      const s = (cur as any).status as string;
      if (s !== lastStatus) {
        console.log(`  [${new Date().toISOString()}] status: ${lastStatus} → ${s}`);
        lastStatus = s;
      }
      if (s === 'brief_review' || s === 'failed' || s === 'delivered') break;
    }
    await sleep(3000);
  }
  console.log(`  final status: ${lastStatus}\n`);

  // ── 4. job_events scan: any partb_* contamination? ────────────────────
  console.log('── job_events scan ──');
  const { data: events } = await sb
    .from('job_events')
    .select('event_type, to_status, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  const total = events?.length ?? 0;
  const partBContam = (events ?? []).filter((e) =>
    (e.event_type as string).startsWith('partb_'),
  );
  console.log(`  total events: ${total}`);
  console.log(`  partb_* events: ${partBContam.length}`);
  if (partBContam.length > 0) {
    console.log('  ⚠️ UNEXPECTED partb_* events:');
    for (const r of partBContam) {
      console.log(`    ${r.created_at}  ${r.event_type}  to=${r.to_status}`);
    }
  }
  // Distribution print for the artifact
  const dist = new Map<string, number>();
  for (const r of events ?? []) {
    const k = r.event_type as string;
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  console.log('  event_type distribution:');
  for (const [name, n] of [...dist.entries()].sort()) {
    console.log(`    ${name}: ${n}`);
  }
  console.log('');

  // ── 5. Post-snapshot shadow_runs count ───────────────────────────────
  const { count: shadowPost, error: shErr2 } = await sb
    .from('shadow_runs')
    .select('id', { count: 'exact', head: true });
  if (shErr2) {
    console.error(`✗ shadow_runs post-count failed: ${shErr2.message}`);
  }
  const shadowDelta = (shadowPost ?? 0) - (shadowPre ?? 0);
  console.log(`── snapshot: shadow_runs total rows AFTER = ${shadowPost ?? 0} (delta=${shadowDelta})\n`);

  // ── 6. Brand still phase35? (hard invariant) ─────────────────────────
  const { data: brandPostRow } = await sb
    .from('brand_configs')
    .select('pipeline_version')
    .eq('brand_id', BRAND)
    .single();
  const postBrandVersion =
    (brandPostRow as { pipeline_version: string } | null)?.pipeline_version;
  console.log(`── post-check: ${BRAND}.pipeline_version=${postBrandVersion}\n`);

  // ── 7. Verdict ────────────────────────────────────────────────────────
  console.log('── VERIFICATION SUMMARY ──');
  const reachedBriefReview = lastStatus === 'brief_review';
  const noPartBContam = partBContam.length === 0;
  const shadowUnchanged = shadowDelta === 0;
  const brandUnchanged = postBrandVersion === 'phase35';

  console.log(`  Phase 3.5 reached brief_review:  ${reachedBriefReview ? '✓' : '✗'} (observed=${lastStatus})`);
  console.log(`  No partb_* contamination:         ${noPartBContam ? '✓' : '✗'} (count=${partBContam.length})`);
  console.log(`  shadow_runs unchanged:            ${shadowUnchanged ? '✓' : '✗'} (delta=${shadowDelta})`);
  console.log(`  Brand still phase35:              ${brandUnchanged ? '✓' : '✗'} (post=${postBrandVersion})`);

  const success =
    reachedBriefReview && noPartBContam && shadowUnchanged && brandUnchanged;
  console.log(`  Overall:                          ${success ? '✓ PASS' : '✗ FAIL'}\n`);

  // ── 8. Cleanup ────────────────────────────────────────────────────────
  console.log('── cleanup: delete test job (cascades job_events) ──');
  const { error: delErr } = await sb.from('jobs').delete().eq('id', jobId);
  if (delErr) {
    console.error(`  delete err: ${delErr.message}`);
  } else {
    console.log(`  ✓ deleted job ${jobId}`);
  }

  // Final reminder: operator must capture the two ssh-side checks in artifact.
  if (success) {
    console.log('\n── REMINDER: capture the two ssh-side checks in the Gate A artifact ──');
    console.log('  1. Worker memory: systemctl status video-factory | grep Memory');
    console.log('  2. Dispatcher log: journalctl -u video-factory --since ... | grep -F "Part B not routed"');
    console.log(`     (target jobId: ${jobId})`);
  }

  process.exit(success ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
