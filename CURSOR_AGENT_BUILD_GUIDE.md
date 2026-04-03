# VIDEO FACTORY — Cursor Agent Build Guide

## What is this project?

A 95% automated video production pipeline for 30 social media brands. It takes raw UGC footage from Google Drive, uses AI agents to plan creative briefs, and renders branded short-form videos (30-60s) for TikTok, Instagram Reels, and YouTube Shorts. Target: 150 videos/week across 30 brands.

## What's already done

### Infrastructure (all live and ready):
- **Supabase Postgres** — `https://kfdfcoretoaukcoasfmu.supabase.co` — Schema deployed with 5 tables: `brand_configs`, `assets`, `jobs`, `job_events`, `music_tracks`. 5 pilot brands seeded (nordpilates, ketoway, carnimeat, nodiet, highdiet). Has helper views: `v_active_jobs`, `v_stale_jobs`, `v_brand_stats`. RLS enabled with service_role bypass. Auto-updating `updated_at` trigger on jobs table. Job status uses a Postgres ENUM type `job_status`.
- **Upstash Redis** — `decent-collie-72298.upstash.io:6379` — Serverless, BullMQ-compatible, TLS enabled. Regional (eu-central-1).
- **Cloudflare R2** — Bucket `video-factory` on account `c9a225a2af25661d5ef85c9bc76a9ec5`. S3-compatible API. Zero egress fees. Folder structure not yet created.
- **n8n** — Self-hosted on Hetzner, already running. Used for all orchestration workflows. SSH access available.
- **Architecture doc** — Full v2 architecture is in `VIDEO_PIPELINE_ARCHITECTURE_v2.md` (attached separately).
- **Environment file** — `.env.video-factory` has all credentials for Supabase, Redis, R2.

### What does NOT exist yet:
- No VPS render workers provisioned
- No code written (workers, agents, templates, workflows)
- No R2 folder structure created
- No n8n workflows built
- No Remotion templates
- No Google Sheets worker interface

## Tech stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Orchestrator | n8n (self-hosted, Hetzner) | Triggers workflows, routes events |
| Database | Supabase Postgres (free tier) | All state: assets, jobs, brands, events |
| Job queue | BullMQ + Upstash Redis | Render job distribution, retries, priority |
| Render workers | Hetzner CX41 VPS (start with 1) | FFmpeg + Remotion + whisper.cpp |
| Working storage | Cloudflare R2 | Clips, rendered videos, brand assets |
| UGC source | Google Drive | Drop zone only — read once during ingestion, never again |
| AI agents | Claude Sonnet API | Creative Director, Asset Curator, Copywriter |
| Transcription | whisper.cpp (self-hosted on workers) | Captions — runs locally, no API |
| Video templates | Remotion (React) | Programmatic video rendering |
| Worker UI | Google Sheets | Human review/approval interface |
| Music | Artlist/Epidemic Sound | Licensed background tracks |

## Architecture principles (MUST follow)

1. **Drive is a drop zone.** Workers upload raw UGC to Drive. Ingestion copies to R2. The render pipeline NEVER reads from Drive. All clip references use R2 keys.

2. **No long-lived n8n executions.** Every n8n workflow completes immediately. No "wait for human input" steps. State is persisted to Supabase before execution ends. New workflows are triggered by webhooks when humans act.

3. **Event-driven workflow split:**
   - Workflow 2A: Planning (runs agents, saves Context Packet to Supabase, ends)
   - Workflow 2B: Brief Approval (webhook trigger, reads from Supabase, enqueues to BullMQ, ends)
   - Workflow 3A: Video Assembly (BullMQ trigger, renders video, runs QA, ends)
   - Workflow 3B: QA Approval (webhook trigger, reads from Supabase, marks delivered or re-routes, ends)
   - Workflow 4: Stale Job Monitor (cron every 15 min, checks for stuck jobs, Slack alerts)

4. **Brand configs live in Supabase.** The `brand_configs` table is the source of truth. Google Sheets is a read-only view. Color hex values have regex constraints, required fields are NOT NULL.

5. **Context Packet is immutable.** All 3 agent outputs merge into a single JSON object stored in `jobs.context_packet`. It flows through the entire pipeline. Never mutated — if rejected, a new one replaces it entirely.

6. **Every state transition is logged.** Insert into `job_events` on every status change. This powers monitoring, debugging, and the stale job detector.

## State machine

```
IDLE → IDEA_SEED → PLANNING → BRIEF_REVIEW → QUEUED → CLIP_PREP → TRANSCRIPTION → RENDERING → AUDIO_MIX → SYNC_CHECK → PLATFORM_EXPORT → AUTO_QA → HUMAN_QA → DELIVERED
```

