# Agent Task Brief — Curator Overhaul (Week 2, Phase 2)

> **⚠️ HISTORICAL — FULLY IMPLEMENTED**
>
> This brief is the original design spec for Phase 2. All of it shipped on 2026-04-13 across commits `085d215`, `d0b1d3f`, `f568be8` (plus Phase 2.5 in `faa85cd`), merged to `main` on the VPS, and `ENABLE_CURATOR_V2=true` is live in production. Validation run: 261s wall time, 9-10/10 on all 5 test slots, 5/5 unique parents.
>
> **Current source of truth:** `VIDEO_PIPELINE_ARCHITECTURE_v3_8.md` + `MVP_PROGRESS (5).md`. This file is retained as a reference for the design decisions behind curator V2. Do not treat as a todo list.

**Project:** video-factory
**Target branch:** `feat/curator-v2`
**Estimated agent work:** 2–3 sessions across 2 days
**Author:** orchestration assistant, 2026-04-13
**Owner:** Domis (deploys manually after agent push)

---

## TL;DR

Phase 1 shipped: `asset_segments` has 180 rich segments across 52 nordpilates clips with CLIP embeddings, segment types, and validated semantic retrieval. The existing Asset Curator (V1, Claude Sonnet, text-based) still picks from the legacy `assets` table and can't use any of this. **Phase 2 builds a new Asset Curator V2 that queries `asset_segments` via pgvector, ffmpeg-trims candidates from R2 on the fly, and uses Gemini 3.1 Pro with native video input to pick the best one per brief slot.**

V1 stays operational as fallback. V2 is gated by `ENABLE_CURATOR_V2` feature flag. Zero-risk rollout.

---

## Why Phase 2 is the quality unlock

**Current state (V1):**
- Curator reads a row from `assets` with one lossy tag list + one Flash description
- Picks 5 clips based on text matching against the brief
- Has no way to distinguish setup from exercise, usable from garbage
- Failure mode: abs-burner video used a mat-setup segment twice thinking it was exercise content

**Phase 2 state (V2):**
- Curator reads from `asset_segments` — 180 rich segments with type labels
- For each brief slot, filters by `segment_type` to exclude setup/unusable/transition from exercise searches
- CLIP vector search narrows to top 15 candidates per slot by visual+semantic similarity to the brief
- ffmpeg trims each candidate from the R2 parent file using stored `start_s`/`end_s`
- Gemini 3.1 Pro watches all 15 actual video slices and picks the best one with reasoning
- Self-critique pass re-scores the pick, swaps to next best if rated <7/10

Two mechanisms working together: CLIP is the filter (cheap, narrows 180→15), Pro is the judge (expensive, makes the decision with eyes on the footage).

---

## Current State (do not break)

- `src/agents/asset-curator.ts` — V1, Sonnet-based, reads `assets` table, returns 5 picks
- `src/agents/prompts/asset-curator.md` — V1 prompt
- `src/workers/pipeline.ts` — planning worker calls the V1 curator during the planning phase
- `asset_segments` table populated with 180 rows via Phase 1 backfill
- `clip-embed.ts` exports `embedText(text)` — this is how V2 embeds the brief slot description before vector search

**Phase 1 invariants that must hold:**
- `assets` table stays as-is (V1 still uses it as fallback)
- `/ugc-ingest` keeps writing both legacy and segments rows
- No changes to `segment-processor.ts` or ingestion worker
- Video output stays backward compatible when `ENABLE_CURATOR_V2=false`

---

## Goal of Phase 2

After this phase ships:

1. New `src/agents/asset-curator-v2.ts` exists and implements the vector retrieval → trim → Pro picker → self-critique flow
2. New `src/agents/prompts/asset-curator-v2.md` contains the Pro picker prompt
3. A small dispatcher in `src/agents/asset-curator-dispatch.ts` checks `ENABLE_CURATOR_V2` and routes to V1 or V2
4. `src/workers/pipeline.ts` calls the dispatcher, not V1 directly
5. Feature flag `ENABLE_CURATOR_V2=false` by default — service behaves exactly as today
6. A test script `src/scripts/test-curator-v2.ts` lets Domis run V2 against a real brief payload and inspect picks without rendering a full video

