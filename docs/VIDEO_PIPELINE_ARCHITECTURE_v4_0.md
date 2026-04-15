# Video Factory — Architecture v4.0

**Last updated:** 2026-04-15
**Status:** ✅ **Phase 1, Phase 2, Phase 2.5, and Phase 2 cleanup shipped and live on origin/main.** Tagged `phase2-complete`. Phase 3 designed and locked, pre-implementation. See `docs/PHASE_3_DESIGN.md` for the Phase 3 source of truth.

**What changed in v4.0:** Phase 3 design locked. Architecture rules expanded with Phase-3-specific principles. Model assignments and component descriptions updated to reflect upcoming Phase 3 changes. Phase 2 cleanup outcomes documented (retry helper, Zod corrective, full_brief column, V2 prompt variety). Historical v3.9 content preserved where it doesn't contradict Phase 3.

---

## Phase 3 (planned, pre-implementation)

Phase 3 eliminates "every video feels the same" by giving the Creative Director open-ended creative freedom and rebuilding the Remotion composition as parameterized instead of templated. Five workstreams (W1: CD rewrite, W2: Curator V2 update, W3: Copywriter update, W4: Remotion parameterized composition, W5: clean-slate ingestion). Three milestones (3.1, 3.2, 3.3). Behind feature flags `ENABLE_PHASE_3_CD` and `ENABLE_PHASE_3_REMOTION` until final flip.

**Source of truth:** `docs/PHASE_3_DESIGN.md`. All Phase 3 agent briefs reference that doc. This architecture doc points to it; do not duplicate the design content here.

**Key Phase 3 architecture decisions:**
- Creative Director outputs a richer schema (creative_vision paragraph, color_treatment, per-slot transition_in + internal_cut_style + aesthetic_guidance)
- Remotion becomes a single parameterized composition, no template variants
- Existing 182 segments dropped, library re-ingested via new pre-normalized pipeline
- 8 color treatments, brand-restricted via brand_config.allowed_color_treatments
- Slot count variable 3-12, no fixed 5
- Vibe input from operator (free-text, optional) or CD-generated when blank

---

## 1. System Overview

Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30–60s) for TikTok/IG/YT.

**Core differentiator:** Real UGC authenticity + full end-to-end ownership + brand-perfect templating. Competing with manual editing workflows that cost $50–200 per video.

**MVP scope:** 3 brands (nordpilates, ketoway, carnimeat), 1 video type, 5–10 videos/week.
**Target scale:** 30–50 brands, 4 video types, 150–300 videos/week.

**What changed in v3.9:** First production V2 video rated 4-5/10 surfaced three quality bottlenecks that V1 had been masking. V2 is functionally complete and strictly better than V1. The remaining quality gap is structural (content + templates + Creative Director decisions), not picker quality. Phase 3 plan revised to be the biggest priority remaining.

---

## 2. Proven Performance

| Phase | Video 1 (Apr 11, V1) | Video 2 (Apr 12, V1) | First V2 video (Apr 14) |
|---|---|---|---|
| Planning (CD + Curator + Copywriter) | 46s | 45s | ~5 min (curator dominant) |
| Clip prep (4K → 1080p) | 17 min | 6 min | (unchanged, Phase 3 target) |
| Transcription (whisper.cpp) | 2s | <1s | (unchanged) |
| Remotion render | 8 min | 8 min | (unchanged) |
| Audio mix + sync check | 2s | 2s | (unchanged) |
| Platform export (3 formats) | 2 min | 1.5 min | (unchanged) |
| Auto QA | 4s | 3s | (unchanged) |
| **Total** | **28 min** | **16 min** | **~16 min** |
| **Quality rating** | **6/10** | **5-6/10** | **4-5/10** |

**The V2 rating drop is not a regression.** Rating methodology is honest, ratings are subjective, and 4-5 vs 5-6 is within noise. The substance is that V2 picks intentionally (with reasoning) where V1 picked randomly, but the *rest of the pipeline* hasn't caught up. See section 10.

**Cost per video:** ~$0.75 (Sonnet CD + Copywriter $0.25, Gemini ingestion ~$0.06/clip amortized, Gemini curator ~$0.20). Inside budget at every scale tier.

---

## 3. Infrastructure (unchanged from v3.8)

