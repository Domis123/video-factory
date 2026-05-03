# Editor Agent — Simple Pipeline v1.2

**Status:** brief drafted 2026-04-30
**Branch:** `feat/simple-pipeline-editor-agent` from main HEAD `8cc181c`
**Predecessor:** Simple Pipeline v1.1 (deployed 2026-04-29)
**Workstream type:** standard two-gate (NOT single-gate per Rule 42 — adds new agent stage, new prompt file, new orchestrator step, new schema validation)

---

## Purpose

Refine `start_s`/`end_s` boundaries on segments picked by Match-Or-Match before Pass A trim. Solves operator-flagged problem from v1.0/v1.1 production review: some segments have 1-2s of preparation footage at start, end mid-action, or contain unhelpful content at boundaries. Hard cuts produce visible-but-imperfect edits.

Operator workflow today: over-generate ~6 idea seeds per actual target video, discard 2-3 with bad boundaries. Target post-Editor: generate 3 idea seeds, ship 3 videos.

---

## Architectural decisions (from kickoff Q&A 2026-04-30)

| Q | Decision |
|---|---|
| Q1 input modality | Keyframe grids (4×3 mosaic, 12 timed frames per segment, EXIF-embedded coords) + `segment_v2` JSONB + `description` + `editor_use`. Single Gemini Pro multimodal call per segment, image input only. NO ffprobe, NO video upload, NO videoMetadata.startOffset path. |
| Q2 cross-cut awareness | Per-segment isolation. N parallel Gemini calls (Promise.all). Each segment refined independently. |
| Q3 scope | Incision cuts only. `refined_start_s >= original_start_s` AND `refined_end_s <= original_end_s` (cannot widen). Cannot drop, re-rank, or invoke Match-Or-Match. |
| Q4 format gating | Routine path only. Meme path bypasses Editor entirely (single-segment, verbatim-shaped). |
| Q5 placement | Between Match-Or-Match and Pass A in `simple-pipeline-orchestrator.ts`. Pass A's existing parent-cache logic untouched; only the trim args change. |
| Q6 schema + clamps | See "Schema" section below. Hard clamp on bounds. 1.5s minimum trimmed-segment duration. |
| Q7 failure handling | Fall back silently per segment to original boundaries. 1 retry on transient errors (timeout, 429, 500). 0 retries on Zod/clamp failures. Log outcome to `job_events.payload`. |
| Q8 Gate A bar | Mechanical: all 6 routine renders complete through human_qa, refined bounds within original, wall time delta < 30s vs v1.1 baseline. Visual: ≥4/6 noticeably better, 0/6 noticeably worse, side-by-side against v1.1. |

---

## Files to add / modify

**New files:**

- `src/agents/editor-agent.ts` — single Gemini Pro multimodal call per segment, parallelized via Promise.all from orchestrator
- `src/agents/prompts/editor-agent.md` — agent prompt (boundary refinement, anti-pattern examples, escape paths per Rule 38)
- `src/agents/editor-agent-schema.ts` — Zod schema for `EditorRefinement` output

**Modified files:**

- `src/orchestrator/simple-pipeline/simple-pipeline-orchestrator.ts` — insert Editor step between Match-Or-Match and Pass A on routine format only; bypass for meme
- `src/orchestrator/simple-pipeline/render.ts` — Pass A reads `refined_start_s`/`refined_end_s` if present, falls back to original `start_s`/`end_s` if Editor returned `no_change_needed` or fell back
- `n8n-workflows/...` — NO changes. Editor is internal to the worker. n8n doesn't see it.

**No schema migration needed.** Editor outcome lives in `job_events.payload->editor_outcome`. No new columns, no new tables.

---

## Schema

```typescript
// EditorRefinement — Zod-validated per-segment output
{
  segment_id: string,                                 // UUID, must match input
  refined_start_s: number,                            // must be >= original_start_s
  refined_end_s: number,                              // must be <= original_end_s
  reasoning: string,                                  // 1-2 sentences for diagnostics
  confidence: 'high' | 'medium' | 'low',              // for fallback decisions if used later
  no_change_needed: boolean                           // explicit "leave as-is" signal
}
```

**Hard clamps (post-Zod, pre-render):**

