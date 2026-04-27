# Handoff to New Chat — Session 2026-04-24

**Read this first. Then read MVP_PROGRESS_17.md for the historical record. Then read the Project Context Primer if you don't already have it loaded — it tells you why the pipeline exists and what failure modes are load-bearing. Tactical specs come last.**

---

## What you're walking into

Video Factory is a pipeline that produces ~150-300 short-form videos per week across ~30 wellness/fitness brands, fully automated. Operators (humans) fill idea seeds in a Google Sheet; the pipeline does ingestion, segmentation, analysis, scripting, clip selection, copywriting, rendering, and platform-export delivery. Two Hetzner VPS servers (n8n orchestrator + worker engine) run the whole thing.

The bigger architectural arc this session continued: **Phase 3.5 is the production pipeline today (Creative Director → Asset Curator → Copywriter → render). Part B is the rebuild that exploits richer segment metadata + multimodal pick + post-select copy.** Part B's creative goal — *retention through pleasure, not persuasion; videos that feel organic, not like ads* — is the entire reason the rebuild exists.

**As of 2026-04-26: Part B is complete as runtime code, W9 + W9.1 deployed, awaiting Phase 1 calibration flip.** All five creative agents (Planner, Retrieval, Director, Critic, Copywriter) are shipped. The Orchestrator that wires them is shipped. Shadow-mode infrastructure (shadow_runs table, 3-tier feature flag composition, dual-run dispatch) is deployed. **W9's measurement surface (Q5d cutover-rule scaffold, shadow_review view, runbooks, n8n+Sheet integration spec) is deployed.** **W9.1 cost-tracking wireup is deployed** — `shadow_runs.part_b_cost_usd` now reflects real per-run cost; Q5d signal is 5-of-5. All 5 brands still on `pipeline_version='phase35'`; `PART_B_ROLLOUT_PERCENT=0`. Phase 3.5 still serves 100% of production.

**W9.1 has shipped — cost-tracking gap closed; Phase 1 calibration is no longer cost-blocked.** The next operator-track step is the Phase 1 calibration flip on nordpilates (`PART_B_ROLLOUT_PERCENT=100` for the first ~10 jobs, then drop to 30 for steady-state Phase 2). See "What's next" below.

---

## Pipeline status at a glance

| Stage | Phase 3.5 | Part A | Part B |
|---|---|---|---|
| Ingestion | ✅ Production v1 | ✅ V2 flag ON | — |
| Segment analysis | ✅ Production (v2) | ✅ Complete | — |
| Keyframe grids | — | — | ✅ W1 shipped |
| Content Sprint 2 | — | — | ✅ Complete (1116+ segments, 100% v2) |
| Creative Director | ✅ Production (Claude) | — | ✅ Replaced by Planner |
| Brand persona | ✅ Minimal | — | ✅ W2 shipped |
| Planner | — | — | ✅ W3 shipped + W6.5 tuned |
| Retrieval RPC | ✅ v1 match_segments | — | ✅ W4 shipped (v2) |
| Visual Director | — | — | ✅ W5 shipped |
| Coherence Critic | — | — | ✅ W6 shipped + W6.5 tuned + W8 lib-inv |
| Copywriter | ✅ Production (Claude) | — | ✅ W7 shipped |
| Orchestrator | ✅ Phase 3.5 worker | — | ✅ **W8 shipped 2026-04-24** |
| Shadow rollout | — | — | ✅ **W9 shipped 2026-04-26** |
| Audio generation | — | — | 🔴 W10 post-shadow |
| Remotion render | ✅ Production | — | (unchanged) |
| Platform export | ✅ Production | — | (unchanged) |

Legend: ✅ shipped · 🔴 not started · — not applicable

