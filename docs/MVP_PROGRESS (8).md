# Video Factory — MVP Progress Tracker (8)

**Last updated:** 2026-04-16
**Supersedes:** MVP_PROGRESS (7).md
**Companion docs:** `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`, `PHASE_3_DESIGN.md`, `SUPABASE_SCHEMA.md`, `CLAUDE.md`

---

## Where we are right now

**Phase 3 W5 shipped (2026-04-16).** Clean-slate ingestion + pre-normalization live. Old 53/182 nordpilates library dropped, new ingestion pipeline validated end-to-end on first production clip. **Content sprint in progress** — operator ingesting 50-100 nordpilates UGC clips through the new pipeline. After sprint: W2 (Curator V2 update) begins.

**Tags shipped:**
- `phase1-complete`
- `phase2-complete`
- `phase3-w1-complete` ✅ (2026-04-15)
- `phase3-w5-complete` ✅ (2026-04-16)

**Active feature flags in production:** ENABLE_CURATOR_V2=true, ENABLE_PHASE_3_CD=false, ENABLE_BEAT_SYNC=true, ENABLE_COLOR_GRADING=true, ENABLE_MUSIC_SELECTION=true, ENABLE_AUDIO_DUCKING=true, ENABLE_CRF18_ENCODING=true.

---

## Phase 3 W5 ship report (2026-04-16)

### What landed

| Component | File | Status |
|---|---|---|
| Migration 007 | `src/scripts/migrations/007_pre_normalized_clips.sql` | Applied |
| preNormalizeParent() | `src/lib/parent-normalizer.ts` (74 lines, NEW) | Live |
| Ingestion wiring | `src/workers/ingestion.ts` (modified) | Live |
| Asset type extension | `src/types/database.ts` | Live |
| Test harness (standalone) | `src/scripts/test-pre-normalize.ts` + `npm run test:pre-normalize` | Live |
| Test harness (end-to-end) | `src/scripts/test-ingestion-w5.ts` + `npm run test:ingestion-w5` | Live |
| Clean-slate script | `src/scripts/clean-slate-nordpilates.ts` + `npm run clean-slate:nordpilates` | Live (executed once) |

**Commits:**
- `6bb1b0b` — migration 007 + Asset type
- `242da6a` — preNormalizeParent() + test harness
- `c18595c` — wire preNormalizeParent into ingestion flow
- `24aab98` — clean-slate nordpilates + carnimeat test debris + doc sync
- `f1b8120` — squash-merge to main (tag `phase3-w5-complete`)

**Side-fix commits:**
- `22e977e` — raise /ugc-ingest Content-Length cap 500MB → 2GB
- (workflow-side) n8n S8 `Send to VPS` timeout 10 min → 30 min

### Architectural decisions locked during W5

- **Pre-normalization is hard-required.** Ingestion throws if it fails (with best-effort cleanup of orphan raw R2 key). Alternative (soft-required with fallback to raw) rejected because W5 is clean-slate anyway — no half-state tolerated.
- **Sibling function, not parameterized.** `buildNormalizeCommand` in `ffmpeg.ts` kept for render-time use (CRF 18 preset slow loudnorm). New `preNormalizeParent` in `parent-normalizer.ts` (CRF 22 preset medium, no loudnorm). Parameterizing would have added ~4 optional overrides that muddle purpose.
- **INSERT after pre-normalize.** Assets row is inserted with `pre_normalized_r2_key` already populated. No UPDATE dance. Raw R2 upload happens earlier (archival, before pre-normalize) so we have a raw fallback if ever needed.
- **1080×1920 30fps fixed.** All renders output 1080×1920 30fps; pre-normalize shifts that work left. Source 60fps → 30fps re-timed (duration preserved, frame count halves). Non-vertical sources get letterboxed at pre-normalize (not render time) — same end result.
- **CRF 22 medium for pre-normalize**, not CRF 18 slow. Segments get re-encoded to 720p CRF 28 downstream anyway; storage-grade quality here is sufficient and ~3× faster encode.
- **Keep legacy analyzeClip on raw.** `clip-analysis.ts` also stays on raw. Reason: once non-vertical source lands, pre-normalize adds black bars which would skew color/brightness averages. Current content is vertical so it's moot now; wiring correctly from start avoids future bug. Legacy dead-ish work retired at Milestone 3.3.

