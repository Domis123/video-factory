# Video Factory — CLAUDE.md

## Project Overview
Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30-60s) for TikTok/IG/YT. Phase 1 (ingestion overhaul) shipped: 182 sub-clip segments with CLIP embeddings + Gemini 3.1 Pro analysis across 53 nordpilates clips. Phase 2 (curator overhaul) shipped + LIVE: asset-curator-v2 with pgvector retrieval + on-the-fly trim + Gemini Pro picking + self-critique, `ENABLE_CURATOR_V2=true` (flipped 2026-04-13 13:46 UTC). Phase 2.5 shipped + LIVE: pre-trimmed 720p clips at ingestion + backfill complete (182/182 segments carry `clip_r2_key`, 355 MB added to R2). Phase 2 cleanup shipped (commit `269ff99`, tag `phase2-complete`): retry helper, Zod corrective retry on V2, full_brief column, V2 prompt soft variety, S1 runaway loop fix. **Phase 3 W1 shipped 2026-04-15 (commit `df6a326`, tag `phase3-w1-complete`)**: Creative Director rewrite behind `ENABLE_PHASE_3_CD` flag (default false). New schema: creative_vision + slot_count 3-12 + per-slot energy/transition/cut style + 8 color treatments + brand-restricted color palette. Dispatcher pattern preserves Phase 2 path for instant rollback. Downstream Phase 3 consumers (W2 Curator update, W3 Copywriter, W4 Remotion) not yet shipped — flipping the flag throws on the Phase 3 path until those land. MVP: 3 brands, 1 video type, 5-10 videos/week. Target scale: 30-50 brands, 4 video types, 150-300 videos/week.

## Key Documentation
- **`docs/VIDEO_PIPELINE_ARCHITECTURE_v5_0.md`** — Architecture v5.0. Current source of truth. Phase 1+2+2.5+Phase 2 cleanup+Phase 3 W1 shipped and live (Phase 3 W1 behind flag). Supersedes v4.0.
- **`docs/PHASE_3_DESIGN.md`** — Phase 3 master design doc, source of truth for all Phase 3 work. W1 marked ✅ shipped; W2-W5 still planned.
- **`docs/MVP_PROGRESS (7).md`** — Day-by-day progress tracker with timing data, Phase 1/2/2.5 results, first V2 video diagnosis (4-5/10), Phase 3 W1 ship report. Supersedes (6).
- **`docs/SUPABASE_SCHEMA.md`** — DB schema reference, verified columns, migration history through 006.
- **`docs/AGENT_CONTEXT_UPDATE.md`** — Operator handoff note after Phase 2+2.5 ship with session recap, known issues, and rules about what NOT to touch. Historical.
- **`docs/PHASE_2_CURATOR_BRIEF.md`** — Historical (Phase 2 agent brief, fully implemented). Keep for reference.
- **`docs/VPS-SERVERS.md`** — Infrastructure docs: both VPS servers, deployment, costs, how they work together.
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (28 total, MUST follow)
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
24. **Composition is parameterized, not template-instanced.** Phase 3 ships one Remotion composition that reads a brief and renders accordingly. Do not author multiple template variants. Variety comes from CD decisions, not template selection.
25. **Brand consistency lives in small surface area.** Only logo, color palette restrictions (`allowed_color_treatments`), and caption preset are brand-locked. Everything else (cut style, slot count, transitions, energy curve, vibe) is free per video.
26. **Hybrid structured + free-text fields where LLMs and code both consume the data.** Structured fields for code to act on deterministically. Free-text fields for downstream LLM agents to read for nuance.
27. **Defer polish features in favor of variety features.** Beat-locked music, music ducking, overlay timing sophistication, reference-guided generation — all parked for later phases. Quality variety improvements ship before quality polish improvements.
28. **Clean-slate ingestion when content sprint is incoming.** Don't migrate existing segments to new pipelines when fresh content is about to land anyway. Operator effort goes into new uploads, not data migration.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner) — 46.224.56.174
- **Database**: Supabase Postgres (free tier, pgvector enabled) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required, drainDelay 120s)
- **Storage**: Cloudflare R2 (S3-compatible, zero egress) — clips + keyframes + rendered videos
- **Creative Director**:
  - **Phase 2 (live default)**: Claude Sonnet 4.6, `generateBriefPhase2` in `src/agents/creative-director.ts`
  - **Phase 3 (behind flag)**: Claude Sonnet 4.6, `generateBriefPhase3` in `src/agents/creative-director-phase3.ts`. Zod corrective retry. Routed via `creative-director-dispatch.ts` based on `ENABLE_PHASE_3_CD`.