**Production state right now:** Phase 3.5 serves every job. All 5 brands have `brand_configs.pipeline_version = 'phase35'` (nordpilates was flipped to `part_b_shadow` for the W9 Q8c synthetic Tier 2 run on 2026-04-26 and immediately restored). `PART_B_ROLLOUT_PERCENT = 0` (or unset). `jobs.pipeline_override` is NULL on every steady-state row (one historical row carries `'force'` from the Q8c synthetic seed and is terminal). `shadow_runs` holds one row — `cb87d32c-53d2-49d1-aeb9-2e362091fbcb` — preserved as the Q8c calibration marker. Part B code is loaded into the worker process (memory baseline ~210MB idle post-W8 deploy; observed peak ~500-562MB during a sustained shadow run, returns to baseline post-run), but no job ever routes to it under steady state.

---

## What shipped this session

Two ships and one critical bugfix at the W7+W8 close (2026-04-24). Both W7 and W8 were full Part B workstreams; the bugfix was W8 commit 13 closing the `job_events` observability gap pre-merge. **W9 (operations + measurement surface, no new agent code paths) shipped 2026-04-26 in a follow-on session and is captured here for continuity.**

### W7 — Copywriter (shipped 2026-04-24, merged at SHA 73ad155)

Single Gemini text-only call producing per-slot overlay text + timing, hook, CTA (organic-content invariant — never hard-sell), platform captions (canonical + 3 platform-trimmed), hashtags. Pure function `writeCopyForStoryboard(picks, planner, persona, snapshots) → CopyPackage`. `voiceover_script: z.null()` reserved for W10.

**Key architectural commitments locked in W7 brief Q&A:**
- Single call (option a) with two-call fallback (option b) named but not preemptively built
- Pure function — no orchestrator coupling
- Reference Phase 3.5 Copywriter for output conventions (caption length, hashtag count, platform split); inherit shape, extend with Part B inputs
- Overlay type enum authored: `label | cue | stamp | caption | count | none` with per-type validation rules
- Captions: one canonical + three platform-trimmed, all in one Gemini call
- Hook mechanism → text mapping taught in prompt (no external registry)
- CTA pipeline-invariant: never hard-sell. NOT a per-brand `hard_sell_allowed` field. Decision driven by form_id + close-slot energy + narrative_beat.
- segment_v2 snapshot per pick: extends Critic's snapshot shape with `on_screen_text` (load-bearing for overlay-collision avoidance)
- Subject stance modulates voice + overlay density. `single-subject` ≠ first-person — nordpilates persona binds at brand level.

**8 commits on the W7 branch.** Two unplanned: commit 6 worked around Gemini rejecting `voiceover_script: z.null()` (constraint-density ceiling, W3 pattern second occurrence — schema strip + post-parse inject). Commit 9 was param-only tuning (maxOutputTokens 4000→8000, aggressive bounds strip beyond `stripSchemaBounds()`) that fixed the dominant JSON parse malformation pattern. **Final Gate A: 5/5 Tier 1 with zero parse retries.**

The slot-0 "homogenization FAIL" in the test harness was test-metric semantic, not Copywriter behavior — when `hook.delivery='overlay'`, slot-0 type=`'none'` is correct; the distinctness metric counted two `none`s as identical. Filed as followup, not a Gate A blocker.

### W8 — Orchestrator (shipped 2026-04-24, merged at SHA 89c886f)

The first runtime-changing merge of Part B. Wires W3 → W4 → W5 → [W6 ∥ W7] into a coordinated pipeline behind a 3-tier flag composition. Writes output to a new `shadow_runs` table; **never** touches `jobs.context_packet` (which Phase 3.5 owns). Fire-and-forget dispatch from BullMQ planning worker — Part B errors NEVER propagate to Phase 3.5's flow.

**12 commits on the W8 branch.** Two more added during Gate B (commit 13: the `job_events` column-mismatch fix; commit 14: post-fix verification re-smoke). Total 14 SHAs.

