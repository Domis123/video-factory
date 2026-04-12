# Video Factory — CLAUDE.md

## Project Overview
Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30-60s) for TikTok/IG/YT. First video delivered end-to-end 2026-04-11 (28 min, ~$0.55/video, peak 265MB RAM). MVP: 3 brands, 1 video type, 5-10 videos/week. Target scale: 30-50 brands, 4 video types, 150-300 videos/week.

## Key Documentation
- **`docs/ARCHITECTURE.md`** — Architecture v3.5. Current source of truth. First video delivered, quality roadmap defined. Supersedes all prior architecture docs.
- **`docs/MVP_PROGRESS.md`** — Day-by-day progress tracker with timing data, outputs, quality roadmap tiers, lessons learned.
- **`docs/VPS-SERVERS.md`** — Infrastructure docs: both VPS servers, deployment, costs, how they work together.
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (17 total, MUST follow)
1. **Google Drive is a drop zone only.** Ingestion copies to R2. The render pipeline NEVER reads from Drive. All clip references use R2 keys.
2. **No long-lived n8n executions.** Every workflow completes immediately. State is persisted to Supabase. New workflows triggered by webhooks.
3. **Supabase is the source of truth.** Sheets is the primary input/view layer for workers. All Sheet edits are validated by n8n before writing to Supabase. Workers never access Supabase directly.
4. **Context Packet is immutable.** 3 agent outputs merge into one JSON in `jobs.context_packet`. Never mutated — replaced entirely on rejection.
5. **Every state transition is logged.** INSERT into `job_events` on every status change where possible.
6. **All workers use TypeScript.** No JavaScript files.
7. **whisper.cpp runs locally** on VPS workers — do NOT use OpenAI Whisper API.
8. **Workers only use Google Drive + Google Sheets.** No terminal, no Supabase, no R2 directly. n8n + VPS handle everything behind the scenes.
9. **Stream large files.** Never `readFile` on uploads. Use `req.pipe(createWriteStream)`.
10. **One ingestion at a time.** Concurrency guard prevents parallel OOM.
11. **Feature flags control quality phases.** Default OFF for untested features.
12. **Hardcode Supabase URL/key in n8n workflows.** No `$env` variables (unreliable in n8n).
13. **Remotion bundles from .tsx source.** Use `extensionAlias` webpack override for `.js` → `.tsx`.
14. **Remotion assets via `publicDir` + `staticFile()`.** Never pass absolute paths or `file://` URLs.
15. **Asset Curator JSON key names vary** — use `Object.values().find()` dynamic extraction.
16. **Create jobs with the status the worker expects** (`planning`, not `idea_seed`).
17. **n8n Sheet writes after HTTP nodes** reach back through `$('Upstream Node').item.json` to avoid losing data to response replacement.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner) — 46.224.56.174
- **Database**: Supabase Postgres (free tier) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required, drainDelay 120s)
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

n8n-workflows/       — Importable n8n workflow JSONs
├── S1-new-job.json          — v2 final ✅ — New job from Sheet → Supabase + BullMQ (30s poll)
├── S2-brief-review.json     — v2 final ✅ — Brief approve/reject → Supabase + BullMQ (30s poll)
├── S3-qa-decision.json      — v1 ⏸ — Needs v2 rebuild
├── S7-music-ingest.json     — v2 ✅ — Drive → VPS ffprobe → R2 → Supabase → Sheet
├── S8-ugc-ingest.json       — v1 manual ✅ — Drive UGC → VPS → R2 → Supabase
├── P2-periodic-sync.json    — v2 ✅ — Active jobs Supabase → Sheet (5min)
├── S4-brand-config.json     — ⏸ deactivated for MVP
├── S5-caption-preset.json   — ⏸ deactivated for MVP
├── S6-music-track.json      — ⏸ deactivated for MVP
├── P1-job-status-push.json  — Webhook: Supabase → Sheet (event-driven)
├── P3-dashboard-refresh.json — ⏸ deactivated for MVP
└── P4-monthly-archive.json  — ⏸ deactivated for MVP
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
- **nordpilates UGC**: `1n0-vMRq0ckgAugGxUlOtY9e942ARpCyZ` (Processed: `1IMQwMD902e2ps7UYZnz1RQhRs3ZEUIhN`)

