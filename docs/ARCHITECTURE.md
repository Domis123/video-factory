# Video Factory — Architecture v3.6

**Last updated:** 2026-04-12 17:45 UTC
**Status:** ✅ **Two videos delivered end-to-end. Day 5 polish verified. Week 2 architecture lift starting.**

---

## 1. System Overview

Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30–60s) for TikTok/IG/YT.

**Core differentiator:** Real UGC authenticity + full end-to-end ownership + brand-perfect templating. Not competing with AI avatar tools (Arcads, HeyGen, Creatify). Not competing with generative video models (Runway, Kling, Sora). Competing with manual editing workflows that cost $50–200 per video and scale linearly with human labor.

**MVP scope:** 3 brands (nordpilates, ketoway, carnimeat), 1 video type (tips-listicle), 5–10 videos/week.
**Target scale:** 30–50 brands, 4 video types, 150–300 videos/week.

---

## 2. Proven Performance (2 videos)

| Phase | Video 1 | Video 2 | Notes |
|---|---|---|---|
| Planning (3 Claude agents) | 46s | ~45s | Creative Director → Asset Curator → Copywriter |
| Clip prep (5 × 4K → 1080p) | 17 min | **6 min** | Variance is real — depends on source encoder difficulty |
| Transcription (whisper.cpp) | 2s | <1s | **Now segment-windowed** (Day 5 fix) |
| Remotion render (1050–1140 frames) | 8 min | 8 min | Chromium headless, single pass |
| Audio mix (music + ducking) | 2s | 2s | FFmpeg sidechain compressor |
| Sync check | <1s | <1s | A/V drift 0ms both runs |
| Platform export (3 formats) | 2 min | ~1.5 min | TikTok + Instagram + YouTube |
| Auto QA (8 checks) | 4s | 3s | FFprobe-based |
| **Total** | **28 min** | **16 min** | Peak RAM 265MB on 8GB VPS |

**Cost per video:** ~$0.55 in API calls. Near-zero marginal infra cost.
**Capacity at current timing:** ~50–90 videos/day on single CX32. Pre-normalization (post-Phase 1) pushes this to 100+/day.

---

## 3. Infrastructure

```
┌─────────────────────┐     ┌──────────────────────────┐
│   n8n Server         │     │   Video Factory VPS       │
│   46.224.56.174      │────▶│   95.216.137.35           │
│   (Orchestrator)     │     │   CX32: 4 vCPU, 8GB RAM  │
└──────────┬──────────┘     └──────────┬───────────────┘
           │                           │
     ┌─────┴─────┐              ┌─────┴─────┐
     │  Google    │              │  Supabase  │
     │  Sheets    │              │  Upstash   │
     │  Drive     │              │  R2        │
     └───────────┘              │  Claude    │
                                │  Gemini    │
                                └───────────┘
```

| Service | Host | Purpose | Cost/mo |
|---|---|---|---|
| n8n | Hetzner 46.224.56.174 | Workflow orchestration | ~€4.50 |
| VPS | Hetzner 95.216.137.35 (CX32 8GB) | Processing engine | ~€8.50 |
| Supabase | Managed free tier | State + catalog + RLS + **pgvector (Week 2)** | $0 |
| Upstash Redis | Free tier, drainDelay 120s | BullMQ queue | $0 |
| R2 | Cloudflare, zero egress | Media storage | ~$1 |
| Claude API | Anthropic Sonnet | 3 creative agents | ~$0.50/video |
| Gemini API | Google Flash → **2.5 Pro (Week 2)** | Clip analysis at ingestion | ~$0.05–0.10/clip |
| **CLIP self-hosted** | `@xenova/transformers` on VPS | Semantic embeddings (Week 2) | $0 |

### VPS Binaries

