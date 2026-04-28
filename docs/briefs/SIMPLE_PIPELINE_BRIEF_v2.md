# Simple Pipeline — Brief v2 (two products)

**Workstream:** Simple Pipeline (parallel production pipeline, two products, multi-brand-aware)
**Date drafted:** 2026-04-28
**Estimated effort:** 3-4 days agent work, single Gate A
**Predecessor:** S8 multi-brand chore shipped at main 98d85b5; Polish Sprint Pillar 1 parked at branch cebfc46
**Successor:** Polish Sprint Pillar 1 resumption (post-Simple-Pipeline-ship)
**Brief format:** single-workstream brief, two product paths sharing infrastructure

---

## TL;DR

Build a parallel Simple Pipeline that ships two products from the same infrastructure:

- **Routine videos**: slot_count 2-5, parent-anchored multi-segment cuts with instructive overlay text. Sheet `Format=routine`.
- **Meme videos**: slot_count 1, single-segment with punchy/conversational overlay text. Sheet `Format=meme`.

Both products use the same Gemini Pro library-aware "Match-Or-Match" agent for segment selection. Routine path: agent emits N ranked segment_ids from one parent (parent-first cooldown). Meme path: agent emits 1 segment_id from any parent (segment-first selection across all eligible parents).

Multi-brand-aware: reads brand_id from job; per-brand readiness gating at S1 (≥3 parents with ≥10 segments + brand_configs.aesthetic_description populated). Operator activates brands per-brand on commit-to-ingest.

ffmpeg-based render path. No Critic. No Director. No Planner. Just orchestration logic + one agent stage + render. Massively simpler than Phase 3.5 / Part B.

Cost: ~$0.025/video (one Gemini Pro agent call + one Gemini Pro overlay generation + ffmpeg). Operator cost-irrelevant for v1.

What ships: nordpilates uploadable to TikTok within days of Simple Pipeline Gate A close. Cyclediet/carnimeat/nodiet follow as operator ingests + populates brand_configs.

---

## Decisions locked from kickoff Q&A

| Q | Decision | Notes |
|---|---|---|
| Q1 | Sheet "Pipeline" column dropdown `simple` / `advanced`; empty defaults to `advanced` | Per-job routing; preserves advanced-pipeline default |
| Q2 | Sheet "Clips" column 1-5 dropdown, default 3 | Operator explicit per-job |
| Q3 | Routine: greedy top-N similarity within parent (no diversity enforcement) | Source order risks unrelated material; greedy fits idea seed best |
| Q4 | Parent-first picker on routine; segment-first on meme | Routine preserves parent continuity; meme picks best segment regardless |
| Q5 | Cooldown: parent (last 2) + segment (last 2) per brand | Both layers tracked |
| Q6 | Same overlay style within routine path regardless of slot count | Don't add conditional complexity |
| Q7 | Cost ceiling irrelevant for v1, can be more if needed | Operator-confirmed |
| Q8 | slot_count=1 uses full segment duration (no padding); slot_count>1 targets 30s | Different products, different duration logic |
| Q9 | Both paths use same Gemini Pro agent stage | Q16 (b) — operator override of single-product framing |
| Q10 | Cooldown wins over fit-match (structural before heuristic) | Operator can vary idea seeds for variety |
| Q11 | Sheet "Format" column dropdown `meme` / `routine` for explicit routing | Branch logic in orchestrator |
| Q12 | Two distinct overlay generation prompts: routine + meme | Quality control via deliberate prompts |
| Q13 | Single Match-Or-Match agent call (sees library, returns segment_id(s) + reasoning) | Don't fragment into mood-translator + picker |
| Q14 | Meme path: segment cooldown only; parent cooldown implicit | slot_count=1 means segment uniqueness implies parent uniqueness |
| Q15 | Same music selector + brand mood pool for both formats | Don't differentiate music until needed |
| Q16 | Both paths use the agent (consistency over selective complexity) | Operator override of my initial code-only-routine lean |

**Default applied (no Q&A): brand_id source.** S1 reads brand_id from existing Brand column (existing). Multi-brand routing on Simple Pipeline uses standard brand_id field; no separate convention.

**Default applied (no Q&A): "Match-Or-Match" agent name.** Internal name for the Gemini Pro library-aware segment-selection agent. Renameable; not load-bearing.

---

## Scope

### In scope

**New BullMQ queue:** `simple_pipeline` registered alongside existing planning, rendering, ingestion, export queues.

**New worker:** `src/workers/simple-pipeline.ts` listening on `simple_pipeline` queue.

**New orchestrator:** `src/orchestrator/simple-pipeline-orchestrator.ts` that branches on Format input and orchestrates the appropriate path.

