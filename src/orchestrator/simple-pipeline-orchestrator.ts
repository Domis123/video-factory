/**
 * Simple Pipeline orchestrator — end-to-end flow for one job.
 *
 * Triggered by the BullMQ `simple_pipeline` worker after S1 routes a job
 * to it. Reads the agent input from the BullMQ payload (format,
 * clipsMode), runs Match-Or-Match → overlay generator → music selector
 * → render, logs render to the cooldown history, and transitions the
 * job into human_qa with a 24h presigned preview URL.
 *
 * Failure handling: any step that throws moves the job to
 * simple_pipeline_failed with the error message in job_events.details.
 *
 * File: src/orchestrator/simple-pipeline-orchestrator.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import { transitionJob } from '../lib/job-manager.js';
import { getPresignedUrl } from '../lib/r2-storage.js';

import { callMatchOrMatchAgent } from '../agents/match-or-match-agent.js';
import { generateRoutineOverlay } from './simple-pipeline/overlay-routine.js';
import { generateMemeOverlay } from './simple-pipeline/overlay-meme.js';
import { selectMusicForSimplePipeline } from './simple-pipeline/music-selector.js';
import {
  cleanupRenderWorkdir,
  renderSimplePipeline,
} from './simple-pipeline/render.js';
import {
  getRecentSegmentsUsed,
  logRender,
} from './simple-pipeline/segment-cooldown-tracker.js';
import { planRoutineExclusions } from './simple-pipeline/parent-picker.js';

export type SimplePipelineFormat = 'routine' | 'meme';
export type SimplePipelineClipsMode = 'fixed_1' | 'agent_picks';
/**
 * Overlay text source mode (Round 3, 2026-04-29):
 *   - 'generate' : call overlay-{routine,meme}.ts to produce overlay text
 *                  via Gemini (existing default for routine)
 *   - 'verbatim' : use jobs.idea_seed verbatim as the overlay text
 *                  (existing default for meme — meme idea seeds are
 *                  usually already in caption-shape; the generator
 *                  paraphrasing weakens them)
 */
export type SimplePipelineOverlayMode = 'generate' | 'verbatim';

export interface SimplePipelineInput {
  jobId: string;
  format: SimplePipelineFormat;
  clipsMode: SimplePipelineClipsMode;
  overlayMode: SimplePipelineOverlayMode;
}

export interface SimplePipelineResult {
  jobId: string;
  r2Key: string;
  previewUrl: string;
  durationS: number;
  totalCostUsd: number;
  fallbackTriggered: boolean;
}

const PREVIEW_URL_EXPIRES_S = 24 * 3600; // 24 hours

