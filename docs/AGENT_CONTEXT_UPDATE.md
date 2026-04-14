# Agent Context Update — Post Phase 2 + 2.5 Ship

**Date:** 2026-04-13 13:46 UTC
**Branch state:** `feat/curator-v2` merged to `main` on VPS. Tag `phase2-complete` pending push from laptop.
**Production state:** `ENABLE_CURATOR_V2=true` live. V2 curator is now default.

---

## What shipped tonight

### Phase 2 (Asset Curator V2)

You built this over two commits this session. Recap for context:

**Commit 1 — Core V2 curator:**
- `src/agents/curator-v2-retrieval.ts` — CLIP text embed → `match_segments` RPC → batch resolve parent r2_keys → `CandidateSegment[]`
- `src/agents/asset-curator-v2.ts` — orchestrator: retrieve 15 → serial trim → parallel Gemini upload → Pro pick → self-critique → cleanup
- `src/agents/asset-curator-dispatch.ts` — flag-gated V1/V2 router, adapter reshapes V2 output
- `src/agents/prompts/asset-curator-v2.md` — picker prompt
- `src/scripts/migrations/003_match_segments_function.sql` — pgvector RPC
- `src/scripts/test-curator-v2.ts` — 5-slot abs-burner test
- `src/lib/segment-trimmer.ts` — modified from commit 0 to downscale during trim (720p CRF 28)
- `src/agents/context-packet.ts` — swapped V1 import for dispatcher

**Commit 2 — Parent cache + variety + timing:**
- `src/lib/segment-trimmer.ts` — accepts `parentCache?: Map<string,string>`, reuses parent downloads across candidates
- `src/agents/asset-curator-v2.ts` — single cache map across all slots, variety preference via `previously_picked_parents` prompt var, per-slot timing logs
- `src/agents/prompts/asset-curator-v2.md` — `{previously_picked_parents}` placeholder + strengthened variety instruction
- `src/scripts/test-curator-v2.ts` — softened duplicate assertion (warn only if 3+ slots share parent)

### Phase 2.5 (Pre-trim at ingestion)

**Commit 3 — Runtime speedup via pre-trimmed segments:**
- `src/scripts/migrations/004_asset_segments_clip_key.sql` — adds nullable `clip_r2_key TEXT` column + partial index
- `src/scripts/migrations/005_match_segments_with_clip_key.sql` — RPC returns `clip_r2_key`, requires DROP+CREATE (return type change)
- `src/lib/segment-processor.ts` — after keyframe, runs ffmpeg on already-local parent to produce 720p CRF 28 mp4, uploads to `segments/{brand_id}/{segment_uuid}.mp4`, sets `clip_r2_key` on insert. Failure → null + legacy fallback.
- `src/lib/segment-trimmer.ts` — new `clipR2Key?: string` param. FAST PATH: stream ~5MB from R2. SLOW PATH (legacy): download + encode. Falls back to slow on R2 404.
- `src/agents/curator-v2-retrieval.ts` — `CandidateSegment` includes `clipR2Key`
- `src/agents/asset-curator-v2.ts` — passes `candidate.clipR2Key` to trimmer
- `src/scripts/backfill-segment-clips.ts` — idempotent backfill for existing 182 segments: serial, parent-cached, interactive confirmation

### What was NOT yours but happened tonight

These were operator actions, not code changes:
- Dropped the ivfflat index on `asset_segments(embedding)` because stale centroids were routing text queries into empty cells. Documented in migration 003 header.
- Ran migrations 004 and 005 manually in Supabase SQL editor. Migration 005 initially failed with `42P13: cannot change return type of existing function` — fixed via DROP + CREATE + NOTIFY pgrst.
- Ran the backfill script — 182/182 segments succeeded, 354.9 MB added to R2 in 25m 26s.
- Merged `feat/curator-v2` → `main` on VPS (no GitHub push yet because VPS lacks credentials).
- Set `ENABLE_CURATOR_V2=true` in VPS `.env`.
- Restarted `video-factory.service`, confirmed active.

---

## Test results (final, post Phase 2.5)

```
Brand: nordpilates
Wall time: 261.3s (4.4 min, down from 1072s / 17.9 min)
Pro calls: ~5
Est cost: ~$0.20

Slot 0: hook → three-legged dog to knee-to-nose crunch, 9/10
Slot 1: oblique → side-lying V-ups, 10/10 (reproduced 3× across runs)
Slot 2: abs progression → plank with knee-to-elbow crunch, 9/10
Slot 3: transition → brief recovery moment, 9/10
Slot 4: cool-down closer → upward-facing dog stretch, 9/10

Unique parents: 5/5 (variety preference working, Pro explicitly mentions "avoiding previously used parent" in reasoning)
All slots ≥7: ✅
All candidates used FAST PATH: ✅
```

---

## Known issues you should track

