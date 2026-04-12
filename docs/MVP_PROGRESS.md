# Video Factory — MVP Progress Tracker

**Last updated:** 2026-04-11 14:00 UTC

---

## 🎉 MVP GOAL ACHIEVED (3 days early)

**First video rendered end-to-end: 2026-04-11 13:22 UTC**

Job `0333326e-474d-4f39-9ef5-06bfb2fbf45b` — nordpilates, "3 pilates mistakes beginners make that hurt their back" — rendered to TikTok/IG/YT, all 8 auto QA checks passed, uploaded to R2. 28 minutes end-to-end. 6/10 human quality rating.

**Pipeline preserves source quality.** Logic issues (off-topic clip selection, invisible logo, missing captions) are prompt/config fixes, not architecture rebuilds.

---

## Overall Status

| Day | Plan | Status |
|---|---|---|
| 1 (Apr 9) | Drive fix, music ingestion | ✅ DONE |
| 2 (Apr 10 AM) | UGC ingestion, 54 clips | ✅ DONE |
| 3 (Apr 10 midday) | Brands, sheets, workflows | ✅ DONE |
| 4 (Apr 10 PM) | First end-to-end render | ✅ **DONE — video delivered** |
| 5 (Apr 11) | Polish: preview_url, whisper, logo, curator | 🔄 IN PROGRESS |
| 6 | Quality lift (Tier 1 fixes), second brand | ⏳ PENDING |
| 7 | Stabilize, retro, playbook | ⏳ PENDING |

---

## First Video Evidence

### Timing

| Phase | Actual | v3 Estimate | Status |
|---|---|---|---|
| Planning (3 agents) | 46s | ~45s | ✅ |
| Clip prep (5 × 4K → 1080p) | 17 min | ~18 min | ✅ |
| Transcription | 2s | ~2 min | ✅ (0 words, non-blocking) |
| Remotion render (1140 frames) | 8 min | ~8 min | ✅ |
| Audio mix | 2s | ~1 min | ✅ |
| Platform export (3 formats) | 2 min | ~5 min | ✅ |
| Auto QA (8 checks) | 4s | ~30s | ✅ |
| **Total** | **~28 min** | **~35 min** | ✅ Inside estimate |

Peak VPS memory during render: 265MB resident. Never stressed the 8GB CX32.

### Outputs in R2

| Platform | Size | R2 Key |
|---|---|---|
| TikTok | 35.2 MB | `rendered/nordpilates/2026-04/2026-04-11_3-pilates-mistakes-hurting-your-back_v1_tiktok.mp4` |
| Instagram | 15.9 MB | `rendered/nordpilates/2026-04/2026-04-11_3-pilates-mistakes-hurting-your-back_v1_instagram.mp4` |
| YouTube | 43.7 MB | `rendered/nordpilates/2026-04/2026-04-11_3-pilates-mistakes-hurting-your-back_v1_youtube.mp4` |

### Auto QA — All 8 checks passed

Duration 38.0s ✅, Resolution 1080x1920 ✅, Aspect 9:16 ✅, A/V sync 0ms ✅, Audio present ✅, Logo template reference ✅, Text readability ✅, No black frames ✅.

### Human Review Findings

| Finding | Severity | Root Cause | Fix |
|---|---|---|---|
| Clip 3 off-topic (random kitchen) | Medium | Asset Curator prioritizes role over theme | Tighten curator prompt (Day 5) |
| "Mistakes hurt back" vs correct-form footage | User error | Bad idea seed for clip library | Operator guideline |
| Logo not visible | Low | staticFile path or component not mounted | Debug (Day 5) |
| No speech captions | Low | Whisper extracts full clip audio instead of segment window | Apply `-ss start_s -t duration` (Day 5) |
| preview_url missing in sheet | Medium | Render pipeline doesn't populate jobs.preview_url | Generate signed URL in final transition (Day 5) |

---

## Day 5 Queue (active)

1. **preview_url generation** — sign R2 URL, write to jobs table, P2 syncs to sheet
2. **Whisper audio window** — apply segment boundaries to FFmpeg extraction
3. **Logo visibility debug** — investigate publicDir/staticFile/component mount
4. **Curator prompt coherence** — require thematic alignment per segment
5. **S3 QA Decision v2** — same pattern as S1/S2 (needed before first video delivery)

Then retest with better idea seed: `morning pilates flow for stiff backs` (workout-focused, matches actual footage library).

---

## Quality Roadmap (post-Day-5)

### Critique vs Reality

External SOTA critique recommended: Runway/Kling/Veo generative enhancement, Twelve Labs video search, GPU boxes, Gemini 2.5 Pro planning, CapCut API, $2-5/video cost. 

**Rejected:** Generative enhancement kills UGC authenticity (the whole product). GPU doesn't help Remotion (CPU-bound Chromium). Twelve Labs is redundant with CLIP + pgvector. Claude Sonnet already excellent at marketing copy.

**Accepted with modifications:** Better clip curation is the real bottleneck. But the fix is prompt quality + richer metadata + optional CLIP embeddings — not vendor lock-in.

### Budget Target

**Current:** ~€15/mo (~$16) total infra. **Target:** $60-100/mo at MVP volume. **Cap:** $400-500/mo at full scale.

### Tier 1 — Free, do first (Day 6)

| Item | Impact | Cost |
|---|---|---|
| Tighten Asset Curator prompt (thematic coherence per segment) | ~80% reduction in off-topic clips | $0 |
| Pass full Gemini description text to Curator (not just tags) | Richer curator decisions | $0 |
| Extract thematic keywords from idea seed, require per-segment match | Forces topic alignment | $0 |
| Enable ENABLE_COLOR_GRADING flag (code already built) | Professional look | $0 |
| Enable ENABLE_BEAT_SYNC flag (code already built) | Rhythmic cuts | $0 |
| Manually tag 15 music tracks with real mood/energy (30 min work) | Enables real music selection | $0 |
| Enable ENABLE_MUSIC_SELECTION flag | Brief-matched music | $0 |

