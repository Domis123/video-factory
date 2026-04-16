# Video Factory — Architecture v5.0

**Last updated:** 2026-04-15
**Status:** ✅ **Phase 1, Phase 2, Phase 2.5, Phase 2 cleanup, and Phase 3 W1 shipped and live on origin/main.** Tagged `phase3-w1-complete` (commit `df6a326`). Phase 3 W2-W5 still planned. ENABLE_PHASE_3_CD remains false in production until W2/W3/W4 ship.

**What changed in v5.0:**
- Phase 3 W1 (Creative Director rewrite) shipped behind feature flag.
- Architecture rules unchanged from v4.0 (28 total).
- Model assignments and component descriptions updated to reflect Phase 3 W1 shipped state (dispatcher pattern, Zod corrective retry, new schema).
- Phase 3 design intent moved from "planned" framing to "W1 shipped, W2-W5 planned" framing.
- New section: §11.5 — Phase 3 W1 Ship Report (smoke test results, what landed, what's next).
- Historical v4.0 content preserved where it doesn't contradict W1 shipped state.

---

## Phase 3 Status (W1 shipped, W2-W5 planned)

Phase 3 eliminates "every video feels the same" by giving the Creative Director open-ended creative freedom and rebuilding the Remotion composition as parameterized instead of templated. Five workstreams; three milestones.

**W1 — Creative Director rewrite** ✅ SHIPPED 2026-04-15 (commit `df6a326`, tag `phase3-w1-complete`). Behind `ENABLE_PHASE_3_CD` flag (default false in production).

**W2 — Curator V2 update** ⏳ PLANNED. Read new aesthetic_guidance + creative_vision context.

**W3 — Copywriter update** ⏳ PLANNED. Generate per-slot overlay text, read creative_vision for tone consistency.

**W4 — Remotion parameterized composition** ⏳ PLANNED. Single composition replaces template variants. Largest workstream.

**W5 — Clean-slate ingestion + pre-normalization** ⏳ PLANNED. Independent of W2/W3/W4; **next workstream after W1 per operator decision (2026-04-15)**. Unblocks content sprint with new pre-normalized pipeline.

**Source of truth:** `docs/PHASE_3_DESIGN.md`. All Phase 3 agent briefs reference that doc.

**Key Phase 3 architecture decisions (now landing or shipped):**
- Creative Director outputs a richer schema (creative_vision paragraph, color_treatment, per-slot transition_in + internal_cut_style + aesthetic_guidance) — **W1 SHIPPED**
- Remotion becomes a single parameterized composition, no template variants — W4 planned
- Existing 182 segments dropped, library re-ingested via new pre-normalized pipeline — W5 planned (next)
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

### Ingestion Pipeline (Phase 1 + 2.5; W5 will add pre-normalization)

```
Operator drops UGC file
  ↓ S8 polls or manual upload
POST /ugc-ingest with x-asset-meta JSON header
  ↓ Ingestion Worker
  1. Stream file to R2 at assets/{brand_id}/{uuid}.MOV
     [Phase 3 W5 will: pre-normalize parent to 1080p H.264, upload to parents/normalized/]
  2. INSERT assets row
  3. gemini-segments.analyzeClipSegments (Files API, Pro segment analyzer)
  4. For each segment returned:
     4a. Extract keyframe at midpoint → upload to keyframes/{brand_id}/{segment_uuid}.jpg
     4b. Compute CLIP embedding from keyframe → 512 floats, L2 normalized
     4c. (Phase 2.5) ffmpeg trim to 720p CRF 28 → upload to segments/{brand_id}/{segment_uuid}.mp4
     4d. INSERT asset_segments row with embedding + keyframe_r2_key + clip_r2_key
  5. Delete local parent file
```

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
| 007 | `007_pre_normalized_clips.sql` | **Phase 3 W5, planned** | Add pre_normalized_r2_key TEXT to assets |

---

## 6. R2 Storage Layout

```
assets/{brand}/{uuid}.MOV            — original UGC parent files
keyframes/{brand}/{segment_uuid}.jpg — single-frame keyframes (Phase 1)
segments/{brand}/{segment_uuid}.mp4  — pre-trimmed 720p mp4s (Phase 2.5)
parents/normalized/{brand}/{asset_id}.mp4  — Phase 3 W5: 1080p H.264 normalized parents
music/{brand}/{track}.mp3
logos/{brand}/{variant}.png
renders/{job_id}/{format}.mp4
```

Storage growth from Phase 2.5: +355 MB for 182 existing segments. Negligible cost.

---

## 7. HTTP API (port 3000)

Unchanged from v4.0. `/ugc-ingest` writes pre-trimmed clips alongside keyframes and assets.

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

### W5 — Clean-slate ingestion + pre-normalization (planned, NEXT)

Pre-normalize parent clips to 1080p H.264 at ingestion. New uploads use new pipeline. Existing 182 segments dropped (clean-slate per Architecture Rule 28). Drops render-time clip prep from 6-17 min to ~1 min. Independent of W2/W3/W4. **Per operator decision (2026-04-15), W5 ships next** to unblock content sprint with new pipeline before W2/W3/W4 begin. Estimated 1-2 sessions.

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

### In Progress / Next

**Phase 3 W5** (next workstream per operator decision, 2026-04-15):
- Pre-normalize parent clips to 1080p H.264 at ingestion
- Migration 007 adds `pre_normalized_r2_key` to assets
- Drop existing 182 segments (clean-slate)
- Independent of W2/W3/W4

**Content sprint** (post-W5):
- Ingest 15-20 more nordpilates ab/core UGC clips through new pipeline
- Operator work; agent helps script bulk ingestion
- Unblocks library content ceiling on nordpilates abs videos

**Phase 3 W2/W3/W4** (after content sprint):
- W2: Curator V2 reads aesthetic_guidance + creative_vision
- W3: Copywriter generates per-slot overlay text
- W4: Remotion parameterized composition (largest)

**Milestone 3.3 — flag flip + first Phase 3 production video** when W2/W3/W4 done. Success criterion: 8 of 10 consecutive Phase 3 videos approved.

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
| Medium | Library content gap on nordpilates ab/core exercises | Content sprint (post-W5) |
| Medium | Phase 3 brief operator visibility (throws before DB write) | Acceptable for 3.1 validation window; resolves at W2/W3/W4 ship |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild before first `delivered` |
| Medium | All videos use same template (Phase 2 path) | Phase 3 W4 (parameterized composition) |
| Low | Render time variance (6-17 min on clip prep) | Phase 3 W5 pre-normalization |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | Upstash token leaked in chat history | Rotate before public production |
| Low | VPS `package-lock.json` drifts between deploys | Worked around with stash, persistent friction |
| Low | Music tagging only has energy_level + mood, no audience suitability | Tier 3 |
| Low | Curator V2 ENABLE_CURATOR_V2 read pattern inconsistent with Phase 3 CD env.* pattern | Cleanup at Milestone 3.3 |
| Low | Phase 3 prompt still emits `min_quality: 6-7` defaults | Re-evaluate post-W2 (Curator does its own scoring) |

**Resolved in Phase 1, 2, 2.5, cleanup:** see v4.0 archive.

**Resolved in Phase 3 W1:**
- ✅ Creative Director makes too few decisions (Phase 3 CD makes ~10x more decisions per brief — slot count, energy curve, color treatment, per-slot pacing/transitions/cuts/overlays/aesthetic)
- ✅ No Zod on Creative Director (Phase 3 CD has Zod corrective retry; Phase 2 CD path retained as-is)
- ✅ runPlanning was dropping video_type column (W1 fixed)
- ✅ planJob() dead code (deleted in W1)

---

## 15. File Structure (post-W1)

```
src/
├── config/          — env.ts (incl. ENABLE_PHASE_3_CD), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts (incl. Phase3CreativeBrief, BriefSegment, color/transition/overlay enums), video-types.ts
├── lib/             — ffmpeg.ts, gemini.ts (Flash legacy),
│                      gemini-segments.ts (Phase 1, Pro),
│                      clip-embed.ts, keyframe-extractor.ts,
│                      segment-processor.ts (Phase 1+2.5),
│                      segment-trimmer.ts (Phase 2),
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
│                      test-clip.ts, test-segment-analyzer.ts,
│                      test-segment-trimmer.ts, test-curator-v2.ts,
│                      test-agents.ts, test-agents-live.ts, test-phase5.ts,
│                      migrations/001 through 006,
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

### Phase 3 W1 (shipped 2026-04-15)

Released as squashed commit `df6a326` on `origin/main`, tagged `phase3-w1-complete`. Five-commit feature branch (`feat/phase3-w1-cd`) consolidated into one release. Key outcomes documented in §11.5.

### Phase 2 cleanup (shipped 2026-04-14)

Released as squashed commit `269ff99` on `origin/main`, tagged `phase2-complete`. See v4.0 archive for full details.

---

## 17. Document Status

- This file (v5.0) replaces v4.0. Delete v4.0.
- `MVP_PROGRESS (7).md` — current
- `PHASE_3_DESIGN.md` — current, W1 marked shipped, W2-W5 planned
- `SUPABASE_SCHEMA.md` — current
- `VPS-SERVERS.md` — current (no W1 changes)
- `PHASE_2_CURATOR_BRIEF.md` — historical (fully implemented)
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — historical (Phase 1)
- `HANDOFF.md` — Day 4 context, historical