| Service | Host | Purpose | Cost/mo |
|---|---|---|---|
| n8n | Hetzner 46.224.56.174 | Workflow orchestration | ~€4.50 |
| VPS | Hetzner 95.216.137.35 (CX32 8GB) | Processing engine | ~€8.50 |
| Supabase | Managed free tier | State + catalog + RLS + pgvector | $0 |
| Upstash Redis | Free tier, drainDelay 120s | BullMQ queue | $0 |
| R2 | Cloudflare, zero egress | Media storage (clips + keyframes + pre-trimmed segment clips) | ~$1.02 |
| Claude API (Sonnet 4.6) | Anthropic | Creative Director + Copywriter | ~$0.25/video |
| Gemini API (3.1 Pro Preview) | Google | Ingestion analyzer + Asset Curator V2 | ~$0.06/clip + ~$0.20/video |
| CLIP self-hosted | `@xenova/transformers` on VPS | Semantic embeddings (512-dim) | $0 |

### Model Assignments (locked)

| Stage | Model | Rationale |
|---|---|---|
| Ingestion analyzer | **Gemini 3.1 Pro Preview** | Native video input, segment lists with editor-grade descriptions |
| Asset Curator V2 | **Gemini 3.1 Pro Preview** | Watches actual pre-trimmed segment videos from R2, not text tags |
| Creative Director | **Claude Sonnet 4.6** | Planning structure — slated for Phase 3 enhancement (archetype + variable slots) |
| Copywriter | **Claude Sonnet 4.6** | Strongest model for hooks/CTAs |

### Agent Roles (Phase 3 behavior)

**Creative Director** — Claude Sonnet 4.6. Reads brand_config + idea_seed + optional vibe + library overview. Outputs a rich creative brief: creative_vision paragraph, slot count (3-12), per-slot energy curve, color_treatment, per-slot pacing/cut style/transitions/text overlay structure/clip requirements with aesthetic guidance, and music constraints. In Phase 3, CD takes on much more creative responsibility — vibe interpretation, energy curve design, color treatment selection, per-slot creative decisions. See `docs/PHASE_3_DESIGN.md` for the full output schema.

**Asset Curator V2** — Gemini 3.1 Pro Preview. CLIP retrieval via `match_segments` RPC → FAST PATH R2 fetch of pre-trimmed clip (Phase 2.5) → Pro pick → self-critique. Dispatched via `asset-curator-dispatch.ts`, which is imported by `context-packet.ts`. In Phase 3, Curator V2 reads the new `aesthetic_guidance` field per slot and the global `creative_vision` paragraph as additional context. Hard requirements (mood, content_type, min_quality) remain authoritative; aesthetic_guidance and creative_vision are interpreted as flavor.

**Copywriter** — Claude Sonnet 4.6. Generates hooks, captions, CTAs. In Phase 3, Copywriter also owns per-slot overlay text generation (CD specifies overlay style/position/animation/char_target, Copywriter fills in the actual text per slot in tone-consistent fashion). Reads the global creative_vision paragraph for tone consistency across all generated copy.

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

### Video Production Pipeline (V2 active in production)

```
Operator types idea seed in Jobs sheet
  ↓ S1 polls 30s
Supabase INSERT (status: planning) + BullMQ enqueue planning
  ↓ Planning Worker
  1. Creative Director (Sonnet, ~12s) → brief, template, segment slots
     [Phase 3: archetype, energy_curve, variable slot count, per-slot cut_style]
  2. Asset Curator V2 Dispatcher (~5 min, V2 active since 2026-04-13)
     2a. Reads ENABLE_CURATOR_V2 flag on every call
     2b. Routes to V2: per-slot CLIP text embed → match_segments RPC → top 15 candidates
     2c. For each candidate: trimSegmentFromR2 → FAST PATH (R2 fetch ~5MB) if clip_r2_key, else SLOW PATH
     2d. Parallel upload to Gemini Files API
     2e. Single Pro call with 15 trimmed clips + brief → picker returns segment_id + score + reasoning
     2f. Self-critique pass if score < 7
     2g. Cleanup in finally: Gemini files + local trims + parent cache
     2h. Dispatcher reshapes V2 output to V1's ClipSelectionList shape
  3. Copywriter (Sonnet, ~15s) → hooks, CTAs, overlays
  4. Music selector → weighted random over tagged tracks
  5. Brief persisted to Supabase + brief_review status, P2 syncs to sheet
  ↓ S2 (human approval)
     [Cleanup commit: brief_summary column with flattened picks for human review]
  ↓ Rendering Worker
  6. Clip prep: 4K → 1080p (Phase 3 target: pre-normalized at ingestion)
  7. Remotion composition render (8 min)
     [Phase 3: variable slot count, multiple template variants per video type]
  8. Audio mix + beat sync
  9. Platform export (3 formats)
  10. Auto QA (ffprobe checks)
  ↓ S3 (human QA — v2 rebuild pending)
delivered
```

