# Video Factory — CLAUDE.md

## Project Overview
A 95% automated video production pipeline for 30 social media brands. Takes raw UGC footage from Google Drive, uses AI agents to plan creative briefs, and renders branded short-form videos (30-60s) for TikTok, Instagram Reels, and YouTube Shorts. Target: 150 videos/week across 30 brands.

## Key Documentation
- `VIDEO_PIPELINE_ARCHITECTURE_v2.md` — Full architecture, database schemas, workflow definitions, state machine
- `CURSOR_AGENT_BUILD_GUIDE.md` — Build guide with file structure, dependencies, access patterns
- `BUILD_PLAN.md` — Phased build plan (foundation → workers → agents → templates → integration)
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (MUST follow)
1. **Google Drive is a drop zone only.** Ingestion copies to R2. The render pipeline NEVER reads from Drive. All clip references use R2 keys.
2. **No long-lived n8n executions.** Every workflow completes immediately. State is persisted to Supabase. New workflows triggered by webhooks.
3. **Supabase is the source of truth.** Sheets is the primary input/view layer for workers. All Sheet edits are validated by n8n before writing to Supabase. Workers never access Supabase directly.
4. **Context Packet is immutable.** 3 agent outputs merge into one JSON in `jobs.context_packet`. Never mutated — replaced entirely on rejection.
5. **Every state transition is logged.** INSERT into `job_events` on every status change.
6. **All workers use TypeScript.** No JavaScript files.
7. **whisper.cpp runs locally** on VPS workers — do NOT use OpenAI Whisper API.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner)
- **Database**: Supabase Postgres (free tier) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required)
- **Storage**: Cloudflare R2 (S3-compatible, zero egress)
- **AI Agents**: Claude Sonnet API (Creative Director, Asset Curator, Copywriter)
- **Clip Analyzer**: Gemini API — analyzes raw UGC during ingestion (content type, mood, quality, visual elements, usable segments, speech detection)
- **Transcription**: whisper.cpp (self-hosted on render workers)
- **Video Templates**: Remotion (React-based)
- **Video Processing**: FFmpeg

## Database Tables
- `brand_configs` — Brand settings, colors (regex-validated hex), fonts, caption presets, voice guidelines
- `assets` — Ingested UGC clips with AI-generated tags, quality scores, usable segments
- `jobs` — Video production jobs with full state machine (ENUM `job_status`)
- `job_events` — Event log for every state transition, error, retry, timeout
- `music_tracks` — Licensed background music, mood-tagged

## Job State Machine
```
IDLE → IDEA_SEED → PLANNING → BRIEF_REVIEW → QUEUED → CLIP_PREP → TRANSCRIPTION → RENDERING → AUDIO_MIX → SYNC_CHECK → PLATFORM_EXPORT → AUTO_QA → HUMAN_QA → DELIVERED
```
Terminal states: DELIVERED, FAILED. Rejection loops exist at BRIEF_REVIEW and HUMAN_QA.

## BullMQ Queue Names
- `ingestion` — Asset ingestion (Drive → R2 → Supabase)
- `planning` — Creative planning (run 3 agents)
- `rendering` — Video assembly (FFmpeg + Remotion + Whisper)
- `export` — Platform-specific export

## File Structure
```
src/
├── config/          — env.ts, supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (all DB + Context Packet types)
├── lib/             — job-manager.ts, r2-storage.ts, ffmpeg.ts, exec.ts, gemini.ts
├── workers/         — ingestion, clip-prep, transcriber, audio-mixer, sync-checker, exporter, qa-checker, renderer, pipeline
├── agents/
│   ├── prompts/     — creative-director.md, asset-curator.md, copywriter.md
│   ├── creative-director.ts, asset-curator.ts, copywriter.ts
│   └── context-packet.ts  — runs all 3 agents, merges into Context Packet
├── templates/
│   ├── types.ts     — TemplateProps, ResolvedSegment, helpers
│   ├── Root.tsx     — Remotion composition registry
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect, SegmentVideo
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
├── index.ts         — Server entry point (starts all BullMQ workers)
└── scripts/         — test-connectivity, test-pipeline, test-agents, test-agents-live, test-gemini, test-phase5, create-r2-structure, migrate.sql
```

## Google Sheets Admin Panel ("Video Factory Control Panel")
Workers manage everything from a single Google Spreadsheet with 6 tabs:
1. **Jobs** — Create idea seeds, review briefs (approve/reject), QA videos. Polled every 30s.
2. **Brands** — Edit colors, fonts, CTA style, voice guidelines, Drive folders. Polled every 5min.
3. **Caption Presets** — Flattened JSONB (20 columns per brand). n8n reassembles to nested JSON.
4. **Music Library** — Add/tag tracks with mood, genre, energy level, tempo.
5. **Templates** — Reference tab listing available templates + allowed brands.
6. **Dashboard** — Read-only stats from `v_brand_stats` view. Refreshed every 5min.

