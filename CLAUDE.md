# Video Factory — CLAUDE.md

## Project Overview
A 95% automated video production pipeline for 30 social media brands. Takes raw UGC footage from Google Drive, uses AI agents to plan creative briefs, and renders branded short-form videos (30-60s) for TikTok, Instagram Reels, and YouTube Shorts. Target: 150 videos/week across 30 brands.

## Key Documentation
- `VIDEO_PIPELINE_ARCHITECTURE_v2.md` — Full architecture, database schemas, workflow definitions, state machine
- `QUALITY_UPGRADE_PLAN.md` — 9-phase video quality upgrade plan (video types, beat sync, color grading, audio ducking, encoding, music selection)
- `VPS-SERVERS.md` — Infrastructure docs: both VPS servers, deployment, costs, how they work together
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (MUST follow)
1. **Google Drive is a drop zone only.** Ingestion copies to R2. The render pipeline NEVER reads from Drive. All clip references use R2 keys.
2. **No long-lived n8n executions.** Every workflow completes immediately. State is persisted to Supabase. New workflows triggered by webhooks.
3. **Supabase is the source of truth.** Sheets is the primary input/view layer for workers. All Sheet edits are validated by n8n before writing to Supabase. Workers never access Supabase directly.
4. **Context Packet is immutable.** 3 agent outputs merge into one JSON in `jobs.context_packet`. Never mutated — replaced entirely on rejection.
5. **Every state transition is logged.** INSERT into `job_events` on every status change.
6. **All workers use TypeScript.** No JavaScript files.
7. **whisper.cpp runs locally** on VPS workers — do NOT use OpenAI Whisper API.
8. **Workers only use Google Drive + Google Sheets.** No terminal, no Supabase, no R2 directly. n8n + VPS handle everything behind the scenes.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner) — 46.224.56.174
- **Database**: Supabase Postgres (free tier) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required, drainDelay 30s)
- **Storage**: Cloudflare R2 (S3-compatible, zero egress)
- **AI Agents**: Claude Sonnet API (Creative Director, Asset Curator, Copywriter)
- **Clip Analyzer**: Gemini API — analyzes raw UGC during ingestion (content type, mood, quality, visual elements, usable segments, speech detection)
- **Transcription**: whisper.cpp (self-hosted on render workers)
- **Video Templates**: Remotion (React-based)
- **Video Processing**: FFmpeg
- **Admin Panel**: Google Sheets ("Video Pipeline" spreadsheet)

## Database Tables
- `brand_configs` — Brand settings, colors (regex-validated hex), fonts, caption presets, voice guidelines, allowed_video_types, color_grade_preset
- `assets` — Ingested UGC clips with AI-generated tags, quality scores, usable segments, dominant_color_hex, motion_intensity, avg_brightness
- `jobs` — Video production jobs with full state machine (ENUM `job_status`), video_type
- `job_events` — Event log for every state transition, error, retry, timeout
- `music_tracks` — Licensed background music, mood-tagged, energy_level, tempo_bpm

## Job State Machine
```
IDLE → IDEA_SEED → PLANNING → BRIEF_REVIEW → QUEUED → CLIP_PREP → TRANSCRIPTION → RENDERING → AUDIO_MIX → SYNC_CHECK → PLATFORM_EXPORT → AUTO_QA → HUMAN_QA → DELIVERED
```
Terminal states: DELIVERED, FAILED. Rejection loops exist at BRIEF_REVIEW and HUMAN_QA.

## Video Type System
4 video types with pacing profiles, energy curves, and brand mapping:
- **workout-demo** — Fast cuts (1-3s), energy 7-9. Brands: nordpilates, highdiet
- **recipe-walkthrough** — Medium holds (3-6s), energy 4-6. Brands: ketoway, carnimeat
- **tips-listicle** — Medium cuts (2-4s), energy 5-7. All brands
- **transformation** — Slow build → dramatic cut, energy 3→8. Brands: nordpilates, nodiet, highdiet

Video type is auto-selected from brand + idea_seed keywords via `video-type-selector.ts`.

## BullMQ Queue Names
- `ingestion` — Asset ingestion (Drive → R2 → Supabase)
- `planning` — Creative planning (run 3 agents)
- `rendering` — Video assembly (FFmpeg + Remotion + Whisper)
- `export` — Platform-specific export

