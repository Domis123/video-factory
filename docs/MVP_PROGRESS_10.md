# Video Factory — MVP Progress Tracker (10)

**Last updated:** 2026-04-20
**Supersedes:** MVP_PROGRESS (9).md
**Companion docs:** `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`, `PHASE_3_DESIGN_3.md`, `SUPABASE_SCHEMA.md`, `CLAUDE.md`, `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md`

---

## Where we are right now

**Architecture pivot is implemented and pushed to `feat/architecture-pivot` (commits `fd63a35` + `5327188`), pending merge + VPS deploy + a real-job validation pass.** Phase 3 on `main` is still the prior path — it renders videos that auto-QA passes but whose overlay text doesn't match the clips. The branch fixes the root cause: the CD now reads a library inventory before planning and emits `body_focus` per slot instead of inventing exercise names; the copywriter runs after the curator and writes text against the picked segments' actual descriptions.

**Live pivot smoke test PASSED on nordpilates** (single Sonnet brief, ~$0.05): 3/3 body slots picked valid library regions (`core`, `core`, `obliques`), 0 outliers, video_type=tips-listicle, slot_count=5. The wiring works end-to-end in code; awaiting end-to-end validation in a real rendered video.

**Quality work that landed across the session arc:**
- Segment analyzer deep rewrite → 611→903 segments, better descriptions, subject appearance tracking
- Prompt-only fixes → hook duration floors, visual descriptions, curator prep-clip rejection
- Curator scores improved (4/10 → 9/10) but factual mismatch persisted, surfacing the architectural problem
- Architecture pivot wiring → library inventory, `body_focus`, post-selection clip descriptions
- Copywriter style enforcement → only `label` names visible content; other styles add what the viewer can't see

---

## Session report — 2026-04-19/20 (architecture pivot — implementation)

### Branch shipped: `feat/architecture-pivot`

Two commits, pushed to origin, awaiting merge to `main` and VPS deploy.

**Commit `fd63a35` — feat(pivot): library-aware CD + post-selection copywriter (milestone 3.5)**

Files changed:
- `src/agents/library-inventory.ts` (new) — aggregates `asset_segments` by body region for a brand. Filters non-exercise tags via BODY_PARTS allowlist + NON_EXERCISE_TAGS set + EXCLUDED_PREFIXES + NON_EXERCISE_PATTERNS regexes. Emits a CD-ready summary (counts per region, top exercise names, talking-head scarcity warning).
- `src/scripts/smoke-test-inventory.ts` (new) — Supabase-only sanity test for the aggregator.
- `src/scripts/smoke-test-pivot.ts` (new) — single Sonnet brief, asserts every exercise/hold slot has a `body_focus` from the library's body regions.
- `src/types/database.ts` — `Phase3BriefSegment.clip_requirements.body_focus: string | null`; `ClipSelection.asset_segment_id?: string`.
- `src/agents/creative-director-phase3-schema.ts` — matching Zod field, kept in lockstep with TS interface via existing `_AssertEqual`.
- `src/agents/creative-director-phase3.ts` — fetches `getLibraryInventory(brandId)` and injects the summary into the user message as `library_inventory`. Mock brief updated with `body_focus` on every slot.
- `src/agents/asset-curator-dispatch.ts` — threads `body_focus` into `BriefSlot`, surfaces it in `buildSlotDescription`, populates `ClipSelection.asset_segment_id` from `r.segmentId`.
- `src/agents/curator-v2-retrieval.ts` — `BriefSlot` gains optional `body_focus`.
- `src/agents/context-packet.ts` — between curator and copywriter on Phase 3, calls new `fetchSelectedClipDescriptions()` to pull `asset_segments.description` for the picked IDs and passes them to the copywriter as `selectedClipDescriptions`.
- `src/agents/copywriter.ts` — accepts `selectedClipDescriptions?: (string | null)[]`; when present, the Phase 3 user message gets a new "ACTUAL SELECTED CLIPS" section.
- `src/agents/prompts/copywriter.md` — new "Post-Selection Clip Descriptions (Phase 3)" section; clip descriptions are the source of truth for what to write about, brief constraints are fallback.

**Commit `5327188` — fix(copywriter): enforce style constraints — only label names visible content**

`src/agents/prompts/copywriter.md`:
- Style guide rewritten with examples for each of the 6 styles. Most important change: `bold-center`, `subtitle`, and `minimal` get explicit "do NOT describe what's on screen" rules.
- New "CRITICAL STYLE RULE" block at the end of the style guide.
- Phase 3 example output replaced with a 5-slot example showing the correct style/content relationship (bold-center=emotional, minimal=mood cue, none=empty, label=visible name, cta=action).

### Validation

