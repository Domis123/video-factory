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

async function main() {
  // 1. shadow_runs table: SELECT limit 0 confirms table + columns are reachable.
  console.log('── 1. shadow_runs table ──────────────────────────────────');
  const { error: srErr } = await sb
    .from('shadow_runs')
    .select(
      'id, job_id, created_at, planner_output, retrieval_debug, storyboard_picks, critic_verdict, copy_package, context_packet_v2, context_packet_v1, revise_loop_iterations, total_agent_invocations, part_b_wall_time_ms, part_b_cost_usd, operator_comparison_verdict, operator_notes, part_b_terminal_state, part_b_failure_reason',
    )
    .limit(0);
  if (srErr) {
    console.error(`  FAIL shadow_runs: ${srErr.message}`);
  } else {
    console.log('  PASS shadow_runs reachable with all 18 expected columns');
  }

  // 2. brand_configs.pipeline_version
  console.log('\n── 2. brand_configs.pipeline_version ─────────────────────');
  const { data: brandRows, error: brandErr } = await sb
    .from('brand_configs')
    .select('brand_id, pipeline_version')
    .limit(10);
  if (brandErr) {
    console.error(`  FAIL: ${brandErr.message}`);
  } else {
    console.log(`  PASS column reachable. ${brandRows?.length ?? 0} rows:`);
    for (const r of brandRows ?? []) {
      console.log(`    brand_id=${r.brand_id} pipeline_version=${r.pipeline_version}`);
    }
  }

  // 2b. CHECK constraint verification: try to insert an invalid value via update
  console.log('\n── 2b. pipeline_version CHECK constraint ─────────────────');
  const { error: badUpdateErr } = await sb
    .from('brand_configs')
    .update({ pipeline_version: 'nonsense_value' })
    .eq('brand_id', 'nordpilates');
  if (badUpdateErr) {
    console.log(
      `  PASS CHECK rejected invalid value. Error: ${badUpdateErr.message.slice(0, 120)}`,
    );
  } else {
    console.error('  FAIL: invalid value was accepted!');
    // Roll back the bad write
    await sb
      .from('brand_configs')
      .update({ pipeline_version: 'phase35' })
      .eq('brand_id', 'nordpilates');
  }

  // 3. jobs.pipeline_override
  console.log('\n── 3. jobs.pipeline_override ────────────────────────────');
  const { data: jobsSample, error: jobsErr } = await sb
    .from('jobs')
    .select('id, pipeline_override')
    .limit(3);
  if (jobsErr) {
    console.error(`  FAIL: ${jobsErr.message}`);
  } else {
    console.log(`  PASS column reachable. ${jobsSample?.length ?? 0} rows:`);
    for (const r of jobsSample ?? []) {
      console.log(`    id=${r.id} pipeline_override=${JSON.stringify(r.pipeline_override)}`);
    }
  }

  // 4. shadow_runs indexes — apply_migration_sql is DDL-only (returns no
  // rows); indexes are declared with CREATE INDEX IF NOT EXISTS in the
  // migration so the migration apply itself asserts their presence.
  console.log('\n── 4. shadow_runs indexes ───────────────────────────────');
  console.log('  Declared in migration (CREATE INDEX IF NOT EXISTS):');
  console.log('    - idx_shadow_runs_job_id');
  console.log('    - idx_shadow_runs_created_at');
  console.log('    - idx_shadow_runs_terminal_state');
  console.log('    - idx_shadow_runs_brand_state_time');

  // 4b. Round-trip insert/delete exercises the table + FK + NOT NULL set.
  console.log('\n── 4b. round-trip insert/delete sanity ──────────────────');
  const { data: anyJob } = await sb.from('jobs').select('id').limit(1).single();
  if (!anyJob) {
    console.log('  SKIP: no jobs row available to FK into');
    return;
  }
  const insertRow = {
    job_id: anyJob.id as string,
    planner_output: { probe: true },
    retrieval_debug: { probe: true },
    storyboard_picks: { probe: true },
    critic_verdict: { probe: true },
    copy_package: { probe: true },
    context_packet_v2: { brand_id: 'nordpilates', probe: true },
    revise_loop_iterations: 0,
    total_agent_invocations: 1,
    part_b_wall_time_ms: 1,
    part_b_cost_usd: 0,
    part_b_terminal_state: 'completed',
  };
  const { data: inserted, error: insErr } = await sb
    .from('shadow_runs')
    .insert(insertRow)
    .select('id')
    .single();
  if (insErr) {
    console.error(`  FAIL insert: ${insErr.message}`);
    return;
  }
  console.log(`  PASS inserted id=${inserted!.id}`);
  const { error: delErr } = await sb
    .from('shadow_runs')
    .delete()
    .eq('id', inserted!.id);
  if (delErr) {
    console.error(`  FAIL delete (cleanup): ${delErr.message}`);
  } else {
    console.log(`  PASS cleanup delete ok`);
  }
}

main();