**New agent module:** `src/agents/match-or-match-agent.ts` — single Gemini Pro library-aware picker. Input: brand_id, idea_seed, format, slot_count. Output: array of segment_ids (length 1 for meme, length 2-5 for routine) + reasoning string + selected parent_asset_id.

**New picker support modules:**
- `src/orchestrator/simple-pipeline/parent-picker.ts` — for routine path: weighted random across parents with ≥10 segments, excluding last 2 used per brand. LRU fallback when insufficient diversity.
- `src/orchestrator/simple-pipeline/segment-cooldown-tracker.ts` — reads/writes simple_pipeline_render_history table; queries last-2-segments-used per brand.

**New render module:** `src/orchestrator/simple-pipeline/render.ts` — ffmpeg pipeline (concat segments + apply LUT + overlay text + logo + music + encode to 1080x1920/30fps/CRF 18 MP4).

**New overlay generators:**
- `src/orchestrator/simple-pipeline/overlay-routine.ts` — Gemini Pro call with routine-flavored prompt
- `src/orchestrator/simple-pipeline/overlay-meme.ts` — Gemini Pro call with meme-flavored prompt

**Music selector wrapper:** `src/orchestrator/simple-pipeline/music-selector.ts` — wraps existing music selection logic from advanced pipeline; no new selection algorithm. Same brand-allowed music_intents pool.

**Sheet column additions (operator-side):**
- "Pipeline" (dropdown `simple` / `advanced`; empty defaults to `advanced`)
- "Format" (dropdown `meme` / `routine`; required when Pipeline=simple)
- "Clips" (dropdown 1-5; default 3 when Pipeline=simple Format=routine; required to be 1 when Format=meme)

**n8n S1 routing modification:**
- Read Pipeline + Format + Clips columns
- If Pipeline=simple: validate brand readiness (≥3 parents with ≥10 segments + brand_configs.aesthetic_description populated)
- If readiness check passes: POST /enqueue {queue: 'simple_pipeline', jobId, format, slot_count}
- If readiness check fails: set jobs.status='simple_pipeline_blocked' with reason

**New schema:** `simple_pipeline_render_history` table tracking parent + segment usage per brand.

**Documentation:**
- `docs/SIMPLE_PIPELINE.md` — pipeline reference doc (architecture, when-to-use, two-product distinction, troubleshooting, operator guide)
- Update `docs/INGESTION_NAMING.md` — add note about Simple Pipeline brand_configs requirement (lazy population per brand)

### Out of scope

- **Multi-parent simple pipeline cuts.** Single-parent only for routine (segments from one parent). Cross-parent only for meme (one segment from any parent — no concatenation across parents).
- **Voice generation** — W10, parked behind first-brand cutover.
- **Render bridge for advanced pipeline** — W9.2, separate workstream.
- **Subject identity tagging at ingestion** — `s8-subject-group-tagging-future` followup; not in this brief.
- **Body composition filter** — Polish Sprint Pillar 5; not in this brief.
- **Per-form text safe zones** — Polish Sprint Pillar 3; Simple Pipeline uses one fixed position.
- **Polish Sprint Pillar 1 work** — branch parked; Simple Pipeline doesn't touch Critic or any Pillar 1 surface.
- **Brand expansion logic beyond per-brand readiness check** — operator decides which brands to activate by populating brand_configs and dropping content; system mechanics support all 33 brands once readiness is met.
- **Operator-named parent override** — auto-pick + agent only.
- **Multiple overlay options for operator selection** — single overlay per render.
- **Music differentiation by format** — same music pool for routine and meme.
- **Captions / transcription** — not used in Simple Pipeline; only AI-generated overlay text.
- **Color grade per-posture presets** — Polish Sprint scope.
- **Real-time A/V sync improvements** — not relevant; Simple Pipeline uses ffmpeg's standard sync.

---

## Pre-work

Agent runs these checks before starting Simple Pipeline implementation.

```bash
# 1. Sync main, confirm clean state
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log origin/main..main   # empty

# 2. Verify Polish Sprint branch parked
git branch -v
# expected: feat/polish-sprint-pillar-1-critic-calibration exists at cebfc46
# 6 commits ahead of main, unmerged

# 3. Verify S8 chore + followup merged
git log --oneline -10
# expected: 98d85b5 (followup merge), f4ae06c (chore merge), recent c1-c6 of S8 chore
```

