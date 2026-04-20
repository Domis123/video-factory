# Video Factory — CLAUDE.md

## Project Overview
Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30-60s) for TikTok/IG/YT. Phase 1 (ingestion overhaul) shipped: Gemini 3.1 Pro segment analysis + CLIP ViT-B/32 embeddings + pgvector. Phase 2 (curator overhaul) shipped + LIVE: asset-curator-v2 with pgvector retrieval + on-the-fly trim + Gemini Pro picking + self-critique, `ENABLE_CURATOR_V2=true` (flipped 2026-04-13 13:46 UTC). Phase 2.5 shipped + LIVE: pre-trimmed 720p clips at ingestion. Phase 2 cleanup shipped (commit `269ff99`, tag `phase2-complete`): retry helper, Zod corrective retry on V2, full_brief column, V2 prompt soft variety, S1 runaway loop fix. **Phase 3 W1 shipped 2026-04-15 (commit `df6a326`, tag `phase3-w1-complete`)**: Creative Director rewrite behind `ENABLE_PHASE_3_CD` flag (default false). New schema: creative_vision + slot_count 3-12 + per-slot energy/transition/cut style + 8 color treatments + brand-restricted color palette. Dispatcher pattern preserves Phase 2 path for instant rollback. Downstream Phase 3 consumers (W2 Curator update, W3 Copywriter, W4 Remotion) not yet shipped — flipping the flag throws on the Phase 3 path until those land. **Phase 3 W5 shipped 2026-04-16 (commit `f1b8120`, tag `phase3-w5-complete`)**: clean-slate ingestion + pre-normalization. **Phase 3 W2+W3+W4 shipped 2026-04-17:** Curator reads creative_vision + aesthetic_guidance (`68441bc`), Copywriter generates per-slot overlay text (`7e381e4`), Remotion parameterized composition with 18 transitions + 8 color treatments + 6 overlay styles (`d92d601`). **`ENABLE_PHASE_3_CD=true` flipped 2026-04-17. Phase 3 is LIVE.** First Phase 3 video rendered end-to-end (job `fe34b673`, nordpilates workout-demo, auto QA passed). Content sprint complete (253 segments across ~100 assets). Hotfixes: transcriber no-audio (`57791f6`), CTA white-on-white (`9b377ea` pending merge). **Prompt fixes shipped 2026-04-18:** hook duration floors, CD visual descriptions, curator prep-clip rejection (`090bb07`). **Segment analyzer deep rewrite shipped 2026-04-18** (`0d9f55e`): 4 failure modes, exercise max 12s, mandatory subject appearance, exercise naming, 10-15 structured tags, movement phase tracking. **Full re-segmentation backfill completed 2026-04-18:** 191 assets, 611→903 segments, 0 failures, $12.32 Gemini credits. Curator scores improved (4/10 → 9/10) but **fundamental architecture problem identified: CD designs videos for a library it has never seen.** CD invents exercise names → curator can't find them → clips don't match overlay text. **Architecture pivot (Milestone 3.5) shipped on `feat/architecture-pivot` 2026-04-19/20** (commits `fd63a35` + `5327188`, pushed to origin, NOT YET MERGED to main, NOT YET DEPLOYED to VPS): new `library-inventory.ts` aggregator queries `asset_segments` and feeds the CD a body-region summary + filtered exercise-name list (~156 unique on nordpilates) before planning; `body_focus: string | null` added to `Phase3BriefSegment.clip_requirements` (type + Zod, with `_AssertEqual` lockstep); `asset_segment_id` threaded into `ClipSelection`; `context-packet.ts` now fetches the picked segments' `description` rows between curator and copywriter; copywriter receives `selectedClipDescriptions[]` and the prompt's new "Post-Selection Clip Descriptions" + "CRITICAL STYLE RULE" sections forbid non-`label` styles from naming visible content. Live smoke test PASS: 3/3 body slots picked valid library regions, 0 outliers. MVP: 3 brands, 1 video type, 5-10 videos/week. Target scale: 30-50 brands, 4 video types, 150-300 videos/week.

## Key Documentation
- **`docs/VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`** — Architecture v5.1. Reference doc. Needs update once architecture pivot is merged + deployed.
- **`docs/PHASE_3_DESIGN_3.md`** — Phase 3 master design doc (renamed from PHASE_3_DESIGN.md in pivot commit). Milestones 3.1-3.4 complete; 3.5 (architecture pivot) shipped on branch, awaiting merge/deploy.
- **`docs/MVP_PROGRESS_12.md`** — Living progress tracker. Phase 3.5 pivot results, Phase 4 plan. Supersedes (11).
- **`docs/SUPABASE_SCHEMA.md`** — DB schema reference, verified columns, migration history through 007. No schema changes in the architecture pivot — `body_focus` and `asset_segment_id` live only in JSONB (`jobs.context_packet`). Phase 4 will add migrations 008-012.
- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Phase 4 Part A design (segment intelligence: deep analyzer v2, keyframe grids, sidecar schema).
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — Phase 4 Part B design (pipeline: Planner + Visual Director + Coherence Critic, brand_persona, 5-week migration path).
- **`docs/HANDOFF_TO_NEW_CHAT.md`** — Handoff doc for the new chat session kicking off Phase 4.
- **`docs/HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md`** — ARCHIVE. Subsumed by Phase 4 design.
- **`docs/HANDOFF_PHASE3_QUALITY.md`** — ARCHIVE. Quality iteration analysis (superseded by architecture pivot handoff).
- **`docs/VPS-SERVERS.md`** — Infrastructure docs: both VPS servers, deployment, costs, how they work together. VPS path: `/home/video-factory`.
- `docs/HANDOFF_PHASE3_W2_START.md` — ARCHIVE. Handoff for W2 session (completed).
- `env.video-factory` — All credentials (Supabase, Redis, R2). Copy to `.env` for local dev.