**Key architectural commitments locked in W8 brief Q&A:**
- `shadow_runs` table for all Part B output during shadow (Q1 option c). Migration 011.
- Critic-Copywriter parallel on expected-pass path (Q2 option a)
- Per-agent retries kept; W8 only coordinates inter-agent (Q3 option a)
- Revise-loop soft cap at 2; exhaustion → human escalation at brief_review (Q4 option b)
- **Critic gets library inventory injected** (Q5 option a — flipped from initial b during brief drafting). `revise_scope: 'slot_level' | 'structural'` is a signal-based decision, not a guess.
- Three-tier feature flag composition: brand-level eligibility + job-level allowlist + percentage rollout (Q6 option d)
- Dual-run during shadow's first ~20 nordpilates jobs (Q7 option a); switches to Part-B-only after signal stabilizes
- job_events: per-state-transition + per-retry-exhaustion (Q8 option c). Successful retries silent.
- W8 pre-builds segment snapshots once, passes to Critic + Copywriter (Q9 option b — small W7 refactor in W8 scope)
- Sequential spine + parallel tail: Planner → Retrieval → Director → [Critic ∥ Copywriter]
- Pre-enqueue render guard for `voiceover_script: null` (Q11)
- Three-tier Gate A: mocked state machine + real E2E + synthetic failure paths

**Migration 011 applied to remote Supabase before merge.** Adds `shadow_runs` table, `brand_configs.pipeline_version` column (CHECK constraint enum: 'phase35' | 'part_b_shadow' | 'part_b_primary'; default 'phase35'), `jobs.pipeline_override` column.

**W6 received an additive extension:** Critic's agent signature gained a `libraryInventory` parameter (same shape W3 Planner consumes). Critic prompt teaching expanded to use inventory data for distinguishing slot-level fixability from structural plan-mismatch. Cost impact ~$0.01-0.02/call.

**W7 received a refactor (no behavior change):** `buildSegmentSnapshots` extracted from W7's internal call to `src/lib/segment-snapshot.ts` shared lib. W7 + W6 now both consume pre-built snapshots passed in by W8. One Supabase round-trip per video instead of two.

### Gate A Tier 2 findings — what the smokes told us

Gate A passed at 28/28 cases (10 mocked + 15 synthetic + 3 real E2E). But the per-seed real-E2E results revealed signals worth understanding:

- **Seed A** (aesthetic-ambient, "slow sunday stretching"): expected happy-path; observed **revise budget exhausted ×2 → escalated to human**. State machine behaved correctly. Critic legitimately flagged real issues twice; Director's surgical re-picks couldn't resolve them.
- **Seed B** (routine-sequence, "morning pilates hip mobility"): expected revise-loop exercise; observed **same exhaustion pattern as A**. Director re-invocations on the flagged slots produced near-identical clips both times — slot-level revise didn't converge.
- **Seed C** (structural-revise canary, "bulgarian split squat deep dive"): designed to force `revise_scope: 'structural'` via library-inventory injection. **Did NOT trigger structural.** Critic approved on first fanout (sparse library wasn't sparse enough, or Planner didn't commit to deep-dive form). Copywriter then died on parse — separate W7-residual issue.

**What this means:** the W8 state machine, flag composition, render-prep guard, shadow-writer, and Critic library-inventory injection (as code) all work correctly. **What we don't have evidence for yet:** that the Q5(a) library-inventory-at-Critic actually changes Critic behavior. Seed C didn't reach the path. This is a W9 measurement gap, not a W8 bug, but it's load-bearing — if the library-inventory teaching doesn't move Critic's `revise_scope` distribution in shadow, we revisit.

The 2-of-3 revise-exhaustion rate also tells us nordpilates' early shadow will see heavy operator escalation. Followup `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` flags this; W9 measures whether budget=3 helps.

### Phase 3.5 verified unaffected post-W8 deploy

