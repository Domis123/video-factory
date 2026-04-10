# VPS Servers — Video Factory Infrastructure

## Overview

Two Hetzner VPS servers run the entire Video Factory backend. Workers (humans) never touch these servers — they only interact with Google Sheets and Google Drive.

```
┌─────────────────────┐     ┌─────────────────────┐
│   n8n Server         │     │   Video Factory VPS  │
│   46.224.56.174      │────▶│   95.216.137.35      │
│   (Orchestrator)     │     │   (Worker Engine)    │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
     ┌─────┴─────┐              ┌─────┴─────┐
     │  Google    │              │  Supabase  │
     │  Sheets    │              │  Redis     │
     │  Drive     │              │  R2        │
     └───────────┘              │  Claude AI │
                                │  Gemini AI │
                                └───────────┘
```

---

## Server 1: n8n (Orchestrator)

**IP**: 46.224.56.174
**OS**: Ubuntu 24.04
**Role**: Workflow automation — bridges Google Sheets/Drive with Supabase and the VPS worker

### What it does

n8n is a self-hosted workflow automation tool (like Zapier but open source). It runs 11 workflows that sync data between Google Sheets, Google Drive, Supabase, and the VPS worker.

### Workflows running on n8n

**Sheet → Supabase (triggered by worker actions in Sheets):**

| Workflow | Polls | What it does |
|----------|-------|-------------|
| S1: New Job | Every 30s | Worker fills Brand + Idea Seed in Jobs sheet → creates job in Supabase → enqueues to BullMQ planning queue on VPS |
| S2: Brief Review | Every 30s | Worker approves/rejects brief → updates Supabase → if approved, enqueues to BullMQ rendering queue |
| S3: QA Decision | Every 30s | Worker approves/rejects video → updates Supabase → if rejected, routes to re-plan or re-render |
| S4: Brand Config | Every 5min | Worker edits brand colors/fonts → validates hex codes → updates Supabase |
| S5: Caption Preset | Every 5min | Worker edits caption styles → reassembles 20 flat columns into nested JSON → updates Supabase |
| S6: Music Track | Every 5min | If worker manually adds track metadata in Sheet → inserts to Supabase |
| S7: Music Ingest | Every 5min | Downloads MP3s from Drive folder → sends to VPS for processing → writes results to Sheet → moves file to Processed |

**Supabase → Sheet (keeps Sheet in sync with backend):**

| Workflow | Triggers | What it does |
|----------|----------|-------------|
| P1: Job Status Push | Webhook from VPS | After each state transition, fetches job from Supabase, updates Sheet row |
| P2: Periodic Sync | Every 5min | Catches any missed updates — syncs all active jobs from Supabase to Sheet |
| P3: Dashboard Refresh | Every 5min | Fetches brand stats view + active job counts, rebuilds Dashboard tab |
| P4: Monthly Archive | 1st of month 2am | Moves delivered/failed jobs from previous month to an archive tab |

### How n8n authenticates

- **Google Sheets/Drive**: Service account credential ("Flemingo service acc", ID: `AIqzMYUXoQjud7IW`)
- **Supabase**: HTTP header auth with anon key (credential "Strapi API Token", ID: `l66cV4Gj1L3T6MjJ`) + env vars `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- **VPS**: Direct HTTP calls to `http://95.216.137.35:3000` (no auth — internal network)

### n8n management

```bash
# SSH into n8n server
ssh root@46.224.56.174

# n8n is typically running as a systemd service or Docker container
# Check the specific setup on the server
```

---

## Server 2: Video Factory VPS (Worker Engine)

**IP**: 95.216.137.35
**OS**: Ubuntu 24.04
**Spec**: Hetzner CX32 — 4 vCPU, 8GB RAM, 80GB SSD (upgraded from CX22 on 2026-04-10 for render concurrency headroom)
**Role**: All heavy processing — AI agents, video rendering, audio processing, transcription

### What it does

