# Video Factory — Architecture v5.1

**Last updated:** 2026-04-16
**Status:** ✅ **Phase 1, Phase 2, Phase 2.5, Phase 2 cleanup, Phase 3 W1, and Phase 3 W5 shipped and live on origin/main.** Tagged `phase3-w5-complete` (commit `f1b8120`). Phase 3 W2-W4 still planned. ENABLE_PHASE_3_CD remains false in production until W2/W3/W4 ship. **Content sprint in progress** — ingesting 50-100 nordpilates UGC clips through the new pre-normalized pipeline.

**What changed in v5.1:**
- Phase 3 W5 (clean-slate ingestion + pre-normalization) shipped.
- Migration 007 applied: `assets.pre_normalized_r2_key` TEXT.
- New function `src/lib/parent-normalizer.ts`: `preNormalizeParent()` → 1080×1920 30fps, CRF 22 medium, AAC 128k 44.1k stereo.
- Ingestion wiring: pre-normalize inserted between R2 raw upload and `assets` INSERT; all downstream consumers (Gemini Pro segment analyzer, keyframe extraction, 720p scout trim) now read the normalized parent.
- R2 layout added: `parents/normalized/{brand}/{asset_id}.mp4`.
- Clean-slate drop: 53 nordpilates assets + 182 segments + all R2 nordpilates prefixes deleted before sprint. Carnimeat test debris also swept.
- Side fixes: `/ugc-ingest` Content-Length cap raised from 500MB to 2GB (commit `22e977e`); n8n S8 `Send to VPS` timeout raised from 10 min to 30 min (workflow-side change).
- Rule count unchanged at 28. No new rules for W5; rule 21 (pre-trim at ingestion) already covered the pattern.
- New section: §11.6 — Phase 3 W5 Ship Report (encode timings, first production ingestion, what landed).

**What changed in v5.0 (carried from prior release):**
- Phase 3 W1 (Creative Director rewrite) shipped behind feature flag.
- Architecture rules unchanged from v4.0 (28 total).
- Model assignments and component descriptions updated to reflect Phase 3 W1 shipped state (dispatcher pattern, Zod corrective retry, new schema).
- Phase 3 design intent moved from "planned" framing to "W1 shipped, W2-W5 planned" framing.
- Section §11.5 — Phase 3 W1 Ship Report.

---

## Phase 3 Status (W1 + W5 shipped, W2-W4 planned)

Phase 3 eliminates "every video feels the same" by giving the Creative Director open-ended creative freedom and rebuilding the Remotion composition as parameterized instead of templated. Five workstreams; three milestones.

**W1 — Creative Director rewrite** ✅ SHIPPED 2026-04-15 (commit `df6a326`, tag `phase3-w1-complete`). Behind `ENABLE_PHASE_3_CD` flag (default false in production).

**W5 — Clean-slate ingestion + pre-normalization** ✅ SHIPPED 2026-04-16 (commit `f1b8120`, tag `phase3-w5-complete`). Live — every new ingestion pre-normalizes parent to 1080×1920 H.264 before segmentation. Clean-slate drop of old 53/182 nordpilates library executed before sprint. First new-pipeline ingestion verified end-to-end (12 segments from 986MB 4K source, ~14 min total).

**W2 — Curator V2 update** ⏳ PLANNED. Read new aesthetic_guidance + creative_vision context.

**W3 — Copywriter update** ⏳ PLANNED. Generate per-slot overlay text, read creative_vision for tone consistency.

**W4 — Remotion parameterized composition** ⏳ PLANNED. Single composition replaces template variants. Largest workstream.

**Source of truth:** `docs/PHASE_3_DESIGN.md`. All Phase 3 agent briefs reference that doc.

**Key Phase 3 architecture decisions (now landing or shipped):**
- Creative Director outputs a richer schema (creative_vision paragraph, color_treatment, per-slot transition_in + internal_cut_style + aesthetic_guidance) — **W1 SHIPPED**
- Remotion becomes a single parameterized composition, no template variants — W4 planned
- **Existing 182 segments dropped + library re-ingested via new pre-normalized pipeline — W5 SHIPPED**
- 8 color treatments, brand-restricted via brand_config.allowed_color_treatments — **W1 SHIPPED via migration 006**
- Slot count variable 3-12, no fixed 5 — **W1 SHIPPED**
- Vibe input from operator (free-text, optional) — **W1 deferred** (CD-generated when blank; operator vibe wires through after S1 sheet column ships)

---

## 1. System Overview

Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30–60s) for TikTok/IG/YT.

**Core differentiator:** Real UGC authenticity + full end-to-end ownership + brand-perfect templating. Competing with manual editing workflows that cost $50–200 per video.

**MVP scope:** 3 brands (nordpilates, ketoway, carnimeat), 1 video type, 5–10 videos/week.
**Target scale:** 30–50 brands, 4 video types, 150–300 videos/week.

**What changed in v3.9:** First production V2 video rated 4-5/10 surfaced three quality bottlenecks. V2 is functionally complete and strictly better than V1. The remaining quality gap is structural (content + templates + Creative Director decisions), not picker quality. Phase 3 plan revised to be the biggest priority remaining.

**What changed in v5.0:** Phase 3 W1 (CD rewrite) ships and resolves the "Creative Director monotony" half of the diagnosed bottleneck — but only behind a flag. Live videos still run Phase 2 path until W2/W3/W4 land and the flag flips at Milestone 3.3. Smoke validation in dev confirms variety improvements (see §11.5).

---

## 2. Proven Performance

| Phase | Video 1 (Apr 11, V1) | Video 2 (Apr 12, V1) | First V2 video (Apr 14) |
|---|---|---|---|
| Planning (CD + Curator + Copywriter) | 46s | 45s | ~5 min (curator dominant) |
| Clip prep (4K → 1080p) | 17 min | 6 min | (unchanged, Phase 3 W5 target) |
| Transcription (whisper.cpp) | 2s | <1s | (unchanged) |
| Remotion render | 8 min | 8 min | (unchanged, Phase 3 W4 target) |
| Audio mix + sync check | 2s | 2s | (unchanged) |
| Platform export (3 formats) | 2 min | 1.5 min | (unchanged) |
| Auto QA | 4s | 3s | (unchanged) |
| **Total** | **28 min** | **16 min** | **~16 min** |
| **Quality rating** | **6/10** | **5-6/10** | **4-5/10** |

**Phase 3 W1 dev smoke (2026-04-15):** 6 briefs generated. ~20s/brief avg, ~$0.055/brief, 100% Zod first-attempt pass, 100% signal-mapping correct, 4 unique slot_counts, 5 unique color treatments. No production renders yet (W4 not shipped).