### Clean-slate drop

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

Cascade on `asset_segments.parent_asset_id` worked as designed — single `DELETE FROM assets WHERE brand_id='nordpilates'` dropped both tables.

### First production W5 ingestion (Step 5 verification, 2026-04-16)

**Input:** `NP_concept_17.MOV`, 986 MB, 3400×1912 HEVC 60fps, 215.6s (3:36).

| Stage | Timing |
|---|---|
| Stream upload (2GB cap allowed) | instant |
| Gemini Flash legacy analysis (raw) | 3:19 |
| clip-analysis ffmpeg (3× parallel on raw) | 2:09 |
| Raw → R2 | ~26s |
| **preNormalizeParent encode** | **4:42** (986MB → 444MB, 45% ratio) |
| Parent normalized → R2 | ~1s |
| INSERT assets row | <1s |
| Gemini Pro Files API upload + poll + analyze | 1:03 |
| 12 × (keyframe + CLIP + 720p trim + R2 + DB) | ~58s |
| **Total** | **~14 min** |

**Output:**
- 1 asset row with `pre_normalized_r2_key = parents/normalized/nordpilates/22dba651-...mp4`
- 12 asset_segments (all with clip_r2_key + embedding)
- Segment type distribution: 5 hold (avg q 8.0), 3 transition (5.3), 3 setup (5.0), 1 b-roll (7.0)
- 0 exercise segments (content was low-motion yoga/pool — classification honest)

**Short-clip performance (validated during sprint):** 22.9MB 3.9s clip completed end-to-end in 48s. Time dominance shifts with source length/bitrate — short clips fly.

### Key discoveries during W5

1. **Candidate slot-in was right.** Step 0 inspection found a natural place between raw R2 upload and `assets` INSERT. No contract changes, no refactor required.
2. **Sibling function chosen over parameterizing.** W5-specific encode settings differ enough from render-time that shared parameterization would have hurt readability.
3. **Duplicate detection + HTTP timeout misalignment surfaced.** 10-min n8n timeout × 14-min ingestion → false-negative failures that self-healed via next-cycle dedup check. Correct system behavior, poor observability. 30-min timeout applied as workaround; async migration filed for 3.3.
4. **Legacy Flash analysis flagged as dead-ish work.** Runs unconditionally, populates `assets` columns nothing reads for clip selection. Retained for Phase 2 rollback path; retires at Milestone 3.3.
5. **Content-vs-brand mismatch is possible.** S8 pipes by filename prefix, not content. A supermarket clip filed as `NP_concept_*` ingests as nordpilates. Operator discipline at sprint time; not a system bug.

### Cost summary

- **Dev cost:** ~$0 against Claude. Gemini Pro for smoke tests: free on company credits.
- **Operational cost going forward:** ~$0.06/clip amortized Gemini ingestion (free on credits currently). R2 storage: ~+450MB parent + ~5MB/segment per clip ingested.

### Time spent

- 5 agent sessions across 1 day (Step 0 inspection, Step 1 migration, Step 2 function, Step 3 wiring, Step 4 clean-slate + push)
- Plus operator time on deploy + Step 5 live verification + side fixes (cap, redis, timeout)

---

## Content sprint (in progress 2026-04-16)

**Scope:** 50-100 nordpilates UGC clips, batch-dropped across a few session folders for organization.

**Pipeline:** S8 5-min poll picks clips from Drive → /ugc-ingest → full W5 flow → asset_segments populated → clip moved to Processed folder.

**Expected timing:** For short clips (20-60s): ~45-90s each. For 3-5min 4K HEVC: ~10-15 min each. Total sprint likely 3-6 hours wall time.

**Expected output:** ~200-500 asset_segments populated across the sprint, biased toward hold/exercise/transition types depending on content mix.

**Sprint caveat:** Gemini Flash classifies each clip's content — watch logs for obvious brand-content mismatches (lifestyle clips labeled nordpilates, etc). Clips that end up classified wrong still land in nordpilates library; flag for manual DB + R2 cleanup if any obviously don't belong.

