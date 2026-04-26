# Handoff to New Chat — Session 2026-04-24

**Read this first. Then read MVP_PROGRESS_17.md for the historical record. Then read the Project Context Primer if you don't already have it loaded — it tells you why the pipeline exists and what failure modes are load-bearing. Tactical specs come last.**

---

## What you're walking into

Video Factory is a pipeline that produces ~150-300 short-form videos per week across ~30 wellness/fitness brands, fully automated. Operators (humans) fill idea seeds in a Google Sheet; the pipeline does ingestion, segmentation, analysis, scripting, clip selection, copywriting, rendering, and platform-export delivery. Two Hetzner VPS servers (n8n orchestrator + worker engine) run the whole thing.

The bigger architectural arc this session continued: **Phase 3.5 is the production pipeline today (Creative Director → Asset Curator → Copywriter → render). Part B is the rebuild that exploits richer segment metadata + multimodal pick + post-select copy.** Part B's creative goal — *retention through pleasure, not persuasion; videos that feel organic, not like ads* — is the entire reason the rebuild exists.

**As of this session close: Part B is complete as runtime code, end-to-end, deployed and dormant.** All five creative agents (Planner, Retrieval, Director, Critic, Copywriter) are shipped. The Orchestrator that wires them is shipped. Shadow-mode infrastructure (shadow_runs table, 3-tier feature flag composition, dual-run dispatch) is deployed. **Zero brands are flipped to shadow mode yet.** Phase 3.5 still serves 100% of production, exactly as it has all session.

The next brief is **W9 Shadow Rollout** — the workstream that operates the flags W8 built, ramps Part B from 0% to 100% on nordpilates first, then expands.

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
| Shadow rollout | — | — | 🔴 **W9 NEXT BRIEF** |
| Audio generation | — | — | 🔴 W10 post-shadow |
| Remotion render | ✅ Production | — | (unchanged) |
| Platform export | ✅ Production | — | (unchanged) |

Legend: ✅ shipped · 🔴 not started · — not applicable

**Production state right now:** Phase 3.5 serves every job. All 5 brands have `brand_configs.pipeline_version = 'phase35'`. `PART_B_ROLLOUT_PERCENT = 0` (or unset). `jobs.pipeline_override` is NULL on every row. Part B code is loaded into the worker process (memory baseline rose from ~142MB to ~210MB on W8 deploy), but no job ever routes to it.

---

## What shipped this session

Two ships and one critical bugfix. Both ships were full Part B workstreams; the bugfix was W8 commit 13 closing the `job_events` observability gap pre-merge.

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

---

## What's next — W9 Shadow Rollout

This is operational, not architectural. The flags W8 built get operated. The shadow_runs table starts populating. Operator verdicts accumulate. Eventually a brand flips from `part_b_shadow` to `part_b_primary` and Part B serves production for that brand.

**Decisions W9 will need to make:**