**Cost per video:** ~$0.25-0.40 Sonnet (CD + Copywriter; Phase 3 CD uses ~2x output tokens vs Phase 2 due to richer schema). Gemini ingestion ~$0.06/clip amortized, Gemini curator ~$0.20 (FREE on company credits while available).

---

## 3. Infrastructure (unchanged from v4.0)

| Service | Host | Purpose | Cost/mo |
|---|---|---|---|
| n8n | Hetzner 46.224.56.174 | Workflow orchestration | ~€4.50 |
| VPS | Hetzner 95.216.137.35 (CX32 8GB) | Processing engine | ~€8.50 |
| Supabase | Managed free tier | State + catalog + RLS + pgvector | $0 |
| Upstash Redis | Free tier, drainDelay 120s | BullMQ queue | $0 |
| R2 | Cloudflare, zero egress | Media storage (clips + keyframes + pre-trimmed segment clips) | ~$1.02 |
| Claude API (Sonnet 4.6) | Anthropic | Creative Director (Phase 2 + Phase 3) + Copywriter | ~$0.25-0.40/video |
| Gemini API (3.1 Pro Preview) | Google | Ingestion analyzer + Asset Curator V2 | $0 (company credits) |
| CLIP self-hosted | `@xenova/transformers` on VPS | Semantic embeddings (512-dim) | $0 |

### Model Assignments (locked, updated for W1)

| Stage | Model | Rationale |
|---|---|---|
| Ingestion analyzer | **Gemini 3.1 Pro Preview** | Native video input, segment lists with editor-grade descriptions |
| Asset Curator V2 | **Gemini 3.1 Pro Preview** | Watches actual pre-trimmed segment videos from R2, not text tags |
| Creative Director (Phase 2, default) | **Claude Sonnet 4.6** | Planning structure — current production path |
| Creative Director (Phase 3, behind flag) | **Claude Sonnet 4.6** | New schema, Zod corrective retry, dispatcher-routed |
| Copywriter | **Claude Sonnet 4.6** | Strongest model for hooks/CTAs |

### Agent Roles (post-W1)

**Creative Director — Dispatcher pattern.** `creative-director-dispatch.ts` reads `ENABLE_PHASE_3_CD` and routes to either `generateBriefPhase2` (existing Phase 2 logic, renamed in W1) or `generateBriefPhase3` (new Phase 3 generator). Discriminated union return forces downstream callers to handle both shapes.

- **Phase 2 path (live default):** Reads brand_config + idea_seed + video_type_config (built from selectVideoType + VIDEO_TYPE_CONFIGS). Outputs CreativeBrief (segments, template_id, video_type, audio). Loaded prompt: `creative-director-phase2.md` (210 lines, restored from pre-W1 history).
- **Phase 3 path (behind flag):** Reads brand_config (brand_id, brand_name, content_pillars, voice_guidelines, allowed_video_types, allowed_color_treatments, caption_preset.preset_name) + idea_seed. Outputs Phase3CreativeBrief (creative_vision paragraph, slot_count 3-12, energy_per_slot, color_treatment, per-slot pacing/transition_in/internal_cut_style/text_overlay/clip_requirements with aesthetic_guidance, audio with optional pinned_track_id). Loaded prompt: `creative-director.md` (462 lines, 4 example briefs across video types). Wraps Anthropic call in `withLLMRetry`. Validates output via Zod with single corrective retry on schema failure. Substitutes placeholder strings (`<will be set by system>`, `<from input>`) with real values via `ensureBriefId()` before parsing.

**Asset Curator V2** — Gemini 3.1 Pro Preview. CLIP retrieval via `match_segments` RPC → FAST PATH R2 fetch of pre-trimmed clip (Phase 2.5) → Pro pick → self-critique. Dispatched via `asset-curator-dispatch.ts`. **Phase 3 W2 will add:** read per-slot `aesthetic_guidance` + global `creative_vision` paragraph as additional context. Hard requirements (mood, content_type, min_quality) remain authoritative.

**Copywriter** — Claude Sonnet 4.6. Generates hooks, captions, CTAs. **Phase 3 W3 will add:** per-slot overlay text generation. CD specifies overlay style/position/animation/char_target; Copywriter fills the actual text per slot in tone-consistent fashion. Reads global creative_vision for tone.

### VPS Binaries

| Binary | Path | Purpose |
|---|---|---|
| ffmpeg 6.1.1 | /usr/bin/ffmpeg | Clip prep, audio, keyframe extract, segment pre-trim at ingestion |
| ffprobe 6.1.1 | /usr/bin/ffprobe | Auto QA |
| whisper-cli | /opt/whisper.cpp/build/bin/whisper-cli | Speech transcription |
| chromium | /usr/bin/chromium-browser | Remotion dependency |
| CLIP ONNX model | `~/.cache/transformers/Xenova/clip-vit-base-patch32` | Auto-downloaded, ~150MB |

---

## 4. Data Flow

### Video Production Pipeline (V2 + W1 dispatcher active in production)

```
Operator types idea seed in Jobs sheet
  ↓ S1 polls 30s
Supabase INSERT (status: planning) + BullMQ enqueue planning
  ↓ Planning Worker (runPlanning)
  1. CD Dispatcher (creative-director-dispatch.ts) reads ENABLE_PHASE_3_CD
     1a. Flag false (current default) → generateBriefPhase2 (Sonnet, ~12s)
         → Phase 2 brief (segments, template_id, video_type, audio)
     1b. Flag true (post-W2/W3/W4) → generateBriefPhase3 (Sonnet, ~20s)
         → Phase 3 brief (creative_vision, slot_count, color_treatment, segments...)
         → Currently THROWS at downstream because W2/W3/W4 not shipped
  2. Asset Curator V2 Dispatcher (~5 min, V2 active since 2026-04-13)
     [Phase 3 W2 will: read aesthetic_guidance + creative_vision]
  3. Copywriter (Sonnet, ~15s) → hooks, CTAs, overlays
     [Phase 3 W3 will: per-slot overlay text]
  4. Music selector → weighted random over tagged tracks
     [Phase 3 may: honor pinned_track_id from CD]
  5. Brief persisted to Supabase + brief_review status, P2 syncs to sheet
  ↓ S2 (human approval)
  ↓ Rendering Worker
  6. Clip prep: 4K → 1080p
     [Phase 3 W5 target: pre-normalized at ingestion drops this from 6-17 min to ~1 min]
  7. Remotion composition render (8 min)
     [Phase 3 W4 target: single parameterized composition reads full Phase 3 brief]
  8. Audio mix + beat sync
  9. Platform export (3 formats)
  10. Auto QA (ffprobe checks)
  ↓ S3 (human QA — v2 rebuild pending)
delivered
```