## Architecture Rules (38 total, MUST follow)
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
29. **Only `label` style names what's on screen.** All other overlay styles (bold-center, subtitle, minimal, none) add context the viewer can't see — motivation, benefit, cue, personality. Never describe the visible content in a non-label slot.
30. **Gemini `responseSchema` requires string enums.** Numeric categoricals must be stringified (`z.enum(['1','2','3+'])`, `z.literal('2')`). Convert back to number at consumer if needed. Document with a comment near the schema declaration so future maintainers don't "fix" them.
31. **Per-parent batching for video analysis.** Upload the parent clip to Gemini Files API once, reuse the URI across `generateContent` calls via `videoMetadata.startOffset/endOffset`, delete once at end. Saves ~20s/segment vs. naive per-call upload.
32. **Prefer categorical enums over numeric scores for LLM-generated quality judgments.** LLMs cluster at 7-8 on 1-10 scales. Use `z.enum(['excellent','good','poor','unsuitable'])`. Numeric is fine only for objectively measurable fields (duration, count, boolean confidence).
33. **Pin Gemini model IDs per use-case.** One env var per role — `GEMINI_INGESTION_MODEL`, `GEMINI_CURATOR_MODEL`, future `GEMINI_PLANNER_MODEL`/`GEMINI_CRITIC_MODEL`/`GEMINI_COPYWRITER_MODEL`. Preview aliases shift silently; explicit pinning makes model shifts visible.
34. **Two Gemini SDKs coexist during migration; new code uses `@google/genai`.** Existing ingestion/curator stays on `@google/generative-ai` until the migration sprint. Don't mix within a file. Both packages stay in `package.json`.
35. **Place text AFTER video in Gemini prompt `contents` array.** Google's official best practice: `parts: [fileData+videoMetadata, text]`, not the reverse. Measurable quality difference on ambiguous tasks.
36. **Schema-version JSONB sidecar for gradual DB migrations.** For schema changes to heavily-populated tables, add a JSONB sidecar column (e.g., `segment_v2`) rather than ALTER existing columns. Existing v1 consumers keep working; backfill is interruptible/resumable; rollback is drop-column. Drop v1 columns in a later migration after 100% backfill.
37. **Hard-constraint critical fields in prompts, not just Zod schema.** Zod enforces structure; prompt enforces conditional requirements. E.g., `has_speech: true` → `transcript_snippet` must not be null. Also applies to `exercise.name` when confidence ≥ medium, `subject.primary` when `subject.present` is true.
38. **LLMs confabulate structure to match prompt expectations on out-of-distribution inputs.** When a prompt encodes strong structural expectations ("identify exercise segments in this Pilates clip"), older/smaller models hallucinate that structure on non-matching inputs. `responseSchema` validates shape, not truth — confabulated output is Zod-clean and only catchable by manual spot-check. **Mitigations:** include explicit escape paths in prompts ("if input does not contain [expected], return empty array / use `unusable` enum"); deliberately test on edge inputs (short clips, wrong-type clips) before shipping; spot-check at least one sample against ground truth; prefer stronger instruction-followers when the input distribution is wide. **Incident (2026-04-20, W0b.2):** `gemini-2.5-pro` invented 12 exercise segments (bird-dog, russian twists, side plank, etc.) for parent `48a5f3b7`, a 5.5s talking-head clip with zero exercise content; `gemini-3.1-pro-preview` correctly returned 1 talking-head. Discovered via manual inspection after the suspiciously high segment count was flagged.

