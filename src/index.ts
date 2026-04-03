/**
 * Video Factory — Worker Server
 *
 * Starts BullMQ workers for all queues and handles graceful shutdown.
 * Run with: npm start
 */

import { env } from './config/env.js';
import { createWorker, QUEUE_NAMES } from './config/redis.js';
import { runPlanning, runRenderPipeline } from './workers/pipeline.js';
import type { Job as BullJob } from 'bullmq';

console.log(`\n🎬 Video Factory — Worker ${env.WORKER_ID}`);
console.log(`   Concurrency: ${env.WORKER_CONCURRENCY}`);
console.log(`   Temp dir: ${env.RENDER_TEMP_DIR}`);
console.log(`   Queues: ${Object.values(QUEUE_NAMES).join(', ')}\n`);

// ── Planning Worker ──
// Triggered when n8n moves a job to `planning` status
const planningWorker = createWorker(
  QUEUE_NAMES.planning,
  async (job: BullJob<{ jobId: string }>) => {
    console.log(`[worker:planning] Processing job ${job.data.jobId}`);
    await runPlanning(job.data.jobId);
  },
  { concurrency: 1 }, // One planning job at a time (API rate limits)
);

planningWorker.on('completed', (job) => {
  console.log(`[worker:planning] Completed: ${job.data.jobId}`);
});

planningWorker.on('failed', (job, err) => {
  console.error(`[worker:planning] Failed: ${job?.data.jobId}`, err.message);
});

// ── Rendering Worker ──
// Triggered when a job is approved (brief_review → queued)
const renderingWorker = createWorker(
  QUEUE_NAMES.rendering,
  async (job: BullJob<{ jobId: string }>) => {
    console.log(`[worker:rendering] Processing job ${job.data.jobId}`);
    await runRenderPipeline(job.data.jobId);
  },
  { concurrency: env.WORKER_CONCURRENCY },
);

renderingWorker.on('completed', (job) => {
  console.log(`[worker:rendering] Completed: ${job.data.jobId}`);
});

renderingWorker.on('failed', (job, err) => {
  console.error(`[worker:rendering] Failed: ${job?.data.jobId}`, err.message);
});

// ── Ingestion Worker ──
// Triggered when n8n detects a new file in Google Drive
const ingestionWorker = createWorker(
  QUEUE_NAMES.ingestion,
  async (job: BullJob<{ filePath: string; brandId: string; filename?: string }>) => {
    // Dynamic import to avoid loading FFmpeg deps at startup
    const { ingestAsset } = await import('./workers/ingestion.js');
    console.log(`[worker:ingestion] Processing ${job.data.filename ?? job.data.filePath}`);
    await ingestAsset(job.data);
  },
);

ingestionWorker.on('completed', (job) => {
  console.log(`[worker:ingestion] Completed: ${job.data.filename ?? job.data.filePath}`);
});

ingestionWorker.on('failed', (job, err) => {
  console.error(`[worker:ingestion] Failed: ${job?.data.filename}`, err.message);
});

console.log('✅ All workers started. Waiting for jobs...\n');

// ── Graceful Shutdown ──
const workers = [planningWorker, renderingWorker, ingestionWorker];

async function shutdown(signal: string) {
  console.log(`\n⏹️  ${signal} received. Shutting down workers...`);

  await Promise.all(workers.map((w) => w.close()));

  console.log('Workers stopped. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
