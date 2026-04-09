/**
 * Video Factory — Worker Server
 *
 * Starts BullMQ workers for all queues, an HTTP API for n8n to enqueue jobs,
 * and handles graceful shutdown.
 * Run with: npm start
 */

import { createServer } from 'node:http';
import { env } from './config/env.js';
import { createWorker, createQueue, QUEUE_NAMES } from './config/redis.js';
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

// ── HTTP API (for n8n to enqueue jobs) ──
const API_PORT = env.API_PORT;

const server = createServer(async (req, res) => {
  // CORS + JSON headers
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/enqueue') {
    try {
      const body = await readBody(req);
      const { queue, jobId } = JSON.parse(body);

      if (!queue || !jobId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing queue or jobId' }));
        return;
      }

      const validQueues = Object.values(QUEUE_NAMES);
      if (!validQueues.includes(queue)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `Invalid queue. Valid: ${validQueues.join(', ')}` }));
        return;
      }

      const q = createQueue(queue);
      const job = await q.add(`n8n-${queue}`, { jobId });
      await q.close();

      console.log(`[api] Enqueued ${jobId} → ${queue} (bull job ${job.id})`);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, bullJobId: job.id }));
    } catch (err) {
      console.error('[api] Enqueue error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Music Ingest: n8n sends file binary, VPS does ffprobe → R2 → Supabase ──
  if (req.method === 'POST' && req.url === '/music-ingest') {
    try {
      const { ingestMusicTrack } = await import('./workers/music-ingest.js');
      const body = await readRawBody(req);
      const rawMeta = req.headers['x-track-meta'] as string || '{}';
      // Support both plain JSON and base64-encoded JSON (base64 avoids invalid header chars)
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        meta = JSON.parse(Buffer.from(rawMeta, 'base64').toString('utf-8'));
      }
      const filename = String(meta.filename || `track-${Date.now()}.mp3`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const result = await ingestMusicTrack(body, filename, meta);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[api] Music ingest error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', worker: env.WORKER_ID }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found. POST /enqueue or GET /health' }));
});

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function readRawBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

server.listen(API_PORT, () => {
  console.log(`📡 API listening on port ${API_PORT} (POST /enqueue, GET /health)\n`);
});

// ── Graceful Shutdown ──
const workers = [planningWorker, renderingWorker, ingestionWorker];

async function shutdown(signal: string) {
  console.log(`\n⏹️  ${signal} received. Shutting down...`);

  server.close();
  await Promise.all(workers.map((w) => w.close()));

  console.log('Workers + API stopped. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