## Tech Stack
- **Orchestrator**: n8n (self-hosted, Hetzner) — 46.224.56.174
- **Database**: Supabase Postgres (free tier, pgvector enabled) — `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Job Queue**: BullMQ + Upstash Redis (serverless, TLS required, drainDelay 120s)
- **Storage**: Cloudflare R2 (S3-compatible, zero egress) — clips + keyframes + rendered videos
- **Creative Director**:
  - **Phase 3 (LIVE since 2026-04-17)**: Claude Sonnet 4.6, `generateBriefPhase3` in `src/agents/creative-director-phase3.ts`. Zod corrective retry. Routed via `creative-director-dispatch.ts` based on `ENABLE_PHASE_3_CD=true`.
  - **Phase 2 (legacy rollback)**: Claude Sonnet 4.6, `generateBriefPhase2` in `src/agents/creative-director.ts`. Preserved for instant rollback.
- **Copywriter**: Claude Sonnet 4.6. **Phase 3 (LIVE):** generates hooks, CTAs, captions AND per-slot overlay text with style/char_target constraints (W3 shipped). Inline Phase 3 branching, no separate dispatcher.
- **Asset Curator V1**: Claude Sonnet 4.6 (text-based, legacy `assets` table) — emergency fallback only, NOT called in production
- **Asset Curator V2**: Gemini 3.1 Pro Preview — LIVE. **Phase 3 (LIVE):** reads `creative_vision` + `aesthetic_guidance` + three-tier eval priority + duplicate segment hard-filter (W2 shipped). Dispatched via `asset-curator-dispatch.ts`. Phase 3 discriminator: `'creative_direction' in input.brief`.
- **Ingestion Analyzer**: Gemini 3.1 Pro Preview (sub-clip segment analysis, Phase 1 shipped)
- **Legacy Clip Analyzer**: Gemini Flash (still writes legacy `assets` row — scheduled for removal)
- **Embeddings**: CLIP ViT-B/32 via `@xenova/transformers` (self-hosted, 512-dim) + Supabase pgvector
- **Transcription**: whisper.cpp (self-hosted). **Hotfix 2026-04-17:** handles video-only clips with no audio stream.
- **Video Composition**: Remotion (React-based). **Phase 3 (LIVE):** single parameterized composition `phase3-parameterized-v1` — variable slot count, 18 transitions, 8 color treatments (CSS filter), 6 overlay styles × 7 positions × 5 animations. Phase 2 templates preserved for rollback.
- **Video Processing**: FFmpeg
- **Admin Panel**: Google Sheets ("Video Pipeline" spreadsheet)

## Cost Accounting
**Gemini API is currently free for this project via company credits — DO NOT factor Gemini costs into per-video or per-month totals.** Claude Sonnet costs (Creative Director + Copywriter) are the real budget. Phase 3 CD uses ~2x more output tokens (richer schema). Phase 3 Copywriter adds ~$0.04/video for overlay generation. **Real per-video cost: ~$0.35-0.45/video on Phase 3 path.** Revisit if the company credit arrangement ends.

## Database Tables
- `brand_configs` — Brand settings, colors (regex-validated hex), fonts, caption presets, voice guidelines, allowed_video_types, color_grade_preset, **allowed_color_treatments (Phase 3 W1, migration 006)**.
- `assets` — Ingested UGC clips. **Post-W5 (2026-04-16): clean-slate dropped old 53 rows; re-ingesting through new pipeline.** Includes AI-generated tags, quality scores, usable_segments, dominant_color_hex, motion_intensity, avg_brightness (from legacy Flash), **`pre_normalized_r2_key` (W5, migration 007) pointing at 1080×1920 H.264 normalized parent**. Parent table for `asset_segments`.
- `asset_segments` — Sub-clip segments with rich Gemini 3.1 Pro descriptions, visual_tags, best_used_as, segment_type (8-value taxonomy), motion_intensity, has_speech, quality_score, keyframe_r2_key, **clip_r2_key (Phase 2.5 + W5: cut from 1080p normalized parent, not raw 4K)**, CLIP embedding `VECTOR(512)`. Queried via `match_segments` RPC. ivfflat index dropped — sequential scan suffices until ~1000 rows. **Post-W5 clean-slate: 0 rows, accruing via content sprint (2026-04-16+).**
- `jobs` — Video production jobs with full state machine (ENUM `job_status`), video_type, **full_brief (Phase 2 cleanup)**.
- `job_events` — Event log for every state transition, error, retry, timeout
- `music_tracks` (15 rows) — Licensed background music, mood-tagged, energy_level, tempo_bpm

### Segment Type Taxonomy (post-sprint 2026-04-17, 253 total)
| type | count | avg quality |
|---|---|---|
| `b-roll` | 65 | 7.2 |
| `exercise` | 55 | 8.2 |
| `setup` | 47 | 6.1 |
| `hold` | 39 | 7.9 |
| `transition` | 35 | 6.0 |
| `cooldown` | 8 | 6.3 |
| `talking-head` | ~6 | ~7.7 |
| `unusable` | 4 | 1.3 |

**Known gap:** talking-head segments scarce (~6). Hook and CTA slots both request talking-head, causing near-identical picks.

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
│                      parent-normalizer.ts (W5: preNormalizeParent, 1080×1920 30fps H.264 CRF 22 medium),
│                      retry-llm.ts (Phase 2 cleanup),
│                      r2-storage.ts (incl. deleteFile for W5 orphan cleanup), job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts, music-selector.ts,
│                      template-config-builder.ts, clip-analysis.ts,
│                      video-type-selector.ts (Phase 2 only — deprecated for Phase 3),
│                      format-full-brief.ts (Phase 2 cleanup)
├── workers/         — ingestion.ts (Phase 1+2.5+W5), clip-prep.ts, transcriber.ts,
│                      audio-mixer.ts, sync-checker.ts, exporter.ts, qa-checker.ts,
│                      renderer.ts, pipeline.ts, music-ingest.ts
├── agents/
│   ├── prompts/     — creative-director.md (Phase 3, 460+ lines, 4 example briefs),
│   │                  creative-director-phase2.md (Phase 2, 210 lines, preserved for rollback),
│   │                  asset-curator-v2.md (W2: CREATIVE VISION + AESTHETIC GUIDANCE sections, 52 lines),
│   │                  copywriter.md (W3: style guide + priority order + Phase 3 example, 107 lines),
│   │                  segment-analyzer.md (Phase 1),
│   │                  asset-curator.md (V1 legacy)
│   ├── creative-director.ts (Phase 2 generateBriefPhase2),
│   │   creative-director-phase3.ts (Phase 3 generator, Zod corrective retry),
│   │   creative-director-phase3-schema.ts (Zod schema + cross-field validation),
│   │   creative-director-dispatch.ts (flag-gated dispatcher),
│   │   asset-curator.ts (V1), asset-curator-v2.ts (W2: creative_vision, aesthetic_guidance, dedup filter),
│   │   asset-curator-dispatch.ts (W2: Phase 3 branch, SegmentLike interface),
│   │   curator-v2-retrieval.ts (W2: aesthetic_guidance optional on BriefSlot),
│   │   copywriter.ts (W3: inline Phase 3 branch, structured context block)
│   └── context-packet.ts  — runs all 3 agents via dispatchers, merges into Context Packet.
│                             **Phase 3 throw REMOVED in W4.** Full pipeline flows.
├── templates/
│   ├── types.ts     — TemplateProps (Phase 2), Phase3TemplateProps, Phase3ResolvedSegment, helpers
│   ├── resolve-phase3.ts — NEW (W4): resolvePhase3Segments() + totalPhase3Frames()
│   ├── color-treatments.ts — NEW (W4): getColorTreatmentFilter() for 8 treatments
│   ├── Root.tsx     — Remotion composition registry. 4 compositions:
│   │                  hook-demo-cta, hook-listicle-cta, hook-transformation (Phase 2),
│   │                  phase3-parameterized-v1 (Phase 3 W4)
│   ├── components/  — CaptionTrack, HookText (Phase 2), CTAScreen (Phase 2), LogoWatermark,
│   │                  TransitionEffect (W4: expanded to 18 types + mapTransitionName()),
│   │                  SegmentVideo,
│   │                  Phase3TextOverlay (NEW W4: 6 styles × 7 positions × 5 animations, 238 lines)
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation (Phase 2, rollback),
│                      Phase3Parameterized (NEW W4: single parameterized composition, 143 lines)
├── remotion.config.ts — NEW (W4): CLI webpack override (extensionAlias)
├── index.ts         — HTTP API (2GB /ugc-ingest Content-Length cap) + BullMQ workers
├── scripts/         — seed-brand.ts, upload-brand-logos.ts, test-*,
│                      backfill-segments.ts (Phase 1), test-clip.ts,
│                      test-segment-analyzer.ts,
│                      test-segment-trimmer.ts (Phase 2),
│                      test-curator-v2.ts (Phase 2),
│                      backfill-segment-clips.ts (Phase 2.5),
│                      apply-migration.ts (accepts filename only, prepends src/scripts/migrations/),
│                      smoke-test-cd-phase3.ts (W1),
│                      smoke-test-curator-phase3.ts (W2: 3 video types, cached briefs, token overlap),
│                      smoke-test-copywriter-phase3.ts (W3: char_target compliance, style adherence),
│                      fixtures/smoke-w2-*.json (cached Phase 3 briefs for smoke re-runs),
│                      test-pre-normalize.ts (W5),
│                      test-ingestion-w5.ts (W5),
│                      clean-slate-nordpilates.ts (W5, executed 2026-04-16),
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
- `POST /ugc-ingest` — n8n S8 sends video binary. Header: `x-asset-meta`. Idempotent on `(filename, brand_id)`. Streams to disk via `req.pipe(createWriteStream(...))`. Content-Length cap: **2GB** (raised from 500MB on 2026-04-16). **Phase 1+2.5+W5**: After raw R2 upload, runs `preNormalizeParent()` (1080×1920 H.264 CRF 22 medium), INSERTs assets row with `pre_normalized_r2_key`, then Gemini Pro segment analysis on the normalized parent → CLIP embedding + 720p clip trim → `asset_segments` rows. Segmentation step is wrapped in try/catch (non-blocking). Pre-normalize is hard-required — failure throws after best-effort orphan-raw cleanup. **Synchronous** end-to-end; takes 40s-15min depending on source length. n8n S8 Send to VPS timeout set to 30 min to accommodate.
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
npm run test:pre-normalize     # W5: standalone preNormalizeParent smoke (takes local file path arg)
npm run test:ingestion-w5      # W5: end-to-end /ugc-ingest smoke harness
npm run clean-slate:nordpilates  # W5: scripted DB + R2 wipe (one-shot, already executed 2026-04-16)
npm run backfill:segments  # Backfill asset_segments for existing assets
npm run backfill:clips     # Phase 2.5 backfill: clip_r2_key for existing segments
npm start                  # Start all BullMQ workers (dev mode via tsx)
npm run start:prod         # Start workers in production (compiled JS)
```

