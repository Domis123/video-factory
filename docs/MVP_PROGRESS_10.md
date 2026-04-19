# Video Factory — MVP Progress Tracker (10)

**Last updated:** 2026-04-18
**Supersedes:** MVP_PROGRESS (9).md
**Companion docs:** `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`, `PHASE_3_DESIGN.md`, `SUPABASE_SCHEMA.md`, `CLAUDE.md`, `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md`

---

## Where we are right now

**Phase 3 is live but producing factually incorrect videos.** The pipeline renders end-to-end and passes auto QA, but the clips shown in videos don't match the overlay text. Root cause: the Creative Director designs videos with specific exercise names without knowing what exercises exist in the library. The Curator picks the best available clips, but "best available" is often a wrong exercise. The Copywriter writes text for the CD's plan, not for the actual clips shown.

**Current focus: architecture pivot.** The pipeline flow needs to change so the CD sees library inventory before planning, and the Copywriter writes text after clips are selected. See `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md` for the full plan.

**Quality improvements shipped this session:**
- Segment analyzer deep rewrite → 611→903 segments, better descriptions, subject appearance tracking
- Prompt fixes → hook duration floors, visual descriptions, curator prep-clip rejection
- Curator scores improved (4/10 → 9/10 on first-pass picks)
- But the fundamental text/clip mismatch persists

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
| 3.5 — Architecture pivot (library-aware CD + post-selection copy) | 🔲 NOT STARTED | — |

**Success criterion (8/10 consecutive approvals):** Not yet measured. Blocked by architecture pivot — current pipeline produces visually acceptable but factually incorrect videos.

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
| **CRITICAL** | CD designs for exercises it can't verify exist → wrong clips | Architecture pivot (next session) |
| **CRITICAL** | Copywriter writes text before clips selected → text/clip mismatch | Architecture pivot (next session) |
| **HIGH** | Preparation clips still selected despite curator prompt | Needs stronger enforcement or segment-level filtering |
| **HIGH** | S1/S2 n8n workflows unreliable during batch submission | Investigate polling/execution issues |
| **HIGH** | Music library no calm/ambient tracks | Need uploads |
| Medium | Full Brief display "SLOT undefined" | formatFullBrief Phase 3 support (cosmetic) |
| Medium | CTA talking-head reuse (~6 clips) | More content + CTA b-roll fallback |
| Medium | CD refuses non-workout idea seeds | Prompt defaults to workout-demo for everything |
| Medium | S8 workflow .mov-only filter + skip item crash | queryString clear + IF filter |
| Low | Vibe column not wired | Follow-up |
| Low | Legacy `analyzeClip` Gemini Flash runs unconditionally | Cleanup |
| Low | Setup over-splitting in segment analyzer | Calibrate: long setup/rest should merge, not chop into 10s blocks |

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

- `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md` — **NEW.** Primary handoff for next session.
- This file (10) — current. Replaces (9).
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — needs update after pivot ships.
- `PHASE_3_DESIGN.md` — needs update: milestones 3.1-3.4 complete, 3.5 planned.
- `SUPABASE_SCHEMA.md` — current (no schema changes).
- `CLAUDE.md` — needs update: segment counts, architecture pivot status.
- Historical: (9), (8), (7), HANDOFF_PHASE3_QUALITY.md — archive, do not update.
