# Video Factory — Step-by-Step Build Plan

## Context
Video Factory is a 95% automated video production pipeline for 30 brands (150 videos/week). All infrastructure (Supabase, Redis, R2, n8n) is live but **zero code exists**. The goal is to build as much as possible while minimizing cost — develop and test locally, defer VPS/API expenses until code is ready.

## Cost-Efficient Build Strategy

| Phase | What | Cost | Can test locally? |
|-------|------|------|-------------------|
| **1. Foundation** | Config, types, lib, connectivity scripts | $0 | Yes |
| **2. Workers** | Ingestion, clip-prep, transcriber, audio, QA, exporter | ~$0 (free tier) | Partially (FFmpeg needed) |
| **2B. Gemini Analyzer** | AI clip analysis during ingestion | ~$0.60/mo | Yes |
| **3. AI Agents** | Creative Director, Asset Curator, Copywriter + prompts | ~$2-5 testing | Yes (mock-first) |
| **4. Remotion Templates** | React video components + layouts | $0 | Yes (Remotion dev server) |
| **5. Renderer + Integration** | Render worker, n8n workflows, Sheets | $30/mo VPS | Needs VPS |

**Architecture adjustment**: Build agent prompts and stubs first, only call Claude API for final integration testing. This saves ~$100/mo during development.

## Overall Progress

| Phase | Status | Tests | Files Built |
|-------|--------|-------|-------------|
| 1. Foundation | ✅ COMPLETE | 5/5 connectivity | 11 files (config, types, lib, scripts) |
| 2. Workers | ✅ COMPLETE | 16/16 pipeline | 9 files (8 workers + exec helper) |
| 2B. Gemini Analyzer | ✅ COMPLETE | Tested on real video | 2 files (gemini.ts + test script) |
| 3. AI Agents | ✅ COMPLETE | 28/28 mock, 27/27 live | 7 files (3 agents + 3 prompts + context-packet) |
| 4. Remotion Templates | ✅ COMPLETE | Build clean | 9 files (6 components + 3 layouts + types + Root) |
| 5A. Renderer + Server | ✅ DEPLOYED | 28/28 + 27/27 live + 5/5 connectivity on VPS | 4 files + VPS running |
| 5B. Google Sheets | ✅ GUIDE READY | — | SHEETS_SETUP.md with 6 tabs, columns, dropdowns |
| 5C. n8n Workflows | ✅ JSONs READY | — | 10 importable workflows in n8n-workflows/ + HTTP API |
| 5D. End-to-end test | PENDING | — | Needs Sheets + n8n imports + real UGC clips |
| 6.0 Video Type Matrix | ✅ COMPLETE | Build clean | video-types.ts, video-type-selector.ts + 5 modified |
| 6.1 Ingestion Enrichment | ✅ COMPLETE | Build clean | clip-analysis.ts, updated ingestion.ts + asset-curator prompt |
| 6.2 Beat-Synced Transitions | ✅ COMPLETE | Build clean | beat-detector.ts, TransitionEffect beat-flash/beat-zoom |
| 6.3 Audio Ducking | ✅ COMPLETE | Build clean | Sidechain compressor in buildAudioMixCommand |
| 6.4 Encoding Upgrade | ✅ COMPLETE | Build clean | CRF 18 + slow, removed -t 60 truncation |
| 6.5 Color Grading | ✅ COMPLETE | Build clean | color-grading.ts, clip-prep grading step |
| 6.6 Music Selection | ✅ COMPLETE | Build clean | music-selector.ts, context-packet integration |
| 6.7 Dynamic Pacing | ✅ COMPLETE | Build clean | template-config-builder.ts, context-packet integration |
| 6.8 Trending Audio | PENDING | — | Manual curation process, pilot on 2-3 brands |
| Redis Fix | ✅ COMPLETE | — | drainDelay 30s (777K→26K cmds/day idle) |
| DB Migration | ✅ APPLIED | — | migrate-quality-upgrade.sql (ran 2026-04-07) |
| Quality Tests | ✅ 98/98 | 30 mock + 41 quality + 27 live | All video type + quality modules verified |

**Total**: ~52 source files + 10 n8n workflow JSONs + 2 SQL migrations.
**Cost to date**: ~$0.15 (Gemini test + Claude API test calls). Production cost: ~$35/mo (VPS $30 + Gemini $0.60 + Claude ~$4).