## File Structure
```
src/
├── config/          — env.ts, supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (all DB + Context Packet types), video-types.ts (VideoType configs)
├── lib/             — job-manager.ts, r2-storage.ts, ffmpeg.ts, exec.ts, gemini.ts,
│                      video-type-selector.ts, clip-analysis.ts, beat-detector.ts,
│                      color-grading.ts, music-selector.ts, template-config-builder.ts
├── workers/         — ingestion, clip-prep, transcriber, audio-mixer, sync-checker,
│                      exporter, qa-checker, renderer, pipeline, music-ingest
├── agents/
│   ├── prompts/     — creative-director.md, asset-curator.md, copywriter.md
│   ├── creative-director.ts, asset-curator.ts, copywriter.ts
│   └── context-packet.ts  — runs all 3 agents, merges into Context Packet
├── templates/
│   ├── types.ts     — TemplateProps, ResolvedSegment, helpers
│   ├── Root.tsx     — Remotion composition registry
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect, SegmentVideo
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
├── index.ts         — Server entry point (BullMQ workers + HTTP API on port 3000)
└── scripts/         — test-connectivity, test-pipeline, test-agents, test-agents-live,
                       test-gemini, test-phase5, test-quality-upgrade, create-r2-structure,
                       migrate.sql, migrate-quality-upgrade.sql, upload-music, clean-r2-music

n8n-workflows/       — Importable n8n workflow JSONs (11 total)
├── S1-new-job.json          — New job from Sheet → Supabase + BullMQ (30s poll)
├── S2-brief-review.json     — Brief approve/reject → Supabase + BullMQ (30s poll)
├── S3-qa-decision.json      — QA approve/reject → Supabase + BullMQ (30s poll)
├── S4-brand-config.json     — Brand edits → validated → Supabase (5min poll)
├── S5-caption-preset.json   — Caption preset → reassemble JSONB → Supabase (5min poll)
├── S6-music-track.json      — New music tracks from Sheet → Supabase (5min poll)
├── S7-music-ingest.json     — Drive folder → VPS ffprobe → R2 → Supabase → Sheet (5min poll)
├── P1-job-status-push.json  — Webhook: Supabase → Sheet (event-driven)
├── P2-periodic-sync.json    — Active jobs Supabase → Sheet (5min catch-up)
├── P3-dashboard-refresh.json — Brand stats → Dashboard tab (5min)
└── P4-monthly-archive.json  — Archive delivered/failed jobs (1st of month)
```

## Google Sheets Admin Panel ("Video Pipeline")
Spreadsheet ID: `1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`
Workers manage everything from a single Google Spreadsheet with 6 tabs:
1. **Jobs** (gid: 645720058) — Create idea seeds, review briefs (approve/reject), QA videos. Polled every 30s.
2. **Brands** (gid: 219264500) — Edit colors, fonts, CTA style, voice guidelines, allowed video types, color grade preset. Polled every 5min.
3. **Caption Presets** — Flattened JSONB (20 columns per brand). n8n reassembles to nested JSON.
4. **Music Library** — Auto-populated via S7 workflow (Drive → VPS → R2 → Supabase → Sheet). Workers just drop MP3s in Drive.
5. **Templates** — Reference tab listing available templates + video type mapping.
6. **Dashboard** — Read-only stats from `v_brand_stats` view. Refreshed every 5min.

**Worker workflow** (zero terminal):
| Task | Where | Action |
|------|-------|--------|
| Add music | Google Drive `Music Uploads/` folder | Drop MP3 file |
| Add UGC clips | Google Drive brand folder | Drop video file |
| Create video | Sheet (Jobs tab) | Fill Brand + Idea Seed |
| Review brief | Sheet (Jobs tab) | Set approve/reject in Review Decision |
| QA video | Sheet (Jobs tab) | Watch Preview URL, set QA Decision |
| Edit brand | Sheet (Brands tab) | Change colors/fonts/CTA/video types |

**Sync**: n8n mediates bidirectionally. Sheet→Supabase edits are validated (hex regex, ranges, required fields). Errors shown in column A ("Row Status"). Supabase→Sheet updates are event-driven + 5min cron catch-up.

## Google Drive Folder Structure
- **Music Uploads**: `1s2vUnIoJUt7rltSRlJeY9uqQyQ5_Lzso` — Workers drop MP3s here, S7 processes and moves to Processed
- **Music Processed**: `1RtBDaSxM45TT2B7ATvQGXvnY5HB1nWGw` — Processed tracks moved here automatically
- Brand UGC folders: one per brand, workers drop raw footage here