1. **Google Gemini Pro Preview 503s** — At least 3 different 503 hits observed during this session (mid-inference, file cleanup, re-runs). Retry-once-with-exponential-backoff on `status: 503` is the obvious fix. Not in this session's scope, filed for next cleanup commit.

2. **Zod validation failures on picker output do blind retry** — Slot 0 self-critique on one run returned a JSON array instead of an object. Code silently fell back to "highest-quality candidate" and wasted 17.6s on the failed retry. Correct pattern: send the schema error back to the model in a corrective prompt, or accept the failure without retrying.

3. **Tag `phase2-complete` not yet pushed** — VPS can't push to GitHub (no credentials). Operator will push from their laptop when convenient.

4. **ivfflat index gone from `asset_segments(embedding)`** — dropped during debugging. Seq scan is fast enough at 182 rows. Recreate when library hits ~1000 rows with `lists ≈ rows / 1000`. Migration 003 comment block documents this.

5. **`match_segments` RPC takes `query_embedding` as TEXT not VECTOR** — because supabase-js doesn't reliably serialize vectors to pgvector types. The function casts internally. Don't "fix" this.

---

## Your documentation update task

The operator has updated `MVP_PROGRESS.md` and `VIDEO_PIPELINE_ARCHITECTURE_v3_7.md` → `v3_8.md`. Those are your source of truth for project state. Your own docs (if you have any project-local reference files — e.g., `CLAUDE.md` in the repo root, or internal agent handoff notes) should be updated to reflect:

### State changes

- Phase 2 + 2.5 are **complete and live in production**. `ENABLE_CURATOR_V2=true`.
- Curator is now V2 by default. V1 code stays in the codebase as emergency fallback but is not called by production pipeline.
- Segments have a new `clip_r2_key` column pointing to pre-trimmed 720p mp4s in R2 at `segments/{brand_id}/{segment_uuid}.mp4`. All existing 182 segments have been backfilled.
- Runtime curator wall time is ~4-5 minutes per video (down from 17-18 min). End-to-end pipeline is ~20 min per video.
- The `match_segments` RPC now returns `clip_r2_key` in addition to previous columns.
- The ivfflat index is gone. Seq scan is fast enough until ~1000 rows.

### Next steps for context

- **First production V2 video render is the immediate next action.** Operator creates the job in S1 sheet, approves the brief, renders, rates 1-10 against Video 2 (5-6/10 baseline). Target: 7+.
- If rating ≥7: Phase 2 is production-validated, merge confirmed, plan Phase 3.
- If rating <7: iterate the V2 picker prompt, not the architecture. Quality ceiling in the test was 9-10/10 so the architecture is not the problem.
- **Cleanup commit pending** after validation: retry-on-503, Zod schema-aware retry, any other small fixes.

### Files changed

The merged `main` now contains everything from `feat/curator-v2`. 14 files changed in that merge according to git log:
```
faa85cd feat(phase2.5): pre-trim segments at ingestion + backfill script
f568be8 feat(phase2): add parent cache + variety preference + per-phase timing logs
d0b1d3f feat(phase2): add curator V2 (retrieval + Pro picker) + dispatcher + test
```

### What not to change

- Don't touch the `match_segments` RPC signature (TEXT query_embedding)
- Don't touch the dispatcher location (it's in `context-packet.ts`, that's correct because that's where curator is actually called)
- Don't touch `src/agents/asset-curator.ts` (V1) — it's the fallback
- Don't recreate the ivfflat index yet
- Don't change `GEMINI_CURATOR_MODEL` (defaults to ingestion model, which is correct)

### What to do if asked to update docs

1. Read the operator's updated `MVP_PROGRESS.md` and `VIDEO_PIPELINE_ARCHITECTURE_v3_8.md`
2. Sync any agent-facing docs (`CLAUDE.md`, README, inline comments, task briefs) to the new state
3. Don't delete historical docs (`PHASE_2_CURATOR_BRIEF.md`, `INGESTION_OVERHAUL_AGENT_BRIEF.md`) — mark them as "historical (fully implemented)" and keep for reference
4. When you need to describe "what the curator does today," describe V2, not V1
5. When you need to describe "the data layer," note that segments carry pre-trimmed mp4s

---

## For your immediate reference

**Current flag state on VPS `.env`:**
```
ENABLE_CURATOR_V2=true
GEMINI_INGESTION_MODEL=gemini-3.1-pro-preview
# GEMINI_CURATOR_MODEL defaults to ingestion model
```

**Current git state on VPS:**
```
faa85cd feat(phase2.5): pre-trim segments at ingestion + backfill script
f568be8 feat(phase2): add parent cache + variety preference + per-phase timing logs
d0b1d3f feat(phase2): add curator V2 (retrieval + Pro picker) + dispatcher + test
```

**Service state:**
- `video-factory.service` active (running) on main branch code
- V2 dispatcher live, routing all curator calls through V2

The operator will tag `phase2-complete` from laptop when they can. Until then, the main branch HEAD is the reference point.