- **Copywriter**: Claude Sonnet 4.6 (hooks, CTAs, captions). Phase 3 will own per-slot overlay text generation (W3, not yet shipped).
- **Asset Curator V1**: Claude Sonnet 4.6 (text-based, legacy `assets` table) — emergency fallback only, NOT called in production (flag is true)
- **Asset Curator V2**: Gemini 3.1 Pro Preview — LIVE in production. CLIP retrieval via `match_segments` RPC → FAST PATH R2 fetch of pre-trimmed clip (Phase 2.5) → Pro pick → self-critique. Dispatched via `asset-curator-dispatch.ts`.
- **Ingestion Analyzer**: Gemini 3.1 Pro Preview (sub-clip segment analysis, Phase 1 shipped)
- **Legacy Clip Analyzer**: Gemini Flash (still writes legacy `assets` row)
- **Embeddings**: CLIP ViT-B/32 via `@xenova/transformers` (self-hosted, 512-dim) + Supabase pgvector
- **Transcription**: whisper.cpp (self-hosted on render workers)
- **Video Templates**: Remotion (React-based) — Phase 3 W4 will replace templated layouts with single parameterized composition
- **Video Processing**: FFmpeg
- **Admin Panel**: Google Sheets ("Video Pipeline" spreadsheet)

## Cost Accounting
**Gemini API is currently free for this project via company credits — DO NOT factor Gemini costs into per-video or per-month totals.** Only Claude Sonnet costs (Creative Director + Copywriter, ~$0.25-0.40/video) count against the real budget. Phase 3 CD uses ~2x more output tokens than Phase 2 (richer schema), so per-video Sonnet cost rises modestly when ENABLE_PHASE_3_CD flips. Revisit if the company credit arrangement ends.

Smoke test reference: 6 Phase 3 briefs cost ~$0.33 (in=62K, out=9.5K tokens, $3/MTok input, $15/MTok output).

## Database Tables
- `brand_configs` — Brand settings, colors (regex-validated hex), fonts, caption presets, voice guidelines, allowed_video_types, color_grade_preset, **allowed_color_treatments (Phase 3 W1, migration 006)**.
- `assets` (0 rows — clean-slated 2026-04-16 for W5 re-ingestion) — Ingested UGC clips with AI-generated tags, quality scores, usable segments, dominant_color_hex, motion_intensity, avg_brightness, **pre_normalized_r2_key (W5, migration 007)**. Parent table for `asset_segments`. Legacy Gemini Flash catalog.
- `asset_segments` (0 rows — clean-slated 2026-04-16, cascade from assets) — Sub-clip segments with rich Gemini 3.1 Pro descriptions, visual_tags, best_used_as, segment_type (8-value taxonomy), motion_intensity, has_speech, quality_score, keyframe_r2_key, **clip_r2_key (Phase 2.5)**, CLIP embedding `VECTOR(512)`. Queried via `match_segments` RPC. ivfflat index dropped — sequential scan suffices until ~1000 rows.
- `jobs` — Video production jobs with full state machine (ENUM `job_status`), video_type, **full_brief (Phase 2 cleanup)**.
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

In Phase 2: video_type pre-selected by `selectVideoType()` from idea_seed keywords before CD call. In Phase 3 (behind flag): CD picks video_type itself based on signal mapping in the prompt; `selectVideoType()` deprecated and only runs on Phase 2 path. **`brand_configs.allowed_video_types` updated 2026-04-15 to permit multi-type per brand**: nordpilates → ['workout-demo', 'tips-listicle', 'transformation'], carnimeat → ['recipe-walkthrough', 'tips-listicle', 'transformation'], highdiet → ['workout-demo', 'tips-listicle', 'transformation']. Single-type lock was MVP simplicity, not brand strategy.

## Phase 3 Color Treatments (W1, migration 006)
8 named treatments. Phase 3 CD picks one per video; brand_configs.allowed_color_treatments restricts the available set per brand.