1. If `refined_start_s < original_start_s`: clamp to `original_start_s`. Log `clamp:start_widened`.
2. If `refined_end_s > original_end_s`: clamp to `original_end_s`. Log `clamp:end_widened`.
3. If `refined_end_s - refined_start_s < 1.5`: REJECT refinement, fall back to original boundaries. Log `fallback:duration_floor_violated`.
4. If `refined_start_s >= refined_end_s`: REJECT refinement, fall back. Log `fallback:invalid_range`.
5. If `no_change_needed === true`: ignore `refined_start_s` / `refined_end_s`, use original boundaries. Log `outcome:no_change_needed`.

**Retry policy:**

- Transient errors (network timeout, HTTP 429, HTTP 5xx): 1 retry with 2s backoff.
- Non-transient errors (Zod parse fail, clamp violations 3 or 4): 0 retries, immediate fallback.
- Per-segment isolation: a fallback on segment 2 does not affect segments 1, 3, 4, 5.

---

## Per-render observability — `job_events.payload->editor_outcome`

Single job_events row per render with payload shape:

```typescript
{
  editor_invoked: boolean,                            // false on meme, true on routine
  segments_total: number,                             // N picks
  segments_refined: number,                           // count where Editor returned a refinement that passed clamps
  segments_no_change: number,                         // count where no_change_needed=true
  segments_fallback: number,                          // count where Editor failed/clamped/retried-out
  fallback_reasons: Record<string, number>,           // e.g., { "duration_floor_violated": 1, "timeout": 1 }
  editor_wall_ms: number,                             // total wall time for the parallel Promise.all
  editor_cost_usd: number                             // sum of per-call cost from Gemini billing
}
```

Allows aggregate queries post-Gate A: how often does Editor refine vs no-change vs fallback? Which fallback reasons dominate?

---

## Prompt design

`src/agents/prompts/editor-agent.md` — single per-segment prompt. Inputs assembled by `editor-agent.ts`:

- Segment metadata (`segment_id`, `original_start_s`, `original_end_s`, duration, `segment_type`)
- `description` text
- `editor_use` text
- Relevant `segment_v2` fields: motion intensity by phase, on_screen_text presence, audio has_speech, recommended_in/out_point_s if present, quality flags
- Idea seed (job-level context — what the operator is trying to make)
- Slot role (hook / body / close — Editor knows where this segment sits in the routine)
- The keyframe grid (4×3 mosaic, base64 image inline; EXIF coords parsed and included as text alongside so Gemini knows which frame = which timestamp)

**Key prompt rules (per Rule 38):**

- Explicit escape path: "If the segment's existing boundaries are already optimal, return `no_change_needed: true`. Do not invent a refinement to justify your call."
- Hard constraint on bounds: "PARENT BOUNDARIES: original_start_s={X}, original_end_s={Y}. Refined values MUST be within [X, Y]. Do NOT extrapolate boundaries beyond the original segment."
- Hard constraint on duration: "Refined duration MUST be at least 1.5s. If trimming further would violate this, return `no_change_needed: true` instead."
- Anti-pattern examples: at least 2 examples of "wrong" refinements (e.g., "trimmed too aggressively, lost the key rep" / "widened bounds beyond original") so Gemini sees what NOT to do.
- Instruction order per Rule 35: image input first, then text instructions.

---

## Gate A verification

Two artifacts required at Gate A:

**Artifact 1: `docs/diagnostics/editor-agent-gate-a.md`**

For each of 6 routine renders (idea seeds chosen by operator from a fresh batch):

- Job ID
- Match-Or-Match picks (segment_ids + original boundaries)
- Editor outcome per segment (refined / no_change / fallback + reason)
- Refined boundaries vs original (delta in seconds per segment)
- Total render wall time delta vs v1.1 baseline (same idea seed re-rendered without Editor)
- Editor cost
- Editor wall time

**Artifact 2: side-by-side render package**