Rejection loops:
- BRIEF_REVIEW → PLANNING (worker rejects brief)
- HUMAN_QA → QUEUED (technical re-render)
- HUMAN_QA → PLANNING (fundamental re-plan)
- SYNC_CHECK → AUDIO_MIX (auto-retry A/V drift)

Terminal states: DELIVERED, FAILED

## R2 folder structure (create this first)

```
video-factory/
├── assets/{brand_id}/{asset_uuid}.mp4       — Ingested UGC clips
├── rendered/{brand_id}/{YYYY-MM}/           — Finished videos
├── brands/{brand_id}/logo.png               — Brand assets (logos, watermarks)
├── brands/{brand_id}/watermark.png
├── music/{filename}.mp3                     — Licensed background tracks
└── temp/{job_id}/                           — Working directory (cleaned after render)
```

## Database schema summary

### brand_configs
Primary key: `brand_id` (varchar). Colors validated by regex (`^#[0-9A-Fa-f]{6}$`). Contains `caption_preset` (JSONB) with full caption style config. `voice_guidelines` (text) for AI agent system prompts. `drive_input_folder_id` for ingestion source.

### assets
UUID primary key. References `brand_configs(brand_id)`. Key fields: `r2_key` (path in R2), `content_type`, `mood`, `quality_score` (1-10), `has_speech`, `visual_elements` (JSONB array), `usable_segments` (JSONB array of {start_s, end_s, description}), `used_count` + `last_used_at` for overuse prevention. GIN indexes on JSONB fields.

### jobs
UUID primary key. References `brand_configs(brand_id)`. `status` uses Postgres ENUM `job_status`. `context_packet` (JSONB) holds the full merged output of all 3 agents. `auto_qa_results` (JSONB) holds pass/fail for each QA check. `final_outputs` (JSONB) has R2 keys per platform. `updated_at` auto-updates via trigger.

### job_events
Bigserial primary key. References `jobs(id)` with CASCADE delete. `from_status`, `to_status`, `event_type` (state_transition, error, retry, timeout), `details` (JSONB for error messages, worker info, timing).

### music_tracks
UUID primary key. `mood`, `genre`, `energy_level` (1-10), `tempo_bpm`. `license_source` tracks where the track came from.

## Build sequence

### Phase 1: VPS + Connectivity (do this first)
1. Provision Hetzner CX41 (8 vCPU, 16GB RAM, Ubuntu 24.04)
2. Install: Node.js 20 LTS, FFmpeg, whisper.cpp, Docker (optional for Remotion)
3. Clone/init the `video-factory` repo
4. Copy `.env.video-factory` to the VPS
5. Write a connectivity test script that verifies:
   - Supabase: can query `brand_configs`
   - Redis: can PING Upstash
   - R2: can PUT and GET a test file
6. Create R2 folder structure (put empty `.keep` files)

### Phase 2: Asset Ingestion Pipeline
1. Build ingestion worker (`workers/ingestion.ts`):
   - Input: file path or Drive file ID
   - FFprobe → extract metadata
   - AI tagger (Claude API) → analyze content, generate tags
   - Upload to R2 → `assets/{brand_id}/{uuid}.ext`
   - Insert into Supabase `assets` table
2. Build n8n Workflow 1: Drive trigger → calls ingestion worker via HTTP/webhook

### Phase 3: Creative Planning Agents
1. Build agent system prompts (`agents/prompts/`)
2. Build Creative Director agent (`agents/creative-director.ts`)
3. Build Asset Curator agent (`agents/asset-curator.ts`)
4. Build Copywriter agent (`agents/copywriter.ts`)
5. Build Context Packet merger
6. Build n8n Workflow 2A + 2B
7. Set up Google Sheets worker interface

### Phase 4: Video Assembly Engine
1. Set up Remotion on VPS
2. Build base template components (CaptionTrack, HookText, CTAScreen, LogoWatermark)
3. Build first 3 templates (hook-demo-cta, hook-listicle-cta, hook-transformation)
4. Build FFmpeg clip prep pipeline
5. Integrate whisper.cpp for transcription
6. Build audio mixer
7. Build A/V sync checker
8. Build platform exporter (TikTok, IG, YT format variants)
9. Build automated QA checker (8 checks)
10. Build n8n Workflow 3A + 3B

### Phase 5: Monitoring + QA
1. Build n8n Workflow 4 (stale job cron)
2. Set up Slack webhook for alerts
3. Build QA review Sheet
4. End-to-end test with pilot brands

## Supabase access patterns (for workers)

Workers interact with Supabase via REST API (PostgREST). Use service_role key in Authorization header.