---

## Phase 2 Work Breakdown

### Step 1 — Helper: ffmpeg trim + Gemini upload

**File:** `src/lib/segment-trimmer.ts`

**API:**
```ts
export interface TrimmedSegment {
  segmentId: string;           // asset_segments.id
  localPath: string;            // /tmp/video-factory/curator-v2/{uuid}.mp4
  geminiFileName: string | null; // e.g. "files/abc123", set after upload
  durationSeconds: number;
}

export async function trimSegmentFromR2(
  parentAssetR2Key: string,
  startS: number,
  endS: number,
  segmentId: string,
  workDir: string
): Promise<TrimmedSegment>;
```

**Implementation:**
1. Stream the parent file from R2 to a temp path (reuse R2 client from `r2-storage.ts`). **Optimization for later:** if the same parent is referenced by multiple candidates in one curator call, cache the full download. First version can skip this — just download per trim.
2. Run `ffmpeg -ss {startS} -i {tempParent} -t {endS - startS} -c copy -avoid_negative_ts make_zero {outPath}`. Stream copy (no re-encode) to keep it fast. If stream copy fails on certain MOV files (HEVC codec issues are common), fall back to `-c:v libx264 -preset ultrafast -crf 23 -c:a aac`.
3. Return the TrimmedSegment with `geminiFileName: null`.
4. Delete the temp parent file after trim to conserve disk.

**Note on performance:** the test case from Phase 1 (`long-workout.MOV`, 85s source, 10 segments) means 10 parent downloads of the same file if uncached. For the MVP we accept this cost. Caching + parallel downloads is a Phase 2.5 optimization — don't do it now.

### Step 2 — Helper: upload trimmed segments to Gemini in parallel

**File:** `src/lib/segment-trimmer.ts` (same file)

**API:**
```ts
export async function uploadSegmentsToGemini(
  segments: TrimmedSegment[]
): Promise<TrimmedSegment[]>; // mutates and returns with geminiFileName set
```

**Implementation:**
1. For each segment, call `fileManager.uploadFile(localPath, { mimeType: 'video/mp4' })` **in parallel** (use `Promise.all`). Uploads are I/O-bound and the File API accepts parallel uploads cleanly.
2. After upload, poll each file until `state === 'ACTIVE'` (reuse the pattern from `gemini-segments.ts`).
3. Mutate each segment with its `geminiFileName`. Return the array.
4. Export a companion `cleanupGeminiSegments(segments)` that deletes all uploaded Gemini files — caller MUST invoke this in a finally block.

**Critical:** these are the only two places in the codebase that upload to Gemini Files API. Keep them together so cleanup logic stays consistent.

### Step 3 — Retrieval helper

**File:** `src/agents/curator-v2-retrieval.ts`

**API:**
```ts
export interface BriefSlot {
  index: number;
  description: string;          // from Creative Director brief
  valid_segment_types: string[]; // e.g. ['exercise', 'hold'] for an exercise slot
  min_quality: number;          // e.g. 6
}

export interface CandidateSegment {
  segmentId: string;
  parentAssetId: string;
  parentR2Key: string;
  brandId: string;
  startS: number;
  endS: number;
  durationS: number;
  segmentType: string;
  description: string;
  qualityScore: number;
  distance: number; // cosine distance from slot embedding
}

export async function retrieveCandidatesForSlot(
  slot: BriefSlot,
  brandId: string,
  topK: number = 15
): Promise<CandidateSegment[]>;
```