**Sync**: n8n mediates bidirectionally. Sheet→Supabase edits are validated (hex regex, ranges, required fields). Errors shown in column A ("Row Status"). Supabase→Sheet updates are event-driven + 5min cron catch-up. System columns are gray/protected, worker columns are white.

**Validation layers**: Sheet dropdowns (cosmetic) → n8n validation (real gate) → Supabase constraints (last resort).

Full Sheets architecture in `plans/expressive-skipping-giraffe.md`.

## Build Commands
```bash
npm run build              # TypeScript compilation
npm run test:connectivity  # Verify Supabase + Redis + R2
npm run setup:r2           # Initialize R2 folder structure
npm run test:pipeline      # Full integration test (FFprobe, FFmpeg, ingestion, job manager, QA)
npm run test:agents        # AI agents mock mode test (28 checks)
npm run test:agents:live   # AI agents live test with Claude Sonnet API (27 checks)
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

## Multi-Clip Reels
Fully supported. The Asset Curator selects multiple clips per segment via `ClipSelection.clips[]`. Typical reel: hook (1 clip, 3s) + body (2-3 clips, 20s) + CTA (1 clip, 5s) = 3-5 clips per 30-45s reel.

## Gemini Clip Analyzer (replaces stub AI tagger)
During ingestion, every UGC clip is analyzed by Gemini's vision model. Gemini receives the video file and returns structured data:
- **content_type**: talking-head, product-demo, b-roll, lifestyle, unboxing, testimonial, workout, cooking, before-after
- **mood**: energetic, calm, inspirational, funny, serious, casual
- **quality_score**: 1-10 (lighting, stability, audio clarity, framing)
- **has_speech**: boolean + transcript summary of what's said
- **visual_elements**: what's visible (person, product, food, gym, kitchen, nature, etc.)
- **usable_segments**: array of `{start_s, end_s, description}` — best sub-clips with timestamps
- **detailed_description**: 2-3 sentence description of the full clip for AI agents to reference

This rich metadata powers the Asset Curator agent's clip selection. Cost: ~$0.001 per clip (~$0.60/mo at 150 videos/week).

Gemini API key is on a paid Google Cloud project (not free tier).

## Remotion Video Templates
All templates render at 1080x1920 30fps (vertical short-form). Each layout is a React component that takes a `TemplateProps` object containing the full Context Packet, pre-resolved clip paths, whisper transcriptions, logo, and music.

**Available layouts** (mapped by `template_id` in Root.tsx):
- `hook-demo-cta` — Hook → Product demo → CTA (product showcases)
- `hook-listicle-cta` — Hook → Numbered tips with progress bar → CTA (educational/tips)
- `hook-transformation` — Hook → Before/After split-wipe reveal → CTA (fitness/skincare results)

**Reusable components:**
- `CaptionTrack` — Word-by-word captions with 3 animation modes (word-highlight, karaoke, word-pop), spring physics, auto-line grouping
- `HookText` — 5 entrance animations (pop-in, slide-up, typewriter, scale-rotate, glitch), exit fade, text-stroke
- `CTAScreen` — Pulsing action badge, 5 styles (link-in-bio, swipe-up, follow, shop-now, minimal), branded colors
- `LogoWatermark` — Persistent overlay, configurable position/opacity/size
- `TransitionEffect` — 6 types (cut, fade, slide-left, slide-up, zoom, wipe)
- `SegmentVideo` — Handles single or multi-clip segments automatically

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX22, Ubuntu, root user
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && systemctl restart video-factory`
- **Logs**: `journalctl -u video-factory -f`
- **Service**: `systemctl start|stop|restart|status video-factory`
- whisper.cpp installed at `/opt/whisper.cpp/build/bin/whisper-cli` with `base.en` model

## Important Technical Notes
- Upstash Redis requires `tls: {}` and `maxRetriesPerRequest: null` in ioredis config
- BullMQ Queue/Worker instances each need their own Redis connection (no sharing)
- R2 client needs `forcePathStyle: true` and `region: "auto"`
- Job status uses Postgres ENUM — TypeScript `JobStatus` type must exactly match
- Atomic job claiming: `.update({status}).eq('id', jobId).eq('status', fromStatus)` prevents race conditions
- 5 pilot brands are seeded: nordpilates, ketoway, carnimeat, nodiet, highdiet

## Current Build Status
- Phase 1 (Foundation): COMPLETE
  - All config modules (env, supabase, redis, r2) working
  - Type definitions for all 5 DB tables + Context Packet types
  - Job state machine with atomic transitions + event logging
  - R2 storage helpers (upload, download, presign, list)
  - FFmpeg command builders (trim, normalize, audio, export, probe)
  - Connectivity test passes (Supabase 5 brands, Redis PONG, R2 PUT/GET/DELETE)
  - R2 folder structure created for all 5 pilot brands
  - DB schema deployed: 5 tables, indexes, views, triggers, 5 seeded brands
  - SQL migration saved at `src/scripts/migrate.sql`
