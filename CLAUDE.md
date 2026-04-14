# Video Factory — CLAUDE.md

## Project Overview
Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30-60s) for TikTok/IG/YT. Phase 1 (ingestion overhaul) shipped: 182 sub-clip segments with CLIP embeddings + Gemini 3.1 Pro analysis across 52 nordpilates clips. Phase 2 (curator overhaul) shipped + LIVE: asset-curator-v2 with pgvector retrieval + on-the-fly trim + Gemini Pro picking + self-critique, `ENABLE_CURATOR_V2=true` (flipped 2026-04-13 13:46 UTC). Phase 2.5 shipped + LIVE: pre-trimmed 720p clips at ingestion + backfill complete (182/182 segments carry `clip_r2_key`, 355 MB added to R2). Curator wall time 261s (4.4 min), 9-10/10 in isolated test. **First V2 production video rendered 2026-04-14, rated 4-5/10** — V2 works correctly, ceiling now set by library content gap + Creative Director monotony + template monotony. Phase 3 (CD archetype + Remotion variants + pre-normalization) is the next biggest quality unlock. MVP: 3 brands, 1 video type, 5-10 videos/week. Target scale: 30-50 brands, 4 video types, 150-300 videos/week.

## Key Documentation
- **`docs/VIDEO_PIPELINE_ARCHITECTURE_v3_9.md`** — Architecture v3.9. Current source of truth. Phase 1+2+2.5 shipped and live; first V2 video diagnosed. Supersedes v3.8.
- **`docs/MVP_PROGRESS (6).md`** — Day-by-day progress tracker with timing data, Phase 1/2/2.5 results, first V2 video diagnosis (4-5/10), cleanup commit queue, Phase 3 plan. Supersedes (5).
- **`docs/AGENT_CONTEXT_UPDATE.md`** — Operator handoff note after Phase 2+2.5 ship with session recap, known issues (503 retry needed, Zod schema-aware retry), and rules about what NOT to touch.
- **`docs/PHASE_2_CURATOR_BRIEF.md`** — Historical (Phase 2 agent brief, fully implemented). Keep for reference.
- **`docs/VPS-SERVERS.md`** — Infrastructure docs: both VPS servers, deployment, costs, how they work together.
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (23 total, MUST follow)
1. **Google Drive is a drop zone only.** Ingestion copies to R2. The render pipeline NEVER reads from Drive. All clip references use R2 keys.
2. **No long-lived n8n executions.** Every workflow completes immediately. State is persisted to Supabase. New workflows triggered by webhooks.
3. **Supabase is the source of truth.** Sheets is the primary input/view layer for workers. All Sheet edits are validated by n8n before writing to Supabase. Workers never access Supabase directly.
4. **Context Packet is immutable.** 3 agent outputs merge into one JSON in `jobs.context_packet`. Never mutated — replaced entirely on rejection.
5. **Every state transition is logged.** INSERT into `job_events` on every status change where possible.
6. **All workers use TypeScript.** No JavaScript files.
7. **whisper.cpp runs locally** on VPS workers — do NOT use OpenAI Whisper API.
8. **Stream large files.** Never `readFile` on uploads. Use `req.pipe(createWriteStream)`.
9. **One ingestion at a time.** Concurrency guard prevents parallel OOM.
10. **Feature flags control quality phases.** Default OFF for untested features.
11. **Hardcode Supabase URL/key in n8n workflows.** No `$env` variables (unreliable in n8n).
12. **Remotion bundles from .tsx source.** Use `extensionAlias` webpack override for `.js` → `.tsx`.
13. **Remotion assets via `publicDir` + `staticFile()`.** Never pass absolute paths or `file://` URLs.
14. **Asset Curator JSON key names vary** — use `Object.values().find()` dynamic extraction.
15. **Create jobs with the status the worker expects** (`planning`, not `idea_seed`).
16. **n8n Sheet writes after HTTP nodes** reach back through `$('Upstream Node').item.json` to avoid losing data to response replacement.
17. **Supabase needs permissive RLS policies** for anon writes OR service role key.
18. **Embeddings are self-hosted only.** No external embedding APIs. CLIP runs in `@xenova/transformers` on the VPS, costs zero.
19. **Match models to weakness, not vendor enthusiasm.** Sonnet stays at Creative Director and Copywriter. Gemini Pro takes ingestion and curator. Don't swap models without evidence of weakness.
20. **Pin Gemini model IDs in env vars.** Preview suffixes mean availability may shift before GA.
21. **Pre-trim expensive transforms at ingestion when the output is cacheable and the input fits in storage.** Pay once per source file, not per render. (Phase 2.5 pattern; applies to Phase 3 pre-normalization.)
22. **Never trust `CREATE OR REPLACE FUNCTION` for return-type changes.** Always `DROP FUNCTION` + `CREATE FUNCTION` + `NOTIFY pgrst, 'reload schema'` for RPC migrations that touch return signature.
23. **Drop approximate vector indexes at small table sizes.** ivfflat cell centroids become stale as rows grow. Sequential scan beats them until `lists ≈ rows / 1000` is meaningful.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner) — 46.224.56.174
- **Database**: Supabase Postgres (free tier, pgvector enabled) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required, drainDelay 120s)
- **Storage**: Cloudflare R2 (S3-compatible, zero egress) — clips + keyframes + rendered videos
- **Creative Director**: Claude Sonnet 4.6 (planning structure)
- **Copywriter**: Claude Sonnet 4.6 (hooks, CTAs, captions)
- **Asset Curator V1**: Claude Sonnet 4.6 (text-based, legacy `assets` table) — emergency fallback only, NOT called in production (flag is true)
- **Asset Curator V2**: Gemini 3.1 Pro Preview — LIVE in production. CLIP retrieval via `match_segments` RPC → FAST PATH R2 fetch of pre-trimmed clip (Phase 2.5) → Pro pick → self-critique. Dispatched via `asset-curator-dispatch.ts`, which is imported by `context-packet.ts`.
- **Ingestion Analyzer**: Gemini 3.1 Pro Preview (sub-clip segment analysis, Phase 1 shipped)
- **Legacy Clip Analyzer**: Gemini Flash (still writes legacy `assets` row)
- **Embeddings**: CLIP ViT-B/32 via `@xenova/transformers` (self-hosted, 512-dim) + Supabase pgvector
- **Transcription**: whisper.cpp (self-hosted on render workers)
- **Video Templates**: Remotion (React-based)
- **Video Processing**: FFmpeg
- **Admin Panel**: Google Sheets ("Video Pipeline" spreadsheet)

