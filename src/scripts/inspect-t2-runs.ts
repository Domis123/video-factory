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

const RUNS = [
  { tag: 'A', runId: 'c16d19a8-9aa1-4069-af84-95a82c16745a' },
  { tag: 'B', runId: 'e4a01ccc-0ba6-4492-83a4-142eec74756a' },
  // Seed C: no runId because shadow_runs write was skipped (incomplete outputs
  // at terminal state FAILED). We'll note that in the artifact directly.
];

async function main() {
  console.log('── Tier 2 shadow_runs inspection ─────────────────────────');
  let totalCost = 0;
  for (const r of RUNS) {
    const { data, error } = await sb
      .from('shadow_runs')
      .select(
        'id, job_id, created_at, planner_output, storyboard_picks, critic_verdict, copy_package, revise_loop_iterations, total_agent_invocations, part_b_wall_time_ms, part_b_cost_usd, part_b_terminal_state, part_b_failure_reason',
      )
      .eq('id', r.runId)
      .single();
    if (error) {
      console.log(`\n[${r.tag}] shadow_runs fetch error: ${error.message}`);
      continue;
    }

    console.log(`\n── Seed ${r.tag} run ${r.runId} ──`);
    console.log(`  terminal_state: ${data.part_b_terminal_state}`);
    console.log(`  failure_reason: ${data.part_b_failure_reason ?? '—'}`);
    console.log(`  revise_iterations: ${data.revise_loop_iterations}`);
    console.log(`  agent_invocations: ${data.total_agent_invocations}`);
    console.log(`  wall_time_ms: ${data.part_b_wall_time_ms}`);
    console.log(`  cost_usd: $${(data.part_b_cost_usd ?? 0).toFixed(4)}`);
    totalCost += Number(data.part_b_cost_usd ?? 0);

    // Planner form/posture
    const plan = data.planner_output as any;
    if (plan) {
      console.log(
        `  planner: form_id=${plan.form_id} posture=${plan.posture} slots=${plan.slots?.length ?? 0}`,
      );
    }

    // Critic verdicts — reconstruct revise scope if possible
    const critic = data.critic_verdict as any;
    if (critic) {
      console.log(`  critic.verdict: ${critic.verdict}`);
      console.log(`  critic.revise_scope: ${critic.revise_scope ?? '—'}`);
      if (critic.issues) {
        console.log(`  critic.issues (first 3):`);
        for (const issue of (critic.issues as any[]).slice(0, 3)) {
          console.log(
            `    - ${issue.issue_type} ${issue.severity} slots=${JSON.stringify(issue.affected_slot_indices)} — ${(issue.note ?? '').slice(0, 120)}`,
          );
        }
      }
    }

    // Storyboard slot count
    const sp = data.storyboard_picks as any;
    if (sp?.primary_picks) {
      console.log(`  storyboard.primary_picks: ${sp.primary_picks.length}`);
    }

    // Copy package present?
    console.log(`  copy_package: ${data.copy_package ? 'present' : 'null'}`);
  }

  console.log(`\n── Total shadow_runs cost (A+B): $${totalCost.toFixed(4)} ──`);

  // Also probe any other rows in shadow_runs just to be safe
  const { count } = await sb
    .from('shadow_runs')
    .select('id', { count: 'exact', head: true });
  console.log(`── shadow_runs total rows now: ${count} ──`);
}

main();