| Treatment | CSS filter (W4 will refine) |
|---|---|
| `warm-vibrant` | `saturate(1.2) brightness(1.05) hue-rotate(-5deg)` |
| `cool-muted` | `saturate(0.7) brightness(0.95) hue-rotate(15deg)` |
| `high-contrast` | `saturate(1.1) contrast(1.3) brightness(0.95)` |
| `soft-pastel` | `saturate(0.8) brightness(1.1) contrast(0.9)` |
| `moody-dark` | `saturate(0.8) brightness(0.85) contrast(1.2)` |
| `natural` | `saturate(1.0)` |
| `golden-hour` | `saturate(1.15) brightness(1.05) sepia(0.15) hue-rotate(-10deg)` |
| `clean-bright` | `saturate(0.95) brightness(1.15) contrast(1.05)` |

Brand defaults (migration 006):
- nordpilates: warm-vibrant, soft-pastel, golden-hour, natural, cool-muted
- carnimeat: high-contrast, warm-vibrant, moody-dark, natural, clean-bright
- Others: NULL (no restriction; CD picks any of 8)

## BullMQ Queue Names
- `ingestion` — Asset ingestion (Drive → R2 → Supabase)
- `planning` — Creative planning (run 3 agents)
- `rendering` — Video assembly (FFmpeg + Remotion + Whisper)
- `export` — Platform-specific export

## File Structure
```
src/
├── config/          — env.ts (flags + WHISPER paths), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (all DB + Context Packet types + Phase3CreativeBrief), video-types.ts (VideoType configs)
├── lib/             — ffmpeg.ts, gemini.ts (Flash legacy),
│                      gemini-segments.ts (Phase 1, Pro),
│                      clip-embed.ts (Phase 1),
│                      keyframe-extractor.ts (Phase 1),
│                      segment-processor.ts (Phase 1+2.5),
│                      segment-trimmer.ts (Phase 2),
│                      retry-llm.ts (Phase 2 cleanup),
│                      r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts, music-selector.ts,
│                      template-config-builder.ts, clip-analysis.ts,
│                      video-type-selector.ts (Phase 2 only — deprecated for Phase 3),
│                      format-full-brief.ts (Phase 2 cleanup),
│                      parent-normalizer.ts (Phase 3 W5)
├── workers/         — ingestion.ts (Phase 1+2.5+W5), clip-prep.ts, transcriber.ts,
│                      audio-mixer.ts, sync-checker.ts, exporter.ts, qa-checker.ts,
│                      renderer.ts, pipeline.ts, music-ingest.ts
├── agents/
│   ├── prompts/     — creative-director.md (Phase 3, 460+ lines, 4 example briefs),
│   │                  creative-director-phase2.md (Phase 2, 210 lines, preserved for rollback),
│   │                  asset-curator.md, copywriter.md,
│   │                  segment-analyzer.md (Phase 1),
│   │                  asset-curator-v2.md (Phase 2)
│   ├── creative-director.ts (Phase 2 generateBriefPhase2),
│   │   creative-director-phase3.ts (Phase 3 generator, Zod corrective retry),
│   │   creative-director-phase3-schema.ts (Zod schema + cross-field validation),
│   │   creative-director-dispatch.ts (flag-gated dispatcher),
│   │   asset-curator.ts (V1), asset-curator-v2.ts (Phase 2),
│   │   asset-curator-dispatch.ts (Phase 2),
│   │   curator-v2-retrieval.ts (Phase 2),
│   │   copywriter.ts
│   └── context-packet.ts  — runs all 3 agents via dispatchers, merges into Context Packet
├── templates/
│   ├── types.ts     — TemplateProps, ResolvedSegment, helpers
│   ├── Root.tsx     — Remotion composition registry (registerRoot)
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect, SegmentVideo
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
│                      [Phase 3 W4 will replace these with single parameterized composition]
├── index.ts         — HTTP API + BullMQ workers
├── scripts/         — seed-brand.ts, upload-brand-logos.ts, test-*,
│                      backfill-segments.ts (Phase 1), test-clip.ts,
│                      test-segment-analyzer.ts,
│                      test-segment-trimmer.ts (Phase 2),
│                      test-curator-v2.ts (Phase 2),
│                      backfill-segment-clips.ts (Phase 2.5),
│                      apply-migration.ts (Phase 2 cleanup migration runner),
│                      smoke-test-cd-phase3.ts (W1, validates Phase 3 CD against live Claude),
│                      test-pre-normalize.ts (W5), test-ingestion-w5.ts (W5),
│                      clean-slate-nordpilates.ts (W5, one-shot wipe),
│                      migrations/001 through 007
└── brands/          — nordpilates.json, ketoway.json, carnimeat.json

n8n-workflows/       — Importable n8n workflow JSONs (see VPS-SERVERS.md for active workflow list)
```