```sql
-- 4. brand_configs state
SELECT brand_id,
       config->>'aesthetic_description' AS aesthetic_description,
       config->>'logo_r2_key' AS logo_r2_key
FROM brand_configs
ORDER BY brand_id;
-- agent reports per-brand readiness for Simple Pipeline:
--   brand_id, has_aesthetic_description, has_logo, has_≥3-parents-with-≥10-segments

-- 5. Per-brand parent diversity for nordpilates (and any other brand operator has ingested)
SELECT brand_id,
       COUNT(DISTINCT parent_asset_id) FILTER (WHERE parent_asset_id IS NOT NULL) AS distinct_parents,
       COUNT(*) AS total_segments,
       COUNT(*) FILTER (WHERE analysis_v2 IS NOT NULL) AS v2_analyzed_segments
FROM asset_segments
WHERE brand_id IN (SELECT brand_id FROM brand_configs)
GROUP BY brand_id
ORDER BY brand_id;

-- 6. Confirm Simple Pipeline schema not yet present
\d simple_pipeline_render_history
-- expected: relation does not exist (table will be created in c1)

-- 7. Music tracks available for nordpilates
SELECT COUNT(*) FROM music_tracks WHERE active = true;
SELECT DISTINCT music_intent FROM music_tracks WHERE active = true;
-- expected: handful of tracks; if too few, operator may need to ingest more before Simple Pipeline ships
```

```bash
# 8. VPS service state
ssh root@95.216.137.35 "systemctl status video-factory --no-pager | head -5"
# expected: active (running) since 2026-04-28 08:37:40 UTC (S8 chore deploy)

# 9. n8n S1 workflow access (operator-side)
# Operator confirms agent can access S1 workflow JSON for modification
# Path: typically exported via n8n CLI or web UI; agent confirms operator-relayed access
```

If any pre-work fails:
- No brand has ≥3 parents with ≥10 segments → halt, request operator ingestion before Simple Pipeline can ship even nordpilates v1
- aesthetic_description missing for nordpilates → halt, operator-write the field before Simple Pipeline can render
- music_tracks empty → halt, operator-ingest at least 5 tracks for nordpilates-compatible moods
- VPS not active → halt, fix infrastructure first
- n8n S1 access blocked → halt, operator opens access OR brief is split into two parts (agent ships VPS code + JSON file in repo; operator imports separately)

---

## Implementation

### Architecture flow

```
Operator fills Brand + Idea Seed + Pipeline=simple + Format + Clips in Jobs Sheet
  ↓
n8n S1 polls Jobs sheet (every 30s)
  ↓
S1 reads Pipeline, Format, Clips columns
  ↓
S1 validates brand readiness:
  - SELECT COUNT(DISTINCT parent_asset_id) FROM asset_segments WHERE brand_id=X AND ≥10 segments per parent
  - SELECT config->>'aesthetic_description' FROM brand_configs WHERE brand_id=X
  - If either missing → set jobs.status='simple_pipeline_blocked', exit
  ↓
S1 inserts jobs row, status='simple_pipeline_pending'
  ↓
S1 calls VPS POST /enqueue {queue: 'simple_pipeline', jobId, format, slot_count}
  ↓
Simple Pipeline Worker picks up job from BullMQ
  ↓
Orchestrator entry: simple-pipeline-orchestrator.ts
  ↓
1. Fetch job + brand_config from Supabase
  ↓
2. Branch on format:
   - format='routine' → Routine flow
   - format='meme' → Meme flow
  ↓
3. Match-Or-Match Agent (both flows, different output shape)
   - Inputs: brand_id, idea_seed, format, slot_count
   - For routine: agent picks parent first (excluding last 2 used per brand) THEN
     picks best N segments within that parent
   - For meme: agent picks best segment from any parent (excluding last 2 segments
     used per brand)
   - Returns: { segment_ids: string[], parent_asset_id: string, reasoning: string }
   - Cost: ~$0.01-0.02
  ↓
4. Cooldown enforcement (post-agent):
   - Routine: log parent + each segment to simple_pipeline_render_history
   - Meme: log segment to simple_pipeline_render_history
  ↓
5. Overlay text generator
   - Branch on format:
     - format='routine' → overlay-routine.ts (instructive, label-style prompt)
     - format='meme' → overlay-meme.ts (punchy, hook-style prompt)
   - Inputs: brand_aesthetic_description, idea_seed, format
   - Output: 4-15 word overlay text string
   - Cost: ~$0.005
   - Failure handling: retry once; second failure → fallback to idea_seed verbatim
  ↓
6. Music Selector
   - Reuse existing logic
   - Filter music_tracks by brand-allowed music_intents
   - Weighted random pick
  ↓
7. Render (ffmpeg)
   - Pull segment R2 keys; download to local temp
   - Concatenate segments (source order for routine; single segment for meme)
   - Apply nordpilates color grade LUT
   - Overlay text: lower-third, brand font (or system fallback), white with subtle drop shadow, full duration
   - Logo: bottom-right, 0.85 opacity, 0.15× composition height
   - Music: layer at -16 dB under any UGC audio
   - Output: 1080x1920 / 30fps / CRF 18 MP4
   - Wall time: ~30-60s
   - Cost: $0
  ↓
8. Upload to R2 → status = human_qa
  ↓
9. n8n P1 sync: status update visible in Sheet, preview URL populated
  ↓
10. Operator views, approves/rejects in Sheet
  ↓
11. n8n S3 (existing QA decision workflow) handles approve → delivered;
    reject → re-render or manual fix
```

