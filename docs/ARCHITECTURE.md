# Video Factory — Architecture v3.5

**Last updated:** 2026-04-11 14:00 UTC
**Status:** ✅ **First video delivered end-to-end.** Pipeline proven, polish fixes in progress, quality roadmap defined.

---

## 1. System Overview

Automated video production pipeline for social media brands. UGC footage → AI creative planning → branded short-form videos (30-60s) for TikTok/IG/YT.

**Core differentiator:** Real UGC authenticity + full end-to-end ownership + brand-perfect templating. Not competing with AI avatar tools (Arcads, HeyGen, Creatify). Not competing with generative video models (Runway, Kling, Sora). Competing with manual editing workflows that cost $50-200 per video and scale linearly with human labor.

**MVP scope:** 3 brands (nordpilates, ketoway, carnimeat), 1 video type (tips-listicle), 5-10 videos/week.
**Target scale:** 30-50 brands, 4 video types, 150-300 videos/week.

---

## 2. Proven Performance (First Video)

| Phase | Actual Time | Notes |
|---|---|---|
| Planning (3 Claude agents) | 46s | Creative Director → Asset Curator → Copywriter |
| Clip prep (5 × 4K → 1080p) | 17 min | Dominant cost. CRF 18 + slow preset. |
| Transcription (whisper.cpp) | 2s | Local, no API cost |
| Remotion render (1140 frames) | 8 min | Chromium headless, single pass |
| Audio mix (music + ducking) | 2s | FFmpeg sidechain compressor |
| Platform export (3 formats) | 2 min | TikTok + Instagram + YouTube |
| Auto QA (8 checks) | 4s | FFprobe-based |
| **Total** | **28 min** | Peak RAM 265MB on 8GB VPS |

**Cost per video:** ~$0.55 in API calls. Near-zero marginal infra cost.

**Capacity at current timing:** ~50 videos/day on single CX32.
**Capacity after pre-normalization optimization:** ~100+ videos/day.

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
| Supabase | Managed free tier | State + catalog + RLS | $0 |
| Upstash Redis | Free tier, drainDelay 120s | BullMQ queue | $0 |
| R2 | Cloudflare, zero egress | Media storage | ~$1 |
| Claude API | Anthropic Sonnet | 3 creative agents | ~$0.50/video |
| Gemini API | Google Flash (→ Pro in Tier 2) | Clip analysis at ingestion | ~$0.05/video |

### VPS Binaries

| Binary | Path | Purpose |
|---|---|---|
| ffmpeg 6.1.1 | /usr/bin/ffmpeg | Clip prep, audio, encoding |
| ffprobe 6.1.1 | /usr/bin/ffprobe | Auto QA checks |
| whisper-cli | /opt/whisper.cpp/build/bin/whisper-cli | Env: `WHISPER_BIN` |
| whisper model | /opt/whisper.cpp/models/ggml-base.en.bin | Env: `WHISPER_MODEL` |
| chromium | /usr/bin/chromium-browser | Remotion dependency |

---

## 4. Data Flow (Proven)

### Video Production Pipeline

```
Operator types idea seed in Jobs sheet
  ↓ S1 polls 30s
Supabase INSERT (status: planning) + BullMQ enqueue planning
  ↓ VPS Planning Worker
  1. Creative Director (Claude, ~12s) → brief, template, segments
  2. Asset Curator (Claude, ~22s) → clip selections from assets table
  3. Copywriter (Claude, ~10s) → hook, CTA, overlays, captions
  4. Music: fallback track (until ENABLE_MUSIC_SELECTION active)
  5. Template config (empty until ENABLE_DYNAMIC_PACING active)
  → Context Packet assembled → status: brief_review
  ↓ P2 syncs Brief Summary + Hook Text to Sheet (5min)
Operator approves in Sheet
  ↓ S2 polls 30s
Supabase UPDATE (status: queued) + BullMQ enqueue rendering
  ↓ VPS Rendering Worker
  1. Clip prep: download from R2, normalize 4K → 1080x1920/30fps, 17 min
  2. Transcription: whisper.cpp on segment audio, 2s
  3. Remotion: bundle → Chromium → 1140 frames → MP4, 8 min
  4. Audio mix: UGC audio + fallback music + sidechain ducking, 2s
  5. Sync check: A/V drift verification, instant
  6. Platform export: TikTok/IG/YT separate encodes, 2 min
  7. Auto QA: 8 programmatic checks, 4s
  → status: human_qa, final_outputs populated, preview_url signed
  ↓ Operator reviews, approves
S3 → status: delivered
```