---

## Where we go next

### W2 — Asset Curator V2 update (1-2 sessions)

After content sprint completes. Curator V2 currently reads per-slot `clip_requirements` from Phase 2 briefs. W2 extends it to read Phase 3's `aesthetic_guidance` (per-slot) and `creative_vision` (top-level). Prompt update + one new input branch; no new dependencies.

### W3 — Copywriter update (1-2 sessions)

Extends Copywriter to produce per-slot overlay text (in addition to existing hooks/captions/CTAs). Reads CD's `text_overlay.style`, `char_target`, + slot context + `creative_vision` for tone consistency.

### W4 — Remotion parameterized composition (4-6 sessions)

Biggest workstream. Full Remotion rewrite. See PHASE_3_DESIGN.md §W4 for design.

### Milestone 3.3 — flag flip + first Phase 3 video

When W4 done. Success criterion: 8 of 10 consecutive Phase 3 videos approved. Cleanup bundle: Phase 2 CD path deletion, legacy Flash removal, async ingestion migration, env.ts alignment, VIDEO_TYPE_CONFIGS slim.

---

## Phase history (compressed)

### Phase 1 — Ingestion Overhaul ✅ (2026-04-13)
- 182 segments across 53 nordpilates clips
- pgvector + asset_segments table + match_segments RPC
- Gemini Pro Files API for native video segment analysis
- CLIP ViT-B/32 embeddings via @xenova/transformers (self-hosted, free)
- ~98% success rate, $3.47 total cost

### Phase 2 — Curator Overhaul ✅ + LIVE (2026-04-13 13:46 UTC)
- `asset-curator-v2.ts` + dispatcher + retrieval + trimmer
- Per-slot CLIP retrieval, type+quality filters, on-the-fly ffmpeg trim
- Gemini Pro pick + self-critique
- Parent cache, variety preference
- Validated 9-10/10 on all 5 test slots, ~$0.20/video incremental

### Phase 2.5 — Pre-trim optimization ✅ + LIVE (2026-04-13)
- Ingestion pre-trims 720p CRF 28 clips to R2 at `segments/{brand}/{uuid}.mp4`
- Trimmer FAST PATH streams ~5MB instead of downloading full parent + ffmpeg
- Backfill complete: 182/182 segments, 355 MB to R2, 25m 26s, $0
- Curator wall time: 17.9 min → 4.4 min (4.1× speedup)
- **Superseded by W5:** 182 backfill segments deleted in clean-slate drop. Pattern (pre-trim at ingestion) preserved; sources now 1080p normalized parents.

### Phase 2 production validation ✅ (2026-04-14)
- First V2 video rendered: job `d74679d2-3c62-4e10-8e03-6da774b55dc1`
- "5 min pilates abs burner", nordpilates, 35s, 5 segments
- End-to-end ~16 min (planning ~5 min, render + export the rest)
- Rated **4-5/10** by operator
- V2 worked correctly; rating ceiling came from three layers below the picker:
  - Library content gap (only ~3-6 ab segments in nordpilates) → addressed by W5 + content sprint
  - Creative Director monotony (CD makes only 3 decisions) → addressed by W1
  - Remotion template monotony (single template per video_type) → addressed by W4

### Phase 2 cleanup ✅ + LIVE (2026-04-14, commit `269ff99`, tag `phase2-complete`)
- Centralized retry helper `src/lib/retry-llm.ts` (handles 429/502/503/504/529, Anthropic overloaded_error, network errors)
- Zod corrective retry on V2 picker (caught two real "Expected object received array" Pro malformations)
- `full_brief` column on jobs + sheet column with apostrophe escape
- Reusable migration runner (`apply_migration_sql` SECURITY DEFINER + `apply-migration.ts`)
- V2 prompt soft visual variety rule
- Side fixes: S1 runaway loop bug (filter on Job-ID-empty without status writeback), BullMQ drain script, migration 005 fix