**Note on `apply-migration.ts`**: pass the filename only (e.g. `007_pre_normalized_clips.sql`), not the full path. The runner prepends `src/scripts/migrations/` automatically.

## UGC File Naming Convention
```
{brand_id}_{description}.mov
```
Examples: `nordpilates_yoga-flow-demo.mov`, `ketoway_meal-prep-chicken.mp4`
- Brand prefix must match a `brand_id` in Supabase (validated on ingestion)
- If no underscore or invalid brand, falls back to Drive folder's brand
- Description is stored as a searchable tag in `assets.tags`
- Any extension works: `.mov`, `.mp4`, `.webm`

## Remotion Video Compositions
All compositions render at 1080x1920 30fps (vertical short-form).

**Phase 3 (LIVE, default for new jobs):**
- `phase3-parameterized-v1` — Single parameterized composition. Variable slot count (3-12). Per-slot transitions (18 types). Text overlays from Copywriter (6 styles × 7 positions × 5 animations). Color treatment as CSS filter. Props: `Phase3TemplateProps`.

**Phase 2 (legacy, preserved for rollback):**
- `hook-demo-cta` — Hook → Product demo → CTA (workout-demo, recipe-walkthrough)
- `hook-listicle-cta` — Hook → Numbered tips with progress bar → CTA (tips-listicle)
- `hook-transformation` — Hook → Before/After split-wipe reveal → CTA (transformation)