**Next milestones** (in order):
1. ~~Run `migrate-quality-upgrade.sql` on Supabase~~ ✅ Done
2. Prepare Google Sheets (add new columns: video_type, allowed_video_types, color_grade_preset)
3. Configure n8n workflows (import JSONs, set credentials, test S1 first)
4. Wait for Upstash Redis monthly reset (drainDelay fix means free tier is now sufficient)
5. Upload UGC clips for one pilot brand (nordpilates)
6. Stock music library with 10+ tracks
7. End-to-end test: idea seed → rendered video

---

## Phase 1: Foundation (Build First — Zero Cost) ✅ COMPLETE

### Files created (in dependency order):

**1. Project setup**
- `package.json` — deps: zod, dotenv, @supabase/supabase-js, bullmq, ioredis, @aws-sdk/client-s3, @aws-sdk/lib-storage, @aws-sdk/s3-request-presigner. Dev: typescript, @types/node, tsx
- `tsconfig.json` — target ES2022, module NodeNext, strict, outDir dist
- `.gitignore` — node_modules, dist, .env, /tmp
- `.env` — copy from env.video-factory (gitignored)

**2. `src/config/env.ts`** — Zod-validated env loader. Fail-fast on missing vars. Exports typed `env` object.

**3. `src/types/database.ts`** — TypeScript interfaces for all 5 tables + JobStatus union type + ContextPacket/CreativeBrief/ClipSelectionList/CopyPackage interfaces matching the JSON shapes in the architecture doc.

**4. `src/config/supabase.ts`** — Exports `supabaseAdmin` (service_role key, bypasses RLS). Uses @supabase/supabase-js (not raw REST — typed query builder, auto-headers, atomic update pattern).

**5. `src/config/redis.ts`** — Exports `createQueue()` and `createWorker()` factories. Critical: Upstash needs `tls: {}` and `maxRetriesPerRequest: null`. Each Queue/Worker gets its own ioredis connection (BullMQ requirement). Exports `QUEUE_NAMES = { ingestion, planning, rendering, export }`.

**6. `src/config/r2.ts`** — S3Client pointed at R2 with `forcePathStyle: true`, region `"auto"`.

**7. `src/lib/r2-storage.ts`** — uploadFile, downloadFile, downloadToFile, fileExists, getPresignedUrl, deleteFile, listFiles. Uses multipart upload for files >5MB.

**8. `src/lib/job-manager.ts`** — The core state machine. Exports:
- `VALID_TRANSITIONS` map encoding the full state machine
- `transitionJob(jobId, from, to, details)` — atomic via `.eq('status', fromStatus)`, inserts job_event
- `logEvent(jobId, eventType, details)` — non-transition events
- `claimJob(jobId, from, to, workerId)` — sets render_worker_id

**9. `src/lib/ffmpeg.ts`** — Pure command-string builders (no execution yet). buildTrimCommand, buildNormalizeCommand, buildAudioExtractCommand, buildAudioMixCommand, buildExportCommand, buildProbeCommand. Each returns `{ command, args }`.

**10. `src/scripts/test-connectivity.ts`** — Tests: Supabase (query brand_configs, expect 5 rows), Redis (PING + BullMQ queue test), R2 (PUT/GET/DELETE test file).

**11. `src/scripts/create-r2-structure.ts`** — Creates `.keep` files at assets/, rendered/, brands/, music/, temp/, plus brands/{brand_id}/ for each pilot brand.

### Verification ✅
- `npm run build` — compiles cleanly
- `npm run test:connectivity` — 5/5 passed (Supabase 5 brands, Redis PONG, R2 PUT/GET/DELETE)
- `npm run setup:r2` — 20 folders created across all 5 pilot brands
- DB schema deployed via `src/scripts/migrate.sql` in Supabase SQL Editor

---

## Phase 2: Workers (Minimal Cost) ✅ COMPLETE

All processing workers built and compiling. AI tagger in ingestion is stubbed (replaced in Phase 3).

- `src/lib/exec.ts` — Shared child_process.spawn wrapper for FFmpeg commands
- `src/workers/ingestion.ts` — Drive file → FFprobe metadata → AI tagger (stubbed) → R2 upload → Supabase insert
- `src/workers/clip-prep.ts` — Download from R2, trim, normalize to 1080x1920 30fps h264, audio normalize -14 LUFS
- `src/workers/transcriber.ts` — whisper.cpp integration, word-level timestamps, SRT + JSON parsing
- `src/workers/audio-mixer.ts` — Layer UGC audio + background music, volume ducking per Context Packet
- `src/workers/sync-checker.ts` — Compare whisper timestamps vs video timeline, flag drift >200ms, auto-retry
- `src/workers/exporter.ts` — Platform exports (TikTok <=287MB, IG <=100MB, YT) with R2 upload
- `src/workers/qa-checker.ts` — 8 automated checks (duration, resolution, audio, sync, text readability, logo, black frames, aspect ratio)
- `src/scripts/test-pipeline.ts` — Full integration test (`npm run test:pipeline`)

