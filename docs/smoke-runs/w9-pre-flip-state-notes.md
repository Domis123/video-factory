# W9 — Pre-flip state notes

**Captured:** 2026-04-26 (W9 commit 1, on branch `feat/phase4-w9-shadow-rollout`)
**Branch base:** main @ `e4d6e8d` (docs: session-close refresh 2026-04-24)
**Pre-work scope:** brief §"Gate A pre-work" steps 1-7.

This document is the artifact for W9 commit 1. It records the state of W8 residue, Phase-3.5-dispatch sanity, and the synthetic-seed candidate shortlist that the Q8c forced-structural test will draw from. Captured BEFORE writing any new W9 code so the post-merge ramp has a measurable baseline.

---

## 1. shadow_runs cleanup

### Pre-cleanup snapshot

`shadow_runs` had **1 row** before cleanup (matching brief expectation):

```
row=37323ece job=745c626e created=2026-04-24T12:23:45.796482+00:00
  terminal=failed_after_revise_budget
  reason=revise budget exhausted after 2 cycles; final verdict:
    The storyboard suffers from a complete breakdown in subject
    continuity. Despite the planner requesting a single-subject
    sequence, every primary slot uses a different parent asset...
  revises=2  invocations=11  walltime=378500ms  cost=$0
  operator_verdict=null
```

Provenance verdict: **Tier 2 W8 Gate A smoke artifact.** Matches brief criterion "terminal_state in `{failed_after_revise_budget, failed_agent_error}`" → safe to delete. Cost is `$0` because Gemini API is on company credits per CLAUDE.md.

### Surprise: orphan partb_* events without a shadow_runs row

The Phase 3.5-dispatch sanity query (step 2) surfaced **32 partb_* events across 2 jobs** since 2026-04-24, but only one of those jobs had a shadow_runs row. Investigation:

| Job | Brand | Status | Override | partb_* events | shadow_runs | Created |
|---|---|---|---|---|---|---|
| `745c626e` | nordpilates | planning | null | 26 | 37323ece | 2026-04-24 12:17:27 |
| `71e9c99b` | nordpilates | planning | null | 6 | none | 2026-04-24 12:13:08 |

Both jobs:
- Same brand: nordpilates
- Same idea_seed: `"slow sunday stretching with the windows open"`
- Both within the same 5-minute window on 2026-04-24
- Both stuck at `status=planning`, never advanced
- Both have zero non-partb_* events (no Phase 3.5 lifecycle events)

Conclusion: both are W8 Tier 2 Gate A smoke artifacts created when nordpilates was temporarily flipped to `part_b_shadow` (or `pipeline_override='force'` was set, then reset). 745c626e completed its Part B run end-to-end and wrote a shadow_runs row at terminal state; 71e9c99b advanced to DIRECTING completed (12:14:57) but never reached SNAPSHOT_BUILDING — the run was killed mid-flight and `shadow_writer` never got to flush a row. Both `pipeline_override` columns now read null because Tier 2 set+unset the override during the smoke window.

This is **not Part B leaking onto production traffic.** No brand is currently flagged shadow, no job currently has an override set, and no operator-driven post-W8 production job has emitted a single partb_* event (verified in prior session via the cbd6d445 Phase 3.5 verification job, which had only `state_transition` events).

### Cleanup applied

Deleted both jobs via `src/scripts/w9-prework-cleanup.ts --apply` (untracked one-shot helper). The migration 011 FK `shadow_runs.job_id REFERENCES jobs(id) ON DELETE CASCADE` carried the `shadow_runs` row away with the parent job; `job_events.job_id` cascaded equivalently.

Post-cleanup verification:

```
shadow_runs total rows: 0
partb_* job_events since 2026-04-24: 0
✓ baseline clean: zero shadow_runs, zero partb_* events.
```

This zero-baseline is what `verify-worker-dispatch.ts` will reset to after each test run. Any future partb_* event in `job_events` after this point is either (a) the new W9 synthetic Tier 2 seed (Q8c) or (b) a real ramp event after the post-merge nordpilates flip.