- When to flip nordpilates to `part_b_shadow` (probably immediately — it's the canary brand)
- Initial `PART_B_ROLLOUT_PERCENT` value (probably low, e.g. 10-20%, given Tier 2's revise-exhaustion baseline)
- How operator reviews dual-run output in practice — Sheet view? Direct Supabase query? Something else?
- Cadence for ramp decisions (weekly review? when N comparisons accumulate?)
- Signals that decide `part_b_primary` cutover (operator verdict ratio, escalation rate, cost per video, organic-creator-plausibility)
- Pause / rollback thresholds (what makes us roll back to phase35?)
- When to flip dual-run mode off (Q7 said "after signal stabilizes" — what's the concrete threshold?)
- W10 sequencing — does voice generation get scheduled relative to shadow's progress on a brand-by-brand basis?

W9 will probably be a shorter brief than W8 (less code, more measurement framework + decision cadence). Expect ~300-400 lines vs W8's 797.

**The decisions in W9 are different in character from W1-W8.** W1-W8 were "build this thing, validate with Gate A, ship." W9 is "operate the thing, measure, decide cutover." Less code, more operational protocol. The planning chat for W9 should expect to spend more time on measurement-framework design and less time on agent prompt engineering or schema migration.

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

`docs/followups.md` has 14 active entries. Ranked by W9 relevance:

**Load-bearing for W9 (top of mind):**

1. **`w8-q5-signal-validation-not-exercised-in-gate-a`** — does library-inventory-at-Critic actually change `revise_scope` distribution? W9 measures.
2. **`w8-nordpilates-revise-exhaustion-rate-tier-2-baseline`** — 2 of 3 Gate A seeds exhausted. Shadow rate measurement is the calibration signal for whether budget=3 is needed.
3. **`w8-slot-level-revise-thrashing-without-convergence`** — Director re-picks identical candidates. Is Critic mis-classifying as slot-level? Is retrieval pool too sparse? W9 measurement disambiguates.
4. **`w7-slot0-homogenization-metric-treats-none-as-collision`** — test-harness metric tuning; resolve when shadow has real slot-0-non-null cases.
5. **`gemini-3.1-pro-preview-stability-with-rich-response-schemas`** — cross-agent (W5 + W7 + possibly W8). W9 measures parse-exhaustion rate per agent.

**Carried from prior sessions, may surface in W9:**

6. **`w6-subject-discontinuity-prevalence-at-director`** — partially resolved by W6.5; full validation at W9 shadow.
7. **`w5-subject-role-all-primary-in-planner`** — Planner emits primary on ~100% of slots; observe in shadow whether mixed videos feel monotonous.
8. **`w5-duplicate-segment-across-slots-in-director`** — addressed by W6 issue type; revisit only if W6 misses it.

**Lower priority / informational:**

9. **`w7-parse-retry-headroom-in-production`** — 3-attempt ceiling held with headroom at Gate A; widen if shadow exhausts.
10. **`w7-stripAggressiveBounds-kept-distinct-from-stripSchemaBounds`** — design documentation; future agent extending stripAggressive path list rather than widening global strip.
11. **`w8-copywriter-parse-fragility-seed-c`** — observed once at Gate A; linked to gemini stability followup.
12. **`w8-phase-3-5-unaffected-check-via-worker-harness`** — resolved at deploy time via manual verification; automated harness still owed if W9 wants belt-and-suspenders.
13. **`w8-job-events-to-status-varchar-30-ceiling`** — cosmetic; migration 012 if W10+ overflows again.

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
main: 2548a81 docs: post-w8-merge status + 6 followups
        ↑
        89c886f merge feat/phase4-w8-orchestrator
        ↑
        79c6f3b docs: post-w7-merge status + 4 followups
        ↑
        73ad155 merge feat/phase4-w7-copywriter
        ↑
        ... earlier session-close commits ...
```

11+ unmerged origin branches still sitting (hygiene cleanup deferred). Stash count on VPS likely up to 7-8 (W7 + W8 lockfile drift). Anti-pattern #10 (no `git add -A`) honored throughout the session.

### Database state

Supabase migration 011 applied. All 5 brands on `pipeline_version='phase35'`. Zero rows in `shadow_runs`. Zero rows in `jobs` with `pipeline_override` set.

W3 library inventory shows 1116+ segments on nordpilates with v2 coverage near-100%. Sprint 2 confirmed complete by operator.

### VPS state

Service restarted on W8 deploy (2026-04-24 13:00:50 UTC). Memory baseline ~210MB (up from ~142MB pre-W8). 4 queues running: ingestion, planning, rendering, export. API on :3000.

### Files added/modified this session

W7 created: `src/types/copywriter-output.ts`, `src/agents/copywriter-v2.ts`, `src/agents/prompts/copywriter-v2.md`, `src/scripts/test-copywriter.ts`, `docs/smoke-runs/w7-phase35-reference-notes.md`, plus 3 Gate A artifacts.

W8 created: `src/orchestrator/orchestrator-v2.ts`, `state-machine.ts`, `feature-flags.ts`, `shadow-writer.ts`, `revise-loop.ts`, `render-prep.ts`, `src/types/orchestrator-state.ts`, `src/lib/segment-snapshot.ts`, `supabase/migrations/011_shadow_runs.sql`, `src/scripts/test-orchestrator.ts`, plus pre-work + Gate A artifacts.

W6 modified additively: `src/types/critic-verdict.ts`, `src/agents/critic-v2.ts`, `src/agents/prompts/critic-v2.md`, `src/scripts/test-critic.ts` (if existed).

W7 refactored: `src/agents/copywriter-v2.ts` (now consumes pre-built snapshots), `src/scripts/test-copywriter.ts` (snapshot setup external).

`src/index.ts` modified: added fire-and-forget Part B dispatch alongside Phase 3.5 planning.

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