- `npm run build` clean on both commits (Zod ↔ TS interface in lockstep via `_AssertEqual`).
- `smoke-test-inventory.ts` against nordpilates: 518 exercise+hold segments aggregated, 156 unique exercise-name tags after filter, 21 body regions.
- `smoke-test-pivot.ts` against nordpilates with idea seed "3 pilates moves to wake up your core": brief generated in 21.1s, video_type=tips-listicle, slot_count=5, 3/3 body slots picked valid library regions (core, core, obliques), 0 outliers. **PASS.**

### Library inventory snapshot (2026-04-20, nordpilates)

| Bucket | Count |
|---|---|
| Exercise segments | 420 |
| Hold segments | 98 |
| Talking-head | 8 ⚠ (scarce) |
| B-roll | 117 |
| Body regions covered | 21 |
| Unique exercise-name tags | 156 |

Top regions by clip count: arms (55), spine (53), obliques (37), chest (20), quads (14). Talking-head scarcity is the single biggest content gap — CD prompt warns when count < 10 and steers planning away from talking-head-heavy structures.

### What did NOT ship this session

- Merge to `main` — operator's call.
- VPS deploy — operator's call.
- Real-job end-to-end test — needs deploy first.
- `formatFullBrief()` Phase 3 fix — still cosmetic, still broken.
- n8n S1/S2 polling investigation — separate workstream.

---

## Session report — 2026-04-18

### Prompt fixes shipped

**Commit `090bb07` — fix(prompts): visual clip descriptions, hook duration floor, curator prep-clip rejection**
- `creative-director.md`: Hook duration minimums (slow ≥7s, medium ≥5s), CRITICAL visual description block with 4-row table, Example 3 updated, "Things to avoid" expanded
- `asset-curator-v2.md`: New criterion #2 "Active performance" — exercise slots must show active exercise, not setup/positioning. Total criteria: 7.

### Segment analyzer deep rewrite

**Commit `0d9f55e` — feat(ingestion): deep segment analyzer rewrite**
- `segment-analyzer.md`: Full rewrite with 4 failure modes, duration caps (exercise 12s, hold 15s, other 20s), mandatory subject appearance, exercise naming, 10-15 structured tags, movement phase tracking
- `test-reanalyze.ts`: Side-by-side comparison script for validating prompt changes

**Test results on two assets:**
- Asset `22dba651` (plank routine, 215s): 12→23 segments. Subject appearance 1/12→23/23. Over-split setup (8 phone-checking segments) — needs calibration for non-exercise content.
- Asset `350467ca` (wall exercises, 171s): 7→27 segments. Avg exercise duration 34.9s→6.2s. Exercise names 4→23. Subject appearance 2/7→27/27. Clean splits at rep boundaries.

### Full re-segmentation backfill

**Commit `b677334` (merged to main) — feat(backfill): --reprocess mode**
- Extended `backfill-segments.ts` with `--reprocess --brand` flag
- Deletes old segments + R2 files before re-analyzing
- Dry-run mode, progress logging, rate limiting
- Run completed: 191/191 assets, 611→903 segments, 0 failures, $12.32 Gemini credits, 170 minutes

### Test video results (post-backfill)

5 jobs submitted with varied idea seeds:
1. "3 pilates moves that open tight shoulders" — queued (S1 polling issue)
2. "fun pilates exercises" — rendered, QA PASSED, **but clips don't match overlay text**
3. "pilates queen life" — queued (S1 polling issue)
4. "big booty workout" — queued (S1 polling issue)
5. "fast edit of many short pilates exercises" — brief_review, approved but not progressing (S2 polling issue)

**Key finding:** Curator scores improved significantly (9/10 vs previous 4-5/10), but the fundamental problem persists — the CD names exercises that don't match what the curator can find. The architecture needs to change, not the prompts.

---

## Architecture pivot plan

**Current flow (broken):**
```
Idea seed → CD invents exercise names → Curator searches → Wrong clips selected
→ Copywriter writes text for CD's plan → Text doesn't match clips
```

**New flow (proposed):**
```
Idea seed → Query library inventory → CD designs structure + body focus (not exercise names)
→ Curator picks best clips by body region + energy → Copywriter writes text matching actual clips
→ Text always matches clips
```

See `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md` for full design, scoping, and implementation plan.

---

## Phase 3 milestone status

| Milestone | Status | Date |
|---|---|---|
| 3.1 — CD + downstream agents | ✅ COMPLETE | 2026-04-17 |
| 3.2 — Clean-slate ingestion | ✅ COMPLETE | 2026-04-16 |
| 3.3 — Remotion + production flip | ✅ COMPLETE | 2026-04-17 |
| 3.4 — Re-segmentation with deep analyzer | ✅ COMPLETE | 2026-04-18 |
| 3.5 — Architecture pivot (library-aware CD + post-selection copy) | 🟡 SHIPPED ON BRANCH (pending merge + deploy + e2e validation) | 2026-04-19/20 |

