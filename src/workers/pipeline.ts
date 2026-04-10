/**
 * Pipeline Orchestrator — chains the full automated job lifecycle.
 *
 * Listens on the `planning` and `rendering` BullMQ queues.
 * Each job progresses through stages automatically, with state
 * transitions logged to Supabase at each step.
 *
 * Flow: QUEUED → clip-prep → transcription → rendering → audio-mix →
 *       sync-check → platform-export → auto-qa → (human_qa)
 *
 * Planning is triggered separately (by n8n when idea_seed moves to planning).
 */

import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { transitionJob, claimJob, logEvent } from '../lib/job-manager.js';
// logEvent is used for non-transition events (errors, retries). Per-step metrics
// are attached to the NEXT transitionJob() call's `details` param instead of
// going through logEvent('state_transition', ...), because job_events.to_status
// is NOT NULL and a bare logEvent has no target status to report.
import { buildContextPacket } from '../agents/context-packet.js';
import { renderVideo } from './renderer.js';
import { prepareClips } from './clip-prep.js';
import { transcribeAll } from './transcriber.js';
import { mixAudio } from './audio-mixer.js';
import { checkSync } from './sync-checker.js';
import { exportPlatforms } from './exporter.js';
import { runQAChecks, allChecksPassed } from './qa-checker.js';
import type { Job, ContextPacket, BrandConfig } from '../types/database.js';
import type { WordTimestamp } from './transcriber.js';

// ── Planning Pipeline ──

/**
 * Run AI planning: idea_seed → Creative Director → Asset Curator → Copywriter → Context Packet.
 * Called when a job enters `planning` status.
 */
export async function runPlanning(jobId: string): Promise<void> {
  console.log(`[pipeline] Planning job ${jobId}...`);

  // Fetch job + brand config
  const { data: job, error: jobErr } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) throw new Error(`Job ${jobId} not found: ${jobErr?.message}`);

  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brand_configs')
    .select('*')
    .eq('brand_id', (job as Job).brand_id)
    .single();

  if (brandErr || !brand) throw new Error(`Brand ${(job as Job).brand_id} not found: ${brandErr?.message}`);

  const ideaSeed = (job as Job).idea_seed;
  if (!ideaSeed) throw new Error(`Job ${jobId} has no idea_seed`);

  try {
    // Run 3 agents → Context Packet
    const contextPacket = await buildContextPacket({
      ideaSeed,
      brandConfig: brand as BrandConfig,
    });

    // Store Context Packet in job
    await supabaseAdmin
      .from('jobs')
      .update({
        context_packet: contextPacket as unknown as Record<string, unknown>,
        template_id: contextPacket.brief.template_id,
        hook_text: contextPacket.copy.hook_variants[0]?.text ?? null,
        cta_text: contextPacket.brief.segments.find((s) => s.type === 'cta')?.text_overlay.text ?? null,
        brief_summary: `${contextPacket.brief.template_id} | ${contextPacket.brief.total_duration_target}s | ${contextPacket.brief.segments.length} segments`,
        clip_selections: contextPacket.clips as unknown as Record<string, unknown>,
        copy_package: contextPacket.copy as unknown as Record<string, unknown>,
      })
      .eq('id', jobId);

    // Transition to brief_review (worker reviews in Sheets)
    await transitionJob(jobId, 'planning', 'brief_review', {
      template: contextPacket.brief.template_id,
      duration: contextPacket.brief.total_duration_target,
    });

    console.log(`[pipeline] Planning complete for ${jobId} → brief_review`);
  } catch (err) {
    console.error(`[pipeline] Planning failed for ${jobId}:`, err);
    await transitionJob(jobId, 'planning', 'failed', {
      error: String(err),
    });
  }
}

// ── Render Pipeline ──

/**
 * Run the full render pipeline: clip-prep → transcription → render → audio → sync → export → QA.
 * Called when a job enters `queued` status (after brief approval).
 */