This server runs a Node.js application that:
1. Listens on 3 BullMQ queues (planning, rendering, ingestion) for jobs from n8n
2. Serves an HTTP API on port 3000 for n8n to enqueue jobs and ingest music
3. Processes video production jobs end-to-end

### Software installed

| Software | Location | Purpose |
|----------|----------|---------|
| Node.js 20 | system | Runtime for the TypeScript application |
| FFmpeg | system | Video/audio processing (trim, normalize, encode, color grade, audio mix) |
| whisper.cpp | `/opt/whisper.cpp/build/bin/whisper-cli` | Speech-to-text transcription (base.en model) |
| Chromium | system (headless) | Required by Remotion for video rendering |
| Git | system | Pulls code from GitHub for deployments |

### Application structure

The app starts as a single process that runs everything:

```
src/index.ts (entry point)
├── Planning Worker (BullMQ, concurrency: 1)
│   └── Runs 3 AI agents → produces Context Packet
├── Rendering Worker (BullMQ, concurrency: 2)
│   └── clip-prep → transcribe → render → audio-mix → sync-check → export → QA
├── Ingestion Worker (BullMQ)
│   └── FFprobe + Gemini analyze → R2 upload → Supabase insert
└── HTTP API (port 3000)
    ├── POST /enqueue      — n8n adds jobs to BullMQ queues
    ├── POST /music-ingest — n8n sends audio file for processing
    └── GET  /health       — Health check
```

### How a video gets made (VPS perspective)

**Planning phase** (triggered by S1 workflow):
```
1. BullMQ picks up job from `planning` queue
2. Fetch job + brand config from Supabase
3. Select video type from brand + idea seed keywords
4. Run Creative Director agent (Claude Sonnet API)
   → Produces creative brief with segments, pacing, energy curve
5. Run Asset Curator agent (Claude Sonnet API)
   → Selects clips from Supabase assets matching brief requirements
6. Run Copywriter agent (Claude Sonnet API)
   → Generates hook text, CTA, platform captions, hashtags
7. Merge all 3 outputs into immutable Context Packet
8. Select music track (weighted random by mood + energy)
9. Build template config (transition timing from energy curve)
10. Store Context Packet in Supabase → status becomes `brief_review`
```

**Rendering phase** (triggered by S2 workflow after worker approves):
```
1. BullMQ picks up job from `rendering` queue
2. Clip Prep: download clips from R2, trim, normalize 1080x1920/30fps, color grade
3. Transcription: run whisper.cpp on each clip → word-level timestamps
4. Rendering: bundle Remotion project, render video composition to MP4
5. Audio Mix: layer UGC audio + music with sidechain ducking
6. Sync Check: verify A/V sync within 200ms tolerance
7. Platform Export: encode for TikTok, Instagram, YouTube (CRF 18, slow preset)
8. Auto QA: 8 automated checks (duration, resolution, audio, sync, etc.)
9. Upload to R2 → status becomes `human_qa`
```

**Music ingest** (triggered by S7 workflow):
```
1. Receives audio binary via POST /music-ingest
2. Saves to temp file
3. FFprobe for duration
4. Upload to R2 under music/{filename}
5. Insert track record into Supabase music_tracks table
6. Return { track_id, r2_key, duration_seconds, tempo_bpm }
```

### External services the VPS talks to

| Service | What for | Auth |
|---------|----------|------|
| Supabase | Read/write jobs, assets, brands, music_tracks | Service key in .env |
| Upstash Redis | BullMQ job queue (TLS required) | Redis URL in .env |
| Cloudflare R2 | Store/retrieve video clips, rendered videos, music | S3 access keys in .env |
| Claude API (Anthropic) | 3 AI agents for creative planning | API key in .env |
| Gemini API (Google) | Video clip analysis during ingestion | API key in .env |

### Systemd service

The app runs as a systemd service that auto-starts on boot and auto-restarts on crash.

```bash
# Service file location
/etc/systemd/system/video-factory.service

# Common commands
systemctl status video-factory    # Check if running
systemctl restart video-factory   # Restart after deploy
systemctl stop video-factory      # Stop
journalctl -u video-factory -f    # Live logs
journalctl -u video-factory -n 50 # Last 50 log lines
```

