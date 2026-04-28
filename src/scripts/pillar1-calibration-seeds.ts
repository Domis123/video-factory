/**
 * Polish Sprint Pillar 1.4 — Calibration seed harness.
 *
 * Runs 4 calibration seeds through the production planning flow:
 *   1) insert a `jobs` row with brand=nordpilates + idea_seed
 *   2) POST /enqueue {queue:'planning', jobId} to the production VPS API
 *   3) production planning worker (BullMQ on VPS) handles the job —
 *      runs Phase 3.5 + fire-and-forgets Part B (W8 dispatch)
 *   4) poll `shadow_runs.part_b_terminal_state` for the job_id until non-null
 *   5) fetch the shadow_runs row + Phase 3.5 cost from cost-tracking
 *      (W9.1) and summarize per-seed
 *
 * Sequential execution (one seed at a time) — avoids Anthropic rate-limit
 * risk and keeps cost guardrail enforcement clean. Per-seed wall is
 * ~8 minutes (Phase 3.5 + Part B dual-run).
 *
 * Cost guardrails (halt + report; do NOT auto-continue):
 *   - any single seed `shadow_runs.part_b_cost_usd` > $1.50 (anomaly)
 *   - cumulative Part B cost across seeds > $3.50 (brief cap was $3.40)
 *   - any seed terminates `failed_agent_error` AND its job_events show
 *     a 429 / rate-limit token in the failure payload
 *
 * The brief budget tracks Part B cost only — Phase 3.5 cost is logged
 * separately for transparency but does NOT count against the cap, since
 * Phase 3.5 runs on every nordpilates job anyway and is not the
 * incremental cost of running a calibration seed.
 *
 * Output is printed to stdout; pasted into the calibration report by c5.
 *
 * Usage: npx tsx src/scripts/pillar1-calibration-seeds.ts
 *        npx tsx src/scripts/pillar1-calibration-seeds.ts --seed=1   (run seed 1 only)
 *        npx tsx src/scripts/pillar1-calibration-seeds.ts --dry-run  (insert+enqueue only, do not poll)
 */

import { randomUUID } from 'node:crypto';

import { supabaseAdmin } from '../config/supabase.js';

const VPS_API_URL = process.env['VPS_API_URL'] || 'http://95.216.137.35:3000';
const POLL_INTERVAL_MS = 30_000; // 30 s — operator instruction (30–60 s)
const POLL_TIMEOUT_MS = 20 * 60_000; // 20 min — Part B is ~8 min, leaves headroom

const SINGLE_SEED_COST_HALT = 1.5;
const CUMULATIVE_COST_HALT = 3.5;

interface CalibrationSeed {
  tag: string;
  seed: string;
  expected_stance: 'single-subject' | 'prefer-same' | 'mixed';
  brief_expectation: string;
}

const SEEDS: CalibrationSeed[] = [
  {
    tag: 'seed-1',
    seed: '3 small things that make pilates click',
    expected_stance: 'single-subject',
    brief_expectation:
      'cf104600 re-run; expected to still terminate failed_after_revise_budget (regression preservation)',
  },
  {
    tag: 'seed-2',
    seed: 'morning pilates flow with subtle modifications',
    expected_stance: 'single-subject',
    brief_expectation:
      'single-subject; likely also terminates failed_after_revise_budget given library limits — that is the cf104600 pattern we accept',
  },
  {
    tag: 'seed-3',
    seed: 'different pilates exercises for core',
    expected_stance: 'prefer-same',
    brief_expectation:
      'prefer-same; should NOT escalate to revise budget exhaustion; if Director picks ≥3 cross-parents, Critic fires at low (info-only) without revising',
  },
  {
    tag: 'seed-4',
    seed: 'pilates is for everyone — different bodies different flows',
    expected_stance: 'mixed',
    brief_expectation:
      'mixed; should NOT escalate; cross-parent picks intended; outfit-exception clause from c1 is what is being tested for the false-positive case',
  },
];