### Integration Test Results ✅ 16/16 passed
- FFprobe: detected 4K 23s h264 source video
- FFmpeg trim: 3s clip extracted
- FFmpeg normalize: 1080x1920 30fps h264 output verified
- Ingestion: 70MB → R2 upload + Supabase insert
- Presigned URL generation
- Job state machine: 3 transitions + event logging + invalid transition blocked
- QA checker: all 8 checks passed on normalized video
- Cleanup: test data removed from R2 + Supabase

---

## Phase 2B: Gemini Clip Analyzer (replaces stub AI tagger)

Gemini vision model analyzes every UGC clip during ingestion. Extracts:
- content_type, mood, quality_score (1-10)
- has_speech + transcript summary
- visual_elements (person, product, gym, kitchen, etc.)
- usable_segments with timestamps and descriptions
- detailed_description (2-3 sentences for AI agents)

Cost: ~$0.001/clip, ~$0.60/mo at 150 videos/week scale. Paid Google Cloud API key (not free tier).

- `src/lib/gemini.ts` — Gemini 2.0 Flash client + video analysis + validation + fallback
- `src/workers/ingestion.ts` — `stubAiTagger()` replaced with `analyzeClip()` from Gemini
- `src/scripts/test-gemini.ts` — Standalone test script

### Test Results ✅
Tested on 23s 4K babies.mov:
- content_type: lifestyle, mood: casual, quality: 7/10
- Speech detected with summary
- 8 visual elements tagged (person, bed, baby, children, bottle, phone, etc.)
- 1 usable segment identified (0-13s) with description
- Detailed description generated for AI agent reference

---

## Phase 3: AI Agents (Low Cost — Mock First) ✅ COMPLETE

All 3 agents built with dual mode: mock (no API key) and live (Claude Sonnet API). Context Packet merger assembles all outputs into a single immutable artifact.

- `src/agents/prompts/creative-director.md` — System prompt with brand voice, template catalog, trending hooks
- `src/agents/prompts/asset-curator.md` — System prompt for clip selection from asset DB
- `src/agents/prompts/copywriter.md` — System prompt for copy generation per platform
- `src/agents/creative-director.ts` — Takes idea_seed + brand_config → Creative Brief JSON
- `src/agents/asset-curator.ts` — Takes brief + asset query results → Clip Selection List (R2 keys only)
- `src/agents/copywriter.ts` — Takes brief + voice guidelines → Copy Package (overlays, captions, hashtags, hooks)
- `src/agents/context-packet.ts` — Runs all 3 agents, merges into immutable Context Packet, stores in job record
- `src/scripts/test-agents.ts` — Mock mode test (`npm run test:agents`)
- `src/config/env.ts` — Added optional `ANTHROPIC_API_KEY`

### How it works
1. `buildContextPacket(ideaSeed, brandConfig)` runs all 3 agents sequentially
2. Each agent checks for `ANTHROPIC_API_KEY` — if missing, returns realistic mock data
3. If key exists, calls Claude Sonnet API with the system prompt + structured user message
4. All 3 outputs share the same `brief_id` and merge into a `ContextPacket`
5. `planJob(jobId, input)` stores the packet in the `jobs` table

### Mock Test Results ✅ 28/28 passed
- Creative Director: brief_id, brand match, template, 3 segments (hook/body/CTA), duration 30-60s, sub_segments
- Asset Curator: correct brief reference, all segments covered, single + multi-clip, R2 key format
- Copywriter: overlays, 3 platform captions, 5+ hashtags per platform, 3 hook variants with style labels
- Context Packet: ID, all 3 outputs present, brand_config, timestamp, brief_ids match across outputs

### Live API Test Results ✅ 27/27 passed (Claude Sonnet)
- Creative Director: generated `hook-listicle-cta` template, 45s duration, 3 segments, real hook text
- Asset Curator: falls back to mock (no assets in DB yet — expected, will work once clips are ingested)
- Copywriter: platform-specific captions, hashtags, 3 hook variants matching brand's style preferences (pov/question/challenge)
- Context Packet: full assembly with real Claude outputs, all brief_ids match
- Normalizer functions handle Claude's varying JSON field names → mapped to exact TypeScript interfaces
- Sample hook: "POV: Your desk job is ruining your posture"
- Sample CTA: "More desk-friendly stretches in bio ↗️"