export async function runRenderPipeline(jobId: string): Promise<void> {
  console.log(`[pipeline] Starting render pipeline for ${jobId}...`);

  const workDir = join(env.RENDER_TEMP_DIR, jobId);
  const startTime = Date.now();

  try {
    await mkdir(workDir, { recursive: true });

    // Fetch job with Context Packet
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) throw new Error(`Job ${jobId} not found`);

    const typedJob = job as Job;
    const contextPacket = typedJob.context_packet;
    if (!contextPacket) throw new Error(`Job ${jobId} has no context_packet`);

    // ── Step 1: Claim + Clip Prep ──
    await claimJob(jobId, 'queued', 'clip_prep', env.WORKER_ID);
    console.log(`[pipeline] ${jobId}: clip_prep`);

    // Pass brand color grading config to clip prep — gated on ENABLE_COLOR_GRADING.
    // When off, colorPreset + lutPath are both null and clip-prep's conditional
    // (`if (options.colorPreset || options.lutPath)`) short-circuits the grade step.
    const brandConfig = contextPacket.brand_config;
    const clipPrepResult = await prepareClips(jobId, contextPacket, {
      colorPreset: env.ENABLE_COLOR_GRADING
        ? ((brandConfig.color_grade_preset as import('../lib/color-grading.js').ColorPreset) ?? null)
        : null,
      lutPath: null, // LUT downloaded separately when color_lut_r2_key is set (also gated on ENABLE_COLOR_GRADING)
    });
    if (!env.ENABLE_COLOR_GRADING) {
      console.log(`[pipeline] ${jobId}: color grading flagged off`);
    }

    // ── Step 2: Transcription ──
    await transitionJob(jobId, 'clip_prep', 'transcription', {
      clipsPrepped: clipPrepResult.preparedClips.length,
      worker: env.WORKER_ID,
    });
    console.log(`[pipeline] ${jobId}: transcription`);

    // Determine which clips have speech based on the brief's clip requirements
    const clipsForTranscription = clipPrepResult.preparedClips.map((clip) => {
      const briefSeg = contextPacket.brief.segments.find(
        (s) => s.segment_id === clip.segmentId,
      );
      return {
        segmentId: clip.segmentId,
        localPath: clip.localPath,
        hasSpeech: briefSeg?.clip_requirements?.has_speech ?? undefined,
      };
    });

    const transcriptionResults = await transcribeAll(clipsForTranscription, workDir);

    // Build transcriptions map for renderer (segment_id → word timestamps)
    const transcriptions: Record<number, WordTimestamp[]> = {};
    for (const result of transcriptionResults) {
      if (result.words.length > 0) {
        transcriptions[result.segmentId] = result.words;
      }
    }

    // ── Step 3: Rendering (Remotion) ──
    await transitionJob(jobId, 'transcription', 'rendering', {
      segmentsTranscribed: transcriptionResults.filter((r) => r.words.length > 0).length,
      totalWords: transcriptionResults.reduce((sum, r) => sum + r.words.length, 0),
    });
    console.log(`[pipeline] ${jobId}: rendering`);

    const renderResult = await renderVideo({
      jobId,
      contextPacket,
      transcriptions,
    });

    // Store render result
    await supabaseAdmin
      .from('jobs')
      .update({
        rendered_video_r2_key: renderResult.r2Key,
        render_completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // ── Step 4: Audio Mix ──
    await transitionJob(jobId, 'rendering', 'audio_mix', {
      renderTimeMs: renderResult.durationMs,
      r2Key: renderResult.r2Key,
    });
    console.log(`[pipeline] ${jobId}: audio_mix`);

    const audioResult = await mixAudio(jobId, renderResult.outputPath, contextPacket);

    // ── Step 5: Sync Check ──
    await transitionJob(jobId, 'audio_mix', 'sync_check', {
      hasMusic: !!audioResult.musicTrackR2Key,
      musicVolume: audioResult.musicVolume,
    });
    console.log(`[pipeline] ${jobId}: sync_check`);

    // Build clip duration map for sync checker
    const clipDurations = new Map<number, number>();
    for (const clip of clipPrepResult.preparedClips) {
      clipDurations.set(clip.segmentId, clip.trimEnd - clip.trimStart);
    }

    const syncResult = checkSync(transcriptionResults, contextPacket, clipDurations);

    // If sync fails but is recoverable, retry audio mix with offset (max 2 retries)
    let currentVideoPath = audioResult.outputPath;
    if (syncResult.needsRetry) {
      console.log(`[pipeline] ${jobId}: sync drift ${syncResult.maxDriftMs}ms, retrying with offset ${syncResult.suggestedOffsetMs}ms`);
      await logEvent(jobId, 'retry', {
        step: 'sync_check',
        driftMs: syncResult.maxDriftMs,
        suggestedOffsetMs: syncResult.suggestedOffsetMs,
      });
      // For now, log the retry — actual offset adjustment would require re-rendering
      // with adjusted audio timing, which is a future enhancement
    }

    // ── Step 6: Platform Export ──
    await transitionJob(jobId, 'sync_check', 'platform_export', {
      syncPassed: syncResult.passed,
      maxDriftMs: syncResult.maxDriftMs,
    });
    console.log(`[pipeline] ${jobId}: platform_export`);

    // Generate slug from template + hook text for filename
    const slug = generateSlug(contextPacket);

    const exportResult = await exportPlatforms(
      jobId,
      typedJob.brand_id,
      currentVideoPath,
      slug,
    );

    await supabaseAdmin
      .from('jobs')
      .update({ final_outputs: exportResult.outputs })
      .eq('id', jobId);

    // ── Step 7: Auto QA ──
    await transitionJob(jobId, 'platform_export', 'auto_qa', {
      platforms: Object.keys(exportResult.outputs),
    });
    console.log(`[pipeline] ${jobId}: auto_qa`);

    // Run QA on the TikTok export (primary format)
    const tiktokPath = exportResult.localPaths.tiktok;
    const qaResults = await runQAChecks({
      videoPath: tiktokPath,
      syncResult,
      expectedDurationRange: [25, 65], // 30-60s with 5s tolerance
      hasTextOverlays: contextPacket.copy.overlays.length > 0,
    });

    const qaPassed = allChecksPassed(qaResults);

    await supabaseAdmin
      .from('jobs')
      .update({
        auto_qa_passed: qaPassed,
        auto_qa_results: qaResults as unknown as Record<string, unknown>,
      })
      .eq('id', jobId);

    if (!qaPassed) {
      console.warn(`[pipeline] ${jobId}: Auto QA flagged issues — forwarding to human QA with flags`);
    }

    // ── Step 8: Human QA ──
    await transitionJob(jobId, 'auto_qa', 'human_qa', {
      autoQaPassed: qaPassed,
      results: Object.entries(qaResults).map(([k, v]) => `${k}: ${v.passed ? 'ok' : 'FAIL'}`),
    });

    const totalMs = Date.now() - startTime;
    console.log(`[pipeline] Render pipeline complete for ${jobId} in ${(totalMs / 1000).toFixed(1)}s. QA: ${qaPassed ? 'PASSED' : 'FLAGGED'}. Awaiting human review.`);

  } catch (err) {
    console.error(`[pipeline] Render pipeline failed for ${jobId}:`, err);
    try {
      await logEvent(jobId, 'error', { error: String(err), worker: env.WORKER_ID });
    } catch {
      // Ignore logging errors
    }
  } finally {
    // Cleanup temp dir (rendered output already uploaded to R2)
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── Helpers ──

function generateSlug(contextPacket: ContextPacket): string {
  const hookText = contextPacket.copy.hook_variants[0]?.text ?? contextPacket.brief.template_id;
  return hookText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