### Match-Or-Match Agent — implementation

```typescript
// src/agents/match-or-match-agent.ts
//
// Single Gemini Pro call with library-aware reasoning.
// Sees segment v2 descriptions for the brand, picks best fit for idea seed.

interface MatchOrMatchInput {
  brandId: string;
  ideaSeed: string;
  format: 'routine' | 'meme';
  slotCount: number;
  excludedParents: string[]; // last 2 used parents (routine path)
  excludedSegments: string[]; // last 2 used segments (segment cooldown for both paths)
}

interface MatchOrMatchOutput {
  segmentIds: string[];
  parentAssetId: string;
  reasoning: string;
  cost: number;
}

async function callMatchOrMatchAgent(input: MatchOrMatchInput): Promise<MatchOrMatchOutput> {
  // 1. Query asset_segments for brand_id, fetch v2 segment descriptions
  // 2. For routine path: filter parents to those with ≥10 segments AND not in excludedParents
  //    For meme path: filter segments to those not in excludedSegments
  // 3. Build prompt with library overview + idea seed + format-specific instructions
  // 4. Call Gemini Pro with structured output schema (segment_ids, parent_asset_id, reasoning)
  // 5. Validate output: segment_ids.length === slotCount; segment_ids exist in library
  // 6. Return result
}
```

**Routine path prompt template:**

```
You are selecting clips for a brand's social media video.

Brand: {brand_id}
Brand aesthetic: {aesthetic_description}
Idea seed: {idea_seed}
Number of clips needed: {slot_count}

Available parents (excluding recently-used) — select ALL clips from ONE parent:

PARENT {parent_asset_id_1}:
  - segment_id_a: {v2_description_a} (duration: {duration}s)
  - segment_id_b: {v2_description_b} (duration: {duration}s)
  ...

PARENT {parent_asset_id_2}:
  ...

Rules:
1. Pick ONE parent that best matches the idea seed
2. Within that parent, pick {slot_count} segments most relevant to the idea seed
3. Order segments to flow naturally (start to end)
4. Avoid using segments already in your "recently-used" exclude list

Output JSON:
{
  "parent_asset_id": "...",
  "segment_ids": ["...", "...", ...],
  "reasoning": "Brief explanation of why this parent + these segments"
}
```

**Meme path prompt template:**

```
You are selecting ONE clip for a meme/vibe-style social video.

Brand: {brand_id}
Brand aesthetic: {aesthetic_description}
Idea seed (meme/vibe): {idea_seed}

Available segments (excluding recently-used):

  - segment_id_a (parent {parent_id_x}): {v2_description_a} (duration: {duration}s)
  - segment_id_b (parent {parent_id_y}): {v2_description_b} (duration: {duration}s)
  ...

Rules:
1. Pick ONE segment that best embodies the idea seed's mood/vibe/feel
2. The idea seed may be abstract, ironic, or oblique — match the *vibe*, not the literal words
3. Avoid segments already in your "recently-used" exclude list

Output JSON:
{
  "parent_asset_id": "...",
  "segment_ids": ["{segment_id}"],
  "reasoning": "Brief explanation of why this segment captures the idea seed's vibe"
}
```

### Overlay text generators — implementation

**Routine prompt (overlay-routine.ts):**

```
You are writing one short overlay text for a brand's pilates/fitness routine video.

Brand aesthetic: {aesthetic_description}
Idea seed: {idea_seed}

Rules:
- Output: 4-15 words, no quotes, no punctuation at end
- Tone: instructive, brand-anchored, label-style. Examples: "5-min morning flow", "wake your hips up", "core routine that actually works"
- Match the brand's voice from aesthetic_description
- No body-judgment language, no medical claims, no exercise prescriptions for specific conditions

Output the overlay text only (no explanation).
```

**Meme prompt (overlay-meme.ts):**

```
You are writing one short overlay text for a meme/vibe-style pilates/fitness video.

Brand aesthetic: {aesthetic_description}
Idea seed (meme/vibe): {idea_seed}

Rules:
- Output: 4-12 words, no quotes, no punctuation at end (or one ! or ? if natural)
- Tone: punchy, conversational, hook-style, often relatable or ironic. Examples: "no thoughts just stretching", "POV: you actually moved today", "main character energy unlocked"
- The text should feel like a meme caption a creator might write
- Match the brand's voice from aesthetic_description (don't sound off-brand)
- No body-judgment language, no medical claims, no exercise prescriptions

Output the overlay text only (no explanation).
```

