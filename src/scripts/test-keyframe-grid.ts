/**
 * Gate A smoke runner for buildKeyframeGrid().
 *
 * Targets a known v2 exercise segment by default. The brief suggested
 * f9788090-f755-4bf1-afd1-6272df9fe225 but that row did not survive W0d's
 * destroy-and-rebuild; the default below is picked from the current v2 library
 * (720 segments as of 2026-04-21). Pass a different UUID as argv[2] to test
 * another.
 *
 * Produces a single JPEG locally, does NOT upload to R2, does NOT write to DB.
 * Reports dimensions, file size, and the EXIF ImageDescription payload round-trip.
 *
 *   npx tsx src/scripts/test-keyframe-grid.ts [segment_id]
 */

import { downloadToFile } from '../lib/r2-storage.js';
import { buildKeyframeGrid, readKeyframeGridExif, KEYFRAME_GRID_GEOMETRY } from '../lib/keyframe-grid.js';
import { supabaseAdmin } from '../config/supabase.js';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SEGMENT_ID = '93558eea-a80c-4e2a-89ad-f844b7a1581e';

async function main() {
  const segmentId = process.argv[2] ?? DEFAULT_SEGMENT_ID;
  console.log(`[test-keyframe-grid] segment_id=${segmentId}`);
  console.log(
    `[test-keyframe-grid] target geometry: ${KEYFRAME_GRID_GEOMETRY.cols}x${KEYFRAME_GRID_GEOMETRY.rows} @ ${KEYFRAME_GRID_GEOMETRY.gridW}x${KEYFRAME_GRID_GEOMETRY.gridH}`,
  );

  // 1. Fetch segment + parent in one round trip
  const { data: seg, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, brand_id, start_s, end_s, segment_v2')
    .eq('id', segmentId)
    .single();

  if (error || !seg) {
    console.error(`[test-keyframe-grid] segment lookup failed:`, error?.message ?? 'not found');
    process.exit(1);
  }

  const editorial = (seg.segment_v2 as { editorial?: Record<string, unknown> } | null)?.editorial;
  const bestInRaw = editorial?.best_in_point_s;
  const bestOutRaw = editorial?.best_out_point_s;
  const bestIn = typeof bestInRaw === 'number' ? bestInRaw : Number(seg.start_s);
  const bestOut = typeof bestOutRaw === 'number' ? bestOutRaw : Number(seg.end_s);

  console.log(
    `[test-keyframe-grid] segment bounds: start=${seg.start_s}s end=${seg.end_s}s  |  editorial window: [${bestIn}, ${bestOut}]`,
  );

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id, r2_key, pre_normalized_r2_key, filename')
    .eq('id', seg.parent_asset_id)
    .single();

  if (parentErr || !parent) {
    console.error(`[test-keyframe-grid] parent lookup failed:`, parentErr?.message ?? 'not found');
    process.exit(1);
  }

  const parentR2Key = parent.pre_normalized_r2_key || parent.r2_key;
  if (!parentR2Key) {
    console.error(`[test-keyframe-grid] parent ${parent.id} has neither pre_normalized_r2_key nor r2_key`);
    process.exit(1);
  }
  console.log(`[test-keyframe-grid] parent r2_key=${parentR2Key} (${parent.pre_normalized_r2_key ? 'pre-normalized' : 'raw'})`);

  // 2. Download parent to a per-run tmp file
  const parentLocalPath = join(tmpdir(), `test-kfgrid-parent-${seg.parent_asset_id}.mp4`);
  console.log(`[test-keyframe-grid] downloading parent → ${parentLocalPath}`);
  const t0 = Date.now();
  await downloadToFile(parentR2Key, parentLocalPath);
  console.log(`[test-keyframe-grid] downloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 3. Build grid
  console.log(`[test-keyframe-grid] building grid...`);
  const t1 = Date.now();
  const result = await buildKeyframeGrid({
    parentLocalPath,
    windowStartS: bestIn,
    windowEndS: bestOut,
    segmentId: seg.id,
    startS: Number(seg.start_s),
    endS: Number(seg.end_s),
  });
  const buildMs = Date.now() - t1;
  console.log(`[test-keyframe-grid] built in ${(buildMs / 1000).toFixed(2)}s`);

  // 4. Write local artifact for visual inspection
  const outPath = join(tmpdir(), `test-kfgrid-${segmentId}.jpg`);
  await writeFile(outPath, result.buffer);
  console.log(`[test-keyframe-grid] wrote ${outPath}`);

  // 5. Report
  console.log('');
  console.log('═══ RESULT ═══');
  console.log(`  file_path:           ${outPath}`);
  console.log(`  dimensions:          ${result.widthPx}x${result.heightPx}`);
  console.log(`  file_size_bytes:     ${result.buffer.length}`);
  console.log(`  file_size_kb:        ${(result.buffer.length / 1024).toFixed(1)}`);
  console.log(`  missing_tiles:       ${result.missingTileIndices.length === 0 ? 'none' : result.missingTileIndices.join(',')}`);
  console.log(`  window_used:         [${result.windowUsed.startS}, ${result.windowUsed.endS}]${result.windowUsed.fellBackToSegmentBounds ? ' (FELL BACK)' : ''}`);
  console.log(`  warnings:            ${result.warnings.length === 0 ? 'none' : ''}`);
  for (const w of result.warnings) console.log(`    - ${w}`);

  // 6. EXIF round-trip
  console.log('');
  console.log('═══ EXIF READBACK ═══');
  const exifPayload = await readKeyframeGridExif(result.buffer);
  if (!exifPayload) {
    console.error('  ❌ EXIF ImageDescription not found or not parseable');
    process.exit(1);
  }
  for (const [k, v] of Object.entries(exifPayload)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  if (exifPayload.segment_id !== segmentId) {
    console.error(`  ❌ EXIF segment_id mismatch: expected ${segmentId}, got ${exifPayload.segment_id}`);
    process.exit(1);
  }
  console.log('  ✅ EXIF round-trip OK');

  // 7. Cleanup parent
  await rm(parentLocalPath, { force: true }).catch(() => {});
  console.log('');
  console.log(`[test-keyframe-grid] DONE. View with: open ${outPath}`);
}

main().catch((err) => {
  console.error('[test-keyframe-grid] UNHANDLED ERROR:', err);
  process.exit(1);
});