## n8n Credentials
- **Google Sheets/Drive**: Service account `googleApi` — ID: `AIqzMYUXoQjud7IW`, Name: "Flemingo service acc"
- **Supabase HTTP**: Header auth `httpHeaderAuth` — ID: `l66cV4Gj1L3T6MjJ`, Name: "Strapi API Token"
- **Env vars**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` configured in n8n

## HTTP API (VPS port 3000)
- `POST /enqueue` — n8n calls this to add jobs to BullMQ queues. Body: `{ queue, jobId }`
- `POST /music-ingest` — n8n S7 sends audio binary. Header: `x-track-meta` JSON. Returns track record with ID, duration, BPM.
- `GET /health` — Health check. Returns `{ status: "ok", worker: "worker-1" }`

## Build Commands
```bash
npm run build              # TypeScript compilation
npm run test:connectivity  # Verify Supabase + Redis + R2
npm run setup:r2           # Initialize R2 folder structure
npm run test:pipeline      # Full integration test (FFprobe, FFmpeg, ingestion, job manager, QA)
npm run test:agents        # AI agents mock mode test (30 checks)
npm run test:agents:live   # AI agents live test with Claude Sonnet API (27 checks)
npm run test:quality       # Quality upgrade modules test (41 checks)
npm run test:phase5        # Phase 5 integration test (28 checks: queues, lifecycle, renderer)
npm start                  # Start all BullMQ workers (dev mode via tsx)
npm run start:prod         # Start workers in production (compiled JS)
```

## UGC File Naming Convention
Workers drop files into brand-specific Google Drive folders. Simple prefix naming:
```
{brand_id}_{description}.mov
```
Examples: `nordpilates_yoga-flow-demo.mov`, `ketoway_meal-prep-chicken.mp4`
- Brand prefix must match a `brand_id` in Supabase (validated on ingestion)
- If no underscore or invalid brand, falls back to Drive folder's brand
- Description is stored as a searchable tag in `assets.tags`
- Any extension works: `.mov`, `.mp4`, `.webm`

## Remotion Video Templates
All templates render at 1080x1920 30fps (vertical short-form). Each layout is a React component that takes a `TemplateProps` object containing the full Context Packet, pre-resolved clip paths, whisper transcriptions, logo, and music.

**Available layouts** (mapped by `template_id` in Root.tsx):
- `hook-demo-cta` — Hook → Product demo → CTA (workout-demo, recipe-walkthrough)
- `hook-listicle-cta` — Hook → Numbered tips with progress bar → CTA (tips-listicle)
- `hook-transformation` — Hook → Before/After split-wipe reveal → CTA (transformation)

**Reusable components:**
- `CaptionTrack` — Word-by-word captions with 3 animation modes (word-highlight, karaoke, word-pop), spring physics
- `HookText` — 5 entrance animations (pop-in, slide-up, typewriter, scale-rotate, glitch)
- `CTAScreen` — Pulsing action badge, 5 styles (link-in-bio, swipe-up, follow, shop-now, minimal)
- `LogoWatermark` — Persistent overlay, configurable position/opacity/size
- `TransitionEffect` — 8 types (cut, fade, slide-left, slide-up, zoom, wipe, beat-flash, beat-zoom)
- `SegmentVideo` — Handles single or multi-clip segments automatically

## Quality Upgrade Features (all deployed)
- **Video Type System** — 4 types with pacing profiles, energy curves, brand mapping
- **Ingestion Enrichment** — FFmpeg clip analysis: dominant color, motion intensity, brightness
- **Beat-Synced Transitions** — BeatMap from tempo_bpm, snap transitions to nearest beat
- **Audio Ducking** — Sidechain compressor (attack 50ms, release 300ms, ratio 6:1, base vol 0.30)
- **Encoding Upgrade** — CRF 18 + slow preset, audio 192k (was CRF 23 + medium + 128k)
- **Color Grading** — 3-step: auto-level (brightness-adaptive) → brand LUT (.cube) → preset fallback
- **Music Selection** — Weighted random by mood + energy range, prefers fresh tracks
- **Dynamic Pacing** — Per-segment transition timing, animation speeds from energy curve + beat map

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX22 (2 vCPU, 4GB RAM), Ubuntu
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory`
- **Logs**: `journalctl -u video-factory -f`
- **Service**: `systemctl start|stop|restart|status video-factory`
- whisper.cpp installed at `/opt/whisper.cpp/build/bin/whisper-cli` with `base.en` model

## Important Technical Notes
- Upstash Redis requires `tls: {}` and `maxRetriesPerRequest: null` in ioredis config
- BullMQ drainDelay: 30s between empty-queue polls (prevents free tier exhaustion, ~26K cmds/day idle)
- R2 client needs `forcePathStyle: true` and `region: "auto"`
- Job status uses Postgres ENUM — TypeScript `JobStatus` type must exactly match
- Atomic job claiming: `.update({status}).eq('id', jobId).eq('status', fromStatus)` prevents race conditions
- 5 pilot brands seeded: nordpilates, ketoway, carnimeat, nodiet, highdiet
- Quality upgrade migration applied to Supabase (2026-04-07): new columns on jobs, assets, brand_configs

## Current Build Status
- **All code phases COMPLETE** (Phases 1-5 + Quality Phases 0-7)
- **VPS deployed and running** at 95.216.137.35 with all endpoints live
- **Google Sheets created** — "Video Pipeline" spreadsheet with 6 tabs
- **n8n workflows**: 11 JSONs ready (S1-S7, P1-P4), S7 being tested
- **Music library**: 15 tracks dropped in Google Drive, S7 workflow processing them (Drive → VPS ffprobe → R2 → Supabase → Sheet)
- **DB migrations applied** — base schema + quality upgrade columns
- **Tests**: 98/98 passing (30 mock + 41 quality + 27 live)
- **Pending**: End-to-end test (idea seed → rendered video), UGC clips for pilot brand, Phase 8 (Trending Audio)
