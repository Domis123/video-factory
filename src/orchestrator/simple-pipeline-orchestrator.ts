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
import {
  runEditorStep,
  type EditorOutcomePayload,
  type ProposedDrop,
  type RefinedBounds,
} from './simple-pipeline/editor-step.js';

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
  /**
   * c5.5 per-job toggle. When true, the editor step is skipped on the
   * routine path (yields the same shape as meme bypass — editor_invoked=false,
   * empty refined map, zero cost/wall). Defaults to false.
   *
   * Used by the c6 Gate A baseline batch to render v1.1-shape outputs from
   * the same feat-branch deployment that produced the with-Editor batch.
   * Defensive post-merge — the toggle stays in production for ops use.
   */
  editorDisabled?: boolean;
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
      editor_disabled: input.editorDisabled === true,
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

    // 5. Editor agent (routine only). Single-call holistic batch (v1.3):
    //    one Gemini Pro multimodal call with N keyframe grids returns
    //    refinements for all N segments + a global_reasoning string.
    //    Meme path bypasses entirely (editor_invoked=false). All-or-nothing
    //    batch fallback per brief Q3: if the batch call fails (transient,
    //    Zod parse, completeness mismatch), every segment falls back to
    //    original boundaries together.
    //
    //    editorDisabled per-job toggle: yields meme-bypass shape.
    const editor = await runEditorStep({
      jobId: input.jobId,
      segmentIds: pick.segmentIds,
      ideaSeed,
      format: input.format,
      editorDisabled: input.editorDisabled === true,
      targetRenderDurationS: 30,
    });

    // 6. Apply drop guards (v1.3 §5b): floor projection + slot-count
    //    minimum. Editor's drop authority is real but bounded — drops
    //    that would push the projected sum below the 25s floor or the
    //    remaining segment count below 2 are rejected in priority order
    //    (lowest-confidence drop rejected first). The model's prompt
    //    teaches the same projection so well-behaved Editor calls
    //    won't cause rejections; this is a safety net not a feature.
    const dropDecision = applyDropGuards(
      pick.segmentIds,
      editor.proposedDrops,
      editor.refinedBoundsBySegmentId,
      DROP_GUARD_FLOOR_S,
      DROP_GUARD_MIN_SEGMENTS,
    );
    if (dropDecision.acceptedDrops.length > 0 || dropDecision.rejectedDrops.length > 0) {
      console.log(
        `[simple-pipeline] drop guard: proposed=${editor.proposedDrops.length} ` +
          `accepted=${dropDecision.acceptedDrops.length} rejected=${dropDecision.rejectedDrops.length} ` +
          `final_segments=${dropDecision.finalSegmentIds.length} ` +
          `projected_sum=${dropDecision.projectedSumS.toFixed(1)}s`,
      );
    }

    // Filter the refined-bounds map to the final (post-drops) segment set.
    // Render must NEVER see dropped segments — both in the segment_ids
    // list and in the bounds map.
    const finalSegmentIds = dropDecision.finalSegmentIds;
    const finalBoundsBySegmentId = new Map<string, RefinedBounds>();
    for (const id of finalSegmentIds) {
      const b = editor.refinedBoundsBySegmentId.get(id);
      if (b) finalBoundsBySegmentId.set(id, b);
    }

    // 7. Compute total duration AFTER drops for music-track length matching.
    const totalDurationS = computeProjectedSumS(finalSegmentIds, finalBoundsBySegmentId);
    console.log(
      `[simple-pipeline] post-Editor total duration: ${totalDurationS.toFixed(1)}s (${finalSegmentIds.length} segments)`,
    );

    // 7. Overlay + music in parallel (independent calls).
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

    // 8. Render (4-pass ffmpeg). Uses POST-DROPS segment list and bounds
    //    map. Render never sees dropped segments.
    const render = await renderSimplePipeline({
      jobId: input.jobId,
      brandId,
      format: input.format,
      segmentIds: finalSegmentIds,
      overlayText: overlay.text,
      musicR2Key: music.track.r2_key,
      refinedBoundsBySegmentId: finalBoundsBySegmentId,
    });
    workDir = render.workDir;

    // 9. Log to cooldown history. Use the FULL pick.segmentIds (not
    //    post-drops) so dropped segments enter cooldown along with rendered
    //    ones — the picker considered all of them and the operator-facing
    //    cooldown logic should reflect "what was just used by this brand"
    //    in the broadest sense, not the post-Editor sliver.
    await logRender({
      brandId,
      format: input.format,
      parentAssetId: pick.parentAssetId,
      segmentIds: pick.segmentIds,
      jobId: input.jobId,
    });

    // 10. Generate 24h presigned URL for the Sheet preview, update job row,
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

    const totalCostUsd = pick.costUsd + overlay.costUsd + editor.outcome.editor_cost_usd;

    // editor_outcome augmented with orchestrator-side drop-guard counts
    // (v1.3 §5b). The Editor reports drops PROPOSED; the orchestrator
    // is the authority on drops ACCEPTED vs REJECTED.
    const augmentedEditorOutcome: EditorOutcomePayload & {
      segments_dropped_accepted: number;
      segments_drops_rejected: number;
      drops_rejected_reason: string | null;
    } = {
      ...editor.outcome,
      segments_dropped_accepted: dropDecision.acceptedDrops.length,
      segments_drops_rejected: dropDecision.rejectedDrops.length,
      drops_rejected_reason: dropDecision.rejectedDrops.length > 0
        ? dropDecision.rejectionReason
        : null,
    };

    await transitionJob(input.jobId, 'simple_pipeline_rendering', 'human_qa', {
      r2_key: render.r2Key,
      duration_s: render.durationS,
      overlay_text: overlay.text,
      overlay_mode: input.overlayMode,
      music_track_id: music.track.id,
      parent_asset_id: pick.parentAssetId,
      // segment_ids reflects the FINAL (post-drops) set rendered. The
      // original pick is recoverable via job_events by joining on the
      // pre-Editor pick payload if needed for diagnostics.
      segment_ids: finalSegmentIds,
      original_pick_segment_ids: pick.segmentIds,
      slot_count: finalSegmentIds.length,
      original_slot_count: pick.segmentIds.length,
      fallback_triggered: fallbackTriggered,
      agent_cost_usd: pick.costUsd,
      overlay_cost_usd: overlay.costUsd,
      editor_cost_usd: editor.outcome.editor_cost_usd,
      editor_disabled: input.editorDisabled === true,
      total_cost_usd: totalCostUsd,
      wall_time_s: ((Date.now() - t0) / 1000).toFixed(1),
      editor_outcome: augmentedEditorOutcome,
    });
    console.log(
      `[simple-pipeline] DONE jobId=${input.jobId} duration=${render.durationS.toFixed(1)}s ` +
        `wall=${((Date.now() - t0) / 1000).toFixed(1)}s cost=$${totalCostUsd.toFixed(4)}`,
    );

    // 11. Cleanup workdir (R2 already uploaded; local files no longer needed)
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