| Binary | Path | Purpose |
|---|---|---|
| ffmpeg 6.1.1 | /usr/bin/ffmpeg | Clip prep, audio, encoding, keyframe extract |
| ffprobe 6.1.1 | /usr/bin/ffprobe | Auto QA checks |
| whisper-cli | /opt/whisper.cpp/build/bin/whisper-cli | Env: `WHISPER_BIN` |
| whisper model | /opt/whisper.cpp/models/ggml-base.en.bin | Env: `WHISPER_MODEL` |
| chromium | /usr/bin/chromium-browser | Remotion dependency |
| **CLIP ONNX model** | `~/.cache/transformers/Xenova/clip-vit-base-patch32` | Auto-downloaded on first use, ~150MB |

---

## 4. Data Flow (Proven, with Week 2 changes marked)

### Video Production Pipeline

```
Operator types idea seed in Jobs sheet
  ↓ S1 polls 30s
Supabase INSERT (status: planning) + BullMQ enqueue planning
  ↓ VPS Planning Worker
  1. Creative Director (Claude, ~12s) → brief, template, segments [+ archetype, Phase 2]
  2. Asset Curator (Claude, ~22s) → clip selections [vector search + self-critique, Phase 2]
  3. Copywriter (Claude, ~10s) → hook, CTA, overlays, captions
  4. Music: brief-matched track (ENABLE_MUSIC_SELECTION, Day 6)
  5. Template config (still off until ENABLE_DYNAMIC_PACING)
  → Context Packet assembled → status: brief_review
  ↓ P2 syncs Brief Summary + Hook Text + preview_url to Sheet (5 min)
Operator approves in Sheet
  ↓ S2 polls 30s
Supabase UPDATE (status: queued) + BullMQ enqueue rendering
  ↓ VPS Rendering Worker
  1. Clip prep: download from R2, normalize 4K → 1080x1920/30fps (~6–17 min)
  2. Transcription: whisper.cpp on segment audio, ~2s [segment-windowed, Day 5 fix]
  3. Remotion: bundle → Chromium → 1050–1140 frames → MP4, ~8 min
  4. Audio mix: UGC audio + selected music + sidechain ducking, ~2s
  5. Sync check: A/V drift verification, instant
  6. Platform export: TikTok/IG/YT separate encodes, ~2 min
  7. Auto QA: 8 programmatic checks, ~4s
  → status: human_qa, final_outputs populated, preview_url signed
  ↓ Operator reviews, approves
S3 → status: delivered
```

### UGC Ingestion (current vs Phase 1)

**Current:**
```
Drive brand folder → S8 manual run → download batch →
BRAND_MAP lookup → POST /ugc-ingest → stream to disk →
ffprobe → if >50MB downscale 720p → Gemini Flash tags →
R2 upload → Supabase assets row → Drive Processed/
```

**After Phase 1:**
```
... (same up to Gemini Flash legacy row) ...
→ Supabase assets row (legacy, unchanged)
→ Gemini 2.5 Pro segment analyzer (3–10 segments per clip)
→ For each segment:
     ffmpeg keyframe extract at midpoint
     CLIP embed (512-dim) via @xenova/transformers
     Upload keyframe to R2 keyframes/{brand}/{uuid}.jpg
     INSERT asset_segments row with embedding
→ Drive Processed/
```

**Backward compatible:** legacy `assets` row still written first. Segment failures don't block ingestion. The current Asset Curator is unchanged in Phase 1 — segments only become curator inputs in Phase 2.

### Music Ingestion (unchanged)

```
Drive Music Uploads/ → S7 → download → base64 header →
POST /music-ingest → stream → ffprobe → R2 → Supabase →
Sheet → move to Processed/
```

---

## 5. Database

### brand_configs (3 rows) ✅
nordpilates, ketoway, carnimeat. Colors, fonts, caption_preset JSONB, logo_r2_key, voice_guidelines, allowed_video_types.

### assets (54 rows, nordpilates) ✅
Real Gemini Flash tags. Total 27 min footage.
**Week 2 status:** stays as-is. Not dropped, not re-tagged. Becomes the parent table for `asset_segments`.

### asset_segments (NEW, Phase 1) ⏳
```sql
id, parent_asset_id, brand_id, segment_index,
start_s, end_s, duration_s,
description, visual_tags[], best_used_as[],
motion_intensity, recommended_duration_s, has_speech, quality_score,
keyframe_r2_key, embedding VECTOR(512),
ingestion_model, created_at
```
Target after backfill: 150–500 rows from the existing 54 nordpilates clips.
Indexed via ivfflat on `embedding` for cosine similarity search.

