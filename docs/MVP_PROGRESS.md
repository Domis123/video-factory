# Video Factory — MVP Progress Tracker

**Last updated:** 2026-04-12 17:45 UTC

---

## 🎉 MVP DELIVERED — Now Optimizing for Quality

**First video:** 2026-04-11 — `0333326e-...` — 28 min, 6/10
**Second video:** 2026-04-12 — `507129c9-...` — **16 min**, 5–6/10, all Day 5 fixes verified

Pipeline is stable. Floor is fixed. Ceiling work begins.

---

## Overall Status

| Day | Plan | Status |
|---|---|---|
| 1 (Apr 9) | Drive fix, music ingestion | ✅ DONE |
| 2 (Apr 10 AM) | UGC ingestion, 54 clips | ✅ DONE |
| 3 (Apr 10 midday) | Brands, sheets, workflows | ✅ DONE |
| 4 (Apr 10 PM) | First end-to-end render | ✅ DONE |
| 5 (Apr 11–12) | Polish: preview_url, whisper, logo, curator | ✅ DONE |
| 6 (Apr 12) | Tier 1 quality lift (flags + music tagging) | 🔄 IN PROGRESS |
| **Week 2** | **Ingestion overhaul: Gemini Pro + sub-clip segmentation + CLIP embeddings** | ⏳ STARTING |
| Week 3 | Curator overhaul (vector search + self-critique + variable clip count) | ⏳ PLANNED |
| Week 4 | Renderer adjustments + second brand | ⏳ PLANNED |

---

## Day 5 — All Polish Fixes Verified ✅

Second video render (`507129c9-1c64-4138-922d-1de0e7b20b8b`, idea seed `morning pilates flow for stiff backs`) confirmed all four agent-pushed fixes:

| Fix | Evidence |
|---|---|
| **preview_url generation** | Signed R2 URL appeared in sheet within 5 min of `human_qa` |
| **Whisper segment window** | Logs show `Skipping segment 1 (no speech)` × 4, only segment 5 attempted (curator metadata respected) |
| **Logo visibility** | `Logo ready at /tmp/.../public/logo.png (7208 bytes)` — staticFile path resolved, position normalization (`top_right` → `top-right`) applied |
| **Curator topical alignment** | Filename slug `stiff-back-try-this-flow` matches the actual idea, no random kitchen clip this time |

**Render time dropped from 28 min → 16 min** (953.7s end-to-end). The 8-min drop is likely due to a different clip mix in this run, not any specific optimization. Worth re-measuring on the next 2–3 videos to see whether 16 min is the new normal or a fluke.

**Quality plateau hit at 5–6/10.** Pipeline is technically perfect (auto QA passes, A/V sync 0ms, all platforms exported, logo visible, on-topic). What's missing is *creative* quality — the curator can only see clips through lossy text tags, music selection still off, no color grading, no beat sync. This is what Day 6 + Week 2 fix.

---

## Day 6 — Tier 1 Quality Lift (Active)

Three feature flags + one data fix. All free, all using code already on the VPS.

| Action | Expected Impact | Status |
|---|---|---|
| Tag 15 music tracks with mood + energy | Unlocks music selector | 🔄 SQL ready, awaiting run |
| `ENABLE_COLOR_GRADING=true` | Pro look, LUT-based grading | ⏳ Flip after music tagging |
| `ENABLE_BEAT_SYNC=true` | Cuts on music beats | ⏳ Same |
| `ENABLE_MUSIC_SELECTION=true` | Brief-matched music instead of Gaga every time | ⏳ Same (depends on music tagging) |

**Test job after flips:** `5 minute pilates abs burner for busy moms` — different energy/mood than the stiff-back video, lets us hear whether music selection actually picks something punchier than the fallback ballad.

**Target after Day 6:** 6.5–7/10. Validates that the existing pipeline can hit the mid-range with zero new code.

---

## Week 2 — Ingestion Overhaul (Architecture Lift)

The real bottleneck: **the Asset Curator can't see the clips.** It picks from 54 lossy tag-summarised assets via text-only matching. No matter how good the curator prompt gets, it can't choose between visually similar candidates.

