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

const RUN_ID = '37323ece-e9b0-40b2-8d04-20818dca06a8';

async function main() {
  console.log(`── Looking up shadow_runs row for runId=${RUN_ID} ──`);
  const { data: sr, error: srErr } = await sb
    .from('shadow_runs')
    .select('id, job_id, part_b_terminal_state, part_b_failure_reason, part_b_wall_time_ms, revise_loop_iterations, total_agent_invocations, created_at')
    .eq('id', RUN_ID)
    .single();
  if (srErr || !sr) {
    console.error('shadow_runs fetch error:', srErr?.message);
    return;
  }
  console.log('shadow_runs row:');
  console.log(JSON.stringify(sr, null, 2));

  const jobId = sr.job_id as string;
  console.log(`\n── job_events for job_id=${jobId} (ORDER BY created_at ASC) ──`);
  const { data: events, error: evErr } = await sb
    .from('job_events')
    .select('event_type, to_status, details, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (evErr) {
    console.error('job_events fetch error:', evErr.message);
    return;
  }

  const total = events?.length ?? 0;
  console.log(`total rows: ${total}`);
  if (total === 0) return;

  console.log('\n── FIRST 5 ─────────────────────────');
  for (const row of events!.slice(0, 5)) {
    console.log(
      `  ${row.created_at}  event_type=${row.event_type}  to_status=${row.to_status}`,
    );
    console.log(`    details: ${JSON.stringify(row.details)}`);
  }

  console.log('\n── LAST 3 ──────────────────────────');
  for (const row of events!.slice(-3)) {
    console.log(
      `  ${row.created_at}  event_type=${row.event_type}  to_status=${row.to_status}`,
    );
    console.log(`    details: ${JSON.stringify(row.details)}`);
  }

  // Count each event_type
  const counts = new Map<string, number>();
  for (const row of events!) {
    counts.set(row.event_type as string, (counts.get(row.event_type as string) ?? 0) + 1);
  }
  console.log('\n── event_type counts ───────────────');
  for (const [name, n] of [...counts.entries()].sort()) {
    console.log(`  ${name}: ${n}`);
  }

  // Assertions
  console.log('\n── ASSERTIONS ──────────────────────');
  const required = [
    'partb_planning_started',
    'partb_planning_completed',
    'partb_retrieval_started',
    'partb_retrieval_completed',
    'partb_director_started',
    'partb_director_completed',
    'partb_snapshot_started',
    'partb_snapshot_completed',
    'partb_fanout_started',
    'partb_fanout_completed',
    'partb_revise_slots',
    'partb_revise_exhausted',
    'partb_pipeline_escalated',
  ];
  for (const name of required) {
    const n = counts.get(name) ?? 0;
    const ok = n > 0;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${n}`);
  }

  const reviseSlotsCount = counts.get('partb_revise_slots') ?? 0;
  console.log(
    `  ${reviseSlotsCount >= 2 ? '✓' : '✗'} partb_revise_slots occurs ≥2× (observed ${reviseSlotsCount})`,
  );

  // NOT NULL check (to_status)
  const nullToStatus = events!.filter((r) => !r.to_status).length;
  console.log(`  ${nullToStatus === 0 ? '✓' : '✗'} no NULL to_status (observed ${nullToStatus})`);

  // details structured
  const nullDetails = events!.filter((r) => !r.details || typeof r.details !== 'object').length;
  console.log(`  ${nullDetails === 0 ? '✓' : '✗'} details is structured on all rows (non-structured: ${nullDetails})`);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