### Ingestion Pipeline (Phase 1 + 2.5 + W5 — pre-normalization shipped)

```
Operator drops UGC file
  ↓ S8 polls every 5 min OR manual upload
POST /ugc-ingest with x-asset-meta JSON header
  Stream body → /tmp/ugc-ingest/{uuid}.{ext}  (req.pipe, RAM ~64KB, 2GB Content-Length cap)
  ↓ Ingestion Worker (ingestAsset)
  1. ffprobe (probeFile): duration, resolution, codec, size
  2. analyzeClip (legacy Gemini Flash on raw): content_type/mood/quality/description/usable_segments[] → assets row legacy columns
       [LEGACY — scheduled for removal at Milestone 3.3]
  3. analyzeClipMetadata (3× parallel ffmpeg on raw): dominant color, motion, brightness
  4. uploadFile: stream raw to R2 at assets/{brand_id}/{uuid}.{ext}  [archival original]
  5. W5: preNormalizeParent({ inputPath, brandId, assetId })
       ffmpeg → 1080×1920 30fps H.264 CRF 22 medium, AAC 128k 44.1k stereo
       Upload to R2 at parents/normalized/{brand_id}/{asset_id}.mp4
       Return { localPath, r2Key, durationS, fileSizeBytes, encodeMs }
       Hard-required: throw on failure (after best-effort cleanup of orphan raw R2 key)
  6. INSERT assets row (now includes pre_normalized_r2_key)
  7. Segmentation (existing try/catch non-blocking), using NORMALIZED local path:
     7a. analyzeClipSegments (Gemini Pro Files API on normalized): N segments with types, descriptions, timestamps
     7b. processSegmentsForAsset: for each segment (serial):
         - Extract keyframe at midpoint via ffmpeg → upload to keyframes/{brand}/{seg_uuid}.jpg
         - CLIP embedding from keyframe (512 floats, L2 normalized)
         - ffmpeg trim from normalized: 720p CRF 28 → upload to segments/{brand}/{seg_uuid}.mp4
         - INSERT asset_segments with embedding + keyframe_r2_key + clip_r2_key
         - Delete local keyframe + trimmed clip
  8. Finally: delete /tmp/ugc-ingest/{uuid}.{ext} and {uuid}_normalized.mp4
```

**Per-clip timing (first production W5 ingestion, 2026-04-16):**
- 986MB 4K 3:36 source, 3400×1912 HEVC → 444MB 1080×1920 H.264 normalized
- Pre-normalize encode: 4:42 (CRF 22 medium on CX32)
- Gemini Flash legacy analysis: 3:19 (dominated by 986→? MB downscale)
- Gemini Pro Files API upload + poll + analysis: 1:03 → 12 segments
- 12 × (keyframe + CLIP + 720p trim + R2 + DB): ~58s (~5s/segment)
- **Total end-to-end: ~14 min.** Short clips (20-60s) complete in 40-90s (validated 2026-04-16 on 22.9MB/3.9s clip: 48s total).

---

## 5. Supabase Schema (current state)

### `asset_segments`

```sql
CREATE TABLE asset_segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  brand_id        TEXT NOT NULL,
  segment_index   INT NOT NULL,
  start_s         NUMERIC NOT NULL,
  end_s           NUMERIC NOT NULL,
  duration_s      NUMERIC GENERATED ALWAYS AS (end_s - start_s) STORED,
  segment_type    TEXT CHECK (segment_type IN ('setup','exercise','transition','hold','cooldown','talking-head','b-roll','unusable')),
  description     TEXT NOT NULL,
  quality_score   INT CHECK (quality_score BETWEEN 1 AND 10),
  recommended_duration_s NUMERIC,
  keyframe_r2_key TEXT NOT NULL,
  clip_r2_key     TEXT,                 -- Phase 2.5: pre-trimmed 720p mp4
  embedding       VECTOR(512),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_asset_id, segment_index)
);

CREATE INDEX asset_segments_brand_idx  ON asset_segments(brand_id);
CREATE INDEX asset_segments_type_idx   ON asset_segments(segment_type);
CREATE INDEX asset_segments_parent_idx ON asset_segments(parent_asset_id);
CREATE INDEX asset_segments_clip_key_idx ON asset_segments(clip_r2_key) WHERE clip_r2_key IS NOT NULL;

-- ivfflat index DROPPED 2026-04-13. Recreate at ~1000 rows with lists ≈ rows/1000.
```

### `brand_configs` (W1 added column)

`allowed_color_treatments TEXT[]` added via migration 006 (2026-04-15). Nullable. NULL = no restriction (CD picks any of 8). Backfilled values:
- nordpilates: `['warm-vibrant','soft-pastel','golden-hour','natural','cool-muted']`
- carnimeat: `['high-contrast','warm-vibrant','moody-dark','natural','clean-bright']`
- Others: NULL (welcomebaby, nodiet, ketoway, highdiet)

`allowed_video_types` updated 2026-04-15 (manual SQL, not in migration) to multi-type per brand:
- nordpilates: `['workout-demo','tips-listicle','transformation']`
- carnimeat: `['recipe-walkthrough','tips-listicle','transformation']`
- highdiet: `['workout-demo','tips-listicle','transformation']`

### `jobs` (Phase 2 cleanup added column)

`full_brief TEXT` populated by `runPlanning` via `formatFullBrief()`. Sheet column G via P2 sync (with `'` apostrophe escape).

### `match_segments` RPC

Takes `query_embedding` as TEXT (not VECTOR), casts internally. supabase-js doesn't reliably serialize vectors to pgvector types. See migration 005 for current definition.

### Migration history

| # | File | Status | Purpose |
|---|---|---|---|
| 001 | `001_asset_segments.sql` | Applied (Phase 1) | Create asset_segments + ivfflat index |
| 002 | `002_asset_segments_type.sql` | Applied (Phase 1) | Add segment_type column |
| 003 | `003_match_segments_function.sql` | Applied (Phase 1) | Initial match_segments RPC |
| 004 | `004_asset_segments_clip_key.sql` | Applied (Phase 2.5) | Add clip_r2_key |
| 004 | `004_add_full_brief_column.sql` | Applied (Phase 2 cleanup) | Add full_brief (numbering collision with above; touches different table — no conflict) |
| 005 | `005_match_segments_with_clip_key.sql` | Applied | Updated RPC to return clip_r2_key (DROP+CREATE per Architecture Rule 22) |
| 006 | `006_brand_configs_color_treatments.sql` | **Applied (Phase 3 W1, 2026-04-15)** | Add allowed_color_treatments TEXT[] + backfill nordpilates/carnimeat |
| 007 | `007_pre_normalized_clips.sql` | **Applied (Phase 3 W5, 2026-04-16)** | Add pre_normalized_r2_key TEXT to assets |