## Google Sheets Admin Panel ("Video Pipeline")
Spreadsheet ID: `1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`
Workers manage everything from a single Google Spreadsheet with 6 tabs:
1. **Jobs** (gid: 645720058) — Create idea seeds, review briefs (approve/reject), QA videos. Polled every 30s. Columns: Row Status, Job ID, Brand, Idea Seed, Status, Brief Summary, Full Brief, Hook Text, Preview URL, Auto QA, Review Decision, Rejection Notes, QA Decision, QA Issues. **Future: Vibe column to be added when Phase 3 vibe param wires through (deferred from W1).**
2. **Brands** — Edit colors, fonts, CTA style, voice guidelines, allowed video types, color grade preset. Polled every 5min.
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
| Edit Phase 3 brand color palette | Supabase web UI directly (interim, until W6) | Edit `brand_configs.allowed_color_treatments` |

**Sync**: n8n mediates bidirectionally. Sheet→Supabase edits are validated (hex regex, ranges, required fields). Errors shown in column A ("Row Status"). Supabase→Sheet updates are event-driven + 5min cron catch-up. P2 Periodic Sync now includes Full Brief column with apostrophe escape (Phase 2 cleanup).

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
- `POST /music-ingest` — n8n S7 sends audio binary. Header: `x-track-meta`. Returns track record with ID, duration, BPM.
- `POST /ugc-ingest` — n8n S8 sends video binary. Header: `x-asset-meta`. Idempotent on `(filename, brand_id)`. Streams to disk via `req.pipe(createWriteStream(...))`. **Phase 1+2.5**: After legacy `assets` row insert, runs Gemini Pro segment analysis + CLIP embedding + 720p clip pre-trim → writes `asset_segments` rows. Non-blocking: segmentation failure doesn't break ingestion.
- `GET /health` — Health check. Returns `{ status: "ok", worker: "worker-1" }`

## Build Commands
```bash
npm run build              # TypeScript compilation
npm run test:connectivity  # Verify Supabase + Redis + R2
npm run setup:r2           # Initialize R2 folder structure
npm run test:pipeline      # Full integration test
npm run test:agents        # AI agents mock mode test (30 checks)
npm run test:agents:live   # AI agents live test with Claude Sonnet API
npm run test:quality       # Quality upgrade modules test
npm run test:phase5        # Phase 5 integration test
npm run test:clip          # CLIP embedder test
npm run test:segment-analyzer  # Gemini Pro segment analyzer test
npm run test:segment-trimmer   # FAST/SLOW path trimmer test
npm run test:curator-v2    # End-to-end 5-slot curator V2 test
npm run test:cd-phase3     # Phase 3 CD smoke test (6 fixtures, ~$0.33, ~120s)
npm run backfill:segments  # Backfill asset_segments for existing assets
npm run backfill:clips     # Phase 2.5 backfill: clip_r2_key for existing segments
npm start                  # Start all BullMQ workers (dev mode via tsx)
npm run start:prod         # Start workers in production (compiled JS)
```

## UGC File Naming Convention
```
{brand_id}_{description}.mov
```
Examples: `nordpilates_yoga-flow-demo.mov`, `ketoway_meal-prep-chicken.mp4`
- Brand prefix must match a `brand_id` in Supabase (validated on ingestion)
- If no underscore or invalid brand, falls back to Drive folder's brand
- Description is stored as a searchable tag in `assets.tags`
- Any extension works: `.mov`, `.mp4`, `.webm`

## Remotion Video Templates (Phase 2 — being replaced in Phase 3 W4)
All templates render at 1080x1920 30fps (vertical short-form). Each layout is a React component that takes a `TemplateProps` object containing the full Context Packet, pre-resolved clip paths, whisper transcriptions, logo, and music.