## Cost Accounting
**Gemini API is currently free for this project via company credits — DO NOT factor Gemini costs into per-video or per-month totals.** Only Claude Sonnet costs (Creative Director + Copywriter, ~$0.25/video) count against the real budget. Revisit if the company credit arrangement ends.

Applies to: Gemini 3.1 Pro ingestion (segment analysis + CLIP embedding via local @xenova/transformers which is already free), Gemini 3.1 Pro curator V2 (pick + critique). The "~$0.75/video" number cited in earlier docs assumed paid Gemini — real out-of-pocket cost is ~$0.25/video while credits last.

## Database Tables
- `brand_configs` — Brand settings, colors (regex-validated hex), fonts, caption presets, voice guidelines, allowed_video_types, color_grade_preset
- `assets` (53 rows) — Ingested UGC clips with AI-generated tags, quality scores, usable segments, dominant_color_hex, motion_intensity, avg_brightness. Parent table for `asset_segments`. Legacy Gemini Flash catalog, stays as-is.
- `asset_segments` (182 rows, Phase 1+2.5 complete — all rows have `clip_r2_key` populated) — Sub-clip segments with rich Gemini 3.1 Pro descriptions, visual_tags, best_used_as, segment_type (8-value taxonomy), motion_intensity, has_speech, quality_score, keyframe_r2_key, **clip_r2_key (Phase 2.5: pre-trimmed 720p CRF 28, ~5MB, uploaded at ingestion, at R2 path `segments/{brand_id}/{segment_uuid}.mp4`)**, CLIP embedding `VECTOR(512)` (L2 normalized). Queried via `match_segments` RPC (migration 005) for cosine similarity + brand/type/quality filters. **ivfflat index was dropped** — at 182 rows stale centroids routed text queries into empty cells; sequential scan is fast enough until ~1000 rows.
- `jobs` — Video production jobs with full state machine (ENUM `job_status`), video_type
- `job_events` — Event log for every state transition, error, retry, timeout
- `music_tracks` (15 rows) — Licensed background music, mood-tagged, energy_level, tempo_bpm