### Cooldown enforcement

```sql
-- New table
CREATE TABLE simple_pipeline_render_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id TEXT NOT NULL REFERENCES brand_configs(brand_id),
  parent_asset_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  format TEXT NOT NULL,  -- 'routine' or 'meme'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_simple_pipeline_render_history_brand_created
  ON simple_pipeline_render_history (brand_id, created_at DESC);

CREATE INDEX idx_simple_pipeline_render_history_brand_parent_created
  ON simple_pipeline_render_history (brand_id, parent_asset_id, created_at DESC);

CREATE INDEX idx_simple_pipeline_render_history_brand_segment_created
  ON simple_pipeline_render_history (brand_id, segment_id, created_at DESC);
```

**Cooldown queries:**

```sql
-- Last 2 parents used for routine on this brand (parent cooldown)
SELECT DISTINCT parent_asset_id FROM (
  SELECT parent_asset_id, MAX(created_at) AS last_used
  FROM simple_pipeline_render_history
  WHERE brand_id = $1 AND format = 'routine'
  GROUP BY parent_asset_id
  ORDER BY last_used DESC
  LIMIT 2
) AS recent_parents;

-- Last 2 segments used for any format on this brand (segment cooldown for both paths)
SELECT DISTINCT segment_id FROM (
  SELECT segment_id, MAX(created_at) AS last_used
  FROM simple_pipeline_render_history
  WHERE brand_id = $1
  GROUP BY segment_id
  ORDER BY last_used DESC
  LIMIT 2
) AS recent_segments;
```

### S1 modification — multi-brand readiness check

```javascript
// In n8n S1 workflow, after reading the Sheet row:

const pipeline = row.Pipeline || 'advanced';

if (pipeline === 'simple') {
  const format = row.Format;
  const slotCount = parseInt(row.Clips, 10) || 3;

  if (!format || !['meme', 'routine'].includes(format)) {
    // Set status='simple_pipeline_blocked', reason='invalid_format'
    return blocked(row, 'invalid_format');
  }

  if (format === 'meme' && slotCount !== 1) {
    return blocked(row, 'meme_format_requires_clips_1');
  }

  // Brand readiness check
  const aestheticDescription = await fetchBrandAestheticDescription(row.Brand);
  if (!aestheticDescription) {
    return blocked(row, `brand_${row.Brand}_missing_aesthetic_description`);
  }

  const parentCount = await fetchBrandParentCountWithMinSegments(row.Brand, 10);
  if (parentCount < 3) {
    return blocked(row, `brand_${row.Brand}_insufficient_parents_${parentCount}_of_3_needed`);
  }

  // All checks passed
  await insertJob(row, { status: 'simple_pipeline_pending', format, slotCount });
  await postEnqueue({ queue: 'simple_pipeline', jobId: row.id, format, slotCount });
} else {
  // Existing advanced pipeline routing
  await insertJob(row, { status: 'planning_pending' });
  await postEnqueue({ queue: 'planning', jobId: row.id });
}
```

### Files

#### Create

- `migrations/<next-number>_simple_pipeline_render_history.sql`
- `src/workers/simple-pipeline.ts`
- `src/orchestrator/simple-pipeline-orchestrator.ts`
- `src/agents/match-or-match-agent.ts`
- `src/agents/prompts/match-or-match-routine.md`
- `src/agents/prompts/match-or-match-meme.md`
- `src/orchestrator/simple-pipeline/parent-picker.ts` (used in routine pre-agent or post-agent verification)
- `src/orchestrator/simple-pipeline/segment-cooldown-tracker.ts`
- `src/orchestrator/simple-pipeline/overlay-routine.ts`
- `src/orchestrator/simple-pipeline/overlay-meme.ts`
- `src/orchestrator/simple-pipeline/music-selector.ts`
- `src/orchestrator/simple-pipeline/render.ts`
- `docs/SIMPLE_PIPELINE.md`
- `docs/sprint/SIMPLE_PIPELINE_GATE_A_VERIFICATION.md`
- Updated n8n S1 workflow JSON (in repo, operator imports)

#### Modify

- `src/index.ts` — register simple_pipeline worker on startup
- `src/types/jobs.ts` (or wherever job status enum lives) — add new statuses (`simple_pipeline_pending`, `simple_pipeline_rendering`, `simple_pipeline_failed`, `simple_pipeline_blocked`)
- `docs/INGESTION_NAMING.md` — note about Simple Pipeline brand_configs requirement

#### Don't touch