---

## 2. Phase 3.5 dispatch unaffected — verified

### Brand pipeline_version snapshot

```
carnimeat:    phase35
highdiet:     phase35
ketoway:      phase35
nodiet:       phase35
nordpilates:  phase35
```

All 5 brands at the safe default. Nothing routes Part B at Tier 1.

### Per-job override scan

```
jobs with non-null pipeline_override: 0
```

Nothing routes Part B at Tier 2.

### partb_* contamination since 2026-04-24

After cleanup: **zero rows.** The dispatcher in `src/index.ts` is correctly returning early with `Part B not routed for job X — brand pipeline_version=phase35 — Part B disabled` per `feature-flags.ts` Tier 1 hard gate.

This closes followup `w8-phase-3-5-unaffected-check-via-worker-harness` at the read-state level. Tier 1 of Gate A (`verify-worker-dispatch.ts`) closes it at the runtime level by submitting a live job and re-asserting these zeros.

---

## 3. W8 code path review (brief steps 3-5)

### feature-flags.ts (`src/orchestrator/feature-flags.ts`, 293 lines)

Three-tier composition is settled. Pure decider `decidePipelineRouting()` returns `PipelineFlags` with `runPhase35`, `runPartB`, `isDualRun`, `reason`. Pure rollout-bucket `shouldRunPartBByPercentage(jobId, pct)` uses FNV-1a 32-bit hash mod 100 — deterministic per jobId, idempotent across retries.

Key invariants relevant to W9:
- `pipelineVersion === 'phase35'` → ALWAYS `runPhase35: true, runPartB: false` regardless of override or rollout pct. This is the brand-level hard gate W9 ramp will flip away from.
- `pipelineVersion === 'part_b_shadow'` + override `'force'` or `'part_b'` → `isDualRun: true`. This is the path the synthetic seed will take.
- `pipelineVersion === 'part_b_shadow'` + override null + rollout pct → percent decides. Forms the basis of W9 calibration / steady-state phases.
- `pipelineVersion === 'part_b_primary'` → `runPhase35: false`. W9 cutover terminal state. Still unreachable until operator explicitly flips.

Any unknown override value normalizes to null. Any unknown pipeline_version normalizes to phase35 (defensive against DB drift). Both are documented in code comments referencing migration 011.

### state-machine.ts (`src/orchestrator/state-machine.ts`, 449 lines)

Pure transition logic. Relevant to the synthetic seed design:

- `verdict.revise_scope === 'slot_level'` → REVISING_SLOTS → DIRECTING (re-pick on flagged slots).
- `verdict.revise_scope === 'structural'` → REPLANNING → PLANNING (full re-plan).
- Either branch decrements `ctx.budget.reviseLoopRemaining` orchestrator-side before the next call.
- Budget exhausted on a `revise` verdict → terminal `ESCALATING_TO_HUMAN` with terminalState `failed_after_revise_budget` and event `revise_budget_exhausted`.

The synthetic seed Q8c targets a structural emission. If Critic emits `slot_level` instead, the run still validates (per brief: behavior observed is the gate, not which scope fires).

### src/index.ts dispatch site

```ts
const planningWorker = createWorker(
  QUEUE_NAMES.planning,
  async (job: BullJob<{ jobId: string }>) => {
    const { jobId } = job.data;
    await runPlanning(jobId);          // Phase 3.5 — must complete first
    dispatchPartBIfEnabled(jobId);     // Fire-and-forget
  },
  { concurrency: 1 },
);
```

`dispatchPartBIfEnabled` reads brand_id from the jobs row, calls `computePipelineFlags(brandId, jobId)`, returns early if `!flags.runPartB`. Otherwise fire-and-forgets `runPipelineV2(jobId)` with both an inner `.catch` on the promise chain AND an outer `.catch` on the IIFE. Two layers of guard. Phase 3.5's BullMQ job lifecycle is therefore fully decoupled from Part B's outcome.

