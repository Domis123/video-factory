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
import { supabaseAdmin } from './config/supabase.js';
import { computePipelineFlags } from './orchestrator/feature-flags.js';
import { runPipelineV2 } from './orchestrator/orchestrator-v2.js';
import type { Job as BullJob } from 'bullmq';

console.log(`\n🎬 Video Factory — Worker ${env.WORKER_ID}`);
console.log(`   Concurrency: ${env.WORKER_CONCURRENCY}`);
console.log(`   Temp dir: ${env.RENDER_TEMP_DIR}`);
console.log(`   Queues: ${Object.values(QUEUE_NAMES).join(', ')}\n`);

// ── Planning Worker ──
// Triggered when n8n moves a job to `planning` status.
//
// W8 (2026-04-24): after Phase 3.5 planning completes, this worker
// consults the 3-tier feature flag composition and fire-and-forgets a
// Part B shadow pipeline dispatch alongside. Phase 3.5 is the source of
// truth during shadow; Part B errors MUST NOT propagate back into the
// BullMQ job's lifecycle. The `.catch(...)` guards against this even
// though `runPipelineV2` is itself designed to never throw on normal
// failure paths (agent errors → terminal FAILED, not thrown).
const planningWorker = createWorker(
  QUEUE_NAMES.planning,
  async (job: BullJob<{ jobId: string }>) => {
    const { jobId } = job.data;
    console.log(`[worker:planning] Processing job ${jobId}`);
    await runPlanning(jobId);
    dispatchPartBIfEnabled(jobId);
  },
  { concurrency: 1 }, // One planning job at a time (API rate limits)
);

/**
 * Non-blocking helper. Resolves the brand_id for the completed job, computes
 * 3-tier pipeline flags, and fire-and-forgets `runPipelineV2` when flags
 * route Part B on. All failures (brand lookup error, flag decide error,
 * runPipelineV2 rejection) log and return — none propagate.
 */