### Phase 3 design ✅ (2026-04-15)
- 5 workstreams, 3 milestones, 2 feature flags
- Schema locked field-by-field
- Brand color palettes locked for nordpilates and carnimeat
- See PHASE_3_DESIGN.md

### Phase 3 W1 ✅ (2026-04-15, commit `df6a326`, tag `phase3-w1-complete`)

**Six-step delivery squashed to `df6a326`:** schema+Zod+side-fixes, CD prompt rewrite+import sweep, dispatcher+Phase 3 generator+Zod retry, migration 006+types, smoke harness+first run, prompt iteration v2/v3.

**Final smoke (v3):** 6/6 Zod first-attempt, 6/6 signal-mapping correct, 4 unique slot_counts, 5 unique color treatments, 0 color violations, $0.33 cost, 121s wall.

**Key lessons:**
- DB constraints can mask prompt issues (initial v1/v2 5/5 tips-listicle was `allowed_video_types` single-type per brand, not prompt failure — check DB before iterating prompts).
- Example anchoring is real (LLM over-indexes on examples; most divergent first).
- Phase 3 path throws before DB write (smoke harness is operator validation surface until W2/W3 ship).

**Deferred to follow-up:** vibe param plumbing (sheet column + S1 update), VIDEO_TYPE_CONFIGS slim (M3.3), Phase 2 CD Zod retrofit (N/A — Phase 2 dies at M3.3 anyway).

**Dev cost:** ~$0.86 Claude API across 3 smoke iterations.

### Phase 3 W5 ✅ (2026-04-16, commit `f1b8120`, tag `phase3-w5-complete`)
- See ship report above.

---

## Active n8n workflows

Per VPS-SERVERS.md:

| # | Workflow | Status | Notes |
|---|---|---|---|
| S1 | New Job | ✅ | 30s poll. **Pending: Vibe column passthrough when sheet column ships.** |
| S2 | Brief Review | ✅ | 30s poll. Includes brief_summary update. |
| S3 | QA Decision | ⏸ | Needs v2 rebuild before first `delivered` |
| S4 | Brand Config | ⏸ | Deactivated for MVP |
| S5 | Caption Preset | ⏸ | Deactivated for MVP |
| S6 | Music Track | ⏸ | Deactivated for MVP |
| S7 | Music Ingest | ✅ | 5min poll |
| S8 | UGC Ingest | ✅ | 5min poll. **Send to VPS timeout raised to 30min (2026-04-16) to accommodate 3-5min 4K ingestions.** |
| P1 | Job Status Push | ✅ | Webhook from VPS |
| P2 | Periodic Sync | ✅ | 5min, includes Full Brief column with apostrophe escape |
| P3 | Dashboard Refresh | ⏸ | Deactivated for MVP |
| P4 | Monthly Archive | ⏸ | Deactivated for MVP |

---

## Data inventory

**Post-W5 clean-slate + first ingestion (2026-04-16):**

- **1 asset** (nordpilates, `NP_concept_17.MOV`, first W5 production ingestion)
- **12 asset_segments** (all with clip_r2_key + CLIP embedding, all pointing at clips derived from 1080p normalized parent)
- **Content sprint in progress** — counts will grow as operator drops 50-100 more nordpilates clips through S8
- 15 music_tracks
- 5 brand_configs (3 active for Phase 3: nordpilates, carnimeat, highdiet — others kept at MVP defaults)
- 6+ jobs (all pre-W5, unchanged; includes first V2 production render `d74679d2`)

**R2 post-W5:**
- `assets/nordpilates/` — 1 raw .MOV archival
- `parents/normalized/nordpilates/` — 1 1080p H.264 normalized parent
- `segments/nordpilates/` — 12 × 720p scout clips
- `keyframes/nordpilates/` — 12 JPEG keyframes
- `parents/normalized/` growth rate: ~450MB/clip → plan for ~25-55GB at sprint volume

**brand_configs Phase 3 status:**

