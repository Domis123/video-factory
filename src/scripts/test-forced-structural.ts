/**
 * W9 Tier 2 Gate A — forced-structural synthetic seed (Q8c).
 *
 * Active validation that the W6 Critic's `revise_scope='structural'`
 * code path is alive in production by deliberately constructing a job
 * whose form commitment the library cannot fulfill.
 *
 * Pre-condition (operator must satisfy before running):
 *   1. Migration 012 applied to remote Supabase (shadow_review view +
 *      creative-quality columns)
 *   2. Tier 1 (verify-worker-dispatch.ts) PASSED
 *   3. Tier 1 PASS: nordpilates flipped to `pipeline_version='part_b_shadow'`
 *      with `PART_B_ROLLOUT_PERCENT=0` on the worker
 *   4. Worker restarted post-flip so the env var takes effect
 *
 * What this script does:
 *   * Inserts one job with brand=nordpilates, status=planning, and
 *     `pipeline_override='force'`. The override bypasses Tier-3 percentage
 *     gating and forces a dual-run (Phase 3.5 + Part B both run).
 *   * Enqueues the job via /enqueue and polls for the shadow_runs row to
 *     populate (deadline 15 min — full revise loop can run ~5-10 min).
 *   * Captures the full agent trace once Part B terminates:
 *       - Planner output (form_id committed)
 *       - Director picks (storyboard_picks)
 *       - Every Critic verdict in the revise loop (from job_events
 *         partb_revise_slots / partb_revise_structural details)
 *       - Final critic_verdict from shadow_runs
 *       - terminal_state + revise_loop_iterations
 *   * Asserts: at least one `partb_revise_structural` event OR documents
 *     why it didn't fire (Planner didn't commit to deep-dive form, or
 *     Critic accepted the under-fill without structural revise).
 *
 * Cleanup: the test job is INTENTIONALLY NOT deleted. The shadow_runs
 * row is the deliberate Q8c calibration marker — distinctive idea_seed
 * + pipeline_override='force' make it traceable for retrospective
 * analysis.
 *
 * Cost: ~$1-2 (one full Part B run, possibly with revise loops).
 *
 * Per W9_SHADOW_ROLLOUT_BRIEF.md § "Synthetic forced-structural seed
 * (Q8c active validation)" + § "Gate A — Tier 2".
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

// Pre-work step 6 → primary candidate: `fire hydrant` (1 library segment).
// Plain English seed; do NOT pre-bias Planner with explicit form_id mention.
// The seed shape (one exercise + deep treatment + duration) is what should
// pull Planner toward single_exercise_deep_dive on its own.
const IDEA_SEED =
  '30-second fire hydrant deep dive — show progression from beginner setup to glute burn';
const TARGET_EXERCISE_NAME = 'fire hydrant';

// 15-minute deadline — full revise loop (2 iterations max) can run 5-10 min.
const POLL_DEADLINE_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('W9 Tier 2 — Forced-structural synthetic seed (Q8c)');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 0. Pre-flight: brand must be part_b_shadow, rollout 0 ─────────────
  const { data: brandRow, error: brandErr } = await sb
    .from('brand_configs')
    .select('brand_id, pipeline_version')
    .eq('brand_id', BRAND)
    .single();
  if (brandErr || !brandRow) {
    console.error(`✗ pre-flight: brand fetch failed: ${brandErr?.message}`);
    process.exit(1);
  }
  const brandVersion = (brandRow as { pipeline_version: string }).pipeline_version;
  if (brandVersion !== 'part_b_shadow') {
    console.error(
      `✗ pre-flight: ${BRAND}.pipeline_version=${brandVersion}, expected part_b_shadow.\n` +
        '  Tier 2 requires the brand to be flipped first. Operator action:\n' +
        `    UPDATE brand_configs SET pipeline_version='part_b_shadow' WHERE brand_id='${BRAND}';`,
    );
    process.exit(1);
  }
  console.log(`✓ pre-flight: ${BRAND}.pipeline_version=part_b_shadow`);
  console.log('  (operator must also have set PART_B_ROLLOUT_PERCENT=0 + restarted worker)\n');

  // ── 1. Confirm fire-hydrant seed coverage hasn't shifted ──────────────
  // If the library got more `fire hydrant` segments since pre-work, the
  // seed may no longer trigger structural — bail loudly so operator sees.
  const { data: segs, error: segErr } = await sb
    .from('asset_segments')
    .select('id')
    .eq('brand_id', BRAND)
    .filter('segment_v2->exercise->>name', 'eq', TARGET_EXERCISE_NAME);
  if (segErr) {
    console.error(`⚠ could not verify seed coverage: ${segErr.message}`);
  } else {
    const count = segs?.length ?? 0;
    console.log(`── seed coverage: ${count} segment(s) for "${TARGET_EXERCISE_NAME}"`);
    if (count > 2) {
      console.warn(
        `  ⚠ ${count} segments — coverage may be too high to trigger structural.\n` +
          '    The test will still run, but the revise_scope=structural assertion may fail benignly.\n' +
          '    See pre-flip notes for backup candidates.',
      );
    }
    console.log('');
  }

  // ── 2. Insert + enqueue test job ─────────────────────────────────────
  console.log(`── inserting test job (brand=${BRAND}, override=force) ──`);
  console.log(`  seed: "${IDEA_SEED}"`);
  const { data: inserted, error: insErr } = await sb
    .from('jobs')
    .insert({
      brand_id: BRAND,
      status: 'planning',
      idea_seed: IDEA_SEED,
      pipeline_override: 'force',
    })
    .select('id, status, created_at, pipeline_override')
    .single();
  if (insErr || !inserted) {
    console.error(`✗ insert failed: ${insErr?.message}`);
    process.exit(1);
  }
  const jobId = (inserted as { id: string }).id;
  console.log(`  jobId=${jobId}  override=${(inserted as any).pipeline_override}\n`);

  console.log('── POST /enqueue ──');
  const enqRes = await fetch(`${VPS}/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: 'planning', jobId }),
  });
  const enqText = await enqRes.text();
  console.log(`  status=${enqRes.status}  body=${enqText}`);
  if (!enqRes.ok) {
    console.error('✗ enqueue failed.');
    process.exit(1);
  }
  console.log('');

  // ── 3. Poll for shadow_runs row + partb_* terminal event ─────────────
  console.log(`── polling for shadow_runs row + partb_* terminal (up to ${POLL_DEADLINE_MS / 60000} min) ──`);
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let shadowRunRow: Record<string, unknown> | null = null;
  let lastEventCount = 0;
  while (Date.now() < deadline) {
    const { data: srRow } = await sb
      .from('shadow_runs')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();
    if (srRow) {
      shadowRunRow = srRow as Record<string, unknown>;
      console.log(`  ✓ shadow_runs row written at ${(srRow as any).created_at}`);
      break;
    }
    const { data: events } = await sb
      .from('job_events')
      .select('event_type, to_status, created_at')
      .eq('job_id', jobId)
      .like('event_type', 'partb_%')
      .order('created_at', { ascending: true });
    const evs = events ?? [];
    if (evs.length !== lastEventCount) {
      const newOnes = evs.slice(lastEventCount);
      for (const r of newOnes) {
        console.log(`  [${r.created_at}] ${r.event_type}`);
      }
      lastEventCount = evs.length;
    }
    const terminal = evs.find((e) =>
      [
        'partb_pipeline_completed',
        'partb_pipeline_failed',
        'partb_pipeline_escalated',
      ].includes(e.event_type as string),
    );
    if (terminal) {
      console.log(`  terminal event seen: ${terminal.event_type}`);
      // shadow_runs may still be a heartbeat away; keep polling briefly.
      await sleep(POLL_INTERVAL_MS);
      const { data: again } = await sb
        .from('shadow_runs')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();
      if (again) {
        shadowRunRow = again as Record<string, unknown>;
        console.log('  ✓ shadow_runs row appeared after terminal event.');
      } else {
        console.log('  ⚠ no shadow_runs row even after terminal event — early-failure path.');
      }
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log('');

  // ── 4. Capture full agent trace from job_events ──────────────────────
  console.log('── full job_events trace (partb_*) ──');
  const { data: allEvents } = await sb
    .from('job_events')
    .select('event_type, to_status, details, created_at')
    .eq('job_id', jobId)
    .like('event_type', 'partb_%')
    .order('created_at', { ascending: true });
  const events = allEvents ?? [];
  console.log(`  total partb_* events: ${events.length}`);
  for (const r of events) {
    const detailStr = r.details
      ? JSON.stringify(r.details).slice(0, 200)
      : '(none)';
    console.log(`  ${r.created_at}  ${r.event_type}  details=${detailStr}`);
  }
  console.log('');

  // ── 5. Detailed Critic verdict trace ─────────────────────────────────
  console.log('── Critic verdict trace ──');
  const reviseEvents = events.filter((e) =>
    ['partb_revise_slots', 'partb_revise_structural'].includes(
      e.event_type as string,
    ),
  );
  if (reviseEvents.length === 0) {
    console.log('  (no revise events fired — Critic approved on first verdict)');
  } else {
    for (const r of reviseEvents) {
      console.log(`  [${r.created_at}] ${r.event_type}`);
      const d = r.details as Record<string, unknown> | null;
      if (d) {
        const verdict = (d as any).verdict ?? d;
        console.log(`    verdict: ${JSON.stringify(verdict).slice(0, 400)}`);
      }
    }
  }
  console.log('');

  // ── 6. shadow_runs payload summary (if present) ──────────────────────
  if (shadowRunRow) {
    console.log('── shadow_runs row summary ──');
    const sr = shadowRunRow as any;
    console.log(`  run_id: ${sr.id}`);
    console.log(`  terminal_state: ${sr.part_b_terminal_state}`);
    console.log(`  failure_reason: ${sr.part_b_failure_reason ?? '(none)'}`);
    console.log(`  revise_loop_iterations: ${sr.revise_loop_iterations}`);
    console.log(`  total_agent_invocations: ${sr.total_agent_invocations}`);
    console.log(`  wall_time_ms: ${sr.part_b_wall_time_ms}`);
    console.log(`  cost_usd: $${Number(sr.part_b_cost_usd).toFixed(4)}`);
    const planner = sr.planner_output as Record<string, unknown> | null;
    const formId = planner ? (planner as any).form_id : null;
    console.log(`  planner.form_id: ${formId ?? '(unset)'}`);
    const picks = sr.storyboard_picks as Record<string, unknown> | null;
    const slotCount = picks ? Object.keys(picks).length : 0;
    console.log(`  storyboard_picks slot count: ${slotCount}`);
    const finalCritic = sr.critic_verdict as Record<string, unknown> | null;
    if (finalCritic) {
      const verdict = (finalCritic as any).verdict ?? finalCritic;
      console.log(`  final critic_verdict: ${JSON.stringify(verdict).slice(0, 400)}`);
    }
    console.log('');
  } else {
    console.log('── shadow_runs row: NOT WRITTEN ──');
    console.log('  (Part B failed early or is still mid-run past deadline)');
    console.log('');
  }

  // ── 7. Q8c assertion ─────────────────────────────────────────────────
  console.log('── Q8c GATE A ASSERTION ──');
  const sawStructural = events.some(
    (e) => e.event_type === 'partb_revise_structural',
  );
  if (sawStructural) {
    console.log('  ✓ partb_revise_structural EMITTED at least once');
    console.log('    Q8c PASS — Critic structural-revise code path is alive in production.');
    console.log(`    Closes followup w8-q5-signal-validation-not-exercised-in-gate-a.`);
  } else {
    console.log('  ⚠ partb_revise_structural NOT emitted in this run.');
    console.log('    Per brief, this is "evidence not conclusion" — valid Gate A signal.');
    if (shadowRunRow) {
      const sr = shadowRunRow as any;
      const planner = sr.planner_output as Record<string, unknown> | null;
      const formId = planner ? (planner as any).form_id : null;
      if (formId && formId !== 'single_exercise_deep_dive') {
        console.log(
          `    INTERPRETATION: Planner committed form_id='${formId}' (not single_exercise_deep_dive),`,
        );
        console.log('    so structural never had a chance to fire on a deep-dive form.');
      } else if (formId === 'single_exercise_deep_dive') {
        console.log(
          '    INTERPRETATION: Planner committed deep-dive form but Critic accepted the picks.',
        );
        console.log(
          '    Either the seed-coverage of `fire hydrant` was higher than expected, or',
        );
        console.log(
          '    the Critic teaching needs strengthening (W9.5 prompt-tuning candidate).',
        );
      }
    } else {
      console.log('    INTERPRETATION: Part B did not produce a shadow_runs row to analyze.');
    }
  }
  console.log('');

  // ── 8. Print artifact-capture commands ───────────────────────────────
  console.log('── REMINDER: capture this output into a Gate A artifact ──');
  console.log(`  npx tsx src/scripts/test-forced-structural.ts | tee \\`);
  console.log(`    docs/smoke-runs/w9-forced-structural-$(date -u +%Y%m%d).txt`);
  console.log(`  jobId for retrospective lookup: ${jobId}`);
  console.log('');

  process.exit(0);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