### Ingestion Pipeline (Phase 1 + 2.5)

```
Operator drops UGC file
  ↓ S8 polls or manual upload
POST /ugc-ingest with x-asset-meta JSON header
  ↓ Ingestion Worker
  1. Stream file to R2 at assets/{brand_id}/{uuid}.MOV
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

### `match_segments` RPC

Takes `query_embedding` as TEXT (not VECTOR), casts internally. supabase-js doesn't reliably serialize vectors to pgvector types. See migration 005 for current definition.

---

## 6. R2 Storage Layout

```
assets/{brand}/{uuid}.MOV            — original UGC parent files
keyframes/{brand}/{segment_uuid}.jpg — single-frame keyframes (Phase 1)
segments/{brand}/{segment_uuid}.mp4  — pre-trimmed 720p mp4s (Phase 2.5)
music/{brand}/{track}.mp3
logos/{brand}/{variant}.png
renders/{job_id}/{format}.mp4
```

Storage growth from Phase 2.5: +355 MB for 182 existing segments. Negligible cost.

---

## 7. HTTP API (port 3000)

Unchanged from v3.8. `/ugc-ingest` now writes pre-trimmed clips alongside keyframes and assets.

---

## 8. n8n Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | |
| S2 | Brief Review | v2 final | ✅ | **Cleanup commit: add `brief_summary` column for human-readable picks** |
| S3 | QA Decision | v1 | ⏸ | Needs v2 rebuild before first `delivered` |
| S7 | Music Ingest | v2 | ✅ | |
| S8 | UGC Ingest | v1 | Manual | Backend writes pre-trimmed clips + segments |
| P2 | Periodic Sync | v2 | ✅ | Confirmed working post-V2 deploy |

---

## 9. Feature Flags (`.env` on VPS, current state)

| Flag | Current | Notes |
|---|---|---|
| ENABLE_BEAT_SYNC | true | Day 6 |
| ENABLE_COLOR_GRADING | true | Day 6 |
| ENABLE_MUSIC_SELECTION | true | Day 6 |
| ENABLE_AUDIO_DUCKING | true | Day 4 |
| ENABLE_CRF18_ENCODING | true | Day 4 |
| ENABLE_DYNAMIC_PACING | false | Phase 3 |
| **ENABLE_CURATOR_V2** | **true** ✅ | **Live in production since 2026-04-13 13:46 UTC** |
| GEMINI_INGESTION_MODEL | `gemini-3.1-pro-preview` | Pin |
| GEMINI_CURATOR_MODEL | (unset, defaults to ingestion model) | Correct |

---

## 10. First V2 Production Video — What It Taught Us

### The render

Job `d74679d2-3c62-4e10-8e03-6da774b55dc1`, idea seed "5 minute pilates abs burner for busy moms", brand nordpilates, template `hook-demo-cta`, 35s, 5 segments. Rendered end-to-end successfully on 2026-04-14 morning. Operator rating: **4-5/10**.

### What V2 did right

- Dispatcher routed correctly through `context-packet.ts`
- Retrieval returned 15 candidates per slot (no zero-result issues)
- All FAST PATH on candidates (pre-trim worked)
- All 5 slots returned non-placeholder picks
- Pro reasoning strings present and coherent
- 5/5 unique parent assets (variety preference engaged)
- Hook (slot 0) and closer (slot 4) were genuinely good

### What's still wrong

Three problems, three different layers, three different fix scopes:

**1. Library content gap (no code fix possible).** Only 23 pure exercise segments in nordpilates, of which ~3-6 are truly ab-focused. V2 cannot pick clips that don't exist. Every "abs" video will reuse the same small pool.

**2. Creative Director monotony (Phase 3).** CD makes only 3 decisions (video type, brief, template). It does NOT decide pacing, energy curve, archetype, slot count, or visual style. So every brief → same template → same structural shape → videos feel like the same video repeated with different content.

**3. V2 prompt gap on visual variety (cleanup commit, small fix).** Variety preference prevents same-parent reuse but allows visually similar segments across slots. Two slots in the rendered video picked nearly the same clip from different parents.

### Why this is the right outcome

Phase 2 fixed the curator. The curator was the most visible bottleneck because it could be measured directly. With V2 working, two other bottlenecks become visible: content depth and pipeline structural variety. Both were always there, but V1's random text-tag picking masked them. **A 7+/10 video tonight would have been worse for the project long-term** because it would have hidden the deeper structural issues that bite at scale.

---

## 11. Phase 3 Plan — Biggest Quality Unlock Remaining

### 3a. Creative Director: archetype + variable slots

**New CD output schema:**
```ts
{
  video_type: "workout-demo" | "before-after" | ...,
  archetype: "calm-instructional" | "high-energy-listicle"
           | "transformation-story" | "tip-stack" | "before-after" | "myth-buster",
  energy_curve: "build" | "peak-fade" | "steady" | "alternating",
  slot_count: 3-8,
  slots: [
    {
      index: 0,
      role: "hook",
      description: "...",
      valid_segment_types: [...],
      min_quality: 7,
      cut_style: "hard-cut" | "fade" | "slide" | "zoom",   // NEW
      duration_target_s: 3.5,                                 // NEW, variable
      energy_level: 1-10                                      // NEW, drives music sync
    }
  ],
  template: "hook-demo-cta-v1" | "hook-demo-cta-v2" | ...    // multiple variants per video type
}
```

CD picks archetype based on idea seed semantics. Examples:
- "5 mistakes that hurt your back" → tip-stack, 6 slots, alternating
- "morning flow for stiff backs" → calm-instructional, 4 slots, steady
- "5 min abs burner" → high-energy-listicle, 7 slots, build curve
- "30-day transformation" → before-after, 5 slots, peak-fade

### 3b. Remotion template variants

For each video type, author 2-3 template variants differing in:
- Cut patterns (rapid cuts vs slow holds)
- Overlay positioning and animation style
- Color grading presets per archetype
- Music sync intensity

Templates as separate Remotion compositions, CD picks by name.

### 3c. Pre-normalization at ingestion

Pre-normalize parent clips to 1080p at upload time. Drops clip prep from 6-17 min to ~1 min by eliminating per-render encoding. Same architectural pattern as Phase 2.5 — pay once at ingestion, save every render after.

**Total Phase 3 estimated effort:** 3-4 agent sessions over 4-5 days. Biggest unknown is Remotion template authoring (creative work, not engineering).

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

### In Progress / Next

**Cleanup commit** (today):
- Centralized retry helper for all LLM calls (retry-on-429/503/529/network)
- Schema-aware Zod retry for picker output
- V2 prompt fix for visual variety (segment_id dedup + visual similarity)
- Brief summary column in sheet (S2 workflow change)
- Tag `phase2-complete` from laptop

**Content sprint** (this week):
- Ingest 15-20 more nordpilates workout UGC clips, targeting ab/core variety
- Operator work, agent helps script bulk ingestion
- Unblocks library content ceiling on nordpilates abs videos

**Phase 3** (next week):
- Creative Director archetype + variable slot count + cut styles
- Remotion template variants (2-3 per video type)
- Pre-normalization at ingestion
- Target: 7+/10 sustained across diverse briefs

### Tier 3 (Month 2)

- Quality Director post-render scoring agent
- Music tagging revision (audience-suitability score, not just energy)
- Brief preview HTML page with thumbnails + playable segments
- Multi-language support
- Real brand logos
- A/B variant generation

### Explicitly Rejected (unchanged)

- Runway/Kling/Veo generative enhancement (destroys UGC authenticity)
- Twelve Labs video search (redundant with CLIP + pgvector at zero cost)
- GPU hosting (Remotion is CPU-bound)
- Upgrading Creative Director or Copywriter to Gemini *for the model* (Phase 3 redesign keeps Sonnet but makes the prompt smarter)
- CapCut API integration
- External embedding APIs (rule #18)
- A second Creative Director agent (rule #21 below)

### Budget Projection (unchanged from v3.8)

| Volume | Monthly Cost | Notes |
|---|---|---|
| 5–10 videos/week (MVP) | ~$40 | Current + V2 curator live |
| 50 videos/week | ~$95 | |
| 100 videos/week | ~$170 | CX42 upgrade recommended |
| 150 videos/week (target) | ~$270 | CX52 for parallel rendering |
| 300 videos/week | ~$430 | Multi-worker + self-hosted Redis |

---

## 13. Architecture Rules (28 total, MUST follow)

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
18. Embeddings are self-hosted only. No external embedding APIs. CLIP runs in `@xenova/transformers`.
19. Match models to weakness, not vendor enthusiasm. Sonnet stays at Creative Director and Copywriter. Gemini Pro takes ingestion and curator.
20. Pin Gemini model IDs in env vars. Preview suffixes mean availability may shift before GA.
21. **Pre-trim expensive transforms at ingestion when the output is cacheable and the input fits in storage.** Pay once per source file, not per render.
22. **Never trust CREATE OR REPLACE FUNCTION for return type changes.** Always DROP + CREATE + NOTIFY pgrst for RPC migrations that touch return signature.
23. **Drop approximate vector indexes at small table sizes.** ivfflat cell centroids become stale as rows grow. Sequential scan beats them until `lists ≈ rows / 1000` is meaningful.
24. **Composition is parameterized, not template-instanced.** Phase 3 ships one Remotion composition that reads a brief and renders accordingly. Do not author multiple template variants. Variety comes from CD decisions, not template selection.
25. **Brand consistency lives in small surface area.** Only logo, color palette restrictions (`allowed_color_treatments`), and caption preset are brand-locked. Everything else (cut style, slot count, transitions, energy curve, vibe) is free per video. Resist the urge to template more.
26. **Hybrid structured + free-text fields where LLMs and code both consume the data.** Structured fields for code to act on deterministically. Free-text fields for downstream LLM agents to read for nuance. Use both where both matter (creative_vision + structured fields, aesthetic_guidance + clip_requirements enums, etc.).
27. **Defer polish features in favor of variety features.** Beat-locked music, music ducking, overlay timing sophistication, reference-guided generation — all parked for later phases. Quality variety improvements ship before quality polish improvements.
28. **Clean-slate ingestion when content sprint is incoming.** Don't migrate existing segments to new pipelines when fresh content is about to land anyway. Operator effort goes into new uploads, not data migration.

### Informal rule under consideration (not yet locked)

- **Make existing agents smarter before adding new ones.** When a quality issue feels like "we need another agent," check whether the existing agent is making all the decisions it could. Phase 3 enhances Creative Director instead of duplicating it.

---

## 14. Known Issues

| Priority | Issue | Status |
|---|---|---|
| **High** | No retry logic on LLM calls — Anthropic 529s and Gemini 503s lose entire jobs | Cleanup commit (today) |
| **High** | Brief summary not visible in sheet — humans can't actually see what they're approving | Cleanup commit (today) |
| Medium | Library content gap on nordpilates ab/core exercises | Content sprint (this week) |
| Medium | All videos using same template feel structurally identical | Phase 3 (next week) |
| Medium | Creative Director makes too few decisions | Phase 3 (next week) |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild before first `delivered` |
| Medium | Zod validation failures on picker output do blind retry | Cleanup commit (today) |
| Low | V2 picks visually similar segments across slots | Cleanup commit prompt fix |
| Low | Render time variance (6-17 min on clip prep) | Phase 3 pre-normalization |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | Upstash token leaked in chat history | Rotate before public production |
| Low | VPS `package-lock.json` drifts between deploys | Worked around with stash, persistent friction |
| Low | Tag `phase2-complete` not pushed (VPS lacks GitHub credentials) | Push from laptop when convenient |
| Low | Music tagging only has energy_level + mood, no audience suitability | Tier 3 |

**Resolved in Phase 1:**
- ✅ Asset Curator blind to setup/unusable moments
- ✅ Curator could not discriminate visually similar clips
- ✅ Ingestion metadata too shallow
- ✅ No way to catch bad source files at ingestion

**Resolved in Phase 2:**
- ✅ Curator picked clips from text descriptions only
- ✅ Curator could not apply variety preference across slots

**Resolved in Phase 2.5:**
- ✅ Runtime curator wall time was 18+ minutes — now 4.4 min
- ✅ ivfflat index returning zero candidates for text-derived queries

---

## 15. File Structure

```
src/
├── config/          — env.ts, supabase.ts, redis.ts, r2.ts
├── types/           — database.ts, video-types.ts
├── lib/             — ffmpeg.ts, gemini.ts (Flash legacy),
│                      gemini-segments.ts (Phase 1, Pro),
│                      clip-embed.ts (Phase 1),
│                      keyframe-extractor.ts (Phase 1),
│                      segment-processor.ts (Phase 1 + 2.5 — writes pre-trimmed clips),
│                      segment-trimmer.ts (Phase 2 — FAST PATH + SLOW PATH + parent cache),
│                      retry-llm.ts (cleanup commit, NEW),
│                      r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts,
│                      music-selector.ts, template-config-builder.ts,
│                      clip-analysis.ts, video-type-selector.ts
├── workers/         — ingestion.ts (Phase 1 + 2.5 extended), clip-prep.ts,
│                      transcriber.ts, audio-mixer.ts, sync-checker.ts,
│                      exporter.ts, qa-checker.ts, renderer.ts,
│                      pipeline.ts, music-ingest.ts
├── agents/          — creative-director.ts (Sonnet, Phase 3 enhancement target),
│                      asset-curator.ts (V1 — fallback, kept in codebase),
│                      asset-curator-v2.ts (Phase 2, ACTIVE in production),
│                      asset-curator-dispatch.ts (Phase 2),
│                      curator-v2-retrieval.ts (Phase 2),
│                      copywriter.ts (Sonnet),
│                      context-packet.ts (uses dispatcher)
│   └── prompts/     — creative-director.md, asset-curator.md (V1),
│                      copywriter.md, segment-analyzer.md (Phase 1),
│                      asset-curator-v2.md (Phase 2 — needs visual variety update)
├── templates/       — Root.tsx, RemotionRoot.tsx, components/, layouts/
│                      [Phase 3: multiple template variants per video type]
├── scripts/         — backfill-segments.ts (Phase 1),
│                      backfill-segment-clips.ts (Phase 2.5),
│                      test-clip.ts, test-segment-analyzer.ts,
│                      test-segment-trimmer.ts (Phase 2),
│                      test-curator-v2.ts (Phase 2),
│                      migrations/001 through 005,
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