This is the dispatch path `verify-worker-dispatch.ts` will exercise: submit a Phase 3.5 job to a `phase35`-flagged brand, watch for the "Part B not routed" log line, assert no partb_* events emit, assert no shadow_runs row writes, assert memory baseline within ±50MB of ~210MB post-W8 deploy.

### Critic prompt revise_scope teaching (`src/agents/prompts/coherence-critic.md`, 162 lines)

Lines 46-54 teach the field; line 100-110 inject `library_inventory_json` and an explicit example:

> Example: if the Planner committed to `form_id: single_exercise_deep_dive` for "side lying leg lift" and the library shows 24 segments of that exercise, the form is well-supported. If the Planner committed to the same form for an exercise with only 1-2 library segments, the plan is structurally underspecified — even perfect picks can't deliver the form's promise.

The W8 brief flagged that this teaching was not exercised in W8 Gate A — the structural-emission path was tested in mocked state-machine cases but not with a real Critic seeing real library shortage. Q8c is the active validation that closes followup `w8-q5-signal-validation-not-exercised-in-gate-a`.

---

## 4. Synthetic-seed candidate shortlist (brief step 6)

`asset_segments.exercise_name` does not exist as a column. Exercise names live in `segment_v2.exercise.name` (JSONB sidecar per CLAUDE.md Rule 36). Coverage: **587/591 exercise-typed nordpilates segments have `segment_v2.exercise.name` populated** (99.3%).

Distribution across nordpilates segment types (1173 total):

```
exercise:      591   (50.4%)
transition:    147   (12.5%)
setup:         136   (11.6%)
b-roll:        131   (11.2%)
hold:          116   ( 9.9%)
cooldown:       33   ( 2.8%)
unusable:       11   ( 0.9%)
talking-head:    8   ( 0.7%)   ← bottleneck flagged in CLAUDE.md
```

268 unique exercise-name values (post-Gemini-extraction; pre-normalization). The same exercise often appears under hyphenated and spaced variants (e.g., `donkey kicks` (25) vs `donkey-kicks` (8); `wall-squats` (1) vs `wall squats` (1)). Library inventory's tag-filter pipeline likely collapses these in production; for the W9 synthetic seed we want a name distinctive enough that Planner commits to single-exercise-deep-dive but only 1 — at most 2 — segments back the form.

### Primary candidate: `fire hydrant`

- Library count: **1 segment**
- Why: well-known Pilates / barre exercise, naturally invokes `single_exercise_deep_dive` framing in an idea-seed sentence, no synonym noise (no "fire-hydrant" hyphen variant in the listing — confirmed only one normalization).
- Idea-seed text the W9 test script will use: *"30-second fire hydrant deep dive — show progression from beginner setup to glute burn"* (or similar; final wording in `test-forced-structural.ts`).

### Backup candidates

If `fire hydrant` for any reason yields a Planner verdict that doesn't commit to single-exercise-deep-dive (e.g., Planner picks a routine_sequence form), the test script falls through to:

| Backup | Library count | Notes |
|---|---|---|
| `supine double leg lifts` | 1 | distinctive, supine framing rules out posing variants |
| `single-leg modified push-up` | 1 | hyphenated form; if it hits, also confirms hyphen-tolerance |
| `kneeling lean backs` | 1 | unusual enough that Planner won't easily widen to a routine |
| `straddle-crunch` | 1 | very specific posture — unlikely to be generic-substituted |

The test should not silently retry through all five — the brief is explicit that one inconclusive run is still a valid Gate A outcome ("evidence not conclusion"). The script will pick `fire hydrant` first, document the Planner's actual form_id commitment, and only escalate to a backup seed on a clear "Planner refused the deep-dive form" outcome — annotated in the artifact.

### What the test will NOT do

- Pre-bias the Planner with explicit form_id mention. The seed is plain English; the prompt shape (one exercise, deep treatment) is what should pull Planner toward single_exercise_deep_dive.
- Force a particular Critic verdict shape. The test asserts the code path was reached, not the specific verdict text.
- Run more than once per W9 Gate A. Cost ~$1-2 / run; budget is $1-2 + 50% headroom = $3 cap (per brief Success criterion 7).