**Implementation:**
1. Call `embedText(slot.description)` from `clip-embed.ts` to get a 512-dim query vector.
2. Query Supabase with a raw SQL fragment (Supabase-js supports `rpc` but for vector ops it's easier to use the SQL builder with an `.rpc` helper or call a stored function).

**Preferred approach:** define a SQL function once in a new migration, call it via `supabaseAdmin.rpc(...)`:

```sql
-- Migration 003
CREATE OR REPLACE FUNCTION match_segments(
  query_embedding VECTOR(512),
  brand_filter TEXT,
  type_filter TEXT[],
  min_quality INT,
  match_count INT
) RETURNS TABLE (
  id UUID,
  parent_asset_id UUID,
  brand_id TEXT,
  start_s NUMERIC,
  end_s NUMERIC,
  duration_s NUMERIC,
  segment_type TEXT,
  description TEXT,
  quality_score INT,
  distance FLOAT
) LANGUAGE sql STABLE AS $$
  SELECT
    s.id,
    s.parent_asset_id,
    s.brand_id,
    s.start_s,
    s.end_s,
    s.duration_s,
    s.segment_type,
    s.description,
    s.quality_score,
    (s.embedding <=> query_embedding)::float AS distance
  FROM asset_segments s
  WHERE s.brand_id = brand_filter
    AND s.segment_type = ANY(type_filter)
    AND s.quality_score >= min_quality
    AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;
```

Produce this as `src/scripts/migrations/003_match_segments_function.sql`. Domis will run it manually.

3. Call `supabaseAdmin.rpc('match_segments', { ... })`.
4. Join back to `assets` table to fetch `r2_key` for each candidate's parent (single batch query by `parent_asset_id IN (...)`).
5. Return the candidate list, sorted by distance ascending (closest first).

### Step 4 — Pro picker + self-critique

**File:** `src/agents/asset-curator-v2.ts`

**File:** `src/agents/prompts/asset-curator-v2.md` — the picker prompt:

```
You are an expert short-form video editor. You will receive:
1. A brief for ONE slot in a video being assembled
2. Up to 15 candidate clip segments (actual video) that match the slot's
   content and type requirements
3. Metadata for each candidate (segment_type, quality_score, description)

Your job: pick the single best candidate for this slot.

SLOT BRIEF:
{slot_description}

SLOT REQUIREMENTS:
- Valid segment types: {valid_types}
- Minimum quality: {min_quality}
- Target duration: {target_duration_s}s
- This is slot {slot_index} of {total_slots} in the video

CANDIDATES:
{candidate_metadata_block}

EVALUATION CRITERIA (in priority order):
1. Visual relevance — does this clip actually show what the slot describes?
2. Quality — framing, lighting, focus, and editability (already scored at
   ingestion; trust the scores unless the video contradicts them)
3. Editing fit — does the clip's energy and motion match the slot's role
   in the video (hook vs demo vs transition vs closer)?
4. Variety — if this is not the first slot, prefer a different parent
   clip or segment type from previous picks when possible (to avoid
   repetition across the video)

OUTPUT FORMAT: Return ONLY a JSON object, no prose:
{
  "picked_segment_id": "<one of the candidate IDs>",
  "picked_trim_start_s": <number, usually candidate's start_s but you may
    tighten the window to a subrange if only part of the segment is ideal>,
  "picked_trim_end_s": <number>,
  "score": <1-10, your confidence in this pick>,
  "reasoning": "<one sentence: why this is the best option for this slot>"
}

Do not pick an unusable segment. Do not pick a segment shorter than 1.5s.
```

**V2 agent API:**
```ts
export interface CuratorV2Result {
  slotIndex: number;
  segmentId: string;
  parentAssetId: string;
  trimStartS: number;
  trimEndS: number;
  score: number;
  reasoning: string;
  candidateCount: number; // how many candidates went into the Pro call
}

export async function curateWithV2(
  brief: { slots: BriefSlot[]; brandId: string },
  previousPicks: CuratorV2Result[] // for variety context (empty on slot 0)
): Promise<CuratorV2Result[]>;
```

**Implementation:**

1. For each slot in `brief.slots` (serial, not parallel — rate limits):
   a. `retrieveCandidatesForSlot(slot, brandId, 15)`
   b. If zero candidates returned, log a warning, widen the filter (drop quality threshold by 2 and try again; if still zero, return a placeholder result with `score: 0` and let the caller decide what to do)
   c. For each candidate, `trimSegmentFromR2(...)` — serial trim (parallel trim risks VPS memory pressure; optimize later if slow)
   d. `uploadSegmentsToGemini(trimmedSegments)` — **parallel** upload (I/O-bound, safe)
   e. Call `gemini-3.1-pro-preview` with the prompt + candidate video parts + metadata block. Use `generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }`. Attach trimmed clips via `fileData: { fileUri: <gemini file uri>, mimeType: 'video/mp4' }` in the content parts.
   f. Parse response, validate with Zod
   g. Self-critique pass: make a second Pro call with the picked segment's video + "You picked this. Rescore 1-10. If <7, return the ID of the next-best alternative from the original candidates." Use the same Zod schema.
   h. Record the final pick in `CuratorV2Result`
   i. **Cleanup in finally:** delete all Gemini files, delete all local trims

2. Return all picks once every slot is processed.

**Cost per call estimate:** ~5 slots × (1 pick call + 1 critique call) × ~$0.02/call = ~$0.20–0.25 per video.

**Time per call estimate:** ~15-30s per slot (trim + upload + 2 Pro calls) × 5 slots = **~2-3 min total curator time** vs ~22s for V1. Justified by the quality delta.

### Step 5 — Dispatcher

**File:** `src/agents/asset-curator-dispatch.ts`

**API:**
```ts
export async function curateAssets(
  brief: Brief,
  brandId: string
): Promise<CuratorResult>;
```

**Implementation:**
```ts
if (process.env.ENABLE_CURATOR_V2 === 'true') {
  console.log('[curator-dispatch] Using V2 (Gemini Pro + vector retrieval)');
  const v2Result = await curateWithV2(...);
  return adaptV2ToLegacyShape(v2Result); // so pipeline.ts doesn't need to change
} else {
  console.log('[curator-dispatch] Using V1 (Sonnet text-based)');
  return await curateWithV1(...); // the existing function
}
```

**Critical:** V2's output shape must adapt to whatever `pipeline.ts` expects from V1 — otherwise you end up touching three workers to flip the flag. Write the adapter in this file.

**Then:** change `src/workers/pipeline.ts` (or wherever the curator is invoked during planning) to import from the dispatcher instead of directly from V1. That's the only worker change in this phase.

### Step 6 — Test script

**File:** `src/scripts/test-curator-v2.ts`

**Behavior:**
1. Accepts a hardcoded or CLI-supplied brief payload (define a minimal example in the file):
   ```ts
   const TEST_BRIEF = {
     brandId: 'nordpilates',
     slots: [
       { index: 0, description: "hook: arresting visual of woman starting a core workout", valid_segment_types: ['exercise', 'hold'], min_quality: 7 },
       { index: 1, description: "demo: oblique-targeting core exercise like side plank or crunch", valid_segment_types: ['exercise'], min_quality: 7 },
       { index: 2, description: "demo: abs-focused movement showing progression", valid_segment_types: ['exercise', 'hold'], min_quality: 7 },
       { index: 3, description: "transition: brief reset between exercises", valid_segment_types: ['transition', 'b-roll'], min_quality: 5 },
       { index: 4, description: "closer: strong finishing pose or cool-down stretch", valid_segment_types: ['hold', 'cooldown'], min_quality: 7 },
     ],
   };
   ```

2. Calls `curateWithV2(TEST_BRIEF, [])`
3. Prints each pick: slot index, picked segment_id, parent r2_key, trim window, score, reasoning
4. Prints summary: total Pro calls, total cost estimate, total wall time
5. Exits 0 on success, 1 if any slot returned a placeholder pick

**Run command:** `npm run test:curator-v2`

**Non-negotiables:**
- Do NOT render a video. This test exercises curator only.
- Do NOT write to Supabase. No job row should be created.
- Do NOT touch V1 code paths.

---

## Acceptance Criteria for Phase 2

Phase 2 is done when:

1. ✅ Migration 003 (`match_segments` RPC function) exists and is runnable
2. ✅ `npm run build` passes with zero type errors
3. ✅ With `ENABLE_CURATOR_V2=false` (default), the pipeline produces a video identical to the current behavior — no regression
4. ✅ `npm run test:curator-v2` returns 5 picks with all fields populated, all scores ≥ 7, no placeholder picks
5. ✅ When `ENABLE_CURATOR_V2=true` and a real job is enqueued, the planning worker logs show V2 being used, segments picked come from `asset_segments` table, and the downstream pipeline completes successfully
6. ✅ Each V2 curator call runs in under 5 minutes wall time
7. ✅ Temp files (`/tmp/video-factory/curator-v2/*`) are cleaned up after every run (success OR failure)
8. ✅ Gemini Files API files are deleted after every run (success OR failure) — check via a test that lists files before/after
9. ✅ Flipping the flag back to `false` mid-stream is safe (dispatcher re-reads env on each call)

---

## Out of Scope for Phase 2

- ❌ `archetype` field on Creative Director brief (Phase 2.5)
- ❌ Variable clip count per video (Phase 2.5)
- ❌ Variable-count Remotion composition (Phase 3)
- ❌ Pre-normalization of clips at ingestion (Phase 3)
- ❌ Parent file download caching in the trimmer (optimization, Phase 2.5)
- ❌ Parallel trim (optimization, Phase 2.5)
- ❌ Quality Director post-render scoring (Month 2)
- ❌ Retiring V1 curator (it stays as fallback until V2 has produced 20+ successful videos)

---

## Deployment Sequence (Domis runs these)

1. Run migration 003 in Supabase SQL editor manually.
2. `git pull && npm install && npm run build`
3. `npm run test:curator-v2` — inspect picks, confirm they look thematically coherent and no slots are empty.
4. Flip flag: `sed -i 's/^ENABLE_CURATOR_V2=.*/ENABLE_CURATOR_V2=true/' .env || echo 'ENABLE_CURATOR_V2=true' >> .env`
5. Restart service: `systemctl restart video-factory`
6. Create a real job via S1 in the sheet (e.g. `5 minute pilates abs burner for busy moms` — same seed as the previous failed attempt, so we can compare).
7. Watch logs. Expect ~2-3 min curator time in the planning phase (vs ~22s for V1).
8. Approve the brief in the sheet. Render proceeds normally.
9. Rate the final video against Video 2 (5-6/10) and Video 1 (6/10). Target ≥7/10.
10. If video is worse than V1, flip flag back to false, push to main, file bug report, fix in next commit.

---

## Estimated Cost Impact

| Item | One-time | Recurring |
|---|---|---|
| Phase 2 dev testing (5-10 test runs) | ~$2 | – |
| Per-video curator cost (V2 active) | – | ~$0.20 |
| **Total incremental** | ~$2 | ~$0.20/video |

Per-video total post-Phase-2: ~$0.75. Still inside budget cap at every scale tier.

---

## Communication Protocol

- Commits go to `feat/curator-v2` branch.
- Each of Steps 1-6 is a separate commit so Domis can deploy and test incrementally.
- Final PR to main after Domis confirms acceptance criteria 4 and 5.
- Don't flip the feature flag yourself — Domis flips it after test:curator-v2 succeeds locally.
- If you're unsure about the V1 output shape, grep `src/agents/asset-curator.ts` for the `return` statement and match it exactly in the dispatcher adapter.

---

End of Phase 2 brief.