interface SeedResult {
  tag: string;
  job_id: string;
  shadow_run_id: string | null;
  idea_seed: string;
  expected_stance: string;
  actual_stance: string | null;
  form_id: string | null;
  hook_mechanism: string | null;
  posture: string | null;
  slot_count: number | null;
  parent_distribution: Array<{ parent: string; slots: number[] }> | null;
  terminal_state: string | null;
  revise_iters: number | null;
  part_b_cost_usd: number;
  part_b_wall_ms: number | null;
  phase35_cost_usd: number;
  critic_verdict: string | null;
  critic_revise_scope: string | null;
  critic_top_issue: string | null;
  critic_top_severity: string | null;
}

async function postEnqueue(jobId: string): Promise<void> {
  const url = `${VPS_API_URL}/enqueue`;
  const body = JSON.stringify({ queue: 'planning', jobId });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`POST /enqueue failed: ${res.status} ${await res.text()}`);
  }
}

async function pollShadowRun(jobId: string): Promise<{
  row: Record<string, unknown> | null;
  terminal: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from('shadow_runs')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) throw new Error(`shadow_runs lookup: ${error.message}`);
  const row = data as Record<string, unknown> | null;
  const terminal =
    !!row && row['part_b_terminal_state'] != null && row['part_b_terminal_state'] !== 'in_flight';
  return { row, terminal };
}

async function findRateLimitInJobEvents(jobId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('job_events')
    .select('payload')
    .eq('job_id', jobId);
  if (error) return false;
  const text = JSON.stringify(data ?? []);
  return /\b429\b|rate.?limit|rate_limited|RateLimitError/i.test(text);
}

async function getPhase35Cost(jobId: string): Promise<number> {
  // Phase 3.5 cost is recorded against jobs row by the W9.1 wireup
  // (`jobs.cost_usd` for Phase 3.5; `shadow_runs.part_b_cost_usd` for Part B).
  // If schema differs, fail soft → 0.
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('cost_usd, total_cost_usd')
    .eq('id', jobId)
    .single();
  if (error || !data) return 0;
  const row = data as Record<string, unknown>;
  return typeof row['cost_usd'] === 'number'
    ? (row['cost_usd'] as number)
    : typeof row['total_cost_usd'] === 'number'
    ? (row['total_cost_usd'] as number)
    : 0;
}

function computeParentDistribution(
  storyboardPicks: unknown,
): Array<{ parent: string; slots: number[] }> | null {
  if (!storyboardPicks || typeof storyboardPicks !== 'object') return null;
  const picks = (storyboardPicks as { picks?: unknown }).picks;
  if (!Array.isArray(picks)) return null;
  const map = new Map<string, number[]>();
  for (const p of picks) {
    if (!p || typeof p !== 'object') continue;
    const parent = (p as { parent_asset_id?: unknown }).parent_asset_id;
    const slot = (p as { slot_index?: unknown }).slot_index;
    if (typeof parent !== 'string' || typeof slot !== 'number') continue;
    const arr = map.get(parent) ?? [];
    arr.push(slot);
    map.set(parent, arr);
  }
  return [...map.entries()]
    .map(([parent, slots]) => ({ parent: parent.slice(0, 8), slots: slots.sort((a, b) => a - b) }))
    .sort((a, b) => a.slots[0]! - b.slots[0]!);
}

