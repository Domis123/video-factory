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
  const { data, error } = await sb.rpc('apply_migration_sql', {
    sql: `
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'job_events'
      ORDER BY ordinal_position;
    `,
  });
  if (error) {
    console.error('introspect err:', error.message);
  } else {
    console.log('introspect data:', JSON.stringify(data, null, 2));
  }

  // Fallback: probe by inserting with a long string on each column.
  const { data: jr } = await sb.from('jobs').select('id').limit(1).single();
  if (!jr) {
    console.log('no jobs FK target');
    return;
  }

  for (const len of [29, 30, 31, 40, 50, 100]) {
    const pad = 'X'.repeat(len - 'from_status_'.length);
    const probe = `from_status_${pad}`;
    const { error: ie } = await sb
      .from('job_events')
      .insert({
        job_id: jr.id,
        from_status: probe,
        to_status: probe,
        event_type: 'w8_probe',
        details: { probe: true, len },
      })
      .select('id');
    if (ie) {
      console.log(`  len=${len} (from_status/to_status/event_type=${probe.length}): ERR ${ie.message}`);
    } else {
      console.log(`  len=${len}: OK`);
    }
  }

  // Cleanup probes
  await sb.from('job_events').delete().eq('event_type', 'w8_probe');
}

main();