Submitted test job `cbd6d445-...` against nordpilates after W8 deploy. Phase 3.5 reached `brief_review` on schedule. Dispatcher correctly logged `Part B not routed for job ... — brand pipeline_version=phase35 — Part B disabled`. Zero `partb_*` events emitted (expected — no brand is flagged shadow). Test job cleaned up.

The fire-and-forget invariant held. Phase 3.5's job lifecycle is genuinely unaffected by Part B code being loaded.

### W9 — Shadow Rollout (shipped 2026-04-26, merged at SHA `005f9cb`)

The operational layer atop W8's dispatch infrastructure. Migration 012 (`shadow_review` view + 3 nullable creative_quality columns on `shadow_runs`) + `src/lib/cutover-status.ts` (Q5d 5-signal composite cutover rule) + three runbooks (`W9_SHADOW_OPERATIONS.md`, `W9_BRAND_EXPANSION_CRITERIA.md`, `W9_N8N_SHEET_INTEGRATION_SPEC.md`) + two Gate A verification scripts. **No new agent code paths and no Phase 3.5 modifications** — operator-facing measurement surface plus Q5d cutover-rule scaffold.

**Key architectural commitments locked in W9 brief Q&A:**
- Q1b pre-flip Tier 1 dispatch verification — synthetic Phase 3.5 job through the live BullMQ planning worker against a `pipeline_version=phase35` brand, four invariants asserted (reaches `brief_review`, no `partb_*` contamination, `shadow_runs` count unchanged, brand still phase35).
- Q3a Sheet-native operator review surface — Sheet column extensions + two n8n workflows (read every 5 min; write event-driven). Implementation track is operator/n8n; spec at `docs/runbooks/W9_N8N_SHEET_INTEGRATION_SPEC.md`.
- Q5d composite cutover rule — five signals over ≥30 verdicts, with a creative-quality veto. Implemented in `src/lib/cutover-status.ts` reading from the `shadow_review` view.
- Q8c forced-structural synthetic seed — `pipeline_override='force'` + sparse-library exercise seed exercises the structural-revise path independent of natural-seed Planner commitments.
- Q11b brand-expansion criteria locked at `docs/runbooks/W9_BRAND_EXPANSION_CRITERIA.md` — eligibility for the second-brand flip is post-evidence, not pre-committed.
- W9 deliberately ships **NO Critic prompt tuning** and **NO cost-tracking fix**. Tier 2's structural-classification observation and the cost-tracking gap are filed as followups, not addressed in-branch.

**11 commits on the W9 branch.** No Gate B fixes were needed; merged on first try after Gate A Tier 2.

**Migration 012 applied to remote Supabase before merge.** Adds `shadow_review` view (joins shadow_runs + jobs + brand_configs) + three nullable columns on shadow_runs (`creative_quality_feels_organic` BOOLEAN, `creative_quality_tags` TEXT[] with CHECK subset constraint, `creative_quality_notes` TEXT). Used by `cutover-status.ts` and the planned n8n write workflow.

**Gate A Tier 1 — pre-flip dispatch verification.** Synthetic Phase 3.5 job through live BullMQ worker against nordpilates (still on phase35). 4/4 invariants PASS. Dispatcher logged the expected "Part B not routed" line. Evidence at `docs/smoke-runs/w9-pre-flip-verification-20260424.txt`. Cost ~$0. JobId `e9b3475e-079c-463b-af84-e6e498172ae0` cleaned up.

**Gate A Tier 2 — forced-structural synthetic seed.** Flipped nordpilates to `part_b_shadow`, ran the Q8c "fire hydrant deep dive" seed with `pipeline_override='force'`, restored nordpilates to `phase35` immediately post-run. Result: 26 `partb_*` events, Planner committed `form_id='single_exercise_deep_dive'`, 2 `partb_revise_slots` cycles, terminal_state=`failed_after_revise_budget`. Critic verdict text identified the structural-shaped problem on slot 3 ("single-subject deep dive, but Slot 3 switches to a different parent asset and outfit") but classified as `revise_scope='slot_level'`. Zero `partb_revise_structural` events. shadow_runs row `cb87d32c-53d2-49d1-aeb9-2e362091fbcb` preserved as the Q8c calibration marker (intentionally not cleaned up). Evidence at `docs/smoke-runs/w9-forced-structural-20260424.txt`.

