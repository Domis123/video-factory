/**
 * Clean-slate wipe of nordpilates assets + segments + R2 objects,
 * plus carnimeat test debris from Phase 3 W5 development.
 *
 * Usage:
 *   npx tsx src/scripts/clean-slate-nordpilates.ts
 *
 * Destructive. Logs every count before and after deletion.
 * Does NOT touch brand_configs, music_tracks, jobs, or job_events.
 */

import 'dotenv/config';
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { supabaseAdmin } from '../config/supabase.js';
import { s3, R2_BUCKET } from '../config/r2.js';

async function countRows(table: string, brandId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('brand_id', brandId);
  return count ?? 0;
}

async function listR2Keys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function deleteR2Keys(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  let deleted = 0;
  // DeleteObjects accepts max 1000 keys per call
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: batch.map(Key => ({ Key })) },
    }));
    deleted += batch.length;
  }
  return deleted;
}

async function main() {
  console.log('='.repeat(60));
  console.log('CLEAN-SLATE: nordpilates + carnimeat test debris');
  console.log('='.repeat(60));

  // ── Pre-deletion counts ──
  console.log('\n--- PRE-DELETION COUNTS ---');
  const preAssets = await countRows('assets', 'nordpilates');
  const preSegments = await countRows('asset_segments', 'nordpilates');
  console.log(`nordpilates assets:   ${preAssets}`);
  console.log(`nordpilates segments: ${preSegments}`);

  const r2Prefixes = [
    'assets/nordpilates/',
    'segments/nordpilates/',
    'keyframes/nordpilates/',
    'parents/normalized/nordpilates/',
    'assets/carnimeat/',
    'segments/carnimeat/',
    'keyframes/carnimeat/',
    'parents/normalized/carnimeat/',
  ];

  const r2KeysByPrefix: Record<string, string[]> = {};
  for (const p of r2Prefixes) {
    const keys = await listR2Keys(p);
    r2KeysByPrefix[p] = keys;
    console.log(`R2 ${p} → ${keys.length} objects`);
  }

  // ── DB deletion: nordpilates ──
  console.log('\n--- DB DELETION ---');
  const { data: deletedAssets, error: delErr } = await supabaseAdmin
    .from('assets')
    .delete()
    .eq('brand_id', 'nordpilates')
    .select('id');

  if (delErr) {
    console.error(`FAILED: ${delErr.message}`);
    process.exit(1);
  }

  const deletedCount = deletedAssets?.length ?? 0;
  console.log(`Deleted ${deletedCount} nordpilates assets (cascade deletes segments)`);

  const postSegments = await countRows('asset_segments', 'nordpilates');
  console.log(`nordpilates segments remaining: ${postSegments} (expect 0 from cascade)`);

  if (postSegments > 0) {
    console.error('CASCADE DID NOT CLEAR SEGMENTS — STOPPING');
    process.exit(1);
  }

  // ── R2 deletion ──
  console.log('\n--- R2 DELETION ---');
  for (const p of r2Prefixes) {
    const keys = r2KeysByPrefix[p];
    const deleted = await deleteR2Keys(keys);
    console.log(`Deleted ${deleted} objects from ${p}`);
  }

  // ── Final verification ──
  console.log('\n--- FINAL VERIFICATION ---');
  const finalAssets = await countRows('assets', 'nordpilates');
  const finalSegments = await countRows('asset_segments', 'nordpilates');
  console.log(`nordpilates assets:   ${finalAssets} (expect 0)`);
  console.log(`nordpilates segments: ${finalSegments} (expect 0)`);

  let allZero = finalAssets === 0 && finalSegments === 0;

  for (const p of r2Prefixes) {
    const remaining = await listR2Keys(p);
    console.log(`R2 ${p} → ${remaining.length} (expect 0)`);
    if (remaining.length > 0) allZero = false;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${allZero ? 'CLEAN SLATE CONFIRMED' : 'SOME ITEMS REMAIN — CHECK ABOVE'}`);
  console.log('='.repeat(60));

  process.exit(allZero ? 0 : 1);
}

main().catch((err) => {
  console.error('Clean-slate failed:', err);
  process.exit(1);
});