**For SQL migrations that touch RPC return types:** use `DROP FUNCTION` + `CREATE FUNCTION` + `NOTIFY pgrst, 'reload schema'` pattern. `CREATE OR REPLACE` silently fails for return-type changes.

**For Anthropic 529 / Gemini 503 errors:** the cleanup commit adds a centralized retry helper. Until that ships, expect occasional planning failures during API capacity surges. Workaround: re-create the job after 5-10 minutes.

---

## Recently Shipped

### Phase 2 cleanup (shipped 2026-04-14)

Released as squashed commit `269ff99` on `origin/main`, tagged `phase2-complete`. Seven-commit cleanup branch consolidated into one release. Key outcomes:

- `withLLMRetry` helper wraps all Sonnet + Gemini calls with duck-typed retry logic (handles 429/502/503/504/529, Anthropic overloaded_error, network errors)
- Zod corrective retry on V2 picker — sends schema errors back to Pro, single corrective attempt before fallback. Caught two real "Expected object received array" Pro malformations in production validation runs
- `full_brief` column on jobs table for human-readable brief dumps in operator sheet
- Reusable migration runner via `apply_migration_sql` SECURITY DEFINER function + `apply-migration.ts` script (service_role only, hardened with search_path lock)
- V2 prompt soft visual variety rule with explicit "Visual repetition" signal for library exhaustion detection

Side fixes:
- S1 runaway loop bug (filter on Job-ID-empty without status writeback caused 30s re-fires creating 23 duplicate jobs in 11 minutes)
- BullMQ drain script for emergency queue obliteration
- Migration 005 fix (DROP FUNCTION before CREATE OR REPLACE for return-type changes — formalized as Architecture Rule 22)

See `docs/SESSION_LOG_2026-04-14.md` for full session history.

---

## 17. Document Status

- This file (v3.9) replaces v3.8. Delete v3.8.
- `MVP_PROGRESS.md` — current
- `SESSION_HANDOFF_2026-04-14.md` — handoff notes for next agent
- `PHASE_2_CURATOR_BRIEF.md` — historical (fully implemented)
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — historical (Phase 1)
- `HANDOFF.md` — Day 4 context, historical