### Segment Type Taxonomy
| type | semantics | avg quality |
|---|---|---|
| `exercise` | Actively performing a movement, rep, or pose | 8.2 |
| `hold` | Static pose for form demonstration | 7.7 |
| `talking-head` | Subject speaking to camera | 7.7 |
| `cooldown` | Post-work stretching/recovery | 7.2 |
| `b-roll` | Ambient/cutaway, no instructional intent | 6.7 |
| `setup` | Pre-exercise: arriving, adjusting, phone | 5.6 |
| `transition` | Moving between exercises, brief pause | 5.6 |
| `unusable` | Blurry, off-frame, corrupted | 1.9 |

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
├── config/          — env.ts (flags + WHISPER paths), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (all DB + Context Packet types), video-types.ts (VideoType configs)
├── lib/             — ffmpeg.ts, gemini.ts (Flash legacy),
│                      gemini-segments.ts (Phase 1, Pro),
│                      clip-embed.ts (Phase 1, @xenova/transformers),
│                      keyframe-extractor.ts (Phase 1),
│                      segment-processor.ts (Phase 1+2.5, shared helper, now pre-trims 720p clips),
│                      segment-trimmer.ts (Phase 2, FAST/SLOW path + parent cache + Gemini upload),
│                      r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts, music-selector.ts,
│                      template-config-builder.ts, clip-analysis.ts,
│                      video-type-selector.ts
├── workers/         — ingestion.ts (Phase 1 extended), clip-prep.ts, transcriber.ts,
│                      audio-mixer.ts, sync-checker.ts, exporter.ts, qa-checker.ts,
│                      renderer.ts, pipeline.ts, music-ingest.ts
├── agents/
│   ├── prompts/     — creative-director.md, asset-curator.md, copywriter.md,
│   │                  segment-analyzer.md (Phase 1),
│   │                  asset-curator-v2.md (Phase 2)
│   ├── creative-director.ts (Sonnet), asset-curator.ts (V1 Sonnet),
│   │   asset-curator-v2.ts (Phase 2, Pro), asset-curator-dispatch.ts (Phase 2),
│   │   curator-v2-retrieval.ts (Phase 2, CLIP → match_segments RPC),
│   │   copywriter.ts (Sonnet)
│   └── context-packet.ts  — runs all 3 agents, merges into Context Packet (routes curator through dispatcher)
├── templates/
│   ├── types.ts     — TemplateProps, ResolvedSegment, helpers
│   ├── Root.tsx     — Remotion composition registry (registerRoot)
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect, SegmentVideo
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
├── index.ts         — HTTP API + BullMQ workers
├── scripts/         — seed-brand.ts, upload-brand-logos.ts, test-*,
│                      backfill-segments.ts (Phase 1), test-clip.ts (Phase 1),
│                      test-segment-analyzer.ts (Phase 1),
│                      test-segment-trimmer.ts (Phase 2),
│                      test-curator-v2.ts (Phase 2),
│                      backfill-segment-clips.ts (Phase 2.5),
│                      migrations/001_asset_segments.sql,
│                      migrations/002_asset_segments_type.sql,
│                      migrations/003_match_segments_function.sql (Phase 2),
│                      migrations/004_asset_segments_clip_key.sql (Phase 2.5),
│                      migrations/005_match_segments_with_clip_key.sql (Phase 2.5)
└── brands/          — nordpilates.json, ketoway.json, carnimeat.json