---

## 5. State inconsistencies / deltas worth flagging

1. **shadow_runs.cost stored as $0 for the W8 Tier 2 row** despite 11 invocations. This is correct because Gemini is on company credits per CLAUDE.md ("DO NOT factor Gemini costs into per-video or per-month totals") — the cost field measures Claude Sonnet usage and W8 Tier 2 likely ran agents that landed entirely on Gemini. After cleanup the data point is gone; future shadow_runs rows during nordpilates ramp will have small but nonzero costs reflecting Sonnet on Critic + Copywriter calls.

2. **Two W8 Tier 2 jobs shared idea_seed** — confirms both were operator-authored smoke seeds, not n8n-generated production traffic. Reinforces the "smoke residue" verdict.

3. **Job 71e9c99b's incomplete Part B run** is a useful reminder that `shadow_writer` is end-of-pipeline only — a process death mid-fanout leaves orphan partb_* events in `job_events` without a corresponding shadow_runs row. The W9 cost-aggregate helper and operator runbook should account for this asymmetry: counting "Part B runs" by `shadow_runs.id` undercounts crashes; counting via `job_events.event_type='partb_planning_started'` overcounts unfinished runs. The runbook should specify the distinction.

4. **`asset_segments.exercise_name` column does not exist.** It's `segment_v2.exercise.name` (JSONB). Anything in W9 reading exercise-name data should JSON-extract from segment_v2 — not project a column that isn't there. Same applies to operator-side SQL queries.

5. **Migrations 009 and 010 still missing from `docs/SUPABASE_SCHEMA.md` migrations table** (flagged at session close 2026-04-24; confirmed still missing). Out of W9 scope, but Migration 012 SQL file and SUPABASE_SCHEMA Migration 012 entry should follow whatever convention is in place — and it's worth a single-line followup if 012 is added cleanly while 009/010 remain stubs.

---

## 6. Pre-work artifacts (untracked locally)

Three throwaway scripts ran during this commit's investigation:

- `src/scripts/w9-prework-probe.ts` — initial state survey (shadow_runs, contamination check, brand snapshot).
- `src/scripts/w9-prework-probe2.ts` — schema discovery + 71e9c99b orphan investigation + exercise-name extraction.
- `src/scripts/w9-prework-cleanup.ts` — dry-run + apply cleanup of W8 Tier 2 smoke residue. Generic enough to re-run (`--apply` flag gated) on Tier 2 W9 synthetic-seed residue post-Gate-A if desired.

These scripts are NOT committed in W9 — they're one-shot exploration. Their outputs are captured in this notes doc. The cleanup script may be re-used after the Tier 2 forced-structural test (commit 11) to wipe its synthetic seed before merge; if so, it'll be invoked locally without committing.

---

## 7. Pre-flight checklist for downstream W9 commits

- [x] Branch created from clean main (`feat/phase4-w9-shadow-rollout`)
- [x] shadow_runs baseline at 0 rows
- [x] partb_* job_events baseline at 0 rows since 2026-04-24
- [x] All 5 brands at `pipeline_version=phase35`
- [x] No jobs with non-null `pipeline_override`
- [x] Synthetic-seed candidate confirmed (`fire hydrant`, 1 library segment)
- [x] W8 dispatch path read; verify script can mirror it
- [x] Critic structural-vs-slot-level teaching read; synthetic seed targets the documented signal
- [ ] Migration 012 (additive) — commit 2
- [ ] cutover-status helper — commit 3
- [ ] cost-aggregate helper — commit 4
- [ ] verify-worker-dispatch script — commit 5
- [ ] test-forced-structural script — commit 6
- [ ] Three runbooks — commits 7-9
- [ ] Tier 1 Gate A artifact — commit 10
- [ ] Tier 2 Gate A artifact — commit 11

Closes brief steps 1-7 of pre-work.