### music_tracks (15 rows) ✅
Deduped. **Day 6:** mood + energy tagged via SQL. Selector activates after `ENABLE_MUSIC_SELECTION=true`.

### jobs (2 rows)
Both in `human_qa`. Context packets assembled, all QA passed, 6 platform exports in R2. Awaiting first `delivered` (blocked on S3 v2 rebuild).

---

## 6. State Machine

```
PLANNING → BRIEF_REVIEW → QUEUED → CLIP_PREP → TRANSCRIPTION →
RENDERING → AUDIO_MIX → SYNC_CHECK → PLATFORM_EXPORT → AUTO_QA → HUMAN_QA → DELIVERED

Rejections: BRIEF_REVIEW → PLANNING, HUMAN_QA → PLANNING or QUEUED
Terminal: DELIVERED, FAILED
```

**Critical rule:** S1 creates jobs as `status: planning` (not idea_seed) to match worker's expected atomic transition.

---

## 7. HTTP API (port 3000)

| Endpoint | Method | Purpose |
|---|---|---|
| /health | GET | Returns `{status: "ok"}` |
| /enqueue | POST | Body: `{queue, jobId}` — add to BullMQ |
| /music-ingest | POST | Stream MP3 + x-track-meta header |
| /ugc-ingest | POST | Stream video + x-asset-meta header. **Phase 1: now also produces asset_segments rows.** |

---

## 8. n8n Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | Verified twice end-to-end |
| S2 | Brief Review | v2 final | ✅ | Verified twice end-to-end |
| S3 | QA Decision | v1 | ⏸ | **Needs v2 rebuild before first `delivered`** |
| S7 | Music Ingest | v2 | ✅ | Working |
| S8 | UGC Ingest | v1 | Manual | **Phase 1 keeps interface stable, only the backend changes** |
| P2 | Periodic Sync | v2 | ✅ | preview_url propagation verified |

---

## 9. Feature Flags (`.env` on VPS)

| Flag | Current | Day 6 Target | Notes |
|---|---|---|---|
| ENABLE_BEAT_SYNC | false | **true** | Code already built |
| ENABLE_COLOR_GRADING | false | **true** | LUT-based, code already built |
| ENABLE_MUSIC_SELECTION | false | **true** | After music tagging |
| ENABLE_DYNAMIC_PACING | false | false | Post-MVP |
| ENABLE_AUDIO_DUCKING | **true** ✅ | true | Active |
| ENABLE_CRF18_ENCODING | **true** ✅ | true | Active |
| FALLBACK_MUSIC_TRACK_ID | `f6a6f64f-...` | (deprecated post-selector) | Die With A Smile |
| WHISPER_BIN | `/opt/whisper.cpp/build/bin/whisper-cli` | same | Absolute path |
| WHISPER_MODEL | `/opt/whisper.cpp/models/ggml-base.en.bin` | same | Absolute path |

---

## 10. Remotion Integration (Critical Patterns)

Four lessons learned the hard way (validated again on Video 2):

**1. Entry point must call `registerRoot()`.**
```typescript
// src/templates/Root.tsx
import { registerRoot } from 'remotion';
import { RemotionRoot } from './RemotionRoot';
registerRoot(RemotionRoot);
```

**2. TypeScript `.js` imports need webpack override.**
```typescript
bundle({
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: { '.js': ['.tsx', '.ts', '.js'] }
    }
  })
})
```

**3. Assets via `publicDir` + `staticFile()`, never absolute paths.**
- Copy assets to `{workDir}/public/` with flat filenames
- Pass `publicDir` to `bundle()`
- Pass bare filenames in inputProps: `clipPaths: { 1: 'seg1-clip0.mp4' }`
- Wrap in components: `<Video src={staticFile(props.clipPaths[1])} />`
- **Watch for position name mismatches between brand_configs and component props** (Day 5: `top_right` vs `top-right` — normalize at the component boundary).