## n8n Credentials
| ID | Type | Used by |
|---|---|---|
| `AIqzMYUXoQjud7IW` | Google Service Account | S1, S2, P2 (Sheets) |
| `9mzs7zcG6Z9TIcku` | Google OAuth | S7, S8 (Drive) |
| `jPzsu3UPPrZc0kge` | Google Service Account | S7 (Sheet write) |
| `l66cV4Gj1L3T6MjJ` | HTTP Header Auth | Deprecated — workflows use hardcoded headers |

## HTTP API (VPS port 3000)
- `POST /enqueue` — n8n calls this to add jobs to BullMQ queues. Body: `{ queue, jobId }`
- `POST /music-ingest` — n8n S7 sends audio binary. Header: `x-track-meta` (plain JSON or base64-encoded JSON). Returns track record with ID, duration, BPM.
- `POST /ugc-ingest` — n8n S8 sends video binary. Header: `x-asset-meta` (plain JSON or base64-encoded JSON) with `filename`, `brand_id`, optional `description`, `drive_file_id`. Falls back to `{brand_id}_{description}.ext` parsing if header missing. Idempotent on `(filename, brand_id)` — returns `{ok:true, duplicate:true, ...}` for repeats. Streams the request body to a temp file via `req.pipe(createWriteStream(...))` (RAM stays ~64KB regardless of upload size) and rejects payloads >500MB via `Content-Length` check before any I/O. Module-scope concurrency guard still rejects overlapping requests with 503 — keeps Gemini analysis from running in parallel even with the 8GB headroom on the upgraded CX32.
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

## Feature Flags (.env)
See `docs/ARCHITECTURE.md` §9 for full table. MVP state:
- `ENABLE_AUDIO_DUCKING=true` *(active)*
- `ENABLE_CRF18_ENCODING=true` *(active)*
- `ENABLE_BEAT_SYNC=false` — Day 6 target: enable
- `ENABLE_COLOR_GRADING=false` — Day 6 target: enable
- `ENABLE_MUSIC_SELECTION=false` — Day 6 target: enable after music tagging
- `ENABLE_DYNAMIC_PACING=false` — post-MVP
- `FALLBACK_MUSIC_TRACK_ID=f6a6f64f-...` — Die With A Smile 249s