| Brand | active | allowed_video_types | allowed_color_treatments |
|---|---|---|---|
| nordpilates | ✅ | workout-demo, tips-listicle, transformation | warm-vibrant, soft-pastel, golden-hour, natural, cool-muted |
| carnimeat | ✅ | recipe-walkthrough, tips-listicle, transformation | high-contrast, warm-vibrant, moody-dark, natural, clean-bright |
| highdiet | ✅ (test) | workout-demo, tips-listicle, transformation | NULL (no restriction) |
| ketoway | inherited MVP | (single-type, MVP default) | NULL |
| nodiet | inherited MVP | (single-type, MVP default) | NULL |

---

## Known issues (priority sorted)

| Priority | Issue | Status / target |
|---|---|---|
| Medium | Library content gap on nordpilates | **Content sprint in progress (2026-04-16+). 50-100 clips through new W5 pipeline.** |
| Medium | Phase 3 brief operator visibility (throws before DB) | Acceptable for 3.1 validation; resolves W2/W3 |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild before first `delivered` |
| Medium | Phase 2 path templates feel structurally identical | Phase 3 W4 (parameterized composition) |
| Medium | Legacy `analyzeClip` Gemini Flash runs unconditionally | Defer to Milestone 3.3 (Phase 2 rollback path preserved) |
| Medium | `/ugc-ingest` synchronous HTTP for long work | 30-min timeout as workaround; async BullMQ filed to 3.3 |
| Low | Render time variance on clip prep | **Resolved by W5** — segments cut from 1080p normalized parent |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | Upstash token leaked in chat history | Rotate before public production |
| Low | Brand-content fit not enforced | S8 pipes by filename prefix, Gemini Flash classifies content but ingestion doesn't block on mismatch. Operator discipline. |
| Low | VPS package-lock.json drifts between deploys | Persistent friction, worked around with stash |
| Low | Music tagging only has energy_level + mood | Tier 3 |
| Low | ENABLE_CURATOR_V2 reads from process.env (not env.ts) — inconsistent with Phase 3 CD pattern | Cleanup at Milestone 3.3 |
| Low | Phase 3 prompt anchors on min_quality 6-7 in smoke output | Re-evaluate after W2 ships (Curator does its own scoring) |
| Low | Vibe param plumbing not yet wired (sheet → S1 → Supabase → CD) | Follow-up after content sprint, or in parallel with W2 |
| Low | `clip-analysis.ts` processes raw 4K | Free speedup post-W5 by reading normalized parent; filed to 3.3 |

---

## Cost tracking (rough)

| Component | Per video / per clip | Notes |
|---|---|---|
| Phase 2 CD (Sonnet) | ~$0.10-0.15 | Current production path |
| Phase 3 CD (Sonnet) | ~$0.20-0.30 | Behind flag; richer schema = ~2x output tokens |
| Copywriter (Sonnet) | ~$0.10-0.15 | |
| Curator V2 (Gemini Pro) | $0 (credits) | ~$0.20 if credits end |
| Ingestion (Gemini Pro) | $0 (credits) | ~$0.06/clip amortized if credits end |
| **Real out-of-pocket today** | **~$0.25/video** | Phase 2 path |
| **Real out-of-pocket post-W4** | **~$0.35-0.45/video** | Phase 3 path |
| Upstash Redis | **~$1.20/mo** | Pay-as-you-go (upgraded 2026-04-16 from free tier; keepAlive pings dominant cost) |
| R2 storage | **~$1-5/mo** | Scales with library size; ~450MB/clip normalized + ~5MB/segment |

Infra: ~€15/mo (Hetzner VPS + n8n server) + ~$1.20/mo Redis + ~$1-5/mo R2. Total ≈ €18-22/mo at current scale.

---

## Document status

- This file (8) — current. Replaces (7).
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — current. Replaces v5.0.
- `PHASE_3_DESIGN.md` — current. W1 + W5 marked shipped.
- `SUPABASE_SCHEMA.md` — current. Migration 007 applied, counts updated.
- `CLAUDE.md` — current. Reflects W1 + W5 ship and brand config state.
- `VPS-SERVERS.md` — current (no W5 changes).
- `HANDOFF_PHASE3_W2_START.md` — current (for next chat session).
- Historical: `(7)`, `(6)`, `v5.0`, `v4.0`, `v3.9`, `HANDOFF_PHASE3_W5_START.md` — keep for archive, do not update.