### Music Ingestion

```
Drive Music Uploads/ → S7 → download → base64 header →
POST /music-ingest → stream → ffprobe → R2 → Supabase →
Sheet → move to Processed/
```

### UGC Ingestion

```
Drive brand folder → S8 manual run → download batch 1 →
BRAND_MAP lookup → base64 header → POST /ugc-ingest →
stream to disk → ffprobe → if >50MB downscale 720p →
Gemini tags → FFmpeg enrichment → R2 → Supabase → Processed/
```

Safety: streaming (64KB chunks), 720p downscale, concurrency guard, 413 >500MB, idempotency, brand validation.

---

## 5. Database

### brand_configs (3 rows) ✅
Complete: nordpilates, ketoway, carnimeat. Colors, fonts, caption_preset JSONB, logo_r2_key, voice_guidelines, allowed_video_types.

### assets (54 rows, nordpilates) ✅
Real Gemini tags. Content types: workout(15), lifestyle(25), b-roll(9), cooking(1), talking-head(2), product-demo(2). Quality 6-8. Total 27 min footage.

### music_tracks (15 rows) ✅
Deduped. Default mood/energy (fix Day 6). Fallback: Die With A Smile 249s.

### jobs (1 row)
First job 0333326e in `human_qa`. Context packet assembled, all QA passed, 3 platform exports in R2.

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
| /music-ingest | POST | Stream MP3 + x-track-meta header → pipeline |
| /ugc-ingest | POST | Stream video + x-asset-meta header → pipeline |

---

## 8. n8n Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | All Day 4 fixes applied |
| S2 | Brief Review | v2 final | ✅ | Hardcoded auth, JSON safe |
| S3 | QA Decision | v1 | ⏸ | Needs v2 rebuild (Day 5) |
| S7 | Music Ingest | v2 | ✅ | Working |
| S8 | UGC Ingest | v1 | Manual | Working |
| P2 | Periodic Sync | v2 | ✅ | Maps to simplified sheet |

### S1 Critical Behaviors (after all fixes)

1. Hardcoded Supabase URL + anon key (no `$env`)
2. Authentication: None on HTTP node (no httpHeaderAuth credential)
3. VALID_BRANDS array exact-match validation
4. JSON.stringify payload via Code node (no string interpolation)
5. Creates job with `status: 'planning'` (not idea_seed)
6. Matches sheet row on `Idea Seed` column
7. Writes Job ID back via `$('Validate Brand & Build Payload').item.json.ideaSeedClean` reference — reaches through BullMQ response to preserve upstream data
8. Successful write clears match condition to prevent duplicate creation on next poll

### Credentials

| ID | Type | Used by |
|---|---|---|
| AIqzMYUXoQjud7IW | Google Service Account | S1, S2, P2 (Sheets) |
| 9mzs7zcG6Z9TIcku | Google OAuth | S7, S8 (Drive) |
| jPzsu3UPPrZc0kge | Google Service Account | S7 (Sheet write) |
| l66cV4Gj1L3T6MjJ | HTTP Header Auth | Deprecated — workflows use hardcoded headers |

---

## 9. Feature Flags (.env)

