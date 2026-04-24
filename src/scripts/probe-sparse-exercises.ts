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

const candidates = [
  'bulgarian split',
  'pistol squat',
  'kettlebell',
  'burpee',
  'jumping jack',
  'box jump',
  'sprint',
  'battle rope',
  'deadlift',
  'bench press',
  'pull-up',
  'pull up',
  'turkish get-up',
  'farmer carry',
  'wall sit',
  'mountain climber',
  'bear crawl',
  'crab walk',
  'plyometric',
  'barbell',
  'dumbbell',
  'resistance band',
  'medicine ball',
  'chair dip',
  'superman hold',
  'handstand',
  'cartwheel',
  'warrior pose',
  'downward dog',
  'sun salutation',
];

async function main() {
  console.log('── Sparse-exercise probe for Seed C ──────────────────');
  for (const needle of candidates) {
    const { count, error } = await sb
      .from('asset_segments')
      .select('*', { count: 'exact', head: true })
      .ilike('description', `%${needle}%`);
    if (error) {
      console.log(`  ${needle.padEnd(22)} ERROR ${error.message}`);
      continue;
    }
    console.log(`  ${needle.padEnd(22)} ${count}`);
  }
}

main();