- Phase 3.5 orchestrator
- Part B orchestrator
- Curator V2 prompt
- Polish Sprint feat branch (parked, untouched)
- Critic prompt (parked branch owns)
- Existing P1/P2/P3/P4 sync workflows beyond verifying they handle new status values
- shadow_runs schema or Part B routing logic
- Render bridge (`prepareContextForRender`)
- W10 voice generation
- S8 multi-brand routing (just shipped)

---

## Hard constraints

- **Cost ceiling: $1/video.** Simple Pipeline far below at ~$0.025/video; not binding.
- **Copyright bar:** music tracks operator-licensed; overlay text AI-generated, no real-person quotes, no copyrighted phrases.
- **Brand persona safety:** AI-generated overlay text doesn't include body-judgment, medical claims, or exercise prescriptions for specific conditions. Both prompts include explicit constraints.
- **Cooldown enforced:** never use a parent that's in last 2 routine renders for that brand; never use a segment that's in last 2 renders (any format) for that brand.
- **Per-brand readiness gating:** Simple Pipeline refuses jobs for brands without aesthetic_description + ≥3 parents with ≥10 segments. S1 blocks at routing.
- **No advanced-pipeline contamination:** Simple Pipeline never reads from / writes to shadow_runs, context_packet, or any Part B / Phase 3.5 state.
- **Pre-existing pipelines untouched:** Phase 3.5 routing preserved. Part B routing preserved. Polish Sprint branch parked.
- **Render quality bar:** 1080x1920 / 30fps / CRF 18 minimum.
- **Failure modes return useful errors to Sheet status, not silent.** Operator sees `simple_pipeline_blocked` or `simple_pipeline_failed` + reason in Sheet.

---

## Non-goals

- Two-parent cuts (routine path stays single-parent)
- Operator-named parent or segment override
- Multiple overlay options for selection
- Per-form text placement (Polish Sprint Pillar 3 territory)
- Body composition filtering (Polish Sprint Pillar 5)
- Critic / revise / quality gating
- Brand expansion logic beyond per-brand readiness check
- Music selection improvement
- Voice generation
- Real-time A/V sync improvements
- Captions or transcription
- Color grade per-posture presets
- Multi-language support

---

## Followups (open hooks)

To be filed at sprint close or earlier:

- `simple-pipeline-rejected-render-parent-exclusion` — rejected renders' parents may need extra-cooldown treatment
- `simple-pipeline-multi-parent-cuts` — single-parent constraint relaxation if v1 output stales
- `simple-pipeline-operator-parent-override` — operator may want explicit control later
- `simple-pipeline-brand-cooldown-config` — brand_configs override of last-2 cooldown
- `simple-pipeline-overlay-style-config` — per-brand overlay style customization
- `simple-pipeline-music-intent-mismatch` — if music selection picks tonally-off tracks
- `simple-pipeline-deletion-policy` — render history table grows indefinitely
- `simple-pipeline-meme-prompt-iteration` — meme overlay text quality iteration if first batch feels off-tone
- `simple-pipeline-routine-prompt-iteration` — routine overlay text quality iteration
- `simple-pipeline-agent-cost-monitoring` — Match-Or-Match agent cost-per-render reporting
- `simple-pipeline-parent-vs-subject-identity` — already filed; surface here as Simple Pipeline-relevant manifestation

---

## Commit sequence

```
Branch: feat/simple-pipeline   (from main)

  c1: simple pipeline — schema + jobs status extensions
       migrations/<n>_simple_pipeline_render_history.sql
       src/types/jobs.ts (or equivalent — new statuses)

  c2: simple pipeline — Match-Or-Match agent
       src/agents/match-or-match-agent.ts
       src/agents/prompts/match-or-match-routine.md
       src/agents/prompts/match-or-match-meme.md
       Test against synthetic asset_segments + idea seeds (small inline harness, deleted post-test)

  c3: simple pipeline — overlay generators
       src/orchestrator/simple-pipeline/overlay-routine.ts
       src/orchestrator/simple-pipeline/overlay-meme.ts
       Test routine + meme prompts against nordpilates aesthetic_description with mock idea seeds; verify diverse output

  c4: simple pipeline — segment cooldown tracker + parent picker
       src/orchestrator/simple-pipeline/segment-cooldown-tracker.ts
       src/orchestrator/simple-pipeline/parent-picker.ts
       Verify queries against simple_pipeline_render_history with synthetic data

  c5: simple pipeline — music selector wrapper
       src/orchestrator/simple-pipeline/music-selector.ts
       Thin wrapper over existing music selection

  c6: simple pipeline — render path
       src/orchestrator/simple-pipeline/render.ts
       ffmpeg pipeline; test render with synthetic clips on VPS

  c7: simple pipeline — orchestrator + worker
       src/orchestrator/simple-pipeline-orchestrator.ts
       src/workers/simple-pipeline.ts
       src/index.ts (register worker)

  c8: simple pipeline — n8n S1 routing modification (JSON in repo)
       Updated S1 workflow JSON
       Operator-side import action documented

  c9: simple pipeline — Sheet column setup + documentation
       Sheet "Pipeline" / "Format" / "Clips" columns added (operator action)
       docs/SIMPLE_PIPELINE.md
       Update docs/INGESTION_NAMING.md

  c10: simple pipeline — Gate A verification artifact
       docs/sprint/SIMPLE_PIPELINE_GATE_A_VERIFICATION.md
       End-to-end test plan: 6 nordpilates jobs through Simple Pipeline
       (3 routine with varying slot_count, 3 meme with varying idea seeds);
       verify cooldown working, agent picks varied, overlays differ, renders succeed

push origin feat/simple-pipeline
```