---

## 6. R2 Storage Layout

```
assets/{brand}/{uuid}.{ext}                  — original UGC parent files (archival)
parents/normalized/{brand}/{asset_id}.mp4   — Phase 3 W5: 1080×1920 30fps H.264 normalized parents (LIVE)
keyframes/{brand}/{segment_uuid}.jpg         — single-frame keyframes (Phase 1)
segments/{brand}/{segment_uuid}.mp4          — 720p CRF 28 scout clips derived from normalized parent (Phase 2.5 + W5)
music/{brand}/{track}.mp3
logos/{brand}/{variant}.png
renders/{job_id}/{format}.mp4
```

**Storage growth:**
- Phase 2.5: +355 MB for 182 existing segments (now deleted with clean-slate).
- Phase 3 W5 ongoing: ~450MB per parent clip (normalized 1080p) + ~5MB per segment (720p scout). For a 50-100 clip sprint, expect ~25-55GB added to R2.

---

## 7. HTTP API (port 3000)

`/ugc-ingest` contract:
- Streams request body to `/tmp/ugc-ingest/{uuid}.{ext}` via `req.pipe(createWriteStream)` — RAM ~64KB regardless of upload size.
- Content-Length cap: **2GB** (raised from 500MB on 2026-04-16, commit `22e977e`). Streaming removes the actual RAM risk; 500MB was stale.
- Single-flight: `ugcIngesting` module-scope flag rejects overlapping with 503.
- Dedup: on `(filename, brand_id)` match → early return `{ok: true, duplicate: true, ...}`.
- Response body includes `asset_id`, `r2_key`, `pre_normalized_r2_key`, `brand_id`, `content_type`, `quality_score`, `duration_seconds`.
- Synchronous end-to-end: returns only after all segment processing completes. Timing: ~45s for short clips (20-60s source), up to ~15 min for 3-5min 4K HEVC sources. **n8n S8 `Send to VPS` timeout raised to 30 min (2026-04-16) to match.** Async migration deferred to Milestone 3.3 cleanup.

---

## 8. n8n Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | **Future: pass `vibe` field through to Supabase when sheet column ships (deferred from W1)** |
| S2 | Brief Review | v2 final | ✅ | brief_summary column included |
| S3 | QA Decision | v1 | ⏸ | Needs v2 rebuild before first `delivered` |
| S7 | Music Ingest | v2 | ✅ | |
| S8 | UGC Ingest | v1 | Manual | Backend writes pre-trimmed clips + segments |
| P2 | Periodic Sync | v2 | ✅ | Includes Full Brief column with apostrophe escape (Phase 2 cleanup) |

---

## 9. Feature Flags (`.env` on VPS, current state)

| Flag | Current | Notes |
|---|---|---|
| ENABLE_BEAT_SYNC | true | Day 6 |
| ENABLE_COLOR_GRADING | true | Day 6 |
| ENABLE_MUSIC_SELECTION | true | Day 6 |
| ENABLE_AUDIO_DUCKING | true | Day 4 |
| ENABLE_CRF18_ENCODING | true | Day 4 |
| ENABLE_DYNAMIC_PACING | false | Phase 3.5 |
| **ENABLE_CURATOR_V2** | **true** ✅ | **Live in production since 2026-04-13 13:46 UTC** |
| **ENABLE_PHASE_3_CD** | **false** | **W1 shipped 2026-04-15. Stays false until W2/W3/W4 ship + Milestone 3.3 flip.** Flipping currently throws at downstream (intentional). |
| ENABLE_PHASE_3_REMOTION | (not yet defined) | To be added at W4 |
| GEMINI_INGESTION_MODEL | `gemini-3.1-pro-preview` | Pin |
| GEMINI_CURATOR_MODEL | (unset, defaults to ingestion model) | Correct |

---

## 10. First V2 Production Video — What It Taught Us

(Unchanged from v4.0. Job `d74679d2-...`, rated 4-5/10, three diagnosed problems: library content gap, Creative Director monotony, V2 prompt visual variety. Phase 3 W1 directly addresses CD monotony — see §11.5 for smoke evidence. Library gap addressed by content sprint post-W5. Visual variety addressed in Phase 2 cleanup commit.)

---

## 11. Phase 3 Plan — Five Workstreams

**Source of truth:** `docs/PHASE_3_DESIGN.md`. This section summarizes for architecture context only.

### W1 — Creative Director rewrite ✅ SHIPPED (see §11.5)

### W2 — Asset Curator V2 update (planned)

Read new per-slot `aesthetic_guidance` + global `creative_vision` from Phase 3 brief. Hard constraints (mood, content_type, min_quality) remain authoritative; aesthetic guidance is flavor. Estimated 1-2 sessions.

### W3 — Copywriter update (planned)

Add per-slot overlay text generation. CD specifies structure (style/position/animation/char_target), Copywriter fills text. Reads creative_vision for tone consistency. Estimated 1-2 sessions.

### W4 — Remotion parameterized composition (planned)

Single `phase3-parameterized-v1` composition replaces template variants. Iterates over Phase 3 brief's `segments[]`. Implements 8 color treatments as CSS filter chains, 6 transitions, 3 internal cut styles, variable slot counts via frame-count arithmetic. Largest workstream. Estimated 4-6 sessions.

### W5 — Clean-slate ingestion + pre-normalization ✅ SHIPPED (see §11.6)

Shipped 2026-04-16 (commit `f1b8120`, tag `phase3-w5-complete`). Live — every new ingestion pre-normalizes parent to 1080×1920 H.264 at CRF 22 medium before segmentation. Clean-slate drop of 53/182 nordpilates library executed pre-sprint. First production ingestion verified end-to-end (12 segments from 986MB 4K source).

---

## 11.5 — Phase 3 W1 Ship Report

**Shipped:** 2026-04-15. Commit `df6a326` on main, tag `phase3-w1-complete`. Five-step branch (`feat/phase3-w1-cd`) squash-merged.