**Available layouts** (Phase 2):
- `hook-demo-cta` — Hook → Product demo → CTA (workout-demo, recipe-walkthrough)
- `hook-listicle-cta` — Hook → Numbered tips with progress bar → CTA (tips-listicle)
- `hook-transformation` — Hook → Before/After split-wipe reveal → CTA (transformation)

**Phase 3 W4 will ship** a single parameterized composition (`phase3-parameterized-v1`) that consumes the full Phase 3 brief and renders accordingly. Per Architecture Rule 24, no template variants — variety from CD decisions only. Old layouts stay in codebase during W4 development; deleted at Milestone 3.3 cleanup.

## Feature Flags (.env)
See `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_0.md` §9 for full table. Current state:
- `ENABLE_AUDIO_DUCKING=true` *(active)*
- `ENABLE_CRF18_ENCODING=true` *(active)*
- `ENABLE_BEAT_SYNC=true` *(active — Day 6)*
- `ENABLE_COLOR_GRADING=true` *(active — Day 6)*
- `ENABLE_MUSIC_SELECTION=true` *(active — Day 6)*
- `ENABLE_DYNAMIC_PACING=false` — post-MVP
- `ENABLE_CURATOR_V2=true` *(LIVE — flipped 2026-04-13 13:46 UTC)*
- **`ENABLE_PHASE_3_CD=false` *(W1 shipped 2026-04-15, flag remains off in production until W2/W3/W4 ship + Milestone 3.3 flip)***
- `ENABLE_PHASE_3_REMOTION=false` — to be added at W4
- `GEMINI_INGESTION_MODEL=gemini-3.1-pro-preview` — segment analyzer model
- `GEMINI_CURATOR_MODEL=gemini-3.1-pro-preview` — curator V2 picker + critique model
- `FALLBACK_MUSIC_TRACK_ID=f6a6f64f-...` — Die With A Smile 249s (deprecated post-selector)