n8n-workflows/       — Importable n8n workflow JSONs
├── S1-new-job.json          — v2 final ✅
├── S2-brief-review.json     — v2 final ✅
├── S3-qa-decision.json      — v1 ⏸ — Needs v2 rebuild
├── S7-music-ingest.json     — v2 ✅
├── S8-ugc-ingest.json       — v1 manual ✅ — Backend now writes segments; interface unchanged
├── P2-periodic-sync.json    — v2 ✅
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
- `POST /ugc-ingest` — n8n S8 sends video binary. Header: `x-asset-meta` (plain JSON or base64-encoded JSON) with `filename`, `brand_id`, optional `description`, `drive_file_id`. Falls back to `{brand_id}_{description}.ext` parsing if header missing. Idempotent on `(filename, brand_id)` — returns `{ok:true, duplicate:true, ...}` for repeats. Streams the request body to a temp file via `req.pipe(createWriteStream(...))` (RAM stays ~64KB regardless of upload size) and rejects payloads >500MB via `Content-Length` check before any I/O. Module-scope concurrency guard still rejects overlapping requests with 503 — keeps Gemini analysis from running in parallel even with the 8GB headroom on the upgraded CX32. **Phase 1:** After legacy `assets` row insert, runs Gemini Pro segment analysis + CLIP embedding → writes `asset_segments` rows. Non-blocking: segmentation failure doesn't break ingestion.
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
npm run test:clip          # CLIP embedder test (identity, semantic, cross-modal checks)
npm run test:segment-analyzer  # Gemini Pro segment analyzer test (ffprobe, segments, types, keyframes)
npm run test:segment-trimmer   # FAST/SLOW path trimmer test (size bounds, Gemini upload)
npm run test:curator-v2    # End-to-end 5-slot curator V2 test against live DB (no render, no job row)
npm run backfill:segments  # Backfill asset_segments for existing assets (idempotent, interactive)
npm run backfill:clips     # Phase 2.5: backfill clip_r2_key (pre-trimmed 720p clips) for existing segments
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
See `docs/VIDEO_PIPELINE_ARCHITECTURE_v3_9.md` §9 for full table. Current state:
- `ENABLE_AUDIO_DUCKING=true` *(active)*
- `ENABLE_CRF18_ENCODING=true` *(active)*
- `ENABLE_BEAT_SYNC=true` *(active — Day 6)*
- `ENABLE_COLOR_GRADING=true` *(active — Day 6)*
- `ENABLE_MUSIC_SELECTION=true` *(active — Day 6)*
- `ENABLE_DYNAMIC_PACING=false` — post-MVP
- `ENABLE_CURATOR_V2=true` *(LIVE — flipped 2026-04-13 13:46 UTC)*
- `GEMINI_INGESTION_MODEL=gemini-3.1-pro-preview` — segment analyzer model
- `GEMINI_CURATOR_MODEL=gemini-3.1-pro-preview` — curator V2 picker + critique model (defaults to ingestion model if unset)
- `FALLBACK_MUSIC_TRACK_ID=f6a6f64f-...` — Die With A Smile 249s (deprecated post-selector)