**4. Chrome Headless downloads on first render (~86MB).**
System chromium is only for dependency verification. Remotion brings its own.

---

## 11. Google Sheets

**ID:** `1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`

**Jobs tab (13 columns):** Row Status, Job ID, Brand (dropdown), Idea Seed, Status, Brief Summary, Hook Text, Preview URL, Auto QA, Review Decision (dropdown), Rejection Notes, QA Decision (dropdown), QA Issues (dropdown).

Operator touches 5 columns. Rest auto-populated. **preview_url verified working as of Video 2.**

---

## 12. Quality Roadmap

### Philosophy

Real UGC authenticity is the product. Competitors generate or transform video. Video Factory **curates and composes real footage with brand-perfect templating**. The goal is "authentic UGC that outperforms manually-edited brand content at 10% the cost and 100x the volume."

TikTok/Reels/Shorts reward authenticity, not polish. A 7.5/10 authentic video beats a 9/10 over-produced one on engagement metrics.

### Why Day 5 fixed the floor but not the ceiling

Day 5 fixes were **logical** (preview_url generation, segment-aware whisper, logo position normalization, curator topical alignment). They eliminated bugs. Video 2 has zero technical defects: auto QA passes, A/V sync 0ms, on-topic, logo visible, all platforms exported.

But Video 2 still rates 5–6/10 because the **creative ceiling** of the current architecture is capped. The Asset Curator sees clips through lossy text tags and picks "technically valid" not "best." This is what Week 2 fixes.

### Tier 1 — Day 6, free, in progress

| Action | Impact | Status |
|---|---|---|
| Tag music tracks (mood + energy) | Unlocks selector | 🔄 SQL ready |
| `ENABLE_COLOR_GRADING=true` | Pro look | ⏳ Flip after tagging |
| `ENABLE_BEAT_SYNC=true` | Cuts on beats | ⏳ Same |
| `ENABLE_MUSIC_SELECTION=true` | Brief-matched music | ⏳ Same |
| Pass full Gemini description to curator (not just tags) | Slightly better picks | ⏳ Prompt-only change |

**Expected lift:** 5–6/10 → 6.5–7/10. Validation that the existing arch can hit mid-range.

### Tier 2 — Week 2, ingestion overhaul (~$5/mo)

**Phase 1 — Ingestion + database** (current brief: `INGESTION_OVERHAUL_AGENT_BRIEF.md`)
- Enable Supabase pgvector
- Create `asset_segments` table with `vector(512)` embedding column
- Self-host CLIP ViT-B/32 via `@xenova/transformers`
- Gemini 2.5 Pro segment-list ingestion (3–10 segments per clip)
- Keyframe extract + CLIP embed per segment
- Backfill script for the existing 54 clips
- Backward compatible: pipeline produces identical output until Phase 2

**Phase 2 — Curator overhaul** (separate brief, after Phase 1)
- Asset Curator queries `asset_segments` via vector similarity (top-15 candidates per brief segment)
- LLM picks best from candidates
- Self-critique loop: score each pick 1–10, swap any below 7
- Add `archetype` field to Creative Director output (slow_demo / tip_list / hype_reel / before_after / talking_head_broll)
- Variable clip count per archetype (3–12 instead of fixed 5)

**Phase 3 — Renderer adjustments** (separate brief, after Phase 2)
- Remotion composition handles N segments
- Clip prep uses segment trim windows directly (no guessing)
- Pre-normalization at ingestion (drops render time another ~6 min)

**Expected lift:** 7/10 → 8/10.

### Tier 3 — Month 2

1. Quality Director Agent (post-render scoring, after 20–30 calibrated videos)
2. Multi-language support
3. Real brand logos (replace placeholders)
4. A/B variant generation (3 versions per job)

### Explicitly Rejected

Recommendations NOT adopted from external SOTA critique:

- **Runway/Kling/Veo generative enhancement** — destroys UGC authenticity, the product's entire value proposition.
- **Twelve Labs video search** — redundant with self-hosted CLIP + pgvector at zero cost.
- **GPU hosting** — Remotion is Chromium CPU-bound, no benefit.
- **Upgrade planning agents to Gemini Pro / GPT-5** — Claude Sonnet is not the bottleneck. The curator's *eyes* are. Replacing the Creative Director or Copywriter without evidence of weakness is how regressions get introduced.
- **CapCut API integration** — Remotion is more controllable and already working.
- **Generative B-roll fills** — expensive ($0.50–$2 per 5s clip) and looks synthetic.

### Budget Projection

| Volume | Monthly Cost | Notes |
|---|---|---|
| 5–10 videos/week (MVP) | ~$30 | Current state |
| 50 videos/week | ~$80 | Claude API scales linearly |
| 100 videos/week | ~$150 | Consider CX42 upgrade |
| 150 videos/week (target) | ~$250 | CX52 for parallel rendering |
| 300 videos/week | ~$400 | Multiple workers + self-hosted Redis |

All within the $400–500/mo cap. Week 2 ingestion adds ~$5/mo across all volumes.

---

## 13. Architecture Rules (18 total)

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
16. n8n Sheet writes after HTTP nodes reach back through `$('Upstream Node').item.json` to avoid losing data to response replacement.
17. Supabase needs permissive RLS policies for anon writes OR service role key.
18. **(NEW Week 2)** Embeddings are self-hosted only. No external embedding APIs. CLIP runs in `@xenova/transformers` on the VPS, costs zero, latency is acceptable. Same rule applies to any future embedding work.

---

## 14. Known Issues

| Priority | Issue | Status |
|---|---|---|
| Medium | S3 QA Decision v1 has old bugs | **Still pending v2 rebuild** |
| Low | Render time variance (16–28 min) | Investigate after 5+ data points |
| Low | job_events null to_status on some error paths | Fix remaining log call |
| Low | Upstash token leaked in chat history | Rotate before production |

**Resolved Day 5:**
- ✅ preview_url not written to jobs table
- ✅ Whisper extracts full clip instead of segment window
- ✅ Logo not visible in rendered video
- ✅ Asset Curator picks off-topic clips (logical fix; creative fix is Week 2)

---

## 15. File Structure

```
src/
├── config/          — env.ts (flags + WHISPER paths), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts, video-types.ts
├── lib/             — ffmpeg.ts, gemini.ts, gemini-segments.ts (Phase 1),
│                      r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts, music-selector.ts,
│                      template-config-builder.ts, clip-analysis.ts,
│                      video-type-selector.ts,
│                      clip-embed.ts (Phase 1),
│                      keyframe-extractor.ts (Phase 1)
├── workers/         — ingestion.ts (extended in Phase 1), clip-prep.ts,
│                      transcriber.ts, audio-mixer.ts, sync-checker.ts,
│                      exporter.ts, qa-checker.ts, renderer.ts, pipeline.ts,
│                      music-ingest.ts
├── agents/          — creative-director.ts, asset-curator.ts (overhauled in Phase 2),
│                      copywriter.ts, context-packet.ts
│   └── prompts/     — creative-director.md, asset-curator.md, copywriter.md,
│                      segment-analyzer.md (Phase 1)
├── templates/       — Root.tsx (registerRoot), RemotionRoot.tsx
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark,
│   │                  TransitionEffect, SegmentVideo (all use staticFile)
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
├── scripts/         — seed-brand.ts, upload-brand-logos.ts, test-*,
│                      backfill-segments.ts (Phase 1),
│                      test-clip.ts (Phase 1),
│                      test-segment-analyzer.ts (Phase 1),
│                      migrations/001_asset_segments.sql (Phase 1)
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

`npm install` matters when the agent adds new dependencies (e.g. `@xenova/transformers` in Phase 1). Skipping it leads to mysterious "module not found" crashes after restart.

---

## 17. Document Status

- This file (v3.6) replaces v3.5. Delete v3.5.
- `MVP_PROGRESS.md` — current
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — Week 2 Phase 1, ready for agent
- `HANDOFF.md` — still useful for context, but the Day 5 section is now historical