- Phase 2 (Workers): COMPLETE
  - exec.ts — shared child_process.spawn wrapper
  - ingestion.ts — FFprobe + Gemini clip analyzer + R2 upload + Supabase insert
  - clip-prep.ts — R2 download, trim, normalize (1080x1920/30fps/h264/-14 LUFS)
  - transcriber.ts — whisper.cpp with word-level timestamps, SRT/JSON parsing
  - audio-mixer.ts — UGC audio + background music layering
  - sync-checker.ts — A/V drift detection, auto-retry with offset
  - exporter.ts — TikTok/IG/YouTube encoding + R2 upload
  - qa-checker.ts — 8 automated QA checks
  - **Integration test: 16/16 passed** (FFprobe 4K detection, FFmpeg trim+normalize to 1080x1920, ingestion 70MB→R2+Supabase, presigned URLs, job state transitions+event logging, invalid transition blocking, all 8 QA checks)
  - Filename parser added: extracts brand + description from `{brand}_{desc}.ext`
  - Caption sync checking added: monotonic timestamps, gap detection, word duration validation, clip boundary check
- Phase 2B (Gemini Clip Analyzer): COMPLETE
  - `src/lib/gemini.ts` — Gemini 2.0 Flash video analysis with structured JSON output + validation + fallback
  - Replaces stub AI tagger in ingestion.ts
  - Tested on babies.mov: content_type=lifestyle, mood=casual, quality=7/10, speech detected, 8 visual elements, 1 usable segment identified
  - Cost: ~$0.001/clip ($0.60/mo at scale)
  - `src/scripts/test-gemini.ts` — standalone Gemini test script
- Phase 3 (AI Agents): COMPLETE
  - 3 system prompts: creative-director.md, asset-curator.md, copywriter.md
  - creative-director.ts — idea_seed + brand_config → CreativeBrief (mock + Claude API mode)
  - asset-curator.ts — brief + Supabase assets → ClipSelectionList (mock + Claude API mode)
  - copywriter.ts — brief + brand voice → CopyPackage with platform captions/hashtags/hooks (mock + Claude API mode)
  - context-packet.ts — runs all 3 agents sequentially, merges into immutable ContextPacket, stores in job record
  - ANTHROPIC_API_KEY optional in env — agents auto-fallback to mock mode when missing
  - Normalizer functions handle Claude's varying JSON field names → mapped to exact TypeScript interfaces
  - **Mock test: 28/28 passed** (brief structure, clip selection, copy generation, context packet assembly)
  - **Live API test: 27/27 passed** (Claude Sonnet generates real briefs, copy, hooks — Asset Curator falls back to mock since no assets in DB yet)
- Phase 4 (Remotion Templates): COMPLETE
  - 6 reusable components: CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect, SegmentVideo
  - 3 layout templates: HookDemoCTA, HookListicleCTA, HookTransformation
  - Root.tsx composition registry mapping template_id → layout
  - All layouts are data-driven from ContextPacket + BrandConfig (colors, fonts, animations, positions)
  - 1080x1920 30fps vertical video format
  - CaptionTrack: word-highlight, karaoke, word-pop animations with spring physics
  - HookText: 5 animation types (pop-in, slide-up, typewriter, scale-rotate, glitch)
  - CTAScreen: pulsing action badge, 5 CTA styles (link-in-bio, swipe-up, follow, shop-now, minimal)
  - TransitionEffect: 6 types (cut, fade, slide-left, slide-up, zoom, wipe)
  - HookTransformation: split-wipe before/after reveal with animated divider line
  - HookListicleCTA: numbered items with progress bar per step
  - `npm run build` compiles cleanly
- Phase 5A (Renderer + Server): DEPLOYED AND RUNNING
  - renderer.ts — Remotion render orchestration (download clips → bundle → render → upload to R2)
  - pipeline.ts — Full job lifecycle: planning (3 AI agents) + render pipeline (clip-prep → transcription → rendering → audio-mix → sync-check → export → QA)
  - index.ts — Server entry point, starts 3 BullMQ workers (planning, rendering, ingestion), graceful shutdown on SIGINT/SIGTERM
  - scripts/setup-vps.sh — Automated VPS setup (Node 20, FFmpeg, whisper.cpp, Chromium, systemd service)
  - **Phase 5 test: 28/28 passed locally + 28/28 on VPS**
  - **Live API test: 27/27 on VPS** (Claude Sonnet generating real briefs/copy from server)
  - **Connectivity: 5/5 on VPS** (Supabase 5 brands, Redis PONG, R2 PUT/GET/DELETE)
  - VPS deployed: Hetzner CX22 (2 vCPU, 4GB RAM) at 95.216.137.35
  - Running as systemd service (`video-factory.service`), auto-restart on crash/reboot
  - Worker listening on all 4 queues: ingestion, planning, rendering, export
  - Memory usage: ~142MB (plenty of headroom)
  - GitHub repo: https://github.com/Domis123/video-factory (deploy via `git pull && npm install`)
- Phase 5B (Google Sheets): NEEDS MANUAL SETUP — create spreadsheet + configure tabs
- Phase 5C (n8n Workflows): NEEDS MANUAL SETUP — 10 workflows in n8n UI
- Phase 5D (End-to-end test): PENDING — needs real UGC clips ingested