## Quality Roadmap
See `docs/ARCHITECTURE.md` §14 and `docs/MVP_PROGRESS.md` for full tiers. Summary:
- **Tier 1 (Day 6, free):** Tighten curator prompt, pass full Gemini descriptions, enable color grading + beat sync + music selection after tagging 15 tracks. Expected lift: 6/10 → 7.5-8/10.
- **Tier 2 (Day 7-14, ~$15/mo):** Gemini Flash→Pro, pre-normalize at ingestion, CLIP embeddings + pgvector.
- **Tier 3 (Month 2):** Quality Director Agent, multi-language, real logos, A/B variants.

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX32 (4 vCPU, 8GB RAM, 80GB SSD), Ubuntu — upgraded from CX22 on 2026-04-10 for render concurrency headroom
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory`
- **Logs**: `journalctl -u video-factory -f`
- **Service**: `systemctl start|stop|restart|status video-factory`
- whisper.cpp installed at `/opt/whisper.cpp/build/bin/whisper-cli` with `base.en` model

## Important Technical Notes
- Upstash Redis requires `tls: {}` and `maxRetriesPerRequest: null` in ioredis config
- BullMQ drainDelay: 120s between empty-queue polls (~6.5K cmds/day idle, ~195K/mo, well under Upstash 500K free tier limit). 30s burned through the limit in days.
- R2 client needs `forcePathStyle: true` and `region: "auto"`
- Job status uses Postgres ENUM — TypeScript `JobStatus` type must exactly match
- Atomic job claiming: `.update({status}).eq('id', jobId).eq('status', fromStatus)` prevents race conditions
- 5 pilot brands seeded: nordpilates, ketoway, carnimeat, nodiet, highdiet
- Quality upgrade migration applied to Supabase (2026-04-07): new columns on jobs, assets, brand_configs
- **Gemini 4K downscale**: `src/lib/gemini.ts` downscales clips >50MB to 720p (libx264 ultrafast, no audio) before base64-encoding for analysis. Raw 4K UGC (100MB+) balloons to 130MB+ as base64 in the JS heap. Originally added to keep the 4GB CX22 alive; still in place on the CX32 because base64 in V8 is wasteful regardless. Downscale temp files cleaned up in `finally`.
- **UGC ingestion streaming + concurrency guard**: `/ugc-ingest` streams the request body straight to a temp file (`req.pipe(createWriteStream)`) instead of buffering into RAM, rejects payloads >500MB via `Content-Length`, and a module-scope `ugcIngesting` flag still serializes overlapping requests with 503. The streaming fix replaced the original `Buffer.concat` body parser after a 1GB OOM during the 54-clip parallel upload.
- VPS system deps: `ffmpeg`, `chromium-browser`, and whisper.cpp built from source must be installed manually — `apt install ffmpeg chromium-browser` then build whisper.cpp via `cmake -B build && cmake --build build -j2`.

## Current Build Status (MVP per v3, 7-day plan)
- **MVP scope**: 3 brands (nordpilates, ketoway, carnimeat), 1 video type (`tips-listicle`), most quality phases feature-flagged OFF
- **Day 1 — DONE**: S7 music ingest end-to-end green. 15 tracks in R2 + Supabase + Sheet. drainDelay fixed 30→120, fresh Upstash DB.
- **Day 2 — DONE (ingest path)**:
  - VPS `/ugc-ingest` endpoint live with streaming body parser, 500MB cap, idempotency, concurrency guard, 4K→720p downscale before Gemini
  - 1GB OOM root-caused to `Buffer.concat` body parser → fixed via `req.pipe(createWriteStream)` (commit `c4871c4`)
  - S8 n8n workflow shipping real UGC end-to-end
- **Day 3 — DONE (2026-04-10)**:
  - Feature flags wired in `src/config/env.ts` (`ENABLE_BEAT_SYNC`, `ENABLE_COLOR_GRADING`, `ENABLE_MUSIC_SELECTION`, `ENABLE_DYNAMIC_PACING` default false; `ENABLE_AUDIO_DUCKING`, `ENABLE_CRF18_ENCODING` default true; `FALLBACK_MUSIC_TRACK_ID`) — commit `0d0d77f`
  - `context-packet.ts` gates music selection on `ENABLE_MUSIC_SELECTION`, falls back to `FALLBACK_MUSIC_TRACK_ID` row when off; gates dynamic pacing on `ENABLE_DYNAMIC_PACING`
  - `pipeline.ts` gates `colorPreset` passthrough on `ENABLE_COLOR_GRADING`
  - `src/scripts/seed-brand.ts` + `brands/{nordpilates,ketoway,carnimeat}.json` — version-controlled brand_configs upsert (`allowed_video_types: ["tips-listicle"]`)
  - `src/scripts/upload-brand-logos.ts` — generates 512×512 placeholder PNGs via ffmpeg lavfi+drawtext, uploads to `brands/{id}/logo.png`
  - `src/scripts/vps-preflight-live.ts` — read-only health checks (Redis PING, Anthropic, Gemini, R2, Supabase row counts, MVP brand seed verification, FALLBACK_MUSIC_TRACK_ID resolution) — commit `af3f764`
  - **Verified on VPS**: 3 brand_configs upserted (all `tips-listicle`, `warm-vibrant`); 3 placeholder logos uploaded to `brands/{id}/logo.png` (NP/KW/CM, 7-12 KB each); `FALLBACK_MUSIC_TRACK_ID=f6a6f64f-...` resolves to `Lady Gaga, Bruno Mars - Die With A Smile (7clouds)` 249s; preflight green across systemd/ffmpeg/whisper/chromium/Redis/Anthropic/Gemini/R2/Supabase
  - **Live row counts**: 54 `assets` for nordpilates (Day 2 S8 ingest), 15 `music_tracks`, 3 MVP `brand_configs`
- **Day 4 — SHIPPED**: first end-to-end render delivered. nordpilates `tips-listicle` job ran clip-prep → transcription → Remotion render → audio mix → sync check → 3 platform exports (TikTok/Instagram/YouTube) → auto_qa PASSED → human_qa. Quality 6/10. Issues identified for Day 5: missing `preview_url`, whisper extracted full clip instead of segment window, logo not visible in output, asset curator picked off-topic kitchen footage for a pilates video. Earlier Remotion fixes shipped Day 4: `registerRoot` entry, `.js`-extension webpack resolve, `publicDir` + `staticFile` pattern (no more `file://` paths).
- **Day 5 — IN PROGRESS**: 4 fixes batched in one commit:
  - **preview_url**: `pipeline.ts` now generates a 24h presigned R2 URL for the TikTok export and writes it to `jobs.preview_url` between `platform_export` and `auto_qa`. Unblocks P2 sheet sync.
  - **Whisper segment window**: `buildAudioExtractCommand` takes `startSec`/`durationSec`; `transcriber.ts` ffprobes the input clip and clamps audio extraction to the curator-selected window. Threaded `trimStart`/`trimEnd` from `clipPrepResult.preparedClips` → `transcribeAll` → `transcribeClip`. Defends against clip-prep trim failures (e.g. Day 4 seg4: 215s WAV instead of 8s).
  - **Logo visibility**: `LogoWatermark.tsx` now normalizes underscore→hyphen position keys (the seed JSON uses `top_right`, the switch expected `top-right`, so it was silently falling through to `bottom-right`). `renderer.ts` adds existence + size logging for the downloaded logo so future failures land in `journalctl`.
  - **Asset curator topical alignment**: PROMPT-only edit to `src/agents/prompts/asset-curator.md` — added a hard-requirement priority-0 rule that every clip must visually reinforce the video's core topic, with explicit instruction to reduce segments or flag in `notes` rather than pad with off-topic footage.
