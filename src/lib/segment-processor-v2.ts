import { randomUUID } from 'node:crypto';
import { mkdir, unlink, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';
import { uploadFile } from './r2-storage.js';
import { extractKeyframe } from './keyframe-extractor.js';
import { embedImage } from './clip-embed.js';
import { exec } from './exec.js';
import { projectV2ToV1Columns } from './segment-v2-projection.js';
import type { SegmentV2 } from '../agents/segment-analyzer-v2-schema.js';

const INGESTION_MODEL = process.env['GEMINI_INGESTION_MODEL'] || 'gemini-3.1-pro-preview';

/**
 * Dual-write v2: v1 scalar columns (via projectV2ToV1Columns) + segment_v2 JSONB,
 * plus cut new 720p clip, extract new keyframe, embed CLIP.
 *
 * Used by the ingestion worker when ENABLE_SEGMENT_V2=true and by the backfill
 * script. Returns number of rows inserted.
 */
export async function processSegmentsV2ForAsset(
  parentAssetId: string,
  brandId: string,
  localVideoPath: string,
  segments: SegmentV2[],
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const v1 = projectV2ToV1Columns(seg);
    const midpoint = (seg.start_s + seg.end_s) / 2;
    const segmentUuid = randomUUID();
    const keyframePath = `/tmp/video-factory/keyframes/${segmentUuid}.jpg`;
    await mkdir(dirname(keyframePath), { recursive: true });

    await extractKeyframe(localVideoPath, midpoint, keyframePath);
    const keyframeBuffer = await readFile(keyframePath);
    const embedding = await embedImage(keyframeBuffer);

    const keyframeR2Key = `keyframes/${brandId}/${segmentUuid}.jpg`;
    await uploadFile(keyframeR2Key, keyframeBuffer, 'image/jpeg');

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
        console.warn(`[segment-processor-v2] Clip trim failed for segment ${i} (exit ${trimResult.exitCode})`);
      } else {
        const clipStat = await stat(clipPath);
        clipR2Key = `segments/${brandId}/${segmentUuid}.mp4`;
        const clipBuffer = await readFile(clipPath);
        await uploadFile(clipR2Key, clipBuffer, 'video/mp4');
        console.log(`[segment-processor-v2] Uploaded clip: ${clipR2Key} (${(clipStat.size / 1024 / 1024).toFixed(1)} MB)`);
      }

      await unlink(clipPath).catch(() => {});
    } catch (err) {
      console.warn(`[segment-processor-v2] Clip trim/upload failed for segment ${i}: ${(err as Error).message}`);
      clipR2Key = null;
    }

    const { error } = await supabaseAdmin.from('asset_segments').insert({
      id: segmentUuid,
      parent_asset_id: parentAssetId,
      brand_id: brandId,
      segment_index: i,
      start_s: v1.start_s,
      end_s: v1.end_s,
      segment_type: v1.segment_type,
      description: v1.description,
      visual_tags: v1.visual_tags,
      best_used_as: v1.best_used_as,
      motion_intensity: v1.motion_intensity,
      recommended_duration_s: v1.recommended_duration_s,
      has_speech: v1.has_speech,
      quality_score: v1.quality_score,
      keyframe_r2_key: keyframeR2Key,
      clip_r2_key: clipR2Key,
      embedding: `[${embedding.join(',')}]`,
      ingestion_model: INGESTION_MODEL,
      segment_v2: seg,
    });

    if (error) {
      console.warn(`[segment-processor-v2] Failed to insert segment ${i} for parent ${parentAssetId}: ${error.message}`);
    } else {
      inserted++;
    }

    await unlink(keyframePath).catch(() => {});
  }

  return inserted;
}