## Quality Roadmap
See `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_0.md` §12 and `docs/MVP_PROGRESS (7).md` for full details. Summary:
- **Phase 1 — Ingestion Overhaul:** ✅ DONE (2026-04-13) — pgvector + `asset_segments` + Gemini Pro analysis + CLIP embeddings. Originally 182 segments across 53 clips; **clean-slated 2026-04-16 for W5 re-ingestion.**
- **Phase 2 — Curator Overhaul:** ✅ DONE + LIVE (2026-04-13) — `asset-curator-v2.ts` + dispatcher + retrieval + trimmer. Validated 9-10/10 on test slots.
- **Phase 2.5 — Pre-trim optimization:** ✅ DONE + LIVE (2026-04-13) — Curator wall time 17.9 min → 4.4 min.
- **Phase 2 production validation:** ✅ DONE (2026-04-14) — First V2 video rated 4-5/10. Three diagnosed bottlenecks: library content gap, CD monotony, template monotony.
- **Phase 2 cleanup:** ✅ DONE + LIVE (2026-04-14) — retry helper, Zod corrective retry, full_brief column, V2 prompt soft variety, S1 runaway loop fix. Tagged `phase2-complete`.
- **Phase 3 W1 — Creative Director rewrite:** ✅ DONE (2026-04-15, behind flag) — New schema (creative_vision + slot_count 3-12 + per-slot energy/transition/cut + 8 color treatments), Zod corrective retry, dispatcher pattern, prompt rewrite with 4 examples, signal-mapping rules, smoke test harness validating 6/6 Zod + 6/6 signal-mapping. Tagged `phase3-w1-complete`. ENABLE_PHASE_3_CD=false in production.
- **Phase 3 W5 — Clean-slate ingestion:** ✅ DONE (2026-04-16) — Pre-normalize parents to 1080p H.264 at ingestion (migration 007 + `preNormalizeParent()`). Clean-slate drop of 53 nordpilates assets + 182 segments + all R2 objects. Ready for content sprint re-ingestion.
- **Content sprint:** ⏳ QUEUED post-W5 — ingest 15-20 more nordpilates ab/core UGC clips through new pipeline.
- **Phase 3 W2/W3/W4:** ⏳ PLANNED — Curator V2 update (W2), Copywriter update (W3), Remotion parameterized composition (W4). W4 is largest workstream.
- **Milestone 3.3 — flag flip + first Phase 3 production video.** Success criterion: 8 of 10 consecutive Phase 3 videos approved.

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX32 (4 vCPU, 8GB RAM, 80GB SSD), Ubuntu — upgraded from CX22 on 2026-04-10
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory`
- **Logs**: `journalctl -u video-factory -f`
- **Service**: `systemctl start|stop|restart|status video-factory`
- whisper.cpp installed at `/opt/whisper.cpp/build/bin/whisper-cli` with `base.en` model

## Important Technical Notes
- Upstash Redis requires `tls: {}` and `maxRetriesPerRequest: null` in ioredis config
- BullMQ drainDelay: 120s between empty-queue polls (~6.5K cmds/day idle, ~195K/mo, well under Upstash 500K free tier limit)
- R2 client needs `forcePathStyle: true` and `region: "auto"`
- Job status uses Postgres ENUM — TypeScript `JobStatus` type must exactly match
- Atomic job claiming: `.update({status}).eq('id', jobId).eq('status', fromStatus)` prevents race conditions
- 5 pilot brands seeded: nordpilates, ketoway, carnimeat, nodiet, highdiet
- **`brand_configs.allowed_video_types` updated 2026-04-15** to support multi-type per brand (was single-type from MVP simplicity).
- **`brand_configs.allowed_color_treatments` added 2026-04-15** via migration 006 (Phase 3 W1). nordpilates and carnimeat backfilled; others NULL.
- Quality upgrade migration applied to Supabase (2026-04-07): new columns on jobs, assets, brand_configs
- **Gemini 4K downscale**: `src/lib/gemini.ts` downscales clips >50MB to 720p (libx264 ultrafast, no audio) before base64-encoding for analysis. Originally added to keep the 4GB CX22 alive; still in place on the CX32.
- **UGC ingestion streaming + concurrency guard**: `/ugc-ingest` streams the request body straight to a temp file, rejects payloads >500MB via `Content-Length`. Module-scope `ugcIngesting` flag serializes overlapping requests with 503.
- **Shared segment processor**: `src/lib/segment-processor.ts` — `processSegmentsForAsset()` handles keyframe extraction, CLIP embedding, R2 upload, DB insert, AND (Phase 2.5) pre-trim of 720p CRF 28 clips. Single code path prevents drift.
- **Backfill idempotency**: `backfill-segments.ts` uses set subtraction. `backfill-segment-clips.ts` (Phase 2.5) uses `WHERE clip_r2_key IS NULL`. Both safe to re-run.
- **Gemini Files API flow**: `gemini-segments.ts` uploads video via Files API, polls until ACTIVE, analyzes, deletes in `finally`.
- **Curator V2 two-path trim**: FAST PATH streams pre-trimmed 720p file (~5MB) from R2; SLOW PATH falls back to download parent + ffmpeg encode. Same TrimmedSegment contract.
- **Curator V2 variety**: prompt receives `{previously_picked_parents}` and is instructed to STRONGLY prefer different parent clips across slots.
- **`match_segments` RPC accepts TEXT not VECTOR**: supabase-js doesn't reliably serialize vectors to pgvector types. Function takes a string and casts to `vector(512)` internally (migration 005). Do NOT "fix" this signature.
- **ivfflat index is deliberately absent**: dropped when stale centroids routed CLIP text queries into empty cells. Tables clean-slated at W5; sequential scan is fast. Recreate with `lists ≈ rows/1000` when library hits ~1000 rows.
- **CREATE OR REPLACE FUNCTION silently fails on return-type changes**: any RPC migration that adds/removes a RETURNS TABLE column needs `DROP FUNCTION IF EXISTS` first, then CREATE, then `NOTIFY pgrst, 'reload schema'`. Bit us on migration 005.
- **Phase 2 cleanup retry helper**: `src/lib/retry-llm.ts` — `withLLMRetry({ label })` wraps Sonnet + Gemini calls with duck-typed retry on 429/502/503/504/529/network errors. Used by Phase 2 CD, Phase 3 CD, and Curator V2.
- **Phase 2 cleanup full_brief**: `src/lib/format-full-brief.ts` formats the entire context packet into operator-readable text. P2 sync writes to Full Brief sheet column with apostrophe escape (`'` prefix) to defeat Sheets' `=` formula parser.
- **Phase 2 cleanup migration runner**: `src/scripts/apply-migration.ts` uses the `apply_migration_sql` SECURITY DEFINER RPC to apply DDL via supabase-js. Service-role only, hardened with search_path lock. Used for migrations 005, 006.
- **Phase 3 W1 dispatcher pattern**: mirrors `asset-curator-dispatch.ts`. `creative-director-dispatch.ts` reads `ENABLE_PHASE_3_CD` and routes to `generateBriefPhase2` (the existing Phase 2 path, renamed in W1) or `generateBriefPhase3` (new). Discriminated union return forces downstream handling.
- **Phase 3 W1 Zod corrective retry**: `creative-director-phase3.ts` parses model output with `validatePhase3Brief()`. On Zod failure, sends schema errors back to model in a single corrective retry. If still bad, throws. Mirrors curator V2 cleanup pattern.
- **Phase 3 W1 placeholder guard**: `ensureBriefId()` substitutes `<will be set by system>` and `<from input>` placeholders with real values before Zod parses. Prevents valid-but-garbage strings reaching the DB. Runs on both first response and corrective retry.
- **VPS system deps**: `ffmpeg`, `chromium-browser`, and whisper.cpp built from source — `apt install ffmpeg chromium-browser` then build whisper.cpp via `cmake -B build && cmake --build build -j2`.