**Two load-bearing followups surfaced at Gate A Tier 2:**
- `w9-q8c-structural-classification-not-exercised` — Critic emitted `slot_level` on a structurally-shaped seed; Q5d signal quality depends on the `revise_scope` distribution being meaningful. Revisit during shadow ramp; likely Critic prompt tuning.
- `w9-cost-tracking-unwired` — `shadow_runs.cost_usd=$0` across all rows despite 11 agent invocations on the Q8c seed. Q5d cutover rule effectively 4-of-5 until fixed. **Phase 1 calibration can run with this gap; Phase 2 ramp cannot.**

---

## What's next — Phase 1 calibration flip on operator signal

W9 + W9.1 are shipped. Cost-tracking gap closed (Q5d cost signal alive at $0.0114 / $0.1566 / $0.0123 / $0.0152 per-agent baseline on a Tier 2 orchestrator seed; cumulative `part_b_cost_usd=$0.5635` on shadow_runs row `ff67fc55-1fc1-472f-8ef6-aec36e87a9c1`). The path forward, in priority order:

1. **Phase 1 calibration flip on nordpilates** (operator signal). Set `brand_configs.pipeline_version='part_b_shadow'` for nordpilates and `PART_B_ROLLOUT_PERCENT=100` (calibration window — first ~10 jobs only), restart `video-factory` service. Observe signal stability across all five Q5d signals. After ~10 jobs, drop `PART_B_ROLLOUT_PERCENT=30` for Phase 2 steady-state. Operator runbook at `docs/runbooks/W9_SHADOW_OPERATIONS.md` is authoritative for the ramp protocol and pause/rollback triggers.
2. **(Independent / parallel)** Operator implements n8n Workflow A+B and the Sheet column extensions per `docs/runbooks/W9_N8N_SHEET_INTEGRATION_SPEC.md`. Sheet review is convenient but not strictly gating — operators can hand-query `shadow_review` view directly during early calibration. This track does NOT block the Phase 1 flip.

After Phase 1 calibration (~10 jobs at 100%, signal stability assessed), the brand-expansion criteria at `docs/runbooks/W9_BRAND_EXPANSION_CRITERIA.md` decide the second brand to flip. That decision is post-evidence, not pre-committed — five-brand portfolio (carnimeat, highdiet, ketoway, nodiet, nordpilates) yields four candidates after nordpilates cutover; eligibility is library size, persona/form coverage, production volume, persona-prose readiness.

**Decisions deferred to follow-on briefs (do NOT pre-commit in W9 scope):**

- When to flip dual-run mode off (Q7 said "after signal stabilizes" — concrete threshold pending Phase 1 evidence).
- W10 voice-generation sequencing relative to shadow's progress.
- Whether revise budget should widen from 2 to 3 (W8 followup `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` measures this in shadow).

---

## Active rules from CLAUDE.md (full list at session close)

42 rules. Rule 42 was the only addition this session (single-gate tuning protocol; W6.5 was the precedent). I considered proposing Rule 43 ("push feature branches to origin continuously during work, not just at task end") after W8's local-only branch incident, but didn't push for it — GIT_WORKFLOW already states this; the session lesson is that the agent missed it once, not that the convention is unclear.

Rules that bound this session's decisions most:

- **Rule 34** — Never mix Gemini SDKs. New code uses `@google/genai`. Honored throughout W7 and W8.
- **Rule 36** — Additive only. Honored: no Phase 3.5 modification, W6 extension was schema-additive + signature-additive, W7 refactor was parameter-shape only.
- **Rule 38** — Validation throws loud, never silent-corrects. Honored: 7 distinct W7 semantic validation error classes; W8 state-machine guard errors throw with named errors; the post-Gate-A `emitEvent` fix removed a try/catch precisely because Rule 38 says event emission failures should be loud during shadow.
- **Rule 40** — Creative variance lives upstream in persona + prompts, not in segment taxonomy. Honored: W7 didn't add a `hard_sell_allowed` field; organic-content is pipeline-invariant.
- **Rule 41** — Form × posture orthogonality. Honored: W7's `stamp` overlay type validates against posture P4/P5; the axis is read, not modified.
- **Rule 42** — Single-gate tuning protocol. Did NOT apply to W7 or W8. Both were full workstreams with new code paths; both used two-gate (Gate A smoke + Gate B merge approval).

---

## Open followups at session close

`docs/followups.md` has 15 active entries (14 from W7+W8 minus 2 resolved by W9, plus 3 new W9 entries). Ranked by relevance to the upcoming Phase 1 calibration:

**Load-bearing for Phase 1 calibration (top of mind):**

1. **`w9-cost-tracking-unwired`** — `shadow_runs.cost_usd=$0` across all rows. Q5d cutover rule effectively 4-of-5 until fixed. Phase 1 can run degraded; Phase 2 ramp cannot. Likely Rule 42 single-gate eligible.
2. **`w9-q8c-structural-classification-not-exercised`** — Critic emitted `slot_level` on a structurally-shaped synthetic seed; supersedes the resolved `w8-q5-signal-validation-not-exercised-in-gate-a` followup. Q5d signal quality depends on the `revise_scope` distribution being meaningful.
3. **`w8-nordpilates-revise-exhaustion-rate-tier-2-baseline`** — 2 of 3 Gate A seeds exhausted. Shadow rate measurement is the calibration signal for whether budget=3 is needed.
4. **`w8-slot-level-revise-thrashing-without-convergence`** — Director re-picks identical candidates. Is Critic mis-classifying as slot-level? Is retrieval pool too sparse? Phase 1 measurement disambiguates.
5. **`w7-slot0-homogenization-metric-treats-none-as-collision`** — test-harness metric tuning; resolve when shadow has real slot-0-non-null cases.
6. **`gemini-3.1-pro-preview-stability-with-rich-response-schemas`** — cross-agent (W5 + W7 + possibly W8). Phase 1 measures parse-exhaustion rate per agent.

**Carried from prior sessions, may surface in Phase 1 shadow:**

7. **`w6-subject-discontinuity-prevalence-at-director`** — partially resolved by W6.5; full validation at Phase 1 shadow.
8. **`w5-subject-role-all-primary-in-planner`** — Planner emits primary on ~100% of slots; observe in shadow whether mixed videos feel monotonous.
9. **`w5-duplicate-segment-across-slots-in-director`** — addressed by W6 issue type; revisit only if W6 misses it.

**Lower priority / informational:**

