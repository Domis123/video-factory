/**
 * Polish Sprint Pillar 1.4 — Critic replay harness.
 *
 * Replays the (post-Pillar-1) coherence-critic prompt against the three
 * stored pre-charter shadow_runs rows (cb87d32c, ff67fc55, cf104600).
 * Both ff67fc55 and cf104600 are explicitly named in the brief; cb87d32c
 * has the same shape (single-subject + 5/5 distinct parents +
 * failed_after_revise_budget) and is included as a third regression
 * data point at ~$0.05 marginal cost.
 *
 * Brief Section 1.4 Path A — "regression check, not behavioral change
 * check." Under stance-conditional, single-subject + cross-parent picks
 * SHOULD still escalate. The replay confirms the strict path is
 * preserved by the Pillar 1 prompt edits.
 *
 * Cost: ~$0.05 per replay × 3 ≈ $0.15. Negligible.
 *
 * Output is printed to stdout; pasted into the calibration report by c5.
 *
 * Usage: npx tsx src/scripts/pillar1-critic-replay.ts
 */

import { z } from 'zod';

import { supabaseAdmin } from '../config/supabase.js';
import { loadBrandPersona } from '../agents/brand-persona.js';
import { reviewStoryboard } from '../agents/coherence-critic.js';
import { PlannerOutputSchema } from '../types/planner-output.js';
import { StoryboardPicksSchema } from '../types/slot-pick.js';
import type { CriticVerdict } from '../types/critic-verdict.js';

const REPLAY_ROW_IDS = [
  'cb87d32c-53d2-49d1-aeb9-2e362091fbcb',
  'ff67fc55-1fc1-472f-8ef6-aec36e87a9c1',
  'cf104600-5a05-436a-932e-a2473a50dc4a',
];

interface ReplaySummary {
  shadow_run_id: string;
  idea_seed: string;
  subject_consistency: string;
  stored_verdict: string;
  stored_revise_scope: string | null;
  stored_top_issue: string | null;
  stored_top_severity: string | null;
  replay_verdict: string;
  replay_revise_scope: string;
  replay_top_issue: string | null;
  replay_top_severity: string | null;
  replay_cost_usd: number;
  replay_latency_ms: number;
  match: boolean;
}

async function loadShadowRow(id: string) {
  const { data, error } = await supabaseAdmin
    .from('shadow_runs')
    .select('id, job_id, planner_output, storyboard_picks, critic_verdict')
    .eq('id', id)
    .single();
  if (error) throw new Error(`shadow_runs ${id}: ${error.message}`);
  if (!data) throw new Error(`shadow_runs ${id}: not found`);

  const { data: jobData, error: jobErr } = await supabaseAdmin
    .from('jobs')
    .select('idea_seed, brand_id')
    .eq('id', (data as { job_id: string }).job_id)
    .single();
  if (jobErr || !jobData) {
    throw new Error(`jobs lookup for shadow_runs ${id} failed: ${jobErr?.message ?? 'no row'}`);
  }
  return { shadow: data, job: jobData };
}

function topIssue(verdict: { issues?: Array<{ issue_type: string; severity: string }> } | null) {
  if (!verdict || !Array.isArray(verdict.issues) || verdict.issues.length === 0) {
    return { issue: null, severity: null };
  }
  // Prefer high → medium → low
  const ordered = [...verdict.issues].sort((a, b) => {
    const r = (s: string) => (s === 'high' ? 0 : s === 'medium' ? 1 : 2);
    return r(a.severity) - r(b.severity);
  });
  return { issue: ordered[0]!.issue_type, severity: ordered[0]!.severity };
}

async function replayOne(rowId: string): Promise<ReplaySummary> {
  const { shadow, job } = await loadShadowRow(rowId);

  const plannerOutput = PlannerOutputSchema.parse(shadow.planner_output);
  const picks = StoryboardPicksSchema.parse(shadow.storyboard_picks);
  const brandPersona = await loadBrandPersona((job as { brand_id: string }).brand_id);

  const stored = (shadow.critic_verdict ?? null) as null | {
    verdict: string;
    revise_scope?: string;
    issues?: Array<{ issue_type: string; severity: string }>;
  };
  const storedTop = topIssue(stored);

  const replay: CriticVerdict = await reviewStoryboard({
    plannerOutput,
    picks,
    brandPersona,
  });
  const replayTop = topIssue(replay);

  const match =
    !!stored &&
    stored.verdict === replay.verdict &&
    (stored.revise_scope ?? null) === replay.revise_scope &&
    storedTop.issue === replayTop.issue &&
    storedTop.severity === replayTop.severity;

  return {
    shadow_run_id: rowId,
    idea_seed: (job as { idea_seed: string | null }).idea_seed ?? '(none)',
    subject_consistency: String(plannerOutput.subject_consistency),
    stored_verdict: stored?.verdict ?? '(no stored verdict)',
    stored_revise_scope: stored?.revise_scope ?? null,
    stored_top_issue: storedTop.issue,
    stored_top_severity: storedTop.severity,
    replay_verdict: replay.verdict,
    replay_revise_scope: replay.revise_scope,
    replay_top_issue: replayTop.issue,
    replay_top_severity: replayTop.severity,
    replay_cost_usd: replay.cost_usd,
    replay_latency_ms: replay.latency_ms,
    match,
  };
}

async function main() {
  console.log('# Pillar 1.4 Critic replay\n');
  console.log(`Replaying ${REPLAY_ROW_IDS.length} stored shadow_runs against the post-Pillar-1 coherence-critic prompt.\n`);

  const results: ReplaySummary[] = [];
  let totalCost = 0;

  for (const id of REPLAY_ROW_IDS) {
    process.stdout.write(`replay ${id}…  `);
    try {
      const r = await replayOne(id);
      results.push(r);
      totalCost += r.replay_cost_usd;
      console.log(`stored=${r.stored_verdict} replay=${r.replay_verdict} match=${r.match} cost=$${r.replay_cost_usd.toFixed(4)}`);
    } catch (err) {
      console.log(`FAILED — ${err instanceof z.ZodError ? 'Zod: ' + err.issues.map((i) => i.message).join('; ') : (err as Error).message}`);
      throw err;
    }
  }

  console.log('\n## Replay summary table\n');
  console.log('| shadow_run | seed | stance | stored verdict | stored top issue | replay verdict | replay top issue | match |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const seedShort = r.idea_seed.length > 50 ? r.idea_seed.slice(0, 47) + '…' : r.idea_seed;
    const storedIssue = r.stored_top_issue ? `${r.stored_top_issue}@${r.stored_top_severity}` : '(none)';
    const replayIssue = r.replay_top_issue ? `${r.replay_top_issue}@${r.replay_top_severity}` : '(none)';
    console.log(
      `| ${r.shadow_run_id.slice(0, 8)} | ${seedShort} | ${r.subject_consistency} | ${r.stored_verdict}/${r.stored_revise_scope ?? '?'} | ${storedIssue} | ${r.replay_verdict}/${r.replay_revise_scope} | ${replayIssue} | ${r.match ? '✓' : '✗'} |`,
    );
  }

  console.log(`\nTotal replay cost: $${totalCost.toFixed(4)}`);

  const allPreserve = results.every((r) => r.subject_consistency !== 'mixed' ? r.replay_verdict === 'revise' : true);
  console.log(`Regression preserved (single-subject still escalates): ${allPreserve ? 'YES' : 'NO — investigate'}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