## Quality Roadmap
See `docs/VIDEO_PIPELINE_ARCHITECTURE_v3_9.md` §12 and `docs/MVP_PROGRESS (6).md` for full details. Summary:
- **Tier 1 (Day 6):** ✅ DONE — Music tagging, color grading, beat sync, music selection all enabled.
- **Phase 1 — Ingestion Overhaul:** ✅ DONE (2026-04-13) — pgvector + `asset_segments` + Gemini Pro analysis + CLIP embeddings. 182 segments across 53 clips, ~98% success, $3.47 cost.
- **Phase 2 — Curator Overhaul:** ✅ DONE + LIVE (2026-04-13) — `asset-curator-v2.ts` + dispatcher + retrieval + trimmer with per-slot CLIP retrieval, type+quality filters, on-the-fly ffmpeg trim, Gemini Pro pick + self-critique, parent cache, variety preference. Validated at 9-10/10 on all 5 test slots, ~$0.20/video incremental.
- **Phase 2.5 — Pre-trim optimization:** ✅ DONE + LIVE (2026-04-13) — Ingestion pre-trims 720p CRF 28 clips to R2 at `segments/{brand}/{uuid}.mp4`, recorded in `asset_segments.clip_r2_key`. Trimmer FAST PATH streams ~5MB instead of downloading full parent + ffmpeg. Backfill complete: 182/182 segments, 355 MB, 25m 26s, $0 (local ffmpeg only). Curator wall time: 17.9 min → **4.4 min** (4.1× speedup).
- **Phase 2 production validation:** ✅ DONE (2026-04-14) — First V2 video rendered (job `d74679d2-...`, "5 min pilates abs burner"), rated **4-5/10**. V2 architecture works as designed; rating cap surfaced three other bottlenecks (library content gap, Creative Director monotony, Remotion template monotony). See `MVP_PROGRESS (6).md` for diagnosis.
- **Cleanup commit (next):** ⏳ QUEUED — centralized retry helper (`src/lib/retry-llm.ts`) for 429/502/503/504/529/network, schema-aware Zod retry on V2 picker, V2 prompt update (segment_id dedup + visual variety), `brief_summary` column in Jobs sheet via S2 workflow update, push `phase2-complete` tag.
- **Content sprint (this week):** ⏳ QUEUED — ingest 15-20 more nordpilates ab/core UGC clips to unblock library ceiling on abs videos.
- **Phase 3 (Week 3, biggest remaining quality unlock):** ⏳ PLANNED — Creative Director archetype (`calm-instructional`, `high-energy-listicle`, `transformation-story`, `tip-stack`, `before-after`, `myth-buster`) + `energy_curve` + variable `slot_count` (3–8) + per-slot `cut_style`/`duration_target_s`/`energy_level`; 2-3 Remotion template variants per video type; pre-normalization at ingestion (drops clip prep 6-17 min → ~1 min). Target 7+/10 sustained.
- **Week 4+:** Second brand (ketoway) + stabilization. Target: 8/10 across brands.

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX32 (4 vCPU, 8GB RAM, 80GB SSD), Ubuntu — upgraded from CX22 on 2026-04-10 for render concurrency headroom
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory` (`npm install` matters when new deps are added, e.g. `@xenova/transformers` in Phase 1)
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
- **Shared segment processor**: `src/lib/segment-processor.ts` — `processSegmentsForAsset()` handles keyframe extraction, CLIP embedding, R2 upload, DB insert, AND (Phase 2.5) pre-trim of 720p CRF 28 clips uploaded to `segments/{brand}/{uuid}.mp4`. Clip-trim failure is non-fatal: `clip_r2_key` stays null and the curator falls back to SLOW path. Single code path prevents drift between live ingestion and backfill.
- **Backfill idempotency**: `backfill-segments.ts` uses set subtraction (all assets minus those with existing segment rows) — safe to re-run after partial failures. Serial processing with 2s sleep avoids Gemini rate limits. `backfill-segment-clips.ts` (Phase 2.5) uses `WHERE clip_r2_key IS NULL` — same idempotency pattern, with parent caching so each 4K source is only downloaded once across its segments.
- **Gemini Files API flow**: `gemini-segments.ts` uploads video via Files API, polls until ACTIVE, analyzes, deletes in `finally`. Avoids base64 heap pressure for segment analysis. `segment-trimmer.ts` reuses the same upload+cleanup pattern for candidate clips during curator V2.
- **Curator V2 two-path trim**: `segment-trimmer.ts` FAST PATH streams the pre-trimmed 720p file (~5MB) from R2 when `clip_r2_key` is set. Falls through to SLOW PATH (download parent + ffmpeg encode) if R2 fetch fails or the column is null. Both paths end with the same TrimmedSegment contract so the picker doesn't care which was used. Parent downloads are cached across slots in a shared `Map<r2Key, localPath>` cleaned up in the outermost finally.
- **Curator V2 variety**: prompt receives `{previously_picked_parents}` and is instructed to STRONGLY prefer different parent clips across slots. Test softens duplicate assertion to warn-only when 3+ slots share a parent (2 sharing is acceptable given 53-clip library). Verified in validation: Pro reasoning strings explicitly mention "avoiding previously used parent".
- **`match_segments` RPC accepts TEXT not VECTOR**: supabase-js doesn't reliably serialize vectors to pgvector types, so the function takes a string and casts to `vector(512)` internally (migration 005). Do NOT "fix" this signature.
- **ivfflat index is deliberately absent**: dropped when stale centroids routed CLIP text queries into empty cells at 182 rows. Sequential scan is fast enough. Recreate with `lists ≈ rows/1000` when library hits ~1000 rows. Migration 003 header documents this.
- **CREATE OR REPLACE FUNCTION silently fails on return-type changes**: any RPC migration that adds/removes a RETURNS TABLE column needs `DROP FUNCTION IF EXISTS ...` first, then CREATE, then `NOTIFY pgrst, 'reload schema'`. Bit us on migration 005.
- **Known gaps (filed, non-blocking)**: Gemini Pro Preview returns 503 occasionally — retry-once-with-exponential-backoff pending in a cleanup commit. Zod validation failures on picker output do blind retry instead of schema-aware retry — also pending cleanup.
- VPS system deps: `ffmpeg`, `chromium-browser`, and whisper.cpp built from source must be installed manually — `apt install ffmpeg chromium-browser` then build whisper.cpp via `cmake -B build && cmake --build build -j2`.

## Current Status
- **Phase 1 shipped (2026-04-13).** 182 segments across 53 clips, CLIP retrieval validated.
- **Phase 2 shipped + LIVE (2026-04-13 13:46 UTC).** Curator V2 is the default in production. `feat/curator-v2` merged to main on VPS. Service restarted clean. Tag `phase2-complete` pending push from laptop (VPS lacks GitHub credentials).
- **Phase 2.5 shipped + LIVE (2026-04-13).** Pre-trim at ingestion. Backfill complete: 182/182 segments, 355 MB to R2, $0 cost. Curator wall time 17.9 min → 4.4 min. Test picks 9-10/10 on all slots, 5/5 unique parents.
- **Phase 2 production validated (2026-04-14).** First V2 video rendered (job `d74679d2-3c62-4e10-8e03-6da774b55dc1`, "5 min pilates abs burner", nordpilates, 35s, 5 segments). End-to-end ~16 min (planning ~5 min, render + export the rest). Rated **4-5/10** by operator. V2 worked correctly; rating ceiling is from three layers below the picker.
- **Diagnosis of 4-5/10**: (1) library content gap — only ~3-6 truly ab-focused segments in nordpilates; Pro cannot pick clips that don't exist; (2) Creative Director monotony — CD makes only 3 decisions (video type, brief, template), so different briefs produce structurally identical videos; (3) V2 prompt gap — variety preference prevents same-parent reuse but allows visually similar segments across slots.
- **Next action**: cleanup commit (retry helper + Zod schema-aware retry + V2 prompt fix for visual variety + `brief_summary` sheet column + push `phase2-complete` tag). Then content sprint (ingest 15-20 more ab/core UGC). Then Phase 3 (CD archetype + Remotion template variants + pre-normalization at ingestion). Do NOT roll back V2 — it is strictly better than V1.
- **Data**: 53 assets (nordpilates), 182 asset_segments (all with clip_r2_key), 15 music_tracks, 3 brand_configs, 3+ jobs (including first V2 production render).
- **n8n workflows**: S1 v2 ✅, S2 v2 ✅ (needs `brief_summary` column added in cleanup commit), S3 v1 ⏸ (needs v2 rebuild before first `delivered`), S7 v2 ✅, S8 v1 ✅ (manual, backend writes pre-trimmed clips), P2 v2 ✅.
- **Total infra**: ~€15/mo + ~$0.75/video (CD + Copywriter $0.25 Sonnet, curator V2 $0.20 Pro, ingestion $0.06/clip amortized).