10. **`w7-parse-retry-headroom-in-production`** — 3-attempt ceiling held with headroom at Gate A; widen if shadow exhausts.
11. **`w7-stripAggressiveBounds-kept-distinct-from-stripSchemaBounds`** — design documentation; future agent extending stripAggressive path list rather than widening global strip.
12. **`w8-copywriter-parse-fragility-seed-c`** — observed once at W8 Gate A; linked to gemini stability followup.
13. **`w8-job-events-to-status-varchar-30-ceiling`** — cosmetic; migration 013+ if W10+ overflows again (W9's migration 012 is unrelated, adds shadow_review view).
14. **`w9-verify-worker-dispatch-baseline-stale`** — `verify-worker-dispatch.ts` header comment quotes pre-W8 ~210MB baseline; current idle is ~210MB but observed peak during a sustained shadow run was ~500-562MB. Cosmetic, sweep-during-next-touch.

**Inactive backlog:**

14. Various Part A spot-check, Part B test-segment UUID drift, raw-fallback crop, naive singularization — all deferred, unlikely to surface in W9.

---

## Operator (Domis) — how he works, refresher

Lithuanian, Vilnius. Stack-fluent (n8n, Supabase, Sheets, Hetzner, AI pipelines). Direct communicator — spelling can be loose, parse for intent, don't correct.

**Rewards:**
- Decisive moves. Strategic pushback over tactical defense.
- Architectural reframing when the surface problem isn't the real one.
- Plain language when jargon stacks.
- Agents handling git autonomously.

**Frustrations:**
- Re-litigating decisions in docs.
- Hedging language.
- Tactical dismissal of strategic concerns.
- Things that should work but don't.

**Tells observed this session:**
- *"seems alright, continue"* = full approval, ship it.
- *"it will be in /docs/briefs"* = he's already filed; don't re-ask where to put it.
- *"hold on merge"* / *"merge to main and deploy"* = the literal instruction; do it.
- One-line answers to multi-question Q&A = trust earned, decisions made, proceed.
- *"maybe we should have chosen X then?"* = strategic pushback, not a tactical objection. Reframe and re-evaluate; don't defend.

The Q5 flip from (b) to (a) on W8 was a textbook example. Domis surfaced "calibration concern" as a strategic doubt; the planning chat reframed (laid out the false-slot_level thrashing failure mode), recommended the flip, and Domis confirmed. That's the working pattern. Repeat it.

**Cost stance from this session:** *"$1 per video acceptable, even higher if necessary."* Removes pressure to micro-optimize. Multimodal Director is the cost driver; accept it as the price of organic-creator quality.

---

## Tactical state for tools the next chat will use

### Branches at session close

`main` only. All feature branches merged + deleted.

```
main: <post-w9-merge docs commit — see latest git log>
        ↑
        005f9cb merge feat/phase4-w9-shadow-rollout (2026-04-26)
        ↑
        2548a81 docs: post-w8-merge status + 6 followups
        ↑
        89c886f merge feat/phase4-w8-orchestrator
        ↑
        79c6f3b docs: post-w7-merge status + 4 followups
        ↑
        73ad155 merge feat/phase4-w7-copywriter
        ↑
        ... earlier session-close commits ...
```

11+ unmerged origin branches still sitting (hygiene cleanup deferred). Stash count on VPS likely up to 7-8 (W7 + W8 lockfile drift). Anti-pattern #10 (no `git add -A`) honored throughout.

### Database state

Supabase migrations 011 + 012 applied. All 5 brands on `pipeline_version='phase35'`. **One row in `shadow_runs`** — `cb87d32c-53d2-49d1-aeb9-2e362091fbcb`, the W9 Q8c calibration marker (intentionally preserved). **One job in `jobs` with `pipeline_override='force'`** — the W9 Q8c synthetic seed, terminal. Other jobs have `pipeline_override=NULL`.

W3 library inventory shows 1116+ segments on nordpilates with v2 coverage near-100%. Sprint 2 confirmed complete by operator.

### VPS state

Service restarted on W8 deploy (2026-04-24 13:00:50 UTC) and again on W9 deploy (2026-04-26). Memory baseline ~210MB idle post-W8. Observed peak ~500-562MB during the W9 Q8c sustained shadow run (returns to baseline post-run). 4 queues running: ingestion, planning, rendering, export. API on :3000.

### Files added/modified this session

W7 created: `src/types/copywriter-output.ts`, `src/agents/copywriter-v2.ts`, `src/agents/prompts/copywriter-v2.md`, `src/scripts/test-copywriter.ts`, `docs/smoke-runs/w7-phase35-reference-notes.md`, plus 3 Gate A artifacts.

W8 created: `src/orchestrator/orchestrator-v2.ts`, `state-machine.ts`, `feature-flags.ts`, `shadow-writer.ts`, `revise-loop.ts`, `render-prep.ts`, `src/types/orchestrator-state.ts`, `src/lib/segment-snapshot.ts`, `supabase/migrations/011_shadow_runs.sql`, `src/scripts/test-orchestrator.ts`, plus pre-work + Gate A artifacts.

W6 modified additively: `src/types/critic-verdict.ts`, `src/agents/critic-v2.ts`, `src/agents/prompts/critic-v2.md`, `src/scripts/test-critic.ts` (if existed).

W7 refactored: `src/agents/copywriter-v2.ts` (now consumes pre-built snapshots), `src/scripts/test-copywriter.ts` (snapshot setup external).

`src/index.ts` modified: added fire-and-forget Part B dispatch alongside Phase 3.5 planning.

W9 created (2026-04-26): `src/scripts/migrations/012_shadow_review_view.sql`, `src/lib/cutover-status.ts`, `docs/runbooks/W9_SHADOW_OPERATIONS.md`, `docs/runbooks/W9_BRAND_EXPANSION_CRITERIA.md`, `docs/runbooks/W9_N8N_SHEET_INTEGRATION_SPEC.md`, `src/scripts/verify-worker-dispatch.ts`, `src/scripts/test-forced-structural.ts`, plus 2 Gate A artifacts in `docs/smoke-runs/`.

Phase 3.5 code: untouched. Rule 36 honored throughout.

### Cost tracking — actual session spend

Rough estimate from agent reports:
- W7 Gate A (3 smoke runs incl. iterations): ~$2-3 across all attempts
- W8 Gate A (T1+T3 mocked = $0; T2 real E2E = ~$1.0; post-fix re-smoke = ~$0.40): ~$1.5
- Session total: ~$4 in Gemini usage

Production projection unchanged: ~$0.55-0.75/video happy-path Part B; up to ~$1.50/video worst-case with revise loops; absorbable within operator's $1/video target with revise-budget calibration in W9.

---

## What you should NOT do on day 1

- Re-derive architectural decisions from this session. Trust the record. The 24 questions across W7 + W8 brief Q&A are answered; their answers are in the briefs at `docs/briefs/W7_COPYWRITER_BRIEF.md` and `docs/briefs/W8_ORCHESTRATOR_BRIEF.md`. Don't re-ask.
- Suggest rewriting any W2-W8 code. All shipped + validated.
- Skip Part B's organic-content invariant in any W9 measurement framework. "Retention through pleasure, not persuasion" is the success criterion.
- Treat W9 like W8. Different mental mode — operations + measurement, not architecture.
- Assume nordpilates is the only brand worth designing for. W9's decision framework should generalize to the eventual 30 brands; nordpilates is just the canary.
- Skip the plain-language check. If Domis asks you to explain something simpler, reset framing entirely.

## What you SHOULD do on day 1

- Read this doc, then `docs/MVP_PROGRESS_17.md`, then the Project Context Primer if loaded, then whatever's most relevant.
- Verify state matches expectations before moving: query brand_configs (all phase35?), shadow_runs (empty?), jobs.pipeline_override (all NULL?), main branch SHA matches `2548a81`.
- For W9 kickoff, expect ~10-12 questions covering: ramp cadence, operator review workflow, dual-run threshold, signal calibration for cutover, pause/rollback triggers, W10 sequencing.
- Follow the W7 + W8 brief structure as a template — it works, Domis has internalized it, no reason to deviate.
- If Domis pushes back strategically on a decision, treat it as a design signal, not a tactical objection. Reframe.

---

*Session-close handoff authored 2026-04-24 evening. Two ships (W7, W8) + one critical Gate B fix + Phase 3.5 unaffected verification. Part B now exists end-to-end as runtime code, dormant pending W9 shadow rollout. Next brief is operational, not architectural.*