---

## Gate A verification

| Check | Method | Expected |
|---|---|---|
| Schema migration applied | `\d simple_pipeline_render_history` | Table exists with required columns + indexes |
| New jobs statuses recognized | enum check on jobs.ts | All 4 new statuses present |
| BullMQ queue registered | startup log | `simple_pipeline` worker registered |
| n8n S1 routes correctly | drop test row Pipeline=simple Format=routine Clips=3 | Job appears in `simple_pipeline_pending`, not `planning_pending` |
| n8n S1 readiness check (positive) | drop with brand=nordpilates | Job processes; brand_configs check passes |
| n8n S1 readiness check (negative) | drop with brand=cyclediet (no brand_configs.aesthetic_description) | Status = `simple_pipeline_blocked`, reason in Sheet |
| n8n S1 default preserved | drop with Pipeline empty | Job appears in `planning_pending` (advanced pipeline) |
| Match-Or-Match agent — routine | 3 routine jobs varying slot_count (2, 3, 5) | Each returns N segment_ids from one parent + reasoning; cost reported |
| Match-Or-Match agent — meme | 3 meme jobs varying idea seeds | Each returns 1 segment_id + reasoning |
| Match-Or-Match agent — cooldown enforced | 4 sequential routine jobs | Each parent unique across last 2 renders; segment cooldown also unique |
| Match-Or-Match agent — LRU fallback | Mock brand with only 2 parents ≥10 segments | After 2 jobs, third triggers LRU fallback; warning logged |
| Overlay generator — routine prompt | 3 routine jobs | All 4-15 word overlays; instructive tone; no line breaks |
| Overlay generator — meme prompt | 3 meme jobs | All 4-12 word overlays; punchy tone; no line breaks |
| Overlay generator — fallback | Mock failed Gemini call | Falls back to idea_seed verbatim |
| Music selector — track found | Each render | Music track from active brand-allowed pool |
| Render — ffmpeg success (routine) | 3 end-to-end routine renders | All 1080x1920 / 30fps / CRF 18 MP4 in R2; duration in 15-45s range |
| Render — ffmpeg success (meme) | 3 end-to-end meme renders | All 1080x1920 / 30fps MP4 in R2; duration matches segment full duration |
| Render — overlay visible | Manual visual check on R2 URL | Text appears lower-third, readable, full duration |
| Render — logo visible | Manual visual check | Logo bottom-right, 0.85 opacity |
| Render — color grade applied | Manual visual check | Warm-vibrant LUT applied |
| Render — music audible | Manual playback | Music plays at appropriate level |
| Sheet sync — status visible | Drop test row, watch Sheet | Status flows: simple_pipeline_pending → simple_pipeline_rendering → human_qa |
| End-to-end — operator approval | Drop 6 test rows, approve all in Sheet | Status flows to `delivered`; videos accessible from R2 |
| Cost per render reported | Test runs | ~$0.025 ± variance (Match-Or-Match + overlay generation + ffmpeg) |
| No advanced pipeline regression | Drop a Pipeline=advanced or empty row alongside simple jobs | Advanced pipeline routes through Phase 3.5 / Part B normally; no shared state corruption |
| Polish Sprint branch untouched | git status on parked branch | feat/polish-sprint-pillar-1-critic-calibration at cebfc46, unchanged |

---

## Rollback

### Per-commit rollback

`git revert -m 1 <merge-sha>` per Git Workflow. Simple Pipeline commits don't touch advanced pipeline state, so per-commit revert is clean.

### Full pipeline disable (emergency)

```bash
# Sheet-side disable (fastest)
# Operator stops setting Pipeline=simple; new rows route to advanced.

# VPS-side disable
ssh root@95.216.137.35 "sed -i 's/^SIMPLE_PIPELINE_ENABLED=.*/SIMPLE_PIPELINE_ENABLED=false/' /home/video-factory/.env && systemctl restart video-factory"
# Worker checks env flag at job start; rejects simple_pipeline jobs gracefully.

# Full code revert
git checkout main
git pull origin main
git revert -m 1 <merge-sha>
git push origin main
ssh root@95.216.137.35 "cd /home/video-factory && git pull origin main && npm install && npm run build && systemctl restart video-factory"
```