**Branch:** `feat/architecture-pivot` (commits `fd63a35` + `5327188`, pushed to origin).
**Build:** clean. **Smoke test (CD with inventory + body_focus):** PASS.
**Open before milestone closes:** PR merge to main → VPS deploy → fresh test batch rated for text/clip alignment.

**Success criterion (8/10 consecutive approvals):** Not yet measured. Blocked on the open items above.

---

## Data inventory (2026-04-18)

- **191 assets** (nordpilates, all re-segmented)
- **903 asset_segments** (freshly generated with deep analyzer)
  - Exercise segments: avg 6.2s duration (was ~25s)
  - Subject appearance: 100% coverage
  - Exercise names: identified where recognizable
  - Movement phase tags: all exercise/hold segments
  - CLIP embeddings: fresh from new keyframes
- 15 music_tracks (gap: no calm/ambient tracks)
- 5 brand_configs (nordpilates active)
- ~10 jobs (5 test jobs from 2026-04-18)

---

## Active n8n workflows

| # | Workflow | Status | Notes |
|---|---|---|---|
| S1 | New Job | ⚠️ | 30s poll. **Issue: 3 queued jobs not picked up during batch test.** Needs investigation. |
| S2 | Brief Review | ⚠️ | 30s poll. **Issue: approved brief not progressing to rendering.** Needs investigation. |
| S3 | QA Decision | ⏸ | Needs v2 rebuild |
| S7 | Music Ingest | ✅ | 5min poll |
| S8 | UGC Ingest | ✅ | Should be paused during backfills. Known issues: .mov filter, skip item crash. |
| P1 | Job Status Push | ✅ | Webhook |
| P2 | Periodic Sync | ✅ | 5min |

---

## Known issues (priority sorted)

| Priority | Issue | Status / target |
|---|---|---|
| **CRITICAL** | CD designs for exercises it can't verify exist → wrong clips | ✅ Fixed on `feat/architecture-pivot` (library-aware CD). Awaiting merge + deploy. |
| **CRITICAL** | Copywriter writes text before clips selected → text/clip mismatch | ✅ Fixed on `feat/architecture-pivot` (post-selection copy + style-rule). Awaiting merge + deploy. |
| **HIGH** | Preparation clips still selected despite curator prompt | Re-evaluate after pivot deploy — body_focus may shift the picks. If still bad: segment-level filtering. |
| **HIGH** | Talking-head clips scarce (8 total on nordpilates) | Library gap. CD now warns when < 10 (`library-inventory.ts`). Need uploads. |
| **HIGH** | S1/S2 n8n workflows unreliable during batch submission | Investigate polling/execution issues — separate workstream. |
| **HIGH** | Music library no calm/ambient tracks | Need uploads. |
| Medium | Full Brief display "SLOT undefined" | formatFullBrief Phase 3 support (cosmetic). Still open. |
| Medium | CD refuses non-workout idea seeds | Prompt defaults to workout-demo for everything. Still open. |
| Medium | S8 workflow .mov-only filter + skip item crash | queryString clear + IF filter. Still open. |
| Low | Vibe column not wired | Follow-up. |
| Low | Legacy `analyzeClip` Gemini Flash runs unconditionally | Cleanup. |
| Low | Setup over-splitting in segment analyzer | Calibrate: long setup/rest should merge, not chop into 10s blocks. |

---

## Cost tracking

| Component | Per video / per clip | Notes |
|---|---|---|
| Phase 3 CD (Sonnet) | ~$0.20-0.30 | Will change with pivot |
| Copywriter (Sonnet) | ~$0.10-0.15 | Will change with pivot |
| Curator V2 (Gemini Pro) | $0 (credits) | ~5 slots × $0.04 if credits end |
| Ingestion (Gemini Pro) | $0 (credits) | ~$0.06/clip, deep analyzer |
| Backfill reprocess | $12.32 total | One-time, 191 assets |
| **Real out-of-pocket** | **~$0.35-0.45/video** | Phase 3 path |

Infra: ~€15/mo (Hetzner VPS + n8n server) + ~$1.20/mo Redis + ~$1-5/mo R2.

---

## Document status

- `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md` — has STATUS BLOCK at top capturing what shipped on `feat/architecture-pivot`. Open items: merge, deploy, e2e validation.
- This file (10) — current. Updated 2026-04-20 with pivot session report. Replaces (9).
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — still needs update after pivot is merged + deployed.
- `PHASE_3_DESIGN_3.md` — renamed in pivot commit. Milestones 3.1-3.4 complete, 3.5 shipped on branch.
- `SUPABASE_SCHEMA.md` — current. No schema changes in the pivot — `body_focus` and `asset_segment_id` live only in `jobs.context_packet` JSONB.
- `CLAUDE.md` — updated 2026-04-20 with architecture pivot status, library inventory snapshot, and new technical notes.
- Historical: (9), (8), (7), HANDOFF_PHASE3_QUALITY.md — archive, do not update.