- **Day 6-7 — pending**: second brand video, decide which quality phase (if any) to enable based on real output

### Whisper bug to fix post-MVP (LOGGED)
> Transcriber extracts audio from the full normalized clip instead of the curator-selected segment window. Segment 4's WAV was 215 seconds long (full clip) instead of 8 seconds (the picked segment start_s=135, end_s=143). The extraction needs `-ss start_s -t (end_s - start_s)` applied. Non-blocking for first video.

**Status (Day 5)**: Identified Day 4, fixed Day 5 in `transcriber.ts` via the segment-window threading above. The clip-prep root cause (why the normalized file came back as the full source) is still unknown — may be an idempotency cache hit on a stale pre-trim file, or `-c copy` keyframe-snap drift, or a missing `clip.trim` field from the curator. The transcriber-side defense-in-depth fix unblocks the user-visible symptom; the clip-prep investigation is a separate post-MVP item.
- **VPS**: 95.216.137.35, **upgraded CX22 → CX32 on 2026-04-10** (4 vCPU, 8GB RAM, 80GB SSD). All endpoints live, ffmpeg 6.1.1 + chromium + whisper.cpp installed. Env flags already set on VPS `.env`.
- **Google Sheets**: "Video Pipeline" spreadsheet, 6 tabs created
- **n8n workflows**: S1-S3 + S7 + P1/P2 active. S4/S5/S6/P3 deactivated for MVP (per v3). S8 (UGC ingest) shipping real assets.
- **DB migrations applied** — base schema + quality upgrade columns
- **Tests**: 98/98 passing (30 mock + 41 quality + 27 live)