function topCriticIssue(
  verdict: unknown,
): { issue: string | null; severity: string | null } {
  if (!verdict || typeof verdict !== 'object') return { issue: null, severity: null };
  const issues = (verdict as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return { issue: null, severity: null };
  const ordered = [...issues].sort((a, b) => {
    const r = (s: string) => (s === 'high' ? 0 : s === 'medium' ? 1 : 2);
    return r((a as { severity: string }).severity) - r((b as { severity: string }).severity);
  });
  const top = ordered[0] as { issue_type: string; severity: string };
  return { issue: top.issue_type, severity: top.severity };
}

async function runSeed(seed: CalibrationSeed, dryRun: boolean): Promise<SeedResult> {
  const jobId = randomUUID();
  console.log(`\n── ${seed.tag} ──────────────────────────────────────────────`);
  console.log(`seed:               ${seed.seed}`);
  console.log(`expected stance:    ${seed.expected_stance}`);
  console.log(`brief expectation:  ${seed.brief_expectation}`);
  console.log(`job_id:             ${jobId}`);

  const { error: insertErr } = await supabaseAdmin.from('jobs').insert({
    id: jobId,
    brand_id: 'nordpilates',
    status: 'planning',
    idea_seed: seed.seed,
  });
  if (insertErr) throw new Error(`job insert: ${insertErr.message}`);

  await postEnqueue(jobId);
  console.log(`enqueued; planning worker will pick it up on the VPS.`);

  if (dryRun) {
    console.log(`(dry-run — skipping poll)`);
    return {
      tag: seed.tag,
      job_id: jobId,
      shadow_run_id: null,
      idea_seed: seed.seed,
      expected_stance: seed.expected_stance,
      actual_stance: null,
      form_id: null,
      hook_mechanism: null,
      posture: null,
      slot_count: null,
      parent_distribution: null,
      terminal_state: 'dry-run',
      revise_iters: null,
      part_b_cost_usd: 0,
      part_b_wall_ms: null,
      phase35_cost_usd: 0,
      critic_verdict: null,
      critic_revise_scope: null,
      critic_top_issue: null,
      critic_top_severity: null,
    };
  }

  const t0 = Date.now();
  let row: Record<string, unknown> | null = null;
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const wait = new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await pollShadowRun(jobId);
    if (result.terminal) {
      row = result.row;
      break;
    }
    const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`  polling… ${elapsedMin}min elapsed; row=${result.row ? 'present (in_flight)' : 'absent'}`);
    await wait;
  }

  if (!row) {
    throw new Error(`${seed.tag} POLL TIMEOUT after ${POLL_TIMEOUT_MS / 60000}min — investigate manually`);
  }

  const planner = (row['planner_output'] ?? {}) as Record<string, unknown>;
  const verdict = row['critic_verdict'];
  const top = topCriticIssue(verdict);
  const phase35Cost = await getPhase35Cost(jobId);

  return {
    tag: seed.tag,
    job_id: jobId,
    shadow_run_id: row['id'] as string,
    idea_seed: seed.seed,
    expected_stance: seed.expected_stance,
    actual_stance: (planner['subject_consistency'] as string) ?? null,
    form_id: (planner['form_id'] as string) ?? null,
    hook_mechanism: (planner['hook_mechanism'] as string) ?? null,
    posture: (planner['posture'] as string) ?? null,
    slot_count: typeof planner['slot_count'] === 'number' ? (planner['slot_count'] as number) : null,
    parent_distribution: computeParentDistribution(row['storyboard_picks']),
    terminal_state: (row['part_b_terminal_state'] as string) ?? null,
    revise_iters: typeof row['revise_loop_iterations'] === 'number' ? (row['revise_loop_iterations'] as number) : null,
    part_b_cost_usd: typeof row['part_b_cost_usd'] === 'number' ? (row['part_b_cost_usd'] as number) : 0,
    part_b_wall_ms: typeof row['part_b_wall_time_ms'] === 'number' ? (row['part_b_wall_time_ms'] as number) : null,
    phase35_cost_usd: phase35Cost,
    critic_verdict: verdict && typeof verdict === 'object' ? ((verdict as { verdict: string }).verdict ?? null) : null,
    critic_revise_scope: verdict && typeof verdict === 'object' ? ((verdict as { revise_scope?: string }).revise_scope ?? null) : null,
    critic_top_issue: top.issue,
    critic_top_severity: top.severity,
  };
}