**Diagnosis after 2 videos:** the curator picks "technically valid" clips, not "best" clips. The fix isn't a better prompt — it's giving the curator semantic vision over a much richer asset library.

### Architecture changes (full agent brief: `INGESTION_OVERHAUL_AGENT_BRIEF.md`)

**1. Sub-clip segmentation at ingestion**
A 60s source file currently = 1 row in `assets`. After this overhaul, the same file → 4–8 rows in a new `asset_segments` table. Each segment has its own start/end window, rich description, motion intensity, recommended duration, and "best used as" hint (b-roll / demo / hook / transition / establishing / talking-head).

**2. Gemini Flash → Gemini 2.5 Pro for ingestion**
Pro returns segment lists with editor-grade descriptions. Flash returns one shallow tag summary per file. Cost goes from ~$0.05/file to ~$0.05–0.10/file. Worth it.

**3. CLIP embeddings + pgvector**
Each segment gets a CLIP ViT-B/32 embedding of its midpoint keyframe. Stored in a `vector(512)` column. The curator (Phase 2) will use semantic vector search to fetch top-15 candidates per brief segment instead of text-matching against tags. Self-hosted via `@xenova/transformers`, zero API cost.

**4. Backward compatibility during transition**
The legacy `assets` table stays. New ingestion writes BOTH the legacy row AND the new segments. The current curator keeps working unchanged. The pipeline must produce identical output throughout Phase 1 — no behavioural change to video production until Phase 2.

### Phase plan

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** (this brief) | DB schema + CLIP helper + Gemini Pro segment analyzer + ingestion wiring + backfill script | 4–6 agent sessions, 3 days |
| Phase 2 | Asset Curator overhaul: vector search top-15 → LLM picks 5 → self-critique loop. Add `archetype` field to Creative Director output. | Separate brief, after Phase 1 lands |
| Phase 3 | Renderer: variable segment count (3–10), use segment trim windows directly | Separate brief |

### Variable clip count by archetype (Phase 2 design)

| Archetype | Clips | Avg duration | Use case |
|---|---|---|---|
| `slow_demo` | 3–5 | 8–12s | "How to do X properly" |
| `tip_list` | 5–7 | 5–7s | "5 mistakes / 5 tips" |
| `hype_reel` | 8–12 | 2–4s | "Why pilates is taking over" |
| `before_after` | 4–6 | 6–8s | Transformation content |
| `talking_head_broll` | 6–10 | 3–5s | Voiceover with B-roll cutaways |

The Creative Director picks the archetype based on idea seed + target duration. Without sub-segmentation (Phase 1), an 8–12 clip hype reel can't be assembled from 54 source files without repetition — that's why segmentation comes first.

### Cost impact

| Item | One-time | Recurring |
|---|---|---|
| Gemini Pro backfill (54 clips) | ~$2 | – |
| Gemini Pro per new clip | – | ~$0.05–0.10 |
| CLIP self-hosted | $0 | $0 |
| Supabase pgvector | $0 | $0 (free tier) |
| R2 keyframes | $0 | <$0.10/mo |
| **Total recurring** | – | **~$5/mo at 100 clips/mo** |

Stays well inside the $400–500/mo cap.

---

## Quality Targets (revised)

| Stage | Target | Date |
|---|---|---|
| Day 4 (first video) | Floor exists | ✅ 6/10 hit Apr 11 |
| Day 5 (polish fixes) | All bugs gone | ✅ 5–6/10 hit Apr 12 (logic clean, creative still flat) |
| Day 6 (Tier 1 flags) | Pipeline maxed at current arch | 🎯 6.5–7/10 |
| Week 2 (ingestion overhaul) | Curator gets vision | 🎯 7.5/10 |
| Week 3 (curator overhaul) | Self-critique + archetypes | 🎯 8/10 |
| Week 4+ (renderer + 2nd brand) | Stabilize, scale | 🎯 8/10 across brands |

**Don't chase 9+/10.** TikTok rewards authenticity, not polish. Goal is "authentic UGC that outperforms manual editing at 10% cost and 100x volume."