// ─── Drop-guard constants + helpers (v1.3 §5b) ─────────────────────────────

/** Lower edge of the target band; drops that breach this are rejected. */
const DROP_GUARD_FLOOR_S = 25.0;
/** Minimum segment count after drops; matches min(2) Zod floor. */
const DROP_GUARD_MIN_SEGMENTS = 2;

interface DropDecision {
  /** Segment IDs surviving after drops applied. */
  finalSegmentIds: string[];
  /** Drops the orchestrator honored. */
  acceptedDrops: ProposedDrop[];
  /** Drops the orchestrator overrode (with reason). */
  rejectedDrops: ProposedDrop[];
  /** Why drops were rejected (null when none rejected). */
  rejectionReason: 'floor_breach' | 'slot_min' | 'mixed' | null;
  /** Sum of remaining segments' durations after drops. */
  projectedSumS: number;
}

/**
 * Apply drop guards in priority order: lowest-confidence drop rejected
 * first when guards fail. Returns the final segment list + accepted /
 * rejected drop arrays + reason + projected sum.
 *
 * Algorithm:
 *   1. Start with all proposed drops accepted.
 *   2. Compute remaining segment count + projected sum.
 *   3. If both guards pass, return.
 *   4. Otherwise, find the lowest-confidence drop currently accepted
 *      and reject it. Loop.
 *   5. Stops when all guards pass OR all drops have been rejected.
 *
 * If no drops were proposed, returns a no-op decision.
 */