### Deploying updates

```bash
ssh root@95.216.137.35
cd /home/video-factory
git pull
npm install
npm run build
systemctl restart video-factory
```

Or as a one-liner:
```bash
ssh root@95.216.137.35 "cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory"
```

### Resource usage

- **Memory**: ~142MB idle (8GB available on CX32 — plenty of headroom for concurrent renders + Gemini downscale)
- **CPU**: 4 vCPU on CX32. Spikes during FFmpeg encoding and Remotion rendering, idle otherwise.
- **Disk**: 80GB SSD. Temp files cleaned after each job. R2 is the permanent store.
- **Redis**: ~6.5K commands/day idle with drainDelay 120s (Upstash free tier: 500K/month). Was 26K/day at drainDelay 30s.

### Environment variables (.env)

```
# Supabase
SUPABASE_URL=https://kfdfcoretoaukcoasfmu.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...

# Redis (Upstash, TLS required)
REDIS_URL=rediss://...

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=video-factory
R2_ENDPOINT=https://...r2.cloudflarestorage.com

# AI
ANTHROPIC_API_KEY=...    # Claude Sonnet for agents
GEMINI_API_KEY=...       # Gemini for clip analysis

# Worker
WORKER_ID=worker-1
WORKER_CONCURRENCY=2
RENDER_TEMP_DIR=/tmp/video-factory
API_PORT=3000
```

---

## How the two servers work together

```
┌──────────┐  1. Worker fills Sheet    ┌──────────┐
│  Google   │◀─────────────────────────│  Worker   │
│  Sheets   │  (Brand + Idea Seed)     │  (Human)  │
└─────┬────┘                           └──────────┘
      │ 2. n8n polls Sheet (30s)
      ▼
┌──────────┐  3. Creates job in         ┌──────────┐
│   n8n    │─────Supabase──────────────▶│ Supabase │
│  Server  │                            └──────────┘
└─────┬────┘
      │ 4. POST /enqueue {queue: "planning", jobId}
      ▼
┌──────────┐  5. Picks up job           ┌──────────┐
│   VPS    │─────from BullMQ───────────▶│  Redis   │
│  Worker  │                            └──────────┘
└─────┬────┘
      │ 6. Runs AI agents + render pipeline
      │    Reads/writes Supabase, R2, Claude, Gemini
      │
      │ 7. Job complete → status update in Supabase
      ▼
┌──────────┐  8. P1/P2 syncs status     ┌──────────┐
│   n8n    │─────back to Sheet─────────▶│  Google   │
│  Server  │                            │  Sheets   │
└──────────┘                            └─────┬────┘
                                              │
                                    9. Worker sees result
                                       (preview URL, QA status)
                                              ▼
                                        ┌──────────┐
                                        │  Worker   │
                                        │  (Human)  │
                                        └──────────┘
```

### Failure handling

- **VPS crashes**: systemd auto-restarts. BullMQ jobs that were in-progress get retried automatically.
- **n8n crashes**: Polling resumes on restart. No data lost — Supabase is the source of truth.
- **Redis down**: Workers can't pick up jobs. Jobs queue up and process when Redis returns.
- **Supabase down**: Everything pauses. No data corruption — atomic operations prevent partial writes.

---

## Costs

| Service | Cost/month | Notes |
|---------|-----------|-------|
| VPS (video-factory-01) | ~$8.50 | Hetzner CX32 (upgraded from CX22 on 2026-04-10) |
| n8n server | ~$4.50 | Hetzner (shared with other projects) |
| Supabase | $0 | Free tier |
| Upstash Redis | $0 | Free tier (500K cmds/month, using ~26K/day) |
| Cloudflare R2 | ~$0-1 | Free 10GB storage, zero egress |
| Claude API | ~$4 | ~150 videos/week × 3 agents |
| Gemini API | ~$0.60 | ~150 clips/week × $0.001 |
| **Total** | **~$18/month** | At full 150 videos/week scale (CX32) |