**What landed:**
- `Phase3CreativeBrief` type + Zod schema with cross-field validation (slot_count = energy_per_slot length, segments[0].type === 'hook')
- `creative-director-phase3.ts` (362 lines) — Phase 3 generator with Zod corrective retry, placeholder guard, withLLMRetry wrapping
- `creative-director-dispatch.ts` (31 lines) — flag-gated dispatcher mirrors curator-v2-dispatch pattern
- `creative-director-phase2.md` (210 lines) — restored Phase 2 prompt for rollback path
- `creative-director.md` (462 lines, full rewrite) — Phase 3 prompt with 4 example briefs (transformation-story, high-energy-listicle, calm-instructional, workout-demo), signal-mapping rules in Step A, variety nudges in Steps C/D
- Migration 006 — `brand_configs.allowed_color_treatments` TEXT[] with nordpilates + carnimeat backfill
- `smoke-test-cd-phase3.ts` (289 lines) — 6-fixture validation harness
- `runPlanning` writes `video_type` column (was being dropped) + standardized brief_summary format
- `planJob()` deleted (Step 0.5 confirmed zero callers)

**Smoke test results (3 iterations: v1, v2, v3):**

| Axis | v1 (initial) | v2 (post-prompt-iter) | v3 (final) |
|---|---|---|---|
| Fixtures | 5 nord+carni | 5 nord+carni | 6 nord+carni+highdiet |
| video_type variety | tips-listicle ×5 | tips-listicle ×5 | 4 unique |
| Signal-mapping correct | n/a | n/a (DB-locked) | 6/6 |
| slot_count distribution | {5:1, 6:4} | {5:1, 6:4} | {4:1, 5:1, 6:3, 8:1} |
| color treatments used | 3 unique | 2 unique | 5 unique |
| Transition variety within brief | poor | good | excellent |
| Internal cut style variety | poor | good | good |
| Energy curves | flat 6-7 | slight curve | archetype-shaped |
| Zod first-attempt | 5/5 | 5/5 | 6/6 |
| Color violations | 0/5 | 0/5 | 0/6 |
| Cost | $0.25 | $0.28 | $0.33 |

**Key discovery during v1→v2:** initial fixtures used brands locked to single video_type via `allowed_video_types`. The 5/5 tips-listicle result was correct DB constraint honoring, not prompt failure. Operator updated `brand_configs.allowed_video_types` to multi-type per brand before v3 smoke. After update, signal-mapping verified 6/6.

**Production state after W1:** ENABLE_PHASE_3_CD=false in production .env. Live worker continues running Phase 2 path untouched. Flipping the flag in production today would: generate a Phase 3 brief successfully, then throw at the downstream consumer in `context-packet.ts` because W2/W3/W4 don't yet handle the new shape. This is intentional Milestone 3.1 behavior per design doc.

**Operator visibility decision:** Phase 3 briefs only appear in worker logs when generated, not in the Full Brief sheet column (Phase 3 path throws before DB write). Acceptable for current validation window. Will become real once W2/W3/W4 ship and the brief lands in `jobs.context_packet`.

---

## 11.6 — Phase 3 W5 Ship Report

**Shipped:** 2026-04-16. Commit `f1b8120` on main, tag `phase3-w5-complete`. Four-commit branch (`feat/phase3-w5-ingestion`) squash-merged from laptop.

**What landed:**
- **Migration 007** (`007_pre_normalized_clips.sql`) — `assets.pre_normalized_r2_key TEXT` nullable. Applied via existing `apply-migration.ts` runner.
- **`src/lib/parent-normalizer.ts`** (74 lines, NEW) — `preNormalizeParent()` sibling to existing `buildNormalizeCommand` (latter kept for render-time use). FFmpeg: `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30` + `-c:v libx264 -pix_fmt yuv420p -crf 22 -preset medium` + `-c:a aac -b:a 128k -ar 44100 -ac 2` + `-movflags +faststart`. Returns localPath, r2Key, durationS, fileSizeBytes, encodeMs.
- **`src/workers/ingestion.ts`** — pre-normalization step inserted between raw R2 upload and `assets` INSERT. Downstream `analyzeClipSegments` and `processSegmentsForAsset` now read the normalized local path. Assets INSERT populates `pre_normalized_r2_key`. Orphan raw cleanup (best-effort `deleteFile`) on pre-normalize failure.
- **`src/scripts/test-pre-normalize.ts`** (77 lines, NEW) + `npm run test:pre-normalize` — standalone smoke harness.
- **`src/scripts/test-ingestion-w5.ts`** (129 lines, NEW) — end-to-end /ugc-ingest verification harness.
- **`src/scripts/clean-slate-nordpilates.ts`** (147 lines, NEW) + `npm run clean-slate:nordpilates` — scripted DB + R2 wipe. Idempotent, re-runnable, greppable in git history.
- **Doc sync in-commit:** CLAUDE.md, docs/SUPABASE_SCHEMA.md updated.

**Clean-slate executed 2026-04-16:**

| Scope | Pre | Post |
|---|---|---|
| nordpilates assets (DB) | 53 | 0 |
| nordpilates asset_segments (DB, cascade) | 182 | 0 |
| R2 assets/nordpilates/ | 55 | 0 |
| R2 segments/nordpilates/ | 182 | 0 |
| R2 keyframes/nordpilates/ | 182 | 0 |
| R2 parents/normalized/nordpilates/ | 2 (Step 2 test files) | 0 |
| R2 assets/carnimeat/ (test debris) | 4 | 0 |
| R2 segments/carnimeat/ (test debris) | 3 | 0 |
| R2 keyframes/carnimeat/ (test debris) | 3 | 0 |
| R2 parents/normalized/carnimeat/ (test debris) | 3 | 0 |

Cascade on `asset_segments.parent_asset_id` confirmed — single `DELETE FROM assets WHERE brand_id='nordpilates'` dropped both tables.

**First production W5 ingestion (2026-04-16, `NP_concept_17.MOV`):**

| Stage | Timing | Notes |
|---|---|---|
| Stream upload (986 MB, 3400×1912 HEVC 60fps) | instant | 2GB cap fix working |
| Legacy Gemini Flash analysis | 3:19 | Includes internal 720p downscale (existing, unrelated to W5) |
| clip-analysis ffmpeg (3× parallel: color/motion/brightness on raw) | 2:09 | Unchanged |
| Raw → R2 (assets/nordpilates/{uuid}.MOV) | ~26s | |
| **preNormalizeParent** | **4:42 encode** | 986MB → 444MB (~45% ratio). yuvj420p tag carried from JPEG-range source; functionally identical 4:2:0. |
| Parent normalized → R2 (parents/normalized/nordpilates/{uuid}.mp4) | ~1s | |
| INSERT assets row (with pre_normalized_r2_key) | <1s | |
| Gemini Pro Files API upload + poll + analyze | 1:03 | 12/12 segments validated on 215.6s source |
| 12 × (keyframe + CLIP + 720p trim + R2 + DB) | ~58s | ~5s/segment |
| **Total end-to-end** | **~14 min** | |