## Current Status
- **Phase 1 shipped (2026-04-13).** Originally 182 segments across 53 clips. Clean-slated 2026-04-16 for W5 re-ingestion.
- **Phase 2 shipped + LIVE (2026-04-13 13:46 UTC).** Curator V2 default in production.
- **Phase 2.5 shipped + LIVE (2026-04-13).** Pre-trim at ingestion. Backfill complete.
- **Phase 2 production validated (2026-04-14).** First V2 video rendered, rated 4-5/10. Diagnosis: library content gap + CD monotony + template monotony.
- **Phase 2 cleanup shipped (2026-04-14, commit `269ff99`, tag `phase2-complete`).** Retry helper, Zod corrective retry, full_brief column, V2 prompt soft variety, S1 runaway loop fix.
- **Phase 3 design locked (2026-04-15).** Five workstreams (W1: CD rewrite, W2: Curator V2 update, W3: Copywriter update, W4: Remotion parameterized composition, W5: clean-slate ingestion). Three milestones (3.1, 3.2, 3.3). Behind feature flags. See `docs/PHASE_3_DESIGN.md`.
- **Phase 3 W1 shipped (2026-04-15, commit `df6a326`, tag `phase3-w1-complete`).** Creative Director rewrite behind ENABLE_PHASE_3_CD flag. Phase 2 path preserved for rollback. Smoke test passed 6/6 Zod + 6/6 signal-mapping correct + 4 unique slot_counts + 5 unique color treatments. Migration 006 applied. brand_configs.allowed_video_types expanded to multi-type per brand.
- **Doc sync committed 2026-04-15 (commit `ea61805`).** Architecture v5.0, MVP progress (7), updated PHASE_3_DESIGN and SUPABASE_SCHEMA all live on main. v4.0 and (6) deleted.
- **Phase 3 W5 shipped (2026-04-16).** Pre-normalize at ingestion (migration 007 + `preNormalizeParent()`). Clean-slate drop: 53 assets, 182 segments, 434 R2 objects wiped. Ingestion pipeline ready for content sprint.
- **Next action**: Content sprint — ingest 15-20 more nordpilates ab/core UGC clips through the new W5 pipeline. Then W2/W3/W4 in sequence (W4 is largest, blocks Milestone 3.3).
- **Data**: 0 assets (clean-slated), 0 asset_segments (clean-slated), 15 music_tracks, 5 brand_configs (3 active for Phase 3: nordpilates, carnimeat, highdiet), 6+ jobs (including first V2 production render).
- **n8n workflows**: S1 v2 ✅, S2 v2 ✅, S3 v1 ⏸ (needs v2 rebuild before first `delivered`), S7 v2 ✅, S8 v1 ✅ (manual), P2 v2 ✅ (with apostrophe escape).
- **Total infra**: ~€15/mo + ~$0.25-0.40/video Claude (varies with Phase 2 vs Phase 3 CD).