function summarize(r: SeedResult): void {
  console.log(`\n  result for ${r.tag}:`);
  console.log(`    actual stance:        ${r.actual_stance} (expected ${r.expected_stance})`);
  console.log(`    form_id:              ${r.form_id}`);
  console.log(`    hook_mechanism:       ${r.hook_mechanism}`);
  console.log(`    posture:              ${r.posture}  slot_count: ${r.slot_count}`);
  console.log(`    parent_distribution:  ${
    r.parent_distribution
      ? r.parent_distribution.map((d) => `${d.parent}@[${d.slots.join(',')}]`).join('  ')
      : '(none)'
  }`);
  console.log(`    distinct parents:     ${r.parent_distribution?.length ?? 0} / ${r.slot_count ?? '?'}`);
  console.log(`    Critic verdict:       ${r.critic_verdict}/${r.critic_revise_scope ?? '?'}  top: ${r.critic_top_issue ?? '(none)'}@${r.critic_top_severity ?? '?'}`);
  console.log(`    terminal_state:       ${r.terminal_state}  revise_iters: ${r.revise_iters}`);
  console.log(`    part_b_cost_usd:      $${r.part_b_cost_usd.toFixed(4)}  wall: ${r.part_b_wall_ms ?? '?'}ms`);
  console.log(`    phase35_cost_usd:     $${r.phase35_cost_usd.toFixed(4)} (logged separately, not gated)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const seedFilter = argv.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? null;

  const seeds = seedFilter
    ? SEEDS.filter((s) => s.tag === `seed-${seedFilter}` || s.tag === seedFilter)
    : SEEDS;

  if (seeds.length === 0) {
    console.error(`no seed matched --seed=${seedFilter}`);
    process.exit(1);
  }

  console.log(`# Pillar 1.4 calibration seeds`);
  console.log(`Sequential; ${seeds.length} seed(s); dry_run=${dryRun}`);
  console.log(`Cost guardrails: any seed > $${SINGLE_SEED_COST_HALT}, cumulative > $${CUMULATIVE_COST_HALT}, 429s — halt and report.`);

  const results: SeedResult[] = [];
  let cumulativePartB = 0;

  for (const s of seeds) {
    let r: SeedResult;
    try {
      r = await runSeed(s, dryRun);
    } catch (err) {
      console.error(`\n${s.tag} FAILED: ${(err as Error).message}`);
      console.error(`Halting; partial results below.`);
      break;
    }
    summarize(r);
    results.push(r);
    cumulativePartB += r.part_b_cost_usd;

    // Cost / rate-limit halts
    if (r.part_b_cost_usd > SINGLE_SEED_COST_HALT) {
      console.error(`\nHALT: ${s.tag} part_b_cost_usd $${r.part_b_cost_usd.toFixed(4)} exceeds single-seed cap $${SINGLE_SEED_COST_HALT}.`);
      break;
    }
    if (cumulativePartB > CUMULATIVE_COST_HALT) {
      console.error(`\nHALT: cumulative part_b cost $${cumulativePartB.toFixed(4)} exceeds cap $${CUMULATIVE_COST_HALT}.`);
      break;
    }
    if (r.terminal_state === 'failed_agent_error') {
      const rateLimited = await findRateLimitInJobEvents(r.job_id);
      if (rateLimited) {
        console.error(`\nHALT: ${s.tag} terminated failed_agent_error with 429 / rate-limit signal in job_events.`);
        break;
      }
    }
  }

  console.log(`\n## Calibration seed summary table\n`);
  console.log('| tag | seed | expected stance | actual stance | distinct parents / slot_count | terminal_state | revise_iters | Critic verdict | top issue | part_b_cost |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const seedShort = r.idea_seed.length > 50 ? r.idea_seed.slice(0, 47) + '…' : r.idea_seed;
    const dpCount = r.parent_distribution?.length ?? 0;
    const issue = r.critic_top_issue ? `${r.critic_top_issue}@${r.critic_top_severity}` : '(none)';
    console.log(
      `| ${r.tag} | ${seedShort} | ${r.expected_stance} | ${r.actual_stance ?? '?'} | ${dpCount}/${r.slot_count ?? '?'} | ${r.terminal_state ?? '?'} | ${r.revise_iters ?? '?'} | ${r.critic_verdict ?? '?'}/${r.critic_revise_scope ?? '?'} | ${issue} | $${r.part_b_cost_usd.toFixed(4)} |`,
    );
  }

  const totalPartB = results.reduce((a, r) => a + r.part_b_cost_usd, 0);
  const totalPhase35 = results.reduce((a, r) => a + r.phase35_cost_usd, 0);
  console.log(`\nCumulative Part B cost:   $${totalPartB.toFixed(4)} (cap $${CUMULATIVE_COST_HALT}; brief budget $3.40)`);
  console.log(`Cumulative Phase 3.5 cost: $${totalPhase35.toFixed(4)} (logged for transparency; not gated)`);
  console.log(`Cumulative TOTAL cost:    $${(totalPartB + totalPhase35).toFixed(4)}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