## Feature Flags (.env)
Current production state (VPS):
- `ENABLE_AUDIO_DUCKING=true` *(active)*
- `ENABLE_CRF18_ENCODING=true` *(active)*
- `ENABLE_BEAT_SYNC=true` *(active)*
- `ENABLE_COLOR_GRADING=true` *(active)*
- `ENABLE_MUSIC_SELECTION=true` *(active)*
- `ENABLE_DYNAMIC_PACING=false` — post-MVP
- `ENABLE_CURATOR_V2=true` *(LIVE — flipped 2026-04-13. Note: reads from process.env, not env.ts — inconsistency filed for cleanup)*
- **`ENABLE_PHASE_3_CD=true` *(LIVE — flipped 2026-04-17. Phase 3 is the production path.)***
- `GEMINI_INGESTION_MODEL=gemini-3.1-pro-preview` — segment analyzer model
- `GEMINI_CURATOR_MODEL=gemini-3.1-pro-preview` — curator V2 picker + critique model
- Code fallback defaults: `gemini-2.5-pro` (cleaned from stale `gemini-2.5-pro-preview-05-06` on 2026-04-17)
- `FALLBACK_MUSIC_TRACK_ID=f6a6f64f-...` — Die With A Smile 249s (deprecated post-selector)

## Quality Roadmap
- **Phase 1 — Ingestion Overhaul:** ✅ DONE (2026-04-13)
- **Phase 2 — Curator Overhaul:** ✅ DONE + LIVE (2026-04-13)
- **Phase 2.5 — Pre-trim optimization:** ✅ DONE + LIVE (2026-04-13)
- **Phase 2 production validation:** ✅ DONE (2026-04-14) — rated 4-5/10, diagnosed 3 bottlenecks
- **Phase 2 cleanup:** ✅ DONE + LIVE (2026-04-14, tag `phase2-complete`)
- **Phase 3 W1 — Creative Director rewrite:** ✅ DONE (2026-04-15, tag `phase3-w1-complete`)
- **Phase 3 W5 — Clean-slate ingestion:** ✅ DONE (2026-04-16, tag `phase3-w5-complete`)
- **Content sprint:** ✅ DONE (2026-04-17) — 253 segments across ~100 nordpilates assets
- **Phase 3 W2 — Curator V2 update:** ✅ DONE (2026-04-17, commit `68441bc`) — creative_vision + aesthetic_guidance + dedup filter
- **Phase 3 W3 — Copywriter update:** ✅ DONE (2026-04-17, commit `7e381e4`) — per-slot overlay text with style/char_target
- **Phase 3 W4 — Remotion composition:** ✅ DONE (2026-04-17, commit `d92d601`) — 18 transitions, 8 color treatments, 6 overlay styles
- **ENABLE_PHASE_3_CD flipped:** ✅ DONE (2026-04-17). Phase 3 is the production path.
- **First Phase 3 video rendered:** ✅ DONE (2026-04-17, job `fe34b673`). Auto QA passed. Clip selection quality issues identified.
- **Clip selection quality iteration (prompt-only fixes):** ✅ DONE (2026-04-18, commit `090bb07`) — hook duration floors, CD visual descriptions, curator prep-clip rejection. Curator scores 4/10 → 9/10, but factual mismatch persisted, surfacing the architectural problem.
- **Phase 3 Milestone 3.5 — Architecture pivot (library-aware CD + post-selection copywriter):** ✅ SHIPPED ON BRANCH `feat/architecture-pivot` (2026-04-19/20, commits `fd63a35` + `5327188`, pushed to origin). New `library-inventory.ts`, `body_focus` field, `asset_segment_id` threading, post-selection clip-description fetch, copywriter style-constraint rules. Live smoke test pivot PASS. **NOT YET merged to main, NOT YET deployed to VPS, NOT YET end-to-end validated on a real job.**
- **Copywriter style enforcement:** ✅ SHIPPED ON BRANCH (2026-04-19, commit `5327188`) — only `label` style names visible content; `bold-center`, `subtitle`, `minimal` must add what the viewer can't see (feeling, benefit, cue, reaction).
- **Success criterion (8/10 consecutive approvals):** Not yet measured. Pending merge + VPS deploy + a fresh batch through the new flow.

