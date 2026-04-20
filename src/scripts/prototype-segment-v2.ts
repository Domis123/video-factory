import { supabaseAdmin } from '../config/supabase.js';
import { analyzeSegmentDeepV2 } from '../lib/gemini-segments-v2.js';
import { env } from '../config/env.js';

const TEST_SEGMENT_IDS = [
  'f9788090-f755-4bf1-afd1-6272df9fe225', // exercise — spider plank, right leg
  '03c60575-5b59-45e1-b69e-e5c2aa70c38d', // hold — forearm plank
  'f36d686b-9afc-47cf-a067-67edf59321ac', // talking-head — blonde, blue top, home
];

const BRAND_CONTEXT = 'nordpilates — pilates/flexibility/wellness content';

interface V1Row {
  id: string;
  parent_asset_id: string;
  start_s: number;
  end_s: number;
  description: string;
  segment_type: string;
  visual_tags: string[];
  quality_score: number;
}

interface ParentRow {
  pre_normalized_r2_key: string | null;
  r2_key: string;
}

async function loadV1(segmentId: string): Promise<{ v1: V1Row; parentR2Key: string }> {
  const { data: seg, error: segErr } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, start_s, end_s, description, segment_type, visual_tags, quality_score')
    .eq('id', segmentId)
    .single();
  if (segErr || !seg) throw new Error(`asset_segments lookup failed for ${segmentId}: ${segErr?.message ?? 'not found'}`);

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('pre_normalized_r2_key, r2_key')
    .eq('id', seg.parent_asset_id)
    .single();
  if (parentErr || !parent) throw new Error(`assets lookup failed for ${seg.parent_asset_id}: ${parentErr?.message ?? 'not found'}`);

  const parentRow = parent as ParentRow;
  const parentR2Key = parentRow.pre_normalized_r2_key ?? parentRow.r2_key;
  if (!parentR2Key) throw new Error(`No r2 key on parent asset ${seg.parent_asset_id}`);

  return { v1: seg as V1Row, parentR2Key };
}

async function runOne(segmentId: string): Promise<void> {
  const started = Date.now();
  console.log('\n==============================================');
  console.log(`=== SEGMENT ${segmentId} ===`);
  console.log('==============================================');

  const { v1, parentR2Key } = await loadV1(segmentId);

  console.log(`V1 type: ${v1.segment_type}`);
  console.log(`V1 window: start_s=${v1.start_s} end_s=${v1.end_s} (duration=${(v1.end_s - v1.start_s).toFixed(1)}s)`);
  console.log(`V1 quality: ${v1.quality_score}/10`);
  console.log(`V1 description: ${v1.description}`);
  console.log(`V1 tags (${v1.visual_tags.length}): ${v1.visual_tags.join(', ')}`);
  console.log(`Parent R2 key: ${parentR2Key}`);
  console.log('---');

  try {
    const v2 = await analyzeSegmentDeepV2(
      parentR2Key,
      {
        start_s: v1.start_s,
        end_s: v1.end_s,
        segment_type: v1.segment_type as BoundariesType,
        preliminary_notes: `v1 description: ${v1.description.slice(0, 150)}`,
      },
      BRAND_CONTEXT,
    );

    console.log('V2 JSON:');
    console.log(JSON.stringify(v2, null, 2));

    console.log('---');
    console.log('V2.1 new fields:');
    console.log(`  setting.on_screen_text: ${JSON.stringify(v2.setting.on_screen_text)}`);
    console.log(`  audio.audio_clarity:    ${v2.audio.audio_clarity}`);
    console.log(`  exercise.form_rating:   ${v2.exercise.form_rating}`);
  } catch (err) {
    console.error(`V2 ERROR: ${(err as Error).message}`);
    if ((err as Error).stack) console.error((err as Error).stack);
  }

  const wallMs = Date.now() - started;
  console.log('---');
  console.log(`Wall time: ${(wallMs / 1000).toFixed(1)}s`);
}

type BoundariesType =
  | 'setup'
  | 'exercise'
  | 'transition'
  | 'hold'
  | 'cooldown'
  | 'talking-head'
  | 'b-roll'
  | 'unusable';

async function main() {
  console.log(`[prototype-segment-v2] Model: ${env.GEMINI_INGESTION_MODEL}`);
  console.log(`[prototype-segment-v2] Brand context: ${BRAND_CONTEXT}`);
  console.log(`[prototype-segment-v2] Running ${TEST_SEGMENT_IDS.length} test segments\n`);

  const overall = Date.now();
  for (const id of TEST_SEGMENT_IDS) {
    await runOne(id);
  }
  console.log(`\n[prototype-segment-v2] Total wall time: ${((Date.now() - overall) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[prototype-segment-v2] FATAL:', err);
  process.exit(1);
});