**Expected lift: 6/10 → 7.5-8/10.** All free. All using code already written and deployed.

### Tier 2 — Small cost, do if Tier 1 isn't enough (Day 7-10)

| Item | Impact | Cost |
|---|---|---|
| Upgrade ingestion from Gemini Flash to Gemini Pro | Better clip tags + descriptions | ~$10/mo |
| Pre-normalize clips at ingestion (1080p version in R2) | Drops per-render from 28min → 10min | ~$1/mo storage |
| CLIP embeddings at ingestion + pgvector semantic search | Curator picks clips by meaning | ~$0 (CLIP runs locally) |

**Combined Tier 2: ~$15/mo incremental.** Unlocks scale + quality ceiling.

### Tier 3 — Month 2 (scale/polish)

- Quality Director Agent (post-render scoring) — after 20-30 videos calibrated
- Multi-language support
- Real brand logos (replace placeholders)
- A/B variant generation (3 versions per job with different clip orders/hooks)
- Self-hosted Redis when Upstash quota tightens

### Scale Projections (keeping quality)

| Volume | Monthly Cost | Notes |
|---|---|---|
| 5-10 videos/week (MVP) | ~$30 | Current plan |
| 50 videos/week | ~$80 | Claude API scales linearly |
| 100 videos/week | ~$150 | Consider CX42 upgrade |
| 150 videos/week (v3 target) | ~$250 | CX52 for parallel rendering |
| 300 videos/week | ~$400 | Multiple workers + self-hosted Redis |

**All under the $400-500/mo cap.**

---

## Infrastructure (current)

| Service | Host | Status | Cost/mo |
|---|---|---|---|
| n8n | 46.224.56.174 | ✅ | ~€4.50 |
| VPS | 95.216.137.35 (CX32 8GB) | ✅ | ~€8.50 |
| Supabase | Free tier | ✅ | $0 |
| Upstash Redis | Free tier | ✅ | $0 |
| R2 | 54 assets + 15 tracks + 3 logos + 3 rendered videos | ✅ | ~$1 |
| Claude API | Sonnet | ✅ | ~$0.50/video |
| Gemini API | Flash | ✅ | ~$0.05/video |

## Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ ON | Creates job as planning, writes ID back from Code node |
| S2 | Brief Review | v2 final | ✅ ON | Clears Review Decision after processing |
| S3 | QA Decision | v1 | ⏸ OFF | Needs v2 rebuild (Day 5) |
| S7 | Music Ingest | v2 | ✅ ON | 15 tracks |
| S8 | UGC Ingest | v1 | Manual | 54 clips |
| P2 | Periodic Sync | v2 | ✅ ON | Maps to simplified 13-column sheet |

## Data

| Table | Rows | Notes |
|---|---|---|
| assets | 54 nordpilates | Real Gemini tags, 27 min footage |
| music_tracks | 15 deduped | Default mood/energy — Day 6 tagging task |
| brand_configs | 3 complete | All with logos, captions, voice |
| jobs | 1 | In human_qa, first video pending review |

## Feature Flags

| Flag | MVP Value | Plan |
|---|---|---|
| ENABLE_BEAT_SYNC | false | Enable Day 6 (Tier 1) |
| ENABLE_COLOR_GRADING | false | Enable Day 6 (Tier 1) |
| ENABLE_MUSIC_SELECTION | false | Enable Day 6 after music tagging |
| ENABLE_DYNAMIC_PACING | false | Post-MVP |
| ENABLE_AUDIO_DUCKING | **true** ✅ | Active |
| ENABLE_CRF18_ENCODING | **true** ✅ | Active |
| FALLBACK_MUSIC_TRACK_ID | Die With A Smile 249s | Replace with selector after music tagging |

---

## Blockers Resolved (31 total)

Full list preserved in prior versions. Highlights from Day 4:

- Remotion entry point missing registerRoot()
- Remotion webpack .js → .tsx import resolution
- Remotion publicDir + staticFile pattern (not file:// URLs)
- S1 duplicate job creation race (Job ID not written back)
- Asset Curator JSON key name varies (dynamic extraction)
- Job created as idea_seed but worker expects planning
- Whisper binary path + model path env vars
- httpHeaderAuth credential conflicting with hardcoded apikey
- Supabase RLS blocking anon writes
- Sheet node failing on 0-row_number
- Multiple JSON injection points in S1/S2 payloads

---

## Lessons Learned (28 total)

Key Day 4 lessons:

21. Claude varies JSON key names unpredictably — dynamic extraction via `Object.values().find()`.
22. Remotion bundles from TypeScript source. Use `extensionAlias` webpack override for `.js` → `.tsx`.
23. Remotion assets via `publicDir` + `staticFile()` pattern. Never pass absolute paths or file:// URLs.
24. n8n HTTP node `genericCredentialType` injects conflicting auth headers. Set Auth to `None` when using hardcoded headers.
25. Supabase RLS blocks anon writes by default. Add permissive policies OR use service role key.
26. S1 duplicates: if Job ID isn't written back, workflow re-matches every poll. Write through nodes that reach upstream data with `$('Code Node').item.json.field`.
27. Whisper on non-speech audio returns 0 words without crashing. Pipeline gracefully continues.
28. First end-to-end run surfaces integration bugs unit tests miss. Eight distinct bugs from "planning works" to "first video on disk," all single-line fixes. **Total Day 4 code changes: ~200 lines.**