**Production verification (Step 5, 2026-04-16):**
- `SELECT count(*), count(clip_r2_key), count(embedding) FROM asset_segments WHERE brand_id='nordpilates'` → 12 / 12 / 12. Zero partial-write failures.
- Segment type distribution: 5 hold (avg q 8.0), 3 transition (5.3), 3 setup (5.0), 1 b-roll (7.0). No `exercise` segments — consistent with the low-motion yoga/pool content this particular clip contained.

**Short-clip performance** (validated 2026-04-16 during sprint start on 22.9MB 3.9s source): 48s end-to-end. Confirms time dominance is Gemini Flash downscale + pre-normalize encode, both of which scale with source duration and bitrate. 20-60s short clips complete in 40-90s.

**Side fixes delivered during W5 validation:**
- `/ugc-ingest` Content-Length cap: 500MB → 2GB (commit `22e977e`). 500MB guard predated the streaming rewrite; RAM is ~64KB regardless of upload size. 4K HEVC at 3-4 min easily exceeds 500MB.
- Upstash Redis: upgraded free → pay-as-you-go. Diagnosis: no regression; steady-state ~518k commands/mo driven entirely by ioredis keepAlive pings on 6 persistent connections, not a bug. Pay-as-you-go nets ~$1.20/mo at current volume.
- n8n S8 `Send to VPS` timeout: 10 min → 30 min. HTTP was closing before 3-5 min 4K ingestions completed, causing false negatives (file stayed in source folder, VPS had actually succeeded). Re-queue on next S8 poll self-heals via the `(filename, brand_id)` dedup check. Synchronous-HTTP-for-long-work is a real architecture smell; async migration filed as Milestone 3.3 cleanup work.

**Deferred from W5 (flagged for Milestone 3.3 cleanup):**
- Legacy `analyzeClip` Gemini Flash call runs unconditionally on every ingestion. Populates legacy `assets` columns (content_type, mood, quality_score, description, usable_segments) that nothing in V2/Phase 3 reads for clip selection. Keep during Phase 2 rollback window; delete at 3.3 when Phase 2 CD path formally retires.
- Async ingestion via BullMQ queue instead of synchronous HTTP. Filed as 3.3 cleanup.
- `clip-analysis.ts` reads raw 4K (could read normalized 1080p post-W5 for faster color/motion/brightness). Minor.

**Key discoveries during W5:**
1. **Candidate 1 slot-in was the right call** (Step 0 inspection). Between raw R2 upload and `assets` INSERT. Zero contract changes to r2_key semantics, natural path for downstream consumers to pick up the normalized version.
2. **Sibling over parameterized** for parent-normalizer. `buildNormalizeCommand` has render-time concerns (CRF 18, preset slow, loudnorm) baked in; parameterizing would have muddled its purpose. Sibling in `parent-normalizer.ts` at 74 lines.
3. **Duplicate dedup + timeout misalignment.** S8's 10-min HTTP timeout combined with 14-min ingestion produced false-negative "failed" executions that self-healed via next-cycle dedup. Correct system behavior, but observability was confusing. 30-min timeout resolves it.
4. **Brand ≠ content-fit.** Gemini Flash classifies each clip's content (lifestyle, workout, etc). S8 pipes based on filename prefix, not content. A lifestyle clip filed under nordpilates still ingests as nordpilates — flagged for operator discipline at sprint time, not a system bug.

---

## 12. Quality Roadmap

### Philosophy

Real UGC authenticity is the product. Goal: "authentic UGC that outperforms manually-edited brand content at 10% cost and 100x volume." TikTok rewards authenticity over polish.

### Completed

- **Day 4** — First video end-to-end, 6/10 floor established
- **Day 5** — Polish fixes verified, 5-6/10
- **Day 6** — Tier 1 flags flipped (color grading, beat sync, music selection)
- **Phase 1** — Ingestion overhaul (Gemini Pro segment analysis + CLIP embeddings + asset_segments)
- **Phase 2** — Asset Curator V2 (vector retrieval + native video picking + variety + self-critique)
- **Phase 2.5** — Pre-trim segments at ingestion (4.1× speedup)
- **Phase 2 production validation** — First V2 video rendered, rated 4-5/10, diagnosis complete
- **Phase 2 cleanup** — Retry helper, Zod corrective on V2, full_brief column, V2 prompt soft variety, S1 runaway loop fix. Tagged `phase2-complete`.
- **Phase 3 W1 — Creative Director rewrite** ✅ SHIPPED (2026-04-15, behind ENABLE_PHASE_3_CD flag, default false). Smoke validated 6/6 Zod + 6/6 signal mapping. Tagged `phase3-w1-complete`.
- **Phase 3 W5 — Clean-slate ingestion + pre-normalization** ✅ SHIPPED (2026-04-16, commit `f1b8120`, tag `phase3-w5-complete`). preNormalizeParent() live; ingestion writes 1080p normalized parent to R2. Clean-slate drop of old 53/182 library. First production ingestion verified (12 segments, 14min end-to-end on 986MB 4K source).

### In Progress / Next

**Content sprint** (running 2026-04-16):
- Operator drops 50-100 nordpilates UGC clips through new W5 pipeline
- Expected ~3-6 hours wall time for short clips (20-60s dominant)
- Fills library with segments for first Phase 3 production video (post-W4)

**Phase 3 W2/W3/W4** (after content sprint):
- W2: Curator V2 reads aesthetic_guidance + creative_vision (1-2 sessions)
- W3: Copywriter generates per-slot overlay text (1-2 sessions)
- W4: Remotion parameterized composition (4-6 sessions, largest)

**Milestone 3.3 — flag flip + first Phase 3 production video** when W2/W3/W4 done. Success criterion: 8 of 10 consecutive Phase 3 videos approved.