function dispatchPartBIfEnabled(jobId: string): void {
  (async () => {
    const { data: jobRow, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('brand_id')
      .eq('id', jobId)
      .single();
    if (jobErr || !jobRow) {
      console.warn(
        `[w8] Part B dispatch skipped — job ${jobId} lookup failed: ${jobErr?.message ?? 'not found'}`,
      );
      return;
    }
    const brandId = (jobRow as { brand_id: string }).brand_id;

    const flags = await computePipelineFlags(brandId, jobId);
    if (!flags.runPartB) {
      console.log(`[w8] Part B not routed for job ${jobId} — ${flags.reason}`);
      return;
    }

    console.log(`[w8] Dispatching Part B shadow for job ${jobId} — ${flags.reason}`);
    runPipelineV2(jobId)
      .then((summary) => {
        console.log(
          `[w8] Part B shadow complete for job ${jobId} — terminal=${summary.terminalState} runId=${summary.runId ?? 'none'} walltime=${summary.walltime_ms}ms`,
        );
      })
      .catch((err) => {
        console.error(`[w8] Part B shadow threw for job ${jobId}:`, err);
      });
  })().catch((err) => {
    console.error(`[w8] Part B dispatch wrapper threw for job ${jobId}:`, err);
  });
}

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

// ── Simple Pipeline Worker ──
// Triggered by n8n S1 routing Pipeline=simple jobs to /enqueue with
// {queue: 'simple_pipeline', jobId, format, clipsMode}. End-to-end: agent
// → overlay → music → ffmpeg render → human_qa.
const simplePipelineWorker = createWorker(
  QUEUE_NAMES.simple_pipeline,
  async (job: BullJob<{ jobId: string; format: 'routine' | 'meme'; clipsMode: 'fixed_1' | 'agent_picks' }>) => {
    const { runSimplePipelineWorker } = await import('./workers/simple-pipeline.js');
    console.log(`[worker:simple_pipeline] Processing ${job.data.jobId} format=${job.data.format}`);
    await runSimplePipelineWorker(job.data);
  },
  { concurrency: 1 }, // Serial — one ffmpeg pipeline at a time on the VPS
);

simplePipelineWorker.on('completed', (job) => {
  console.log(`[worker:simple_pipeline] Completed: ${job.data.jobId}`);
});

simplePipelineWorker.on('failed', (job, err) => {
  console.error(`[worker:simple_pipeline] Failed: ${job?.data.jobId}`, err.message);
});

console.log('✅ All workers started. Waiting for jobs...\n');

// ── HTTP API (for n8n to enqueue jobs) ──
const API_PORT = env.API_PORT;

// Concurrency guard: 4K UGC clips can be 160MB+ and OOM the 4GB VPS if processed
// in parallel. Reject overlapping ingestion requests with 503.
let ugcIngesting = false;

// S8 multi-brand chore (c6): cache of known brand_ids from brand_configs.
// Populated lazily on first /ugc-ingest filename-fallback path; refreshed
// after TTL or on cache-miss. Header-path requests (S8 normal flow) are
// permissive per "lazy population" decision and don't consult this cache.
let knownBrandIdsCache: Set<string> | null = null;
let knownBrandIdsLoadedAt = 0;
const BRAND_IDS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getKnownBrandIds(forceRefresh = false): Promise<Set<string> | null> {
  const stale = !knownBrandIdsCache || Date.now() - knownBrandIdsLoadedAt > BRAND_IDS_CACHE_TTL_MS;
  if (stale || forceRefresh) {
    const { data, error } = await supabaseAdmin.from('brand_configs').select('brand_id');
    if (error) {
      console.warn(`[ugc-ingest] brand_configs cache load failed: ${error.message}`);
      return null;
    }
    knownBrandIdsCache = new Set((data ?? []).map((r) => r.brand_id as string));
    knownBrandIdsLoadedAt = Date.now();
  }
  return knownBrandIdsCache;
}

const server = createServer(async (req, res) => {
  // CORS + JSON headers
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/enqueue') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const { queue, jobId, ...extra } = parsed;

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

      // Pass through any extra fields from the request body into the BullMQ job
      // data. Used by simple_pipeline (format, clipsMode) and any future queue
      // that needs structured payload beyond just jobId. Backward-compatible:
      // existing callers that send only {queue, jobId} still work as before.
      const q = createQueue(queue);
      const job = await q.add(`n8n-${queue}`, { jobId, ...extra });
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

  // ── UGC Ingest: n8n S8 sends video binary, VPS does ffprobe → Gemini → R2 → Supabase ──
  if (req.method === 'POST' && req.url === '/ugc-ingest') {
    if (ugcIngesting) {
      console.warn('[ugc-ingest] Rejected: ingestion already in progress');
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'ingestion busy, retry later' }));
      req.destroy();
      return;
    }

    // Safety net: reject oversized uploads before touching disk or the single-flight lock.
    // 2GB cap — streaming keeps RAM ~64KB regardless of file size.
    const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      console.warn(`[ugc-ingest] Rejected: content-length ${contentLength} exceeds ${MAX_UPLOAD_BYTES}`);
      res.writeHead(413);
      res.end(JSON.stringify({ error: `file too large: ${contentLength} bytes (max ${MAX_UPLOAD_BYTES})` }));
      req.destroy();
      return;
    }

    ugcIngesting = true;
    const tmpDir = '/tmp/ugc-ingest';
    let tmpPath = '';
    try {
      const { ingestAsset } = await import('./workers/ingestion.js');
      const { supabaseAdmin } = await import('./config/supabase.js');
      const { mkdir, stat } = await import('node:fs/promises');
      const { createWriteStream } = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      const { randomUUID } = await import('node:crypto');
      const { extname } = await import('node:path');

      // Parse meta from headers FIRST — no body read yet, so duplicates and bad-brand
      // requests abort the upload without buffering or spooling to disk.
      const rawMeta = req.headers['x-asset-meta'] as string || '{}';
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        meta = JSON.parse(Buffer.from(rawMeta, 'base64').toString('utf-8'));
      }

      // Parse filename and brand_id from header or filename convention
      const filename = String(meta.filename || `clip-${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
      let brandId = String(meta.brand_id || '');
      const fromFilenameFallback = brandId === '';
      let description = String(meta.description || '');

      // Fallback: parse brand_id from filename ({brand_id}_{description}.ext)
      if (!brandId) {
        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
        const underscoreIdx = nameWithoutExt.indexOf('_');
        if (underscoreIdx > 0) {
          brandId = nameWithoutExt.slice(0, underscoreIdx).toLowerCase();
          description = description || nameWithoutExt.slice(underscoreIdx + 1);
        }
      }

      if (!brandId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing brand_id in header and filename' }));
        req.destroy();
        return;
      }

      // S8 multi-brand chore (c6): validate filename-fallback brand_id against
      // brand_configs. Header-path requests stay permissive (S8 sends a routed
      // brand_id; lazy-population means brand_configs may not have a row yet).
      // Fail-open if the cache itself can't be loaded — matches the rest of
      // the endpoint's posture on Supabase errors.
      if (fromFilenameFallback) {
        let known = await getKnownBrandIds();
        if (known && !known.has(brandId)) {
          known = await getKnownBrandIds(true);
          if (known && !known.has(brandId)) {
            res.writeHead(400);
            res.end(JSON.stringify({
              error: `Unknown brand_id '${brandId}' parsed from filename prefix; not in brand_configs`,
            }));
            req.destroy();
            return;
          }
        }
      }

      // Idempotency check BEFORE reading body — duplicates never touch disk
      const { data: existing } = await supabaseAdmin
        .from('assets')
        .select('id, r2_key, brand_id, duration_seconds')
        .eq('filename', filename)
        .eq('brand_id', brandId)
        .limit(1)
        .single();

      if (existing) {
        console.log(`[ugc-ingest] Duplicate detected: ${filename} for ${brandId}, returning existing asset ${existing.id}`);
        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          duplicate: true,
          asset_id: existing.id,
          r2_key: existing.r2_key,
          brand_id: existing.brand_id,
          duration_seconds: existing.duration_seconds,
        }));
        req.destroy();
        return;
      }

      // Stream request body directly to a temp file. Node never holds more than
      // its default highWaterMark (~64KB) in RAM regardless of upload size.
      // This is the fix for the 1GB OOM — the previous readRawBody helper did
      // Buffer.concat(chunks) which buffered the entire upload in JS heap.
      await mkdir(tmpDir, { recursive: true });
      const ext = extname(filename) || '.mp4';
      tmpPath = `${tmpDir}/${randomUUID()}${ext}`;
      await pipeline(req, createWriteStream(tmpPath));
      const fileStat = await stat(tmpPath);
      console.log(`[ugc-ingest] Streamed ${filename} (${(fileStat.size / 1024 / 1024).toFixed(1)} MB) for ${brandId}`);

      // Call existing ingestion pipeline
      const asset = await ingestAsset({
        filePath: tmpPath,
        brandId,
        filename,
        driveFileId: String(meta.drive_file_id || ''),
      });

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        asset_id: asset.id,
        r2_key: asset.r2_key,
        brand_id: asset.brand_id,
        duration_seconds: asset.duration_seconds,
      }));
    } catch (err) {
      console.error('[ugc-ingest] Error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    } finally {
      if (tmpPath) {
        const { unlink } = await import('node:fs/promises');
        await unlink(tmpPath).catch(() => {});
      }
      ugcIngesting = false;
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', worker: env.WORKER_ID }));
    return;
  }

  // ── Simple Pipeline readiness check (Q4) ──
  // Always returns HTTP 200. Body: {ok: true} or {ok: false, reason}.
  // n8n S1 calls this before routing Pipeline=simple jobs.
  if (
    req.method === 'POST' &&
    req.url &&
    req.url.startsWith('/simple-pipeline/check-readiness')
  ) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const brandId = url.searchParams.get('brand_id');
      if (!brandId) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, reason: 'missing_brand_id_query_param' }));
        return;
      }
      const { checkSimplePipelineReadiness } = await import(
        './orchestrator/simple-pipeline/readiness.js'
      );
      const result = await checkSimplePipelineReadiness(brandId);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      // Per Q4: always 200. Surface the error as a reason token rather than HTTP 500.
      console.error('[api] readiness error:', err);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: false, reason: `readiness_error_${(err as Error).message.slice(0, 40)}` }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found. POST /enqueue, POST /simple-pipeline/check-readiness?brand_id=X, or GET /health' }));
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
  console.log(
    `📡 API listening on port ${API_PORT} ` +
      `(POST /enqueue, POST /simple-pipeline/check-readiness, POST /music-ingest, POST /ugc-ingest, GET /health)\n`,
  );
});

// ── Graceful Shutdown ──
const workers = [planningWorker, renderingWorker, ingestionWorker, simplePipelineWorker];

async function shutdown(signal: string) {
  console.log(`\n⏹️  ${signal} received. Shutting down...`);

  server.close();
  await Promise.all(workers.map((w) => w.close()));

  console.log('Workers + API stopped. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