export function applyDropGuards(
  pickedSegmentIds: string[],
  proposedDrops: ProposedDrop[],
  boundsBySegmentId: Map<string, RefinedBounds>,
  floorS: number,
  minSegments: number,
): DropDecision {
  if (proposedDrops.length === 0) {
    return {
      finalSegmentIds: [...pickedSegmentIds],
      acceptedDrops: [],
      rejectedDrops: [],
      rejectionReason: null,
      projectedSumS: computeProjectedSumS(pickedSegmentIds, boundsBySegmentId),
    };
  }

  const confidenceRank: Record<'low' | 'medium' | 'high', number> = {
    low: 0,
    medium: 1,
    high: 2,
  };

  // Stable sort by confidence ascending. We'll evict from the FRONT
  // (lowest-confidence) when guards fail.
  const dropsByConfidenceAsc = [...proposedDrops].sort(
    (a, b) => confidenceRank[a.confidence] - confidenceRank[b.confidence],
  );

  const acceptedSet = new Set(dropsByConfidenceAsc.map((d) => d.segmentId));
  const rejected: ProposedDrop[] = [];
  let rejectionReason: 'floor_breach' | 'slot_min' | 'mixed' | null = null;

  while (true) {
    const remainingIds = pickedSegmentIds.filter((id) => !acceptedSet.has(id));
    const slotMinOk = remainingIds.length >= minSegments;
    const projectedSum = computeProjectedSumS(remainingIds, boundsBySegmentId);
    const floorOk = projectedSum >= floorS;

    if (slotMinOk && floorOk) {
      const accepted = dropsByConfidenceAsc.filter((d) => acceptedSet.has(d.segmentId));
      return {
        finalSegmentIds: remainingIds,
        acceptedDrops: accepted,
        rejectedDrops: rejected,
        rejectionReason,
        projectedSumS: projectedSum,
      };
    }

    // Reject the lowest-confidence drop still accepted.
    const evict = dropsByConfidenceAsc.find((d) => acceptedSet.has(d.segmentId));
    if (!evict) {
      // No more drops to reject and guards still failing — return current
      // state. This is the degenerate case where even keeping all picks
      // doesn't satisfy the floor (M-O-M produced too-short pick); we
      // can't fix that here, render proceeds with full pick.
      const finalIds = pickedSegmentIds.filter((id) => !acceptedSet.has(id));
      return {
        finalSegmentIds: finalIds,
        acceptedDrops: dropsByConfidenceAsc.filter((d) => acceptedSet.has(d.segmentId)),
        rejectedDrops: rejected,
        rejectionReason,
        projectedSumS: projectedSum,
      };
    }
    acceptedSet.delete(evict.segmentId);
    rejected.push(evict);
    // Track which guard caused the rejection (cumulative).
    const causedByFloor = !floorOk;
    const causedBySlotMin = !slotMinOk;
    if (rejectionReason === null) {
      rejectionReason = causedByFloor && causedBySlotMin
        ? 'mixed'
        : causedByFloor
          ? 'floor_breach'
          : 'slot_min';
    } else if (
      (rejectionReason === 'floor_breach' && causedBySlotMin) ||
      (rejectionReason === 'slot_min' && causedByFloor)
    ) {
      rejectionReason = 'mixed';
    }
  }
}

/**
 * Sum durations across the given segment IDs, reading from the bounds map
 * (which contains either refined or original bounds depending on the
 * Editor's per-segment outcome).
 *
 * If a segment_id is missing from the bounds map (shouldn't happen in
 * normal flow but defensive), it contributes 0 — better than throwing
 * and aborting the render path.
 */
export function computeProjectedSumS(
  segmentIds: string[],
  boundsBySegmentId: Map<string, RefinedBounds>,
): number {
  let sum = 0;
  for (const id of segmentIds) {
    const b = boundsBySegmentId.get(id);
    if (b) sum += b.endS - b.startS;
  }
  return sum;
}