**3.3 cleanup bundle (deferred work to group at milestone):**
- Delete Phase 2 CD path (`generateBriefPhase2`, `creative-director-phase2.md`)
- Delete legacy `analyzeClip` Gemini Flash call + legacy `assets` row columns nothing reads
- Migrate `/ugc-ingest` from synchronous HTTP to BullMQ-queued async (fixes n8n timeout root cause)
- Delete `selectVideoType()` and slim `VIDEO_TYPE_CONFIGS`
- Delete old Remotion template variants
- Migrate `ENABLE_CURATOR_V2` from `process.env` to `env.ts` pattern for consistency
- Revisit `clip-analysis.ts` reading normalized parent instead of raw 4K (free speedup)

### Tier 3 (Month 2)

- Quality Director post-render scoring agent
- Music tagging revision (audience-suitability score)
- Brief preview HTML page with thumbnails + playable segments
- Multi-language support
- Real brand logos
- A/B variant generation
- W6 Brand Settings sheet sync (currently editing brand_configs in Supabase web UI)

### Explicitly Rejected (unchanged)

- Runway/Kling/Veo generative enhancement (destroys UGC authenticity)
- Twelve Labs video search (redundant with CLIP + pgvector at zero cost)
- GPU hosting (Remotion is CPU-bound)
- Upgrading Creative Director to Gemini *for the model* (Phase 3 redesign keeps Sonnet but smarter prompt)
- CapCut API integration
- External embedding APIs (rule #18)
- A second Creative Director agent (informal rule under §13)

### Budget Projection

| Volume | Monthly Cost | Notes |
|---|---|---|
| 5–10 videos/week (MVP) | ~$40 | Current + V2 curator live + Phase 3 W1 (flag off) |
| 50 videos/week | ~$95-115 | Phase 3 CD slightly higher when flag flips |
| 100 videos/week | ~$170-200 | CX42 upgrade recommended |
| 150 videos/week (target) | ~$270-320 | CX52 for parallel rendering |
| 300 videos/week | ~$430-500 | Multi-worker + self-hosted Redis |

---

## 13. Architecture Rules (28 total, MUST follow — unchanged from v4.0)

1. Drive is drop zone only. Pipeline reads from R2.
2. No long-lived n8n executions. State in Supabase.
3. Supabase is source of truth. Sheets is a view layer.
4. Context Packet is immutable.
5. Every state transition logged in job_events where possible.
6. All code TypeScript.
7. whisper.cpp runs locally. No OpenAI Whisper API.
8. Stream large files. Never readFile on uploads.
9. One ingestion at a time. Concurrency guard prevents parallel OOM.
10. Feature flags control quality phases. Default OFF for untested features.
11. Hardcode Supabase URL/key in workflows. No `$env` variables.
12. Remotion bundles from .tsx source. Use `extensionAlias` webpack override.
13. Remotion assets via `publicDir` + `staticFile()`. Never pass absolute paths.
14. Asset Curator JSON key names vary — use `Object.values().find()` dynamic extraction.
15. Create jobs with the status the worker expects (`planning`, not `idea_seed`).
16. n8n Sheet writes after HTTP nodes reach back through `$('Upstream Node').item.json`.
17. Supabase needs permissive RLS policies for anon writes OR service role key.
18. Embeddings are self-hosted only. No external embedding APIs.
19. Match models to weakness, not vendor enthusiasm. Sonnet stays at Creative Director and Copywriter. Gemini Pro takes ingestion and curator.
20. Pin Gemini model IDs in env vars. Preview suffixes mean availability may shift before GA.
21. **Pre-trim expensive transforms at ingestion when the output is cacheable and the input fits in storage.** Pay once per source file, not per render.
22. **Never trust CREATE OR REPLACE FUNCTION for return type changes.** Always DROP + CREATE + NOTIFY pgrst.
23. **Drop approximate vector indexes at small table sizes.** Sequential scan beats them until `lists ≈ rows / 1000` is meaningful.
24. **Composition is parameterized, not template-instanced.** Phase 3 ships one Remotion composition that reads a brief and renders accordingly.
25. **Brand consistency lives in small surface area.** Only logo, color palette restrictions (`allowed_color_treatments`), and caption preset are brand-locked.
26. **Hybrid structured + free-text fields where LLMs and code both consume the data.**
27. **Defer polish features in favor of variety features.**
28. **Clean-slate ingestion when content sprint is incoming.**

### Informal rule under consideration (not yet locked)

- **Make existing agents smarter before adding new ones.** When a quality issue feels like "we need another agent," check whether the existing agent is making all the decisions it could. Phase 3 enhances Creative Director instead of duplicating it. **W1 ship reinforces this rule's value.**

---

## 14. Known Issues

| Priority | Issue | Status |
|---|---|---|
| Medium | Library content gap on nordpilates | **Content sprint in progress (2026-04-16+). 50-100 clips through new W5 pipeline.** |
| Medium | Phase 3 brief operator visibility (throws before DB write) | Acceptable for 3.1 validation window; resolves at W2/W3/W4 ship |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild before first `delivered` |
| Medium | All videos use same template (Phase 2 path) | Phase 3 W4 (parameterized composition) |
| Medium | Legacy `analyzeClip` Gemini Flash runs on every ingestion populating unused assets columns | Defer to Milestone 3.3 cleanup (Phase 2 rollback path preserved until 3.3 flag flip) |
| Medium | `/ugc-ingest` is synchronous HTTP — 3-5 min 4K clips exceed n8n timeout | Timeout raised to 30 min as workaround; async BullMQ migration deferred to Milestone 3.3 |
| Low | Render time variance (6-17 min on clip prep) | **Resolved by Phase 3 W5** pre-normalization — clips now cut from 1080p normalized parent |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | Upstash token leaked in chat history | Rotate before public production |
| Low | Brand-content fit not enforced | Filename prefix → brand mapping; Gemini Flash classifies content but ingestion doesn't block on mismatch. Operator discipline at sprint time. |
| Low | VPS `package-lock.json` drifts between deploys | Worked around with stash, persistent friction |
| Low | Music tagging only has energy_level + mood, no audience suitability | Tier 3 |
| Low | Curator V2 ENABLE_CURATOR_V2 read pattern inconsistent with Phase 3 CD env.* pattern | Cleanup at Milestone 3.3 |
| Low | Phase 3 prompt still emits `min_quality: 6-7` defaults | Re-evaluate post-W2 (Curator does its own scoring) |
| Low | `clip-analysis.ts` processes raw 4K for color/motion/brightness | Free speedup available post-W5 by reading normalized parent; filed to 3.3 |

**Resolved in Phase 1, 2, 2.5, cleanup:** see v4.0 archive.

**Resolved in Phase 3 W1:**
- ✅ Creative Director makes too few decisions (Phase 3 CD makes ~10x more decisions per brief — slot count, energy curve, color treatment, per-slot pacing/transitions/cuts/overlays/aesthetic)
- ✅ No Zod on Creative Director (Phase 3 CD has Zod corrective retry; Phase 2 CD path retained as-is)
- ✅ runPlanning was dropping video_type column (W1 fixed)
- ✅ planJob() dead code (deleted in W1)

**Resolved in Phase 3 W5:**
- ✅ Render-time clip prep slow (6-17 min) — segments now cut from 1080p normalized parent already on R2
- ✅ Segment analysis inconsistency on varying source formats — Gemini Pro now always sees 1080×1920 30fps H.264
- ✅ `/ugc-ingest` 500MB cap blocking realistic 4K uploads — raised to 2GB (streaming keeps RAM flat)
- ✅ 53 parent / 182 segment library held stale Phase 1 analysis — dropped and re-ingested through new pipeline

---

## 15. File Structure (post-W1 + W5)

```
src/
├── config/          — env.ts (incl. ENABLE_PHASE_3_CD), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (incl. Phase3CreativeBrief, BriefSegment, color/transition/overlay enums, Asset.pre_normalized_r2_key — W5), video-types.ts
├── lib/             — ffmpeg.ts, gemini.ts (Flash legacy),
│                      gemini-segments.ts (Phase 1, Pro),
│                      clip-embed.ts, keyframe-extractor.ts,
│                      segment-processor.ts (Phase 1+2.5),
│                      segment-trimmer.ts (Phase 2),
│                      parent-normalizer.ts (Phase 3 W5: preNormalizeParent, 1080×1920 30fps H.264 CRF 22),
│                      retry-llm.ts (Phase 2 cleanup, used by Phase 3 CD),
│                      format-full-brief.ts (Phase 2 cleanup),
│                      r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts,
│                      music-selector.ts, template-config-builder.ts,
│                      clip-analysis.ts, video-type-selector.ts (Phase 2 only)
├── workers/         — ingestion.ts, clip-prep.ts, transcriber.ts, audio-mixer.ts,
│                      sync-checker.ts, exporter.ts, qa-checker.ts, renderer.ts,
│                      pipeline.ts (writes video_type post-W1), music-ingest.ts
├── agents/          — creative-director.ts (Phase 2 generateBriefPhase2),
│                      creative-director-phase3.ts (Phase 3 generator, Zod corrective),
│                      creative-director-phase3-schema.ts (Zod schema),
│                      creative-director-dispatch.ts (flag-gated routing),
│                      asset-curator.ts (V1), asset-curator-v2.ts (Phase 2),
│                      asset-curator-dispatch.ts (Phase 2),
│                      curator-v2-retrieval.ts (Phase 2),
│                      copywriter.ts,
│                      context-packet.ts (uses CD dispatcher post-W1)
│   └── prompts/     — creative-director.md (Phase 3, 462 lines, 4 examples),
│                      creative-director-phase2.md (Phase 2 rollback prompt, 210 lines),
│                      asset-curator.md, copywriter.md,
│                      segment-analyzer.md (Phase 1),
│                      asset-curator-v2.md (Phase 2)
├── templates/       — Root.tsx, components/, layouts/ (Phase 2)
│                      [Phase 3 W4 will replace with parameterized composition]
├── scripts/         — backfill-segments.ts, backfill-segment-clips.ts,
│                      apply-migration.ts (Phase 2 cleanup runner),
│                      smoke-test-cd-phase3.ts (W1),
│                      test-pre-normalize.ts (W5 smoke harness),
│                      test-ingestion-w5.ts (W5 end-to-end verification),
│                      clean-slate-nordpilates.ts (W5 clean-slate script),
│                      test-clip.ts, test-segment-analyzer.ts,
│                      test-segment-trimmer.ts, test-curator-v2.ts,
│                      test-agents.ts, test-agents-live.ts, test-phase5.ts,
│                      migrations/001 through 007,
│                      seed-brand.ts, upload-brand-logos.ts
├── index.ts         — HTTP API + BullMQ workers
└── brands/          — nordpilates.json, ketoway.json, carnimeat.json
```

---

## 16. Deployment

```bash
ssh root@95.216.137.35
cd /home/video-factory
git pull && npm install && npm run build && systemctl restart video-factory
journalctl -u video-factory -f
```

**Known VPS friction:** `package-lock.json` drifts. Stash before checking out a new branch:
```bash
git stash push -m 'vps-lock-drift' package-lock.json && git checkout <branch> && git stash drop
```

**For SQL migrations that touch RPC return types:** use `DROP FUNCTION` + `CREATE FUNCTION` + `NOTIFY pgrst, 'reload schema'`.

**For Anthropic 529 / Gemini 503 errors:** `withLLMRetry` (Phase 2 cleanup) handles retries automatically.

**For pushing branches from VPS (no GitHub credentials):** the standard `git push origin <branch>` works because origin remote URL is configured. Used during W1 ship to push `feat/phase3-w1-cd` for laptop squash-merge.

---

## Recently Shipped

### Phase 3 W5 (shipped 2026-04-16)

Released as squashed commit `f1b8120` on `origin/main`, tagged `phase3-w5-complete`. Four-commit feature branch (`feat/phase3-w5-ingestion`) consolidated into one release. Pre-normalization pipeline live, clean-slate drop executed, first production ingestion verified. Side fixes: `/ugc-ingest` 2GB cap (`22e977e`), n8n S8 30-min timeout (workflow-side). Full details in §11.6.

### Phase 3 W1 (shipped 2026-04-15)

Released as squashed commit `df6a326` on `origin/main`, tagged `phase3-w1-complete`. Five-commit feature branch (`feat/phase3-w1-cd`) consolidated into one release. Key outcomes documented in §11.5.

### Phase 2 cleanup (shipped 2026-04-14)

Released as squashed commit `269ff99` on `origin/main`, tagged `phase2-complete`. See v4.0 archive for full details.

---

## 17. Document Status

- This file (v5.1) replaces v5.0. Delete v5.0.
- `MVP_PROGRESS (8).md` — current (supersedes (7))
- `PHASE_3_DESIGN.md` — current, W1 + W5 marked shipped, W2-W4 planned
- `SUPABASE_SCHEMA.md` — current (migration 007 applied)
- `VPS-SERVERS.md` — current (no W5 changes)
- `PHASE_2_CURATOR_BRIEF.md` — historical (fully implemented)
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — historical (Phase 1)
- `HANDOFF.md` — Day 4 context, historical