| Flag | MVP | Day 6 Target | Notes |
|---|---|---|---|
| ENABLE_BEAT_SYNC | false | **true** | Code built, just flip the flag |
| ENABLE_COLOR_GRADING | false | **true** | Code built, just flip the flag |
| ENABLE_MUSIC_SELECTION | false | **true** (after music tagging) | Needs real mood/energy data first |
| ENABLE_DYNAMIC_PACING | false | false | Post-MVP |
| ENABLE_AUDIO_DUCKING | **true** ✅ | true | Active |
| ENABLE_CRF18_ENCODING | **true** ✅ | true | Active |
| FALLBACK_MUSIC_TRACK_ID | `f6a6f64f-...` | Replace with selector | Die With A Smile 249s |
| WHISPER_BIN | `/opt/whisper.cpp/build/bin/whisper-cli` | Same | Absolute path |
| WHISPER_MODEL | `/opt/whisper.cpp/models/ggml-base.en.bin` | Same | Absolute path |

---

## 10. Remotion Integration (Critical Patterns)

Four lessons learned the hard way:

**1. Entry point must call `registerRoot()`.**
```typescript
// src/templates/Root.tsx
import { registerRoot } from 'remotion';
import { RemotionRoot } from './RemotionRoot';
registerRoot(RemotionRoot);
```

**2. TypeScript `.js` imports need webpack override.**
Templates compile with `moduleResolution: NodeNext` (requires `.js` extensions) but Remotion bundler can't resolve `.js` → `.tsx`. Fix:
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
Chromium blocks `file://` URLs entirely. The only pattern that works:
- Copy assets to `{workDir}/public/` with flat filenames
- Pass `publicDir` to `bundle()`
- Pass bare filenames in inputProps: `clipPaths: { 1: 'seg1-clip0.mp4' }`
- Wrap in components: `<Video src={staticFile(props.clipPaths[1])} />`

**4. Chrome Headless downloads on first render (~86MB).**
System chromium is only for dependency verification. Remotion brings its own.

---

## 11. Google Sheets

**ID:** `1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`

**Jobs tab (13 columns):** Row Status, Job ID, Brand (dropdown), Idea Seed, Status, Brief Summary, Hook Text, Preview URL, Auto QA, Review Decision (dropdown), Rejection Notes, QA Decision (dropdown), QA Issues (dropdown).

Operator touches 5 columns. Rest auto-populated.

**Dashboard tab:** Formula-based stats, per-brand breakdown.

---

## 12. Google Drive Folders

| Folder | ID |
|---|---|
| Music Uploads | `1s2vUnIoJUt7rltSRlJeY9uqQyQ5_Lzso` |
| Music Processed | `1RtBDaSxM45TT2B7ATvQGXvnY5HB1nWGw` |
| nordpilates UGC | `1n0-vMRq0ckgAugGxUlOtY9e942ARpCyZ` |
| nordpilates Processed | `1IMQwMD902e2ps7UYZnz1RQhRs3ZEUIhN` |

---

## 13. Architecture Rules (17 total)

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

---

## 14. Quality Roadmap

### Philosophy

Real UGC authenticity is the product. Competitors (Runway, Kling, Sora, HeyGen, Arcads) generate or transform video. Video Factory **curates and composes real footage with brand-perfect templating**. The goal is not "mind-blowing cinematic quality" — it's "authentic UGC that outperforms manually-edited brand content at 10% the cost and 100x the volume."

TikTok/Reels/Shorts reward authenticity, not polish. A 7.5/10 authentic video beats a 9/10 over-produced one on engagement metrics.

### Tier 1 — Free, implement Day 6 (~expected lift: 6/10 → 7.5-8/10)

**All items use code and data that already exist. Zero incremental cost.**

1. Tighten Asset Curator prompt for thematic coherence per segment
2. Pass full Gemini description text to Curator (not just tag summary)
3. Extract thematic keywords from idea seed, require per-segment match
4. Enable `ENABLE_COLOR_GRADING=true` (LUT already built)
5. Enable `ENABLE_BEAT_SYNC=true` (code already built)
6. Tag 15 music tracks with real mood/energy (30 min manual work)
7. Enable `ENABLE_MUSIC_SELECTION=true` after tagging

### Tier 2 — Small incremental cost (Day 7-14, ~$15/mo)