---

## Phase 4: Remotion Templates (Free) ✅ COMPLETE

All video templates built as React components. Each layout consumes a Context Packet and renders a full branded video at 1080x1920 30fps. Components are data-driven — all styling, timing, and copy comes from the brand config and Context Packet.

### Shared
- `src/templates/types.ts` — TemplateProps, ResolvedSegment, resolveSegments(), totalFrames()
- `src/templates/Root.tsx` — Remotion composition registry (maps template_id → layout component)

### Components (reusable across layouts)
- `src/templates/components/CaptionTrack.tsx` — Word-by-word animated captions with highlight/pop/karaoke styles, grouped into readable lines, driven by brand caption preset
- `src/templates/components/HookText.tsx` — Hook overlay with 5 animations: pop-in, slide-up, typewriter, scale-rotate, glitch. Tight letter-spacing, text-stroke for readability
- `src/templates/components/CTAScreen.tsx` — End screen with pulsing action badge (link-in-bio/swipe-up/follow/shop-now), brand name, accent color
- `src/templates/components/LogoWatermark.tsx` — Persistent brand logo, configurable position/opacity/size, gentle fade-in
- `src/templates/components/TransitionEffect.tsx` — 6 transition types: cut, fade, slide-left, slide-up, zoom, wipe
- `src/templates/components/SegmentVideo.tsx` — Renders single or multi-clip segments with even duration distribution

### Layouts (one per template_id)
- `src/templates/layouts/HookDemoCTA.tsx` — Hook → Product demo → CTA (showcases, tutorials)
- `src/templates/layouts/HookListicleCTA.tsx` — Hook → Numbered tips with progress bar → CTA (educational, tips)
- `src/templates/layouts/HookTransformation.tsx` — Hook → Before/After split-wipe reveal → CTA (fitness, skincare)

### Verification ✅
- `npm run build` compiles cleanly
- All components are type-safe with TemplateProps
- 3 compositions registered in Root.tsx at 1080x1920 30fps

---

## Phase 5: Renderer + Integration (Needs VPS — $30/mo)

### 5A: VPS + Renderer ✅ CODE COMPLETE

- `src/workers/renderer.ts` — Downloads clips from R2, bundles Remotion, renders composition, uploads to R2
- `src/workers/pipeline.ts` — Full job lifecycle orchestrator (planning → clip-prep → transcription → rendering → audio-mix → sync-check → export → QA). **All workers fully wired** — calls prepareClips, transcribeAll, mixAudio, checkSync, exportPlatforms, runQAChecks.
- `src/index.ts` — Server entry point, starts 3 BullMQ workers (planning, rendering, ingestion), graceful shutdown
- `scripts/setup-vps.sh` — Automated VPS provisioning (Node 20, FFmpeg, whisper.cpp, Chromium deps, systemd service)
- `package.json` — Added `npm start` (dev) and `npm run start:prod` (production)

**Renderer flow:**
1. Downloads all selected clips from R2 to temp dir
2. Downloads logo + music if configured
3. Bundles Remotion project (`@remotion/bundler`)
4. Selects composition by `template_id` from Root.tsx
5. Renders via `renderMedia()` (h264, 1080x1920, 30fps)
6. Uploads rendered MP4 to `rendered/{brand}/{YYYY-MM}/{jobId}.mp4`
7. Cleans up temp files

**Pipeline flow:**
- Planning: idea_seed → 3 AI agents → Context Packet → brief_review
- Rendering: queued → clip-prep → transcription → rendering → audio-mix → sync-check → export → auto-qa → human_qa

**Server startup verified:** `npm start` connects to all 4 BullMQ queues, starts 3 workers, graceful shutdown on SIGINT/SIGTERM.

**VPS deployed:** Hetzner CX22 (2 vCPU, 4GB RAM, Ubuntu 24.04) — ~$4.50/mo
- IP: 95.216.137.35
- Node 20, FFmpeg, whisper.cpp (base.en model), Chromium deps installed
- Code cloned from GitHub, .env configured, npm installed
- Running as systemd service: `video-factory.service` (auto-restart, auto-start on boot)
- All tests passing on VPS: 5/5 connectivity, 28/28 phase5, 27/27 live agents
- GitHub: https://github.com/Domis123/video-factory
- Deploy updates: `cd /home/video-factory && git pull && npm install && systemctl restart video-factory`
- Logs: `journalctl -u video-factory -f`

