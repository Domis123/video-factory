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

async function probeExerciseName(label: string, needle: string) {
  const { data, error } = await sb
    .from('asset_segments')
    .select('id, segment_type, start_s, end_s, description')
    .ilike('description', `%${needle}%`)
    .limit(10);
  if (error) {
    console.error(`[${label}] error: ${error.message}`);
    return;
  }
  console.log(`[${label}] match count (up to 10): ${data?.length ?? 0}`);
  for (const r of data ?? []) {
    const d = (r.end_s ?? 0) - (r.start_s ?? 0);
    const descSnip = (r.description ?? '').slice(0, 80);
    console.log(`  ${r.segment_type} ${d.toFixed(1)}s: ${descSnip}`);
  }
}

async function main() {
  console.log('── Single-leg glute bridge coverage probe ────────────');
  await probeExerciseName('single-leg glute bridge', 'single-leg glute bridge');
  await probeExerciseName('single leg glute bridge', 'single leg glute bridge');
  await probeExerciseName('single-leg bridge', 'single-leg bridge');
  await probeExerciseName('glute bridge (all)', 'glute bridge');

  console.log('\n── Hip mobility coverage probe ────────────────────────');
  await probeExerciseName('hip mobility', 'hip mobility');
  await probeExerciseName('hip opener', 'hip opener');
  await probeExerciseName('hip circle', 'hip circle');

  console.log('\n── Aesthetic ambient probe (talking-head + b-roll) ─────');
  const { data: thCount } = await sb
    .from('asset_segments')
    .select('id', { count: 'exact', head: true })
    .eq('segment_type', 'talking-head');
  const { data: brCount } = await sb
    .from('asset_segments')
    .select('id', { count: 'exact', head: true })
    .eq('segment_type', 'b-roll');
  console.log(`  talking-head: ${thCount === null ? '?' : JSON.stringify(thCount)}`);
  console.log(`  b-roll: ${brCount === null ? '?' : JSON.stringify(brCount)}`);
  const { count: thC } = await sb
    .from('asset_segments')
    .select('*', { count: 'exact', head: true })
    .eq('segment_type', 'talking-head');
  const { count: brC } = await sb
    .from('asset_segments')
    .select('*', { count: 'exact', head: true })
    .eq('segment_type', 'b-roll');
  console.log(`  (count via head-only): talking-head=${thC} b-roll=${brC}`);
}

main();
