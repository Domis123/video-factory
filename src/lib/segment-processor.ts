import { randomUUID } from 'node:crypto';
import { mkdir, unlink, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';
import { uploadFile } from './r2-storage.js';
import { extractKeyframe } from './keyframe-extractor.js';
import { embedImage } from './clip-embed.js';
import { exec } from './exec.js';
import type { SegmentAnalysis } from './gemini-segments.js';

const INGESTION_MODEL = process.env['GEMINI_INGESTION_MODEL'] || 'gemini-2.5-pro-preview-05-06';

/**
 * Process analyzed segments for an asset: extract keyframes, compute CLIP
 * embeddings, upload keyframes to R2, trim 720p clips, and insert asset_segments rows.
 *
 * Used by both the live /ugc-ingest handler and the backfill script.
 * Returns the number of segments successfully inserted.
 */
export async function processSegmentsForAsset(
  assetId: string,
  brandId: string,
  localVideoPath: string,
  segments: SegmentAnalysis[],
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const midpoint = (seg.start_s + seg.end_s) / 2;
    const segmentUuid = randomUUID();
    const keyframePath = `/tmp/video-factory/keyframes/${segmentUuid}.jpg`;
    await mkdir(dirname(keyframePath), { recursive: true });

    await extractKeyframe(localVideoPath, midpoint, keyframePath);
    const keyframeBuffer = await readFile(keyframePath);
    const embedding = await embedImage(keyframeBuffer);

    const keyframeR2Key = `keyframes/${brandId}/${segmentUuid}.jpg`;
    await uploadFile(keyframeR2Key, keyframeBuffer, 'image/jpeg');

    // Trim 720p clip for fast curator retrieval at runtime
    let clipR2Key: string | null = null;
    try {
      const clipPath = `/tmp/video-factory/clips/${segmentUuid}.mp4`;
      await mkdir(dirname(clipPath), { recursive: true });

      const duration = seg.end_s - seg.start_s;
      const trimResult = await exec({
        command: 'ffmpeg',
        args: [
          '-y', '-ss', String(seg.start_s), '-i', localVideoPath,
          '-t', String(duration),
          '-vf', 'scale=-2:720',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          '-c:a', 'aac', '-b:a', '96k',
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
          clipPath,
        ],
      });

      if (trimResult.exitCode !== 0) {
        console.warn(`[segment-processor] Clip trim failed for segment ${i} (exit ${trimResult.exitCode})`);
      } else {
        const clipStat = await stat(clipPath);
        clipR2Key = `segments/${brandId}/${segmentUuid}.mp4`;
        const clipBuffer = await readFile(clipPath);
        await uploadFile(clipR2Key, clipBuffer, 'video/mp4');
        console.log(`[segment-processor] Uploaded clip: ${clipR2Key} (${(clipStat.size / 1024 / 1024).toFixed(1)} MB)`);
      }

      await unlink(clipPath).catch(() => {});
    } catch (err) {
      console.warn(`[segment-processor] Clip trim/upload failed for segment ${i}: ${(err as Error).message}`);
      clipR2Key = null;
    }

    const { error } = await supabaseAdmin.from('asset_segments').insert({
      id: segmentUuid,
      parent_asset_id: assetId,
      brand_id: brandId,
      segment_index: i,
      start_s: seg.start_s,
      end_s: seg.end_s,
      segment_type: seg.segment_type,
      description: seg.description,
      visual_tags: seg.visual_tags,
      best_used_as: seg.best_used_as,
      motion_intensity: seg.motion_intensity,
      recommended_duration_s: seg.recommended_duration_s,
      has_speech: seg.has_speech,
      quality_score: seg.quality_score,
      keyframe_r2_key: keyframeR2Key,
      clip_r2_key: clipR2Key,
      embedding: `[${embedding.join(',')}]`,
      ingestion_model: INGESTION_MODEL,
    });

    if (error) {
      console.warn(`[segment-processor] Failed to insert segment ${i} for asset ${assetId}: ${error.message}`);
    } else {
      inserted++;
    }

    await unlink(keyframePath).catch(() => {});
  }

  return inserted;
}