### Test Results ✅ 36/36 passed
- Redis: PING + all 4 queues accessible (ingestion, planning, rendering, export)
- BullMQ: job enqueue/dequeue/cleanup cycle
- Context Packet: full mock assembly (3 agents → merged packet with segments, clips, copy)
- Job lifecycle: 13 state transitions (idle → delivered) with all events logged to Supabase
- All worker modules verified: renderVideo, runPlanning, runRenderPipeline, prepareClips, transcribeAll, mixAudio, checkSync, exportPlatforms, runQAChecks, allChecksPassed
- Temp dir: create + cleanup cycle
- State machine: terminal states, retry paths, rejection loops all validated
- Cleanup: test data removed from Supabase

### 5B: Google Sheets Admin Panel ✅ GUIDE READY

Full setup guide in `SHEETS_SETUP.md`. Single spreadsheet with 6 tabs:
1. **Jobs tab** — Create ideas, review briefs, approve QA (polled 30s). 19 columns with dropdowns.
2. **Brands tab** — Colors, fonts, CTA style, voice guidelines (polled 5min). 22 columns with hex validation.
3. **Caption Presets tab** — Flattened JSONB (20 cols), n8n reassembles to nested JSON.
4. **Music Library tab** — Add/tag tracks, mood/genre/energy dropdowns. 12 columns.
5. **Templates tab** — Reference + allowed brands per template. Read-only.
6. **Dashboard tab** — Read-only stats from `v_brand_stats` (refreshed 5min). 8 columns.

**To complete**: Create the spreadsheet following SHEETS_SETUP.md, share with n8n service account, add GOOGLE_SHEET_ID to .env.

### 5C: n8n Workflows ✅ JSONs READY

All 10 workflows are importable JSON files in `n8n-workflows/`:

**Sheet → Supabase (6 workflows):**
- `S1-new-job.json` — Polls Jobs sheet every 30s for new idea seeds, validates brand, creates job in Supabase
- `S2-brief-review.json` — Polls for approve/reject decisions, updates Supabase, enqueues rendering via HTTP API
- `S3-qa-decision.json` — Polls for QA decisions, routes rejects to planning or re-render based on issue type
- `S4-brand-config.json` — Polls Brands sheet every 5min, validates hex colors/ranges, updates Supabase
- `S5-caption-preset.json` — Polls Caption Presets, reassembles 20 flat columns into nested JSONB, updates Supabase
- `S6-music-track.json` — Polls Music Library for new tracks, inserts to Supabase, writes back Track ID

**Supabase → Sheet (4 workflows):**
- `P1-job-status-push.json` — Webhook endpoint, fetches job from Supabase, maps to Sheet columns
- `P2-periodic-sync.json` — Every 5min catch-up: syncs all active jobs from Supabase to Sheet
- `P3-dashboard-refresh.json` — Every 5min: fetches v_brand_stats + active counts, rebuilds Dashboard tab
- `P4-monthly-archive.json` — 1st of month: archives delivered/failed jobs to monthly tab

**HTTP API added to index.ts:**
- `POST /enqueue` — n8n calls this to add jobs to BullMQ queues (body: `{ queue, jobId }`)
- `GET /health` — Health check endpoint
- Port configurable via `API_PORT` env var (default 3000)

**To complete**: Import JSONs into n8n, configure Google Sheets + Supabase credentials, set env vars (GOOGLE_SHEET_ID, SUPABASE_URL, SUPABASE_ANON_KEY).

### 5D: End-to-end test with pilot brands

---

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Supabase client | @supabase/supabase-js | Typed queries, auto-headers, atomic update maps to PostgREST |
| Module system | ESM (type: module) | Modern standard, required by some deps |
| State machine | App-level TypeScript | Easier to debug than Postgres triggers; atomic DB update prevents races |
| FFmpeg in Phase 1 | Command builders only (pure functions) | Testable without FFmpeg installed |
| BullMQ connections | Fresh ioredis per Queue/Worker | BullMQ requires separate connections |
| Agent development | Mock-first | Saves ~$100/mo during dev; prompts are free to iterate |
| Worker interface | Google Sheets (not web dashboard) | Zero learning curve, workers already know Sheets, n8n has native Sheets integration |
| Sheets sync | n8n polling (not Apps Script) | Simpler, no external script to maintain, sufficient for 150 videos/week throughput |
| JSONB flattening | Separate Caption Presets tab | 20 nested fields too many for Brands tab; comma-separated for simple arrays |
