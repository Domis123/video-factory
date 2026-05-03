/**
 * Simple Pipeline worker — thin BullMQ wrapper over runSimplePipeline.
 *
 * BullMQ payload shape (from S1 via /enqueue → simple_pipeline queue):
 *   {
 *     jobId: string,
 *     format: 'routine' | 'meme',
 *     clipsMode: 'fixed_1' | 'agent_picks',
 *     overlayMode?: 'generate' | 'verbatim',
 *     editorDisabled?: boolean,
 *   }
 *
 * Validates payload shape, dispatches to the orchestrator, lets BullMQ
 * surface failures via the worker.on('failed', ...) handler in
 * src/index.ts.
 *
 * File: src/workers/simple-pipeline.ts
 */

import {
  runSimplePipeline,
  type SimplePipelineFormat,
  type SimplePipelineClipsMode,
  type SimplePipelineOverlayMode,
} from '../orchestrator/simple-pipeline-orchestrator.js';

export interface SimplePipelineJobData {
  jobId: string;
  format: SimplePipelineFormat;
  clipsMode: SimplePipelineClipsMode;
  /**
   * Round 3 (2026-04-29). Optional in payload for back-compat with any
   * BullMQ jobs queued before the S1 update reaches operator-side n8n.
   * Missing → defaulted by format: meme→verbatim, routine→generate.
   */
  overlayMode?: SimplePipelineOverlayMode;
  /**
   * c5.5 (2026-04-30). Optional per-job toggle. true → the editor step is
   * skipped on the routine path (same shape as meme bypass — used by the
   * c6 Gate A baseline batch). Default false; missing → false.
   */
  editorDisabled?: boolean;
}

function defaultOverlayMode(format: SimplePipelineFormat): SimplePipelineOverlayMode {
  return format === 'meme' ? 'verbatim' : 'generate';
}

export async function runSimplePipelineWorker(data: SimplePipelineJobData): Promise<void> {
  if (!data.jobId) throw new Error('simple-pipeline worker: missing jobId');
  if (data.format !== 'routine' && data.format !== 'meme') {
    throw new Error(`simple-pipeline worker: invalid format "${data.format}"`);
  }
  if (data.clipsMode !== 'fixed_1' && data.clipsMode !== 'agent_picks') {
    throw new Error(`simple-pipeline worker: invalid clipsMode "${data.clipsMode}"`);
  }
  if (data.format === 'meme' && data.clipsMode !== 'fixed_1') {
    throw new Error(
      `simple-pipeline worker: meme requires clipsMode=fixed_1 (S1 should reject; got ${data.clipsMode})`,
    );
  }
  if (data.format === 'routine' && data.clipsMode !== 'agent_picks') {
    throw new Error(
      `simple-pipeline worker: routine requires clipsMode=agent_picks (S1 should reject; got ${data.clipsMode})`,
    );
  }
  let overlayMode: SimplePipelineOverlayMode;
  if (data.overlayMode === undefined || data.overlayMode === null) {
    overlayMode = defaultOverlayMode(data.format);
    console.log(`[worker:simple_pipeline] overlayMode unset; defaulting to '${overlayMode}' for format=${data.format}`);
  } else if (data.overlayMode !== 'generate' && data.overlayMode !== 'verbatim') {
    throw new Error(
      `simple-pipeline worker: invalid overlayMode "${data.overlayMode}" (expected 'generate' or 'verbatim')`,
    );
  } else {
    overlayMode = data.overlayMode;
  }

  // editorDisabled defaults to false; only true|false are valid (anything
  // else is a malformed payload).
  let editorDisabled = false;
  if (data.editorDisabled !== undefined && data.editorDisabled !== null) {
    if (typeof data.editorDisabled !== 'boolean') {
      throw new Error(
        `simple-pipeline worker: invalid editorDisabled "${String(data.editorDisabled)}" (expected boolean)`,
      );
    }
    editorDisabled = data.editorDisabled;
  }
  if (editorDisabled) {
    console.log(`[worker:simple_pipeline] editorDisabled=true; routine path will skip Editor`);
  }

  await runSimplePipeline({
    jobId: data.jobId,
    format: data.format,
    clipsMode: data.clipsMode,
    overlayMode,
    editorDisabled,
  });
}