Schema migration: `simple_pipeline_render_history` table can stay even after code revert. No drop required for rollback.

---

## Prerequisites

- main = post-S8-chore-merge state (98d85b5)
- Polish Sprint branch parked at cebfc46
- VPS service active (since S8 chore deploy)
- nordpilates parent diversity sufficient (≥3 parents with ≥10 segments — confirmed 1173 segments)
- nordpilates brand_config has aesthetic_description (operator-populated as part of pre-work; may need writing if not yet there)
- nordpilates brand_config has logo_r2_key
- music_tracks table has active rows for nordpilates-compatible moods (operator may need to ingest more if sparse)
- n8n S1 workflow accessible to agent for modification
- Operator sets up Sheet "Pipeline" + "Format" + "Clips" columns + dropdowns

---

## Success criterion

- nordpilates Simple Pipeline routine job created via Sheet → renders successfully → human_qa state visible → operator approves → delivered (TikTok-uploadable)
- nordpilates Simple Pipeline meme job created via Sheet → 1-segment render successfully → human_qa state → approve → delivered
- 3 sequential routine jobs use 3 different parents (parent cooldown working)
- 3 sequential routine jobs use distinct segments per render (segment cooldown working)
- Overlay text varies meaningfully across jobs (not template repetition)
- Routine + meme overlay tones distinguishable in operator review
- Advanced pipeline operates without regression
- Polish Sprint branch parked at cebfc46

Stretch:
- 10 sequential renders (mix of routine + meme) with operator approval rate ≥75% (if AI-generated text is bad more than 1-in-4, prompt iteration becomes a followup)
- Match-Or-Match agent reasoning quality: operator review of 5+ reasoning strings finds them substantive (not generic), supporting future debugging

---

## Notes for the agent

- **Strategic-first, tactical-second.** If during execution you spot architectural concerns, pause and report. Don't tactically force a workaround.
- **No Polish Sprint branch interference.** feat/polish-sprint-pillar-1-critic-calibration parked; don't rebase it, merge it, or modify it.
- **ffmpeg over Remotion.** The advanced pipeline's render bridge is tangled (W9.2 deferred); Simple Pipeline avoids that by using ffmpeg directly.
- **Per-commit testing.** c1-c10 each ship with verification; don't ship c10 without all prior commits' tests passing.
- **n8n S1 modification ships as JSON file in repo.** Operator imports separately. Same pattern as S8 chore.
- **Match-Or-Match agent prompt iteration.** If first Gate A test runs reveal output quality is weak (irrelevant segments picked, weak reasoning), iterate the prompt before merge. Don't ship known-bad output expecting later fix.
- **Cost monitoring.** Each render's Match-Or-Match cost should appear in jobs.cost_usd; verify cost tracking flows correctly.
- **Cooldown verification.** Test with 5+ sequential renders before declaring cooldown working. Edge case: brand has fewer parents than cooldown requires; LRU fallback must trigger.
- **Schema migration testing.** Apply to dev environment first; verify queries before production migration.
- **Operator-side actions documented.** docs/SIMPLE_PIPELINE.md must include exact operator steps: Sheet column setup, n8n S1 import, brand_configs population requirements per brand, dropdown values.

---

## Operator-side action checklist (for when Simple Pipeline ships)

1. **Pre-Gate-A operator setup:**
   - Confirm nordpilates brand_configs.aesthetic_description populated (operator writes if needed)
   - Add Sheet columns: "Pipeline", "Format", "Clips" with dropdown values
   - Confirm n8n S1 workflow access for import

2. **Per-brand activation (post-Gate-A):**
   - Drop content for new brand via S8 (with correct prefix: CL_, CM_, ND_, etc.)
   - Wait for ingestion to populate ≥3 parents with ≥10 segments
   - Populate brand_configs row with: aesthetic_description, logo_r2_key, allowed_music_intents
   - Test Simple Pipeline render for that brand

3. **First-week content shipping:**
   - Drop daily idea seeds in Jobs sheet with Pipeline=simple
   - Mix routine (3-5 clips) and meme (1 clip) formats
   - Approve in Sheet QA flow
   - Upload to TikTok / Reels / YouTube Shorts manually

---

*Simple Pipeline Brief v2 — drafted 2026-04-28 post-Polish-Sprint-pause + S8-chore-merge. Two products from one infrastructure: routine + meme. ~3-4 days agent work. Filed at `docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md` after Domis review.*