1. Upgrade ingestion from Gemini Flash to Gemini Pro (~$10/mo)
2. Pre-normalize clips at ingestion (drops render from 28min → 10min, ~$1/mo storage)
3. CLIP embeddings + Supabase pgvector semantic search (~$0)

### Tier 3 — Month 2

1. Quality Director Agent (post-render scoring, after 20-30 videos calibrated)
2. Multi-language support
3. Real brand logos (replace placeholders)
4. A/B variant generation (3 versions per job)

### Explicitly Rejected

Recommendations NOT adopted from external SOTA critique:

- **Runway/Kling/Veo generative enhancement** — destroys UGC authenticity, the product's entire value proposition
- **Twelve Labs video search** — redundant with CLIP + pgvector at zero cost
- **GPU hosting** — Remotion is Chromium CPU-bound, no benefit
- **Upgrade planning agents to Gemini 2.5 Pro / GPT-5** — Claude Sonnet is already excellent at marketing copy
- **CapCut API integration** — Remotion is more controllable and already working
- **"Generative B-roll fills"** — expensive ($0.50-$2 per 5s clip) and looks synthetic

### Budget Projection

| Volume | Monthly Cost | Notes |
|---|---|---|
| 5-10 videos/week (MVP) | ~$30 | Current state |
| 50 videos/week | ~$80 | Claude API scales linearly |
| 100 videos/week | ~$150 | Consider CX42 upgrade |
| 150 videos/week (v3 target) | ~$250 | CX52 for parallel rendering |
| 300 videos/week | ~$400 | Multiple workers + self-hosted Redis |

All within the $400-500/mo cap.

---

## 15. Known Issues (Day 5 Queue)

| Priority | Issue | Fix |
|---|---|---|
| Medium | preview_url not written to jobs table | Generate signed R2 URL in final transition |
| Medium | Whisper extracts full clip instead of segment window | Apply `-ss start_s -t duration` |
| Low | Logo not visible in rendered video | Debug LogoWatermark staticFile path |
| Low | Asset Curator picks off-topic clips | Tighten prompt (Tier 1 fix) |
| Low | job_events null to_status on some error paths | Fix remaining log call |
| Low | S3 QA Decision v1 has old bugs | Rebuild v2 (same pattern as S1/S2) |
| Low | Clip prep deletes workdir on failure | Conditional cleanup, keep on failure |
| Low | Upstash token leaked in chat history | Rotate before production |

---

## 16. File Structure

```
src/
├── config/          — env.ts (flags + WHISPER paths), supabase.ts, redis.ts, r2.ts
├── types/           — database.ts, video-types.ts
├── lib/             — ffmpeg.ts, gemini.ts, r2-storage.ts, job-manager.ts, exec.ts,
│                      beat-detector.ts, color-grading.ts, music-selector.ts,
│                      template-config-builder.ts, clip-analysis.ts, video-type-selector.ts
├── workers/         — ingestion.ts, clip-prep.ts, transcriber.ts, audio-mixer.ts,
│                      sync-checker.ts, exporter.ts, qa-checker.ts, renderer.ts,
│                      pipeline.ts, music-ingest.ts
├── agents/          — creative-director.ts, asset-curator.ts, copywriter.ts, context-packet.ts
│   └── prompts/     — creative-director.md, asset-curator.md, copywriter.md
├── templates/       — Root.tsx (registerRoot), RemotionRoot.tsx
│   ├── components/  — CaptionTrack, HookText, CTAScreen, LogoWatermark, TransitionEffect,
│   │                  SegmentVideo (all use staticFile)
│   └── layouts/     — HookDemoCTA, HookListicleCTA, HookTransformation
├── scripts/         — seed-brand.ts, upload-brand-logos.ts, test-*, migrate*.sql
├── index.ts         — HTTP API + BullMQ workers
└── brands/          — nordpilates.json, ketoway.json, carnimeat.json
```

---

## 17. Deployment

```bash
ssh root@95.216.137.35
cd /home/video-factory
git pull && npm run build && systemctl restart video-factory
journalctl -u video-factory -f
```
