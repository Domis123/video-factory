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
  console.log('── job_events sample (last 3) ──────────────────');
  const { data, error } = await sb
    .from('job_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) {
    console.error('fetch error:', error.message);
    return;
  }
  for (const r of data ?? []) {
    console.log(JSON.stringify(r, null, 2));
  }

  // Try inserting with event_type + details to confirm the real column
  console.log('\n── probe: insert with event_type + details ─────');
  const { data: jr } = await sb.from('jobs').select('id').limit(1).single();
  if (!jr) {
    console.log('no jobs to FK into; skipping insert probe');
    return;
  }
  const { data: ie, error: ieErr } = await sb
    .from('job_events')
    .insert({
      job_id: jr.id,
      event_type: 'w8_probe',
      details: { probe: true },
    })
    .select('id')
    .single();
  if (ieErr) {
    console.error('insert probe error:', ieErr.message);
  } else {
    console.log('insert probe ok; id=', ie?.id);
    await sb.from('job_events').delete().eq('id', ie!.id);
    console.log('probe row deleted');
  }
}

main();
