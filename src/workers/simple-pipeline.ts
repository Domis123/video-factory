/**
 * Simple Pipeline worker — thin BullMQ wrapper over runSimplePipeline.
 *
 * BullMQ payload shape (from S1 via /enqueue → simple_pipeline queue):
 *   {
 *     jobId: string,
 *     format: 'routine' | 'meme',
 *     clipsMode: 'fixed_1' | 'agent_picks',
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
} from '../orchestrator/simple-pipeline-orchestrator.js';

export interface SimplePipelineJobData {
  jobId: string;
  format: SimplePipelineFormat;
  clipsMode: SimplePipelineClipsMode;
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

  await runSimplePipeline({
    jobId: data.jobId,
    format: data.format,
    clipsMode: data.clipsMode,
  });
}