- 6 routine renders WITH Editor (uses production VPS path)
- Same 6 idea seeds re-rendered WITHOUT Editor (using v1.1 main HEAD locally or via env-flag bypass — agent's call)
- Operator reviews pairs, fills judgment table:

| Job | With-Editor better / same / worse than v1.1 | Reason |

Pass thresholds (Q8):

- 0/6 "noticeably worse"
- ≥4/6 "noticeably better"
- All 6 mechanical bar passes (completes through human_qa, bounds within original, wall delta < 30s)

If thresholds fail, halt and iterate before merge — do NOT merge a Gate A that fails the noticeably-worse=0 line.

---

## Mechanical bar enforcement

In addition to Gate A artifacts, the following must hold across all 6 renders:

- `editor_outcome.editor_invoked === true` for all 6 (routine path confirmed)
- `editor_outcome.segments_total >= 2` and `<= 5` (slot_count range honored)
- For every segment: `refined_start_s >= original_start_s` AND `refined_end_s <= original_end_s` (clamps held)
- For every segment: refined duration >= 1.5s
- Total Editor wall time per render: report median + max
- Total Editor cost per render: report median + max

---

## Cost & latency projection

| Stage | Cost | Wall time |
|---|---|---|
| Editor agent (Gemini Pro multimodal, image-only input) | ~$0.005-0.01 per segment | ~5-10s per call |
| Per render (routine, slot_count 2-5): N parallel calls | ~$0.01-0.05 | ~5-10s wall (parallel) |

Adds ~$0.01-0.05 + ~5-10s to routine render. Meme renders unchanged. Cost-irrelevant for v1 per operator decision in handoff doc.

---

## Hard constraints (do NOT violate)

- **Polish Sprint Pillar 1 branch (`cebfc46`)** — DO NOT touch.
- **Meme path** — do NOT add Editor invocation. Bypass entirely. Confirm via test render.
- **Match-Or-Match output** — do NOT modify. Editor reads its output, doesn't change it.
- **Pass A trim semantics** — do NOT change cache strategy or `-c copy` behavior. Only the trim arg values change (refined vs original).
- **No schema migration.** No new columns, no new tables. Observability via `job_events.payload`.
- **No n8n changes.** Editor is internal to the worker.
- **Per-segment isolation.** A failure on segment 2 must not affect segments 1, 3, 4, 5 — partial-fallback renders must complete successfully.
- **v2-only segments.** Editor reads `segment_v2` and `keyframe_grid_r2_key`; both must be non-null. If either is null on a picked segment, Editor falls back to original boundaries silently. (Should never happen given Match-Or-Match's v2-only filter, but defensive.)

---

## Out of scope (filed as future followups, NOT v1.2)

- Cross-segment flow awareness (Q2 (b) path) — `simple-pipeline-editor-cross-cut-flow-awareness`
- Editor-driven segment drop + re-pick (Q3 (b) path) — `simple-pipeline-editor-drop-and-repick`
- Editor for meme path (Q4 (b) path) — `simple-pipeline-editor-meme-path`
- Aggregate analytics table (separate from job_events.payload) — `simple-pipeline-editor-history-table`
- Multimodal video input (Q1 (b) or (c) paths) — `simple-pipeline-editor-video-input-modality` (only revisit if Gate A reveals image-only signal is insufficient)

---

## Workstream sequence

| Commit | Scope |
|---|---|
| c1 | `editor-agent-schema.ts` (Zod schema) + unit tests |
| c2 | `editor-agent.ts` (Gemini Pro call, retry, clamp, fallback) + standalone test script |
| c3 | `editor-agent.md` (prompt with anti-patterns + escape paths) + standalone test against 3-5 segments from production data |
| c4 | Orchestrator integration (insert step, format gate, parallel Promise.all, observability payload) |
| c5 | Render path adjustment (Pass A reads refined values, falls back to original) |
| c6 | Gate A — 6 routine renders + side-by-side baseline + diagnostic artifact |

c6 includes operator review window. Brief drafting estimate: c1-c5 ~1.5-2 days agent work, c6 ~0.5-1 day including operator review. Total ~3 days as projected.

---

## Definition of done

- All 6 c6 routine renders complete through human_qa
- Mechanical bar passes (clamps held, wall delta < 30s, cost per render reported)
- Visual bar passes (operator review: 0/6 noticeably worse, ≥4/6 noticeably better)
- Diagnostic artifact at `docs/diagnostics/editor-agent-gate-a.md` filed
- Side-by-side render pair URLs included in agent's end-of-c6 report
- Operator approves merge
- Domis merges per `GIT_WORKFLOW.md`
- Domis deploys to VPS
- `SIMPLE_PIPELINE.md` updated with Editor agent step in architecture flow + cost/latency table updated
- `PHASE_4_PART_B_PIPELINE.md` workstream sequence updated
- `followups.md` — `simple-pipeline-editor-agent-workstream` moved to Resolved; out-of-scope items above filed as new active followups

---

## Rollback

If post-merge production exercise reveals Editor regression:

- `git revert` of the merge commit on main restores v1.1 behavior.
- VPS redeploy from reverted main.
- Editor code remains on the feat branch for diagnosis; no schema changes to undo.
- Renders that had Editor invoked return to using original boundaries. No data corruption (refined boundaries weren't persisted; only used in Pass A trim).

Zero schema risk. Zero data risk. Worst case: 5-minute revert + redeploy.