## Infrastructure
- **VPS (video-factory-01)**: 95.216.137.35 — Hetzner CX32 (4 vCPU, 8GB RAM, 80GB SSD), Ubuntu — upgraded from CX22 on 2026-04-10
- **n8n server**: 46.224.56.174 — Hetzner, Ubuntu 24.04
- **GitHub**: https://github.com/Domis123/video-factory (private)
- **Deploy**: `ssh root@95.216.137.35` → `cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory`
  - **IMPORTANT:** VPS path is `/home/video-factory` (not `~/video-factory` — root's home is `/root`)
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
- **UGC ingestion streaming + concurrency guard**: `/ugc-ingest` streams the request body straight to a temp file, rejects payloads >2GB via `Content-Length` (raised from 500MB on 2026-04-16). Module-scope `ugcIngesting` flag serializes overlapping requests with 503.
- **Shared segment processor**: `src/lib/segment-processor.ts` — `processSegmentsForAsset()` handles keyframe extraction, CLIP embedding, R2 upload, DB insert, AND (Phase 2.5) pre-trim of 720p CRF 28 clips. Single code path prevents drift.
- **Backfill idempotency**: `backfill-segments.ts` uses set subtraction. `backfill-segment-clips.ts` (Phase 2.5) uses `WHERE clip_r2_key IS NULL`. Both safe to re-run.
- **Gemini Files API flow**: `gemini-segments.ts` uploads video via Files API, polls until ACTIVE, analyzes, deletes in `finally`.
- **Curator V2 two-path trim**: FAST PATH streams pre-trimmed 720p file (~5MB) from R2; SLOW PATH falls back to download parent + ffmpeg encode. Same TrimmedSegment contract.
- **Curator V2 variety**: prompt receives `{previously_picked_parents}` and is instructed to STRONGLY prefer different parent clips across slots.
- **`match_segments` RPC accepts TEXT not VECTOR**: supabase-js doesn't reliably serialize vectors to pgvector types. Function takes a string and casts to `vector(512)` internally (migration 005). Do NOT "fix" this signature.
- **ivfflat index is deliberately absent**: dropped when stale centroids routed CLIP text queries into empty cells at 182 rows. Sequential scan is fast enough. Recreate with `lists ≈ rows/1000` when library hits ~1000 rows.
- **CREATE OR REPLACE FUNCTION silently fails on return-type changes**: any RPC migration that adds/removes a RETURNS TABLE column needs `DROP FUNCTION IF EXISTS` first, then CREATE, then `NOTIFY pgrst, 'reload schema'`. Bit us on migration 005.
- **Phase 2 cleanup retry helper**: `src/lib/retry-llm.ts` — `withLLMRetry({ label })` wraps Sonnet + Gemini calls with duck-typed retry on 429/502/503/504/529/network errors. Used by Phase 2 CD, Phase 3 CD, and Curator V2.
- **Phase 2 cleanup full_brief**: `src/lib/format-full-brief.ts` formats the entire context packet into operator-readable text. P2 sync writes to Full Brief sheet column with apostrophe escape (`'` prefix) to defeat Sheets' `=` formula parser.
- **Phase 2 cleanup migration runner**: `src/scripts/apply-migration.ts` uses the `apply_migration_sql` SECURITY DEFINER RPC to apply DDL via supabase-js. Service-role only, hardened with search_path lock. Used for migrations 005, 006.
- **Phase 3 W1 dispatcher pattern**: mirrors `asset-curator-dispatch.ts`. `creative-director-dispatch.ts` reads `ENABLE_PHASE_3_CD` and routes to `generateBriefPhase2` (the existing Phase 2 path, renamed in W1) or `generateBriefPhase3` (new). Discriminated union return forces downstream handling.
- **Phase 3 W1 Zod corrective retry**: `creative-director-phase3.ts` parses model output with `validatePhase3Brief()`. On Zod failure, sends schema errors back to model in a single corrective retry. If still bad, throws. Mirrors curator V2 cleanup pattern.
- **Phase 3 W1 placeholder guard**: `ensureBriefId()` substitutes `<will be set by system>` and `<from input>` placeholders with real values before Zod parses. Prevents valid-but-garbage strings reaching the DB. Runs on both first response and corrective retry.
- **Phase 3 W5 parent normalization**: `src/lib/parent-normalizer.ts` `preNormalizeParent()` is a sibling to `buildNormalizeCommand` in `ffmpeg.ts` (not parameterized). W5 specifically uses CRF 22 medium + AAC 128k 44.1k stereo; render-time uses CRF 18 slow + loudnorm. Different concerns, different functions. Output uploaded to R2 at `parents/normalized/{brand}/{asset_id}.mp4` — referenced via new `assets.pre_normalized_r2_key` column (migration 007).
- **Phase 3 W5 ingestion wiring**: `src/workers/ingestion.ts` inserts pre-normalize between raw R2 upload and `assets` INSERT. If pre-normalize throws, ingestion throws — with best-effort delete of the orphan raw R2 key before rethrowing. All downstream consumers (Gemini Pro segment analyzer, `processSegmentsForAsset` keyframe + CLIP + 720p trim) read the normalized local path, so segment scouts and Pro analysis both use 1080p consistent input.
- **Phase 3 W2 discriminator**: `'creative_direction' in input.brief` is the structural check for Phase 3 briefs across ALL agents (curator dispatch, copywriter inline branch, renderer, pipeline). NOT the `{ phase: 'phase2' | 'phase3' }` tag from DispatchedBrief (unwrapped before reaching downstream consumers).
- **Phase 3 W2 SegmentLike interface**: `asset-curator-dispatch.ts` uses a widened `SegmentLike` interface that both Phase 2 `BriefSegment` and Phase 3 `Phase3BriefSegment` satisfy. Avoids duplicating `buildSlotDescription` and `mapContentTypesToSegmentTypes`. Phase 2 `mood: string | string[]` is the wider type; Phase 3's `mood: string` is assignable to it.
- **Phase 3 W2 duplicate segment hard-filter**: in `curateSlot()`, candidates from already-picked segment IDs are removed before Pro sees them. Activated 8 times across 16 slots in smoke test. Prevents exact same clip appearing in two slots.
- **Phase 3 W2 aesthetic_guidance prompt placement**: separate `{aesthetic_guidance}` placeholder in curator prompt, NOT folded into `{slot_description}`. Keeps signals structurally separate for three-tier eval priority (hard requirements → aesthetic → creative_vision).
- **Phase 3 W3 inline branching**: no separate dispatcher file for Copywriter. Phase 3 detected via same `'creative_direction' in input.brief` discriminator. Phase 3 path prepends structured context block (creative_vision + per-slot text_overlay constraints in plain text) before the JSON brief blob. `CopywriterInput.brief` widened to `CreativeBrief | Phase3CreativeBrief`.
- **Phase 3 W3 char_target compliance**: Copywriter prompt specifies ±20% tolerance. Smoke: 16/16 overlays within tolerance. Style adherence confirmed (bold-center=punchy, label=terse exercise names, cta=actionable).
- **Phase 3 W4 Phase3ContextPacket type**: separate type from ContextPacket to avoid cascading type breaks in pipeline consumers that read Phase 2 field names (`template_id`, `segments[].segment_id`).
- **Phase 3 W4 crossfade**: opacity interpolation on overlapping `<Sequence>` components. During 10-frame overlap (0.33s), outgoing fades 1→0, incoming 0→1. Both clips decoded simultaneously — potential memory spike, acceptable for server-side rendering.
- **Phase 3 W4 SegmentVideo adapter**: Phase3Parameterized passes a shape-matching literal (SegmentVideo only reads `clipPath` + `durationFrames`). No modification to SegmentVideo component needed.
- **Phase 3 W4 renderer wiring**: `renderer.ts` detects Phase 3 via `'creative_direction' in brief`, reads `composition_id` (literal `'phase3-parameterized-v1'`), assembles `Phase3TemplateProps`, passes to `selectComposition({ id: compositionId })`. Phase 2 reads `template_id` as before.
- **Phase 3 W4 context-packet.ts throw removed**: Phase 3 path now flows CD → Curator (W2) → Copywriter (W3) → music → assemble Phase3ContextPacket. No more "downstream not yet shipped" error.
- **Transcriber no-audio hotfix (2026-04-17)**: ffprobe checks for audio streams before ffmpeg extraction. If no audio, returns `{ words: [], fullText: '' }`. UGC fitness clips frequently lack microphones.
- **CTA color hotfix (2026-04-17, deployed 2026-04-18)**: Phase3TextOverlay CTA style used `accentColor` (#FFFFFF for nordpilates) as background + hardcoded white text = invisible. Fixed to use `brandConfig.cta_bg_color` (#E8B4A2) and `cta_text_color` (#2C2C2C). Merged to main.
- **Segment analyzer prompt loads via readFileSync at module load time** from the source `.md` path. With `tsx`, prompt changes are live immediately — no `npm run build` needed. The compiled JS bundle also reads from the `.md` file, not inlined.
- **CLIP embeddings are from keyframe IMAGES, not text descriptions.** `segment-processor.ts` extracts a midpoint keyframe → `embedImage(keyframeBuffer)` → 512-dim vector. At retrieval time, CD's slot description gets `embedText()` and compared via cosine distance. Improving segment text descriptions helps the Gemini Pro PICKER (which reads metadata while watching video), but does NOT directly improve CLIP retrieval distance spread.
- **Backfill reprocess mode (2026-04-18):** `--reprocess --brand` flag deletes old segments + R2 files, re-analyzes with current prompt, inserts fresh segments with new keyframes/CLIP embeddings. `--dry-run` previews without executing. 2s rate limit between assets.
- **RLS blocks anon key on `assets` table** but NOT on `asset_segments`. Backfill script uses `supabaseAdmin` (service role) which bypasses RLS. PostgREST also can't do `LIKE` on UUID columns — use grep on full result sets instead.
- **Gemini model IDs cleaned (2026-04-17)**: stale `gemini-2.5-pro-preview-05-06` fallbacks in 3 files fixed to `gemini-2.5-pro`. VPS production uses `gemini-3.1-pro-preview` (valid). Local dev was 2 generations behind.
- **VPS system deps**: `ffmpeg`, `chromium-browser`, and whisper.cpp built from source — `apt install ffmpeg chromium-browser` then build whisper.cpp via `cmake -B build && cmake --build build -j2`.
- **Milestone 3.5 architecture pivot wiring (branch `feat/architecture-pivot`):** Phase 3 planning flow now runs in a strict order — `getLibraryInventory(brandId)` → CD prompt receives a human-readable summary as `library_inventory` → CD emits `clip_requirements.body_focus: string | null` per slot → curator dispatch threads body_focus into `BriefSlot` and surfaces it in `buildSlotDescription` → curator V2 returns `segmentId` which dispatch maps to `ClipSelection.asset_segment_id` → `context-packet.ts` `fetchSelectedClipDescriptions()` reads `asset_segments.description` for those IDs → copywriter receives `selectedClipDescriptions: (string | null)[]` indexed by slot → prompt's "ACTUAL SELECTED CLIPS" section is the source of truth, with `clip_requirements` as fallback. Single source of truth means the copywriter cannot invent exercise names not on screen.
- **Library inventory tag filter (`src/agents/library-inventory.ts`):** body_part allowlist (BODY_PARTS, 21 regions) + dense exclusion lists (NON_EXERCISE_TAGS, EXCLUDED_PREFIXES, NON_EXERCISE_PATTERNS regexes) reduce raw `visual_tags` to ~156 unique exercise-name tags on nordpilates. Filter iterated 4 rounds (286 → 254 → 169 → 156) — adding a new brand will likely surface new non-exercise leakage; rerun `npx tsx src/scripts/smoke-test-inventory.ts <brandId>` to audit.
- **Copywriter style discipline (`src/agents/prompts/copywriter.md`):** only `label` style names what's on screen. `bold-center` / `subtitle` / `minimal` MUST add information the viewer can't see (feeling, benefit, cue, reaction). The prompt has a "CRITICAL STYLE RULE" block enforcing this. If overlay text starts naming the visible exercise in a non-label slot, the rule was ignored — file as a prompt violation, not a curator pick problem.
- **`asset_segment_id` is JSONB-only:** the field lives in `jobs.context_packet.clips.clip_selections[].asset_segment_id` as a string UUID. No DB migration. The curator V2 `r.segmentId` is the source. Renderer doesn't read it — only the copywriter consumes it via `fetchSelectedClipDescriptions()` in `context-packet.ts`.
- **Smoke test costs:** `smoke-test-inventory.ts` = $0 (Supabase only). `smoke-test-pivot.ts` = ~$0.05–0.20 (single Sonnet brief, no curator/copywriter run). Use the pivot smoke after any CD prompt edit to verify body_focus + library-region adherence before paying for a full pipeline run.

## Current Status
- **Production (`main`, deployed to VPS):** all Phase 3 workstreams (W1-W5), `ENABLE_PHASE_3_CD=true`, segment analyzer deep rewrite, full re-segmentation (903 segments), prompt fixes (hook floors / visual descriptions / prep-clip rejection), CTA color hotfix.
- **Pending merge + deploy (`feat/architecture-pivot`, pushed to origin 2026-04-19/20):** Milestone 3.5 architecture pivot — library-aware CD, `body_focus` per slot, post-selection copywriter, style-constraint enforcement. Two commits: `fd63a35` (pivot wiring) + `5327188` (copywriter style rules). Build clean, smoke-test-pivot PASS on nordpilates.
- **Inventory snapshot (2026-04-20, nordpilates):** 420 exercise + 98 hold + 8 talking-head + 117 b-roll segments, 21 body regions, 156 unique exercise-name tags after filter. Talking-head is the bottleneck — CD prompt warns when count < 10.
- **Data:** 191 nordpilates assets, 903 asset_segments (freshly re-segmented, avg exercise 6.2s, subject appearance 100%), 15 music_tracks (no calm/ambient), 5 brand_configs, ~10 jobs.
- **n8n workflows:** S1 v2 ⚠️ (polling issues during batch test), S2 v2 ⚠️ (same), S3 v1 ⏸ (needs v2), S7 v2 ✅, S8 ✅ (known: .mov filter + skip crash), P1 ✅, P2 v2 ✅.
- **Total infra:** ~€15/mo Hetzner + ~$1.20/mo Upstash + ~$1-5/mo R2. ~$0.35-0.45/video Claude.

### Open punchlist before milestone 3.5 closes
1. Operator merges `feat/architecture-pivot` → `main` (PR: https://github.com/Domis123/video-factory/pull/new/feat/architecture-pivot).
2. VPS deploy: `ssh root@95.216.137.35 → cd /home/video-factory && git pull && npm install && npm run build && systemctl restart video-factory`.
3. Submit fresh test batch (3-5 idea seeds) and rate text/clip alignment specifically — not auto-QA pass/fail.
4. If alignment passes, mark Milestone 3.5 ✅ and start measuring the 8/10 success criterion.