```bash
# Read brand config
GET /rest/v1/brand_configs?brand_id=eq.nordpilates

# Insert asset
POST /rest/v1/assets
Body: { "brand_id": "nordpilates", "r2_key": "assets/nordpilates/xxx.mp4", ... }

# Claim a job (atomic, prevents race conditions)
PATCH /rest/v1/jobs?id=eq.{uuid}&status=eq.idea_seed
Body: { "status": "planning" }
Headers: Prefer: return=representation

# Log event
POST /rest/v1/job_events
Body: { "job_id": "uuid", "from_status": "planning", "to_status": "brief_review", "event_type": "state_transition" }

# Query assets for curator agent
GET /rest/v1/assets?brand_id=eq.nordpilates&content_type=eq.b-roll&quality_score=gte.7&order=used_count.asc,quality_score.desc&limit=10

# Get stale jobs
GET /rest/v1/v_stale_jobs
```

All requests need headers:
```
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {SUPABASE_SERVICE_KEY}
Content-Type: application/json
```

## BullMQ queue names

- `ingestion` — Asset ingestion jobs (Drive → R2 → Supabase)
- `planning` — Creative planning jobs (run 3 agents)
- `rendering` — Video assembly jobs (FFmpeg + Remotion + Whisper)
- `export` — Platform-specific export jobs

## File structure

```
video-factory/
├── .env                            — Credentials (from .env.video-factory)
├── package.json
├── tsconfig.json
├── src/
│   ├── config/
│   │   ├── env.ts                  — Typed env loader
│   │   ├── supabase.ts             — Supabase client init
│   │   ├── redis.ts                — Redis/BullMQ connection
│   │   └── r2.ts                   — S3-compatible R2 client
│   ├── workers/
│   │   ├── ingestion.ts            — Asset ingestion worker
│   │   ├── clip-prep.ts            — FFmpeg clip processing
│   │   ├── transcriber.ts          — whisper.cpp integration
│   │   ├── renderer.ts             — Remotion render orchestration
│   │   ├── audio-mixer.ts          — FFmpeg audio processing
│   │   ├── sync-checker.ts         — A/V sync verification
│   │   ├── exporter.ts             — Platform-specific export
│   │   └── qa-checker.ts           — Automated QA (8 checks)
│   ├── agents/
│   │   ├── creative-director.ts    — Agent 1
│   │   ├── asset-curator.ts        — Agent 2
│   │   ├── copywriter.ts           — Agent 3
│   │   └── prompts/
│   │       ├── creative-director.md
│   │       ├── asset-curator.md
│   │       └── copywriter.md
│   ├── templates/                  — Remotion video templates
│   │   ├── components/
│   │   │   ├── CaptionTrack.tsx
│   │   │   ├── HookText.tsx
│   │   │   ├── CTAScreen.tsx
│   │   │   ├── LogoWatermark.tsx
│   │   │   └── TransitionEffect.tsx
│   │   └── layouts/
│   │       ├── HookDemoCTA.tsx
│   │       ├── HookListicleCTA.tsx
│   │       └── HookTransformation.tsx
│   ├── lib/
│   │   ├── job-manager.ts          — Job state transitions + event logging
│   │   ├── ffmpeg.ts               — FFmpeg command builders
│   │   └── r2-storage.ts           — R2 upload/download helpers
│   └── scripts/
│       ├── test-connectivity.ts    — Verify Supabase + Redis + R2
│       └── create-r2-structure.ts  — Initialize R2 folder structure
├── n8n-workflows/
│   ├── 1-asset-ingestion.json
│   ├── 2a-creative-planning.json
│   ├── 2b-brief-approval.json
│   ├── 3a-video-assembly.json
│   ├── 3b-qa-approval.json
│   └── 4-stale-job-monitor.json
└── docs/
    ├── ARCHITECTURE.md
    └── WORKER_GUIDE.md
```

## Key dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2",
    "bullmq": "^5",
    "ioredis": "^5",
    "@aws-sdk/client-s3": "^3",
    "@remotion/cli": "^4",
    "@remotion/renderer": "^4",
    "react": "^18",
    "react-dom": "^18",
    "fluent-ffmpeg": "^2",
    "dotenv": "^16",
    "zod": "^3"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/fluent-ffmpeg": "^2",
    "tsx": "^4"
  }
}
```

## Important notes for the agent

- The owner (Dominykas) works primarily with n8n for orchestration. All workflows are visual n8n workflows, not pure code.
- n8n is already self-hosted on Hetzner with SSH access.
- Start with 1 VPS render worker, not 3. Scale to 3 later.
- Use TypeScript for all worker code.
- whisper.cpp runs locally on the VPS — do NOT use OpenAI Whisper API.
- Google Drive is a DROP ZONE ONLY. Never read from Drive in the render pipeline.
- All file references in the pipeline use R2 keys, never Drive URLs.
- Brand configs come from Supabase `brand_configs` table, never from Google Sheets.
- Every job status change must INSERT into `job_events` table.
- The `jobs.status` column uses a Postgres ENUM — only valid values from the enum are accepted.