export async function runSimplePipeline(
  input: SimplePipelineInput,
): Promise<SimplePipelineResult> {
  console.log(
    `[simple-pipeline] start jobId=${input.jobId} format=${input.format} clipsMode=${input.clipsMode} overlayMode=${input.overlayMode}`,
  );
  const t0 = Date.now();
  let workDir: string | null = null;

  try {
    // 1. Claim the job (atomic transition pending → rendering)
    await transitionJob(input.jobId, 'simple_pipeline_pending', 'simple_pipeline_rendering', {
      format: input.format,
      clips_mode: input.clipsMode,
      overlay_mode: input.overlayMode,
    });

    // 2. Read job row
    const { data: jobRow, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('id, brand_id, idea_seed')
      .eq('id', input.jobId)
      .single();
    if (jobErr || !jobRow) {
      throw new Error(`runSimplePipeline: job ${input.jobId} not found: ${jobErr?.message ?? 'no row'}`);
    }
    if (!jobRow.idea_seed) {
      throw new Error(`runSimplePipeline: job ${input.jobId} has no idea_seed`);
    }
    const brandId = jobRow.brand_id as string;
    const ideaSeed = jobRow.idea_seed as string;

    // 3. Compute exclusions
    let excludedParents: string[] = [];
    let fallbackTriggered = false;
    if (input.format === 'routine') {
      const plan = await planRoutineExclusions(brandId);
      excludedParents = plan.excludedParents;
      fallbackTriggered = plan.fallbackTriggered;
      console.log(`[simple-pipeline] exclusions: ${plan.reason}`);
    }
    const excludedSegments = await getRecentSegmentsUsed(brandId, 2);
    console.log(
      `[simple-pipeline] excludedParents=${excludedParents.length} excludedSegments=${excludedSegments.length}`,
    );

    // 4. Match-Or-Match agent
    const pick = await callMatchOrMatchAgent({
      brandId,
      ideaSeed,
      format: input.format,
      excludedParents,
      excludedSegments,
    });
    console.log(
      `[simple-pipeline] agent picked parent=${pick.parentAssetId} segments=${pick.segmentIds.length} cost=$${pick.costUsd.toFixed(4)}`,
    );

    // 5. Fetch picked segment durations (sum for routine; single for meme)
    const totalDurationS = await fetchTotalDuration(pick.segmentIds);
    console.log(`[simple-pipeline] picked segments total duration: ${totalDurationS.toFixed(1)}s`);

    // 6. Overlay + music in parallel (independent calls).
    //    overlayMode='verbatim' skips the Gemini generator and uses the
    //    operator's idea_seed as the overlay text directly. Saves ~$0.005
    //    + ~5s wall, and (especially for meme) preserves the seed's
    //    register intact rather than paraphrasing it into something
    //    weaker. No word-count guard on verbatim — operator owns the
    //    text; if it's too long the render visually overflows in QA.
    const overlayPromise: Promise<{ text: string; costUsd: number }> =
      input.overlayMode === 'verbatim'
        ? Promise.resolve({ text: ideaSeed, costUsd: 0 })
        : input.format === 'routine'
          ? generateRoutineOverlay({ brandId, ideaSeed })
          : generateMemeOverlay({ brandId, ideaSeed });
    const [overlay, music] = await Promise.all([
      overlayPromise,
      selectMusicForSimplePipeline({
        brandId,
        format: input.format,
        minDurationS: totalDurationS,
      }),
    ]);
    if (!music) {
      throw new Error(`runSimplePipeline: music selector returned no track for brand=${brandId}`);
    }
    console.log(`[simple-pipeline] overlay="${overlay.text}" music="${music.track.title}"`);

    // 7. Render (4-pass ffmpeg)
    const render = await renderSimplePipeline({
      jobId: input.jobId,
      brandId,
      format: input.format,
      segmentIds: pick.segmentIds,
      overlayText: overlay.text,
      musicR2Key: music.track.r2_key,
    });
    workDir = render.workDir;

    // 8. Log to cooldown history
    await logRender({
      brandId,
      format: input.format,
      parentAssetId: pick.parentAssetId,
      segmentIds: pick.segmentIds,
      jobId: input.jobId,
    });

    // 9. Generate 24h presigned URL for the Sheet preview, update job row,
    //    and transition to human_qa.
    let previewUrl: string;
    try {
      previewUrl = await getPresignedUrl(render.r2Key, PREVIEW_URL_EXPIRES_S);
    } catch (err) {
      console.warn(`[simple-pipeline] failed to generate presigned URL: ${(err as Error).message}`);
      previewUrl = '';
    }

    await supabaseAdmin
      .from('jobs')
      .update({
        rendered_video_r2_key: render.r2Key,
        preview_url: previewUrl || null,
      })
      .eq('id', input.jobId);

    await transitionJob(input.jobId, 'simple_pipeline_rendering', 'human_qa', {
      r2_key: render.r2Key,
      duration_s: render.durationS,
      overlay_text: overlay.text,
      overlay_mode: input.overlayMode,
      music_track_id: music.track.id,
      parent_asset_id: pick.parentAssetId,
      segment_ids: pick.segmentIds,
      slot_count: pick.segmentIds.length,
      fallback_triggered: fallbackTriggered,
      agent_cost_usd: pick.costUsd,
      overlay_cost_usd: overlay.costUsd,
      total_cost_usd: pick.costUsd + overlay.costUsd,
      wall_time_s: ((Date.now() - t0) / 1000).toFixed(1),
    });

    const totalCostUsd = pick.costUsd + overlay.costUsd;
    console.log(
      `[simple-pipeline] DONE jobId=${input.jobId} duration=${render.durationS.toFixed(1)}s ` +
        `wall=${((Date.now() - t0) / 1000).toFixed(1)}s cost=$${totalCostUsd.toFixed(4)}`,
    );

    // 10. Cleanup workdir (R2 already uploaded; local files no longer needed)
    if (workDir) await cleanupRenderWorkdir(workDir);

    return {
      jobId: input.jobId,
      r2Key: render.r2Key,
      previewUrl,
      durationS: render.durationS,
      totalCostUsd,
      fallbackTriggered,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[simple-pipeline] FAIL jobId=${input.jobId}: ${message}`);

    // Attempt to move to simple_pipeline_failed; ignore secondary failures.
    try {
      // We don't know the current status precisely (could be either pending or rendering),
      // so we read it then transition explicitly.
      const { data: jobRow } = await supabaseAdmin
        .from('jobs')
        .select('status')
        .eq('id', input.jobId)
        .single();
      const fromStatus = jobRow?.status as string | undefined;
      if (fromStatus === 'simple_pipeline_pending' || fromStatus === 'simple_pipeline_rendering') {
        await transitionJob(
          input.jobId,
          fromStatus as 'simple_pipeline_pending' | 'simple_pipeline_rendering',
          'simple_pipeline_failed',
          { error: message },
        );
      }
    } catch (transitionErr) {
      console.error(
        `[simple-pipeline] secondary fail: could not move ${input.jobId} to failed: ${(transitionErr as Error).message}`,
      );
    }

    if (workDir) {
      await cleanupRenderWorkdir(workDir).catch(() => {});
    }
    throw err;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchTotalDuration(segmentIds: string[]): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('start_s, end_s')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`fetchTotalDuration: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('fetchTotalDuration: no segment rows returned');
  }
  return data.reduce((sum: number, row: any) => {
    return sum + (Number(row.end_s) - Number(row.start_s));
  }, 0);
}