---

## Infrastructure (current)

| Service | Host | Status | Cost/mo |
|---|---|---|---|
| n8n | 46.224.56.174 | ✅ | ~€4.50 |
| VPS | 95.216.137.35 (CX32 8GB) | ✅ | ~€8.50 |
| Supabase | Free tier | ✅ | $0 |
| Upstash Redis | Free tier, drainDelay 120s | ✅ | $0 |
| R2 | 54 clips + 15 music + 3 logos + 6 rendered | ✅ | ~$1 |
| Claude API (Sonnet) | – | ✅ | ~$0.50/video |
| Gemini API (Flash → Pro Week 2) | – | ✅ | ~$0.05–0.10/clip |

**Current total infra: ~€15/mo. Week 2 lift adds ~$5/mo.**

---

## Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | Verified twice end-to-end |
| S2 | Brief Review | v2 final | ✅ | Verified twice end-to-end |
| S3 | QA Decision | v1 | ⏸ | **Still needs v2 rebuild before first `delivered`** |
| S7 | Music Ingest | v2 | ✅ | 15 tracks |
| S8 | UGC Ingest | v1 | Manual | 54 clips. Will be enhanced in Phase 1 (segments). |
| P2 | Periodic Sync | v2 | ✅ | preview_url propagation verified |

---

## Data State

| Table | Rows | Notes |
|---|---|---|
| assets | 54 nordpilates | Gemini Flash tags. Will be augmented (not replaced) by asset_segments. |
| asset_segments | 0 | **Phase 1 target: 150–500 rows after backfill** |
| music_tracks | 15 | Default mood/energy → Day 6 tagging in progress |
| brand_configs | 3 | Complete |
| jobs | 2 | First in human_qa, second in human_qa |

---

## Feature Flags

| Flag | Current | Day 6 Target | Notes |
|---|---|---|---|
| ENABLE_COLOR_GRADING | false | **true** | LUT code already built |
| ENABLE_BEAT_SYNC | false | **true** | Beat detector already built |
| ENABLE_MUSIC_SELECTION | false | **true** | After music tagging |
| ENABLE_DYNAMIC_PACING | false | false | Post-MVP |
| ENABLE_AUDIO_DUCKING | true ✅ | true | Active |
| ENABLE_CRF18_ENCODING | true ✅ | true | Active |
| FALLBACK_MUSIC_TRACK_ID | Die With A Smile | (deprecated after selector goes live) | – |

---

## Day 5 Lessons Added

29. **Phase Day 5 fixes are real.** Segment-aware whisper, position normalization for Remotion components, signed URL generation in pipeline final transition, and curator prompt tightening all worked first try after deploy. The agent's instinct to make small bounded fixes pays off.

30. **Render time variance is high.** First video 28 min, second video 16 min, same VPS, same brand, similar idea. Likely driven by clip mix (4K source files vary in encoder difficulty). Don't optimize against a single data point — measure 5+ before declaring a regression or improvement.

31. **Quality has two failure modes.** "Logic broken" (wrong clips, missing logo, no music) gets fixed by debugging code and prompts. "Creative flat" (technically correct but boring) needs architecture changes (richer data, semantic search, more candidates). Day 5 fixed the first kind. Week 2 fixes the second.

32. **Don't replace what works.** External recommendations to swap planning agents to Gemini Pro / GPT-5 were rejected — Sonnet is not the bottleneck. The curator's *eyes* are the bottleneck, not the director's *brain*. Always identify which step is actually weak before swapping it out.

---

## Active Blockers

None. Pipeline is green end-to-end. Pending work is enhancement, not bug-fixing.

The only TODO that blocks `delivered` status is **S3 QA Decision v2 rebuild** — same pattern as S1/S2. Should be done before approving the first or second video for delivery.

---

## Document Status

- `MVP_PROGRESS.md` — this file, current
- `VIDEO_PIPELINE_ARCHITECTURE_v3_6.md` — updated alongside this version
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — Week 2 Phase 1 brief, ready to hand to agent
- `HANDOFF.md` — still accurate for context, but Day 5 section is now historical
