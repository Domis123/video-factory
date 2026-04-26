# MVP Progress 17 — 2026-04-24 (evening)

**Supersedes:** MVP_PROGRESS_16.md
**Status cutoff:** end of 2026-04-24. W7 + W8 shipped. Part B pipeline complete as runtime code, deployed and dormant pending W9 shadow rollout.

---

## Headline

**Two ships in one calendar day.** W7 Copywriter shipped morning of 2026-04-24; W8 Orchestrator shipped afternoon. Both two-gate workstreams, both merged + deployed cleanly. Part B now exists as runtime code end-to-end — Planner → Retrieval → Director → Critic → Copywriter → Orchestrator. Phase 3.5 still serves 100% of production traffic; W9 is the rollout brief.

The major architectural decision of the session was the **Q5 flip on W8** — Critic gets library inventory injected so its `revise_scope: 'slot_level' | 'structural'` is a signal-based decision, not a guess. The flip happened during brief drafting, after operator strategic pushback. This is the second time this pattern has played out (the first was W6.5 subject-stance commitment in the previous session). Both follow the same shape: pipeline produces unexpected behavior; tactical instinct is to tune severity or thresholds; operator pushback reframes around an upstream architectural decision; planning chat re-evaluates and lands on the upstream fix; ship at modest cost, measure in shadow.

Secondary headline: **W8 was the first runtime-changing merge of Part B.** Up through W7, every Part B ship was importable modules behind test scripts — zero production wiring. W8 added the BullMQ planning worker dispatch that loads Part B code into the worker process and routes jobs based on feature flags. It deployed dormant (all brands defaulted to `phase35`), Phase 3.5 was verified unaffected via post-deploy test job, and the architectural invariant "Part B errors NEVER affect Phase 3.5" was explicitly validated. The fire-and-forget dispatch boundary held.

Library state at close: 1116+ segments, near-100% v2 coverage, Sprint 2 complete and confirmed. Library state did not change this session — all work was downstream pipeline code.

---

## What shipped this session

See `HANDOFF_TO_NEW_CHAT.md` §"What shipped this session" for the per-ship details with merge SHAs and Gate A signals. Summary:

1. **W7 Copywriter** (merged 73ad155) — single Gemini text-only call producing CopyPackage. 8 commits incl. 2 unplanned fixes (Gemini schema rejection on `voiceover_script: z.null()`, and JSON parse stabilization via maxOutputTokens bump + aggressive bounds strip).

2. **W8 Orchestrator** (merged 89c886f) — wires W3-W7 into a coordinated pipeline. 14 commits incl. 2 post-Gate-A fixes (job_events column mismatch + verification re-smoke). Migration 011 applied. Deployed with full restart sequence. Phase 3.5 verified unaffected.

Plus four docs-only commits that landed in main directly (post-W7 status flip, post-W8 status flip, plus session-close batch).

---

## The Q5 architectural-flip arc — case study worth preserving

**Why this matters:** this is the second occurrence of the upstream-trace reframing pattern. The first was W6.5 subject-stance commitment in the previous session. Both followed the same shape, both produced cleaner architecture than the tactical fix would have, both happened because operator strategic pushback at the right moment redirected the planning chat from defense to re-evaluation. Generalizable beyond this session.

**The trace:**

1. **W8 brief kickoff Q&A:** 12 questions across architecture, state, agent wiring, testing. Q5 asked: "On `revise`, does orchestrator re-invoke Director on flagged slots, or full re-plan?" The answer needed a routing signal from Critic. I framed three options: (a) extend W6 to inject library inventory into Critic so its routing call is signal-based; (b) Critic guesses scope from storyboard alone, defaults to `slot_level` if unsure; (c) defer entirely.

2. **Operator chose (c if critic also sees library if not might be dangerous).** Translation: prefer (a) but accept (b)+(c). The "if not might be dangerous" was the tell — flagging that (b)'s default-`slot_level` failure mode might have miscalibration cost they hadn't fully weighed.

3. **Planning chat lean was (b)** in the initial draft. Reasoning: (a) doubles W8's Critic-extension scope; (b) is "guess from storyboard" with default `slot_level` if unsure; (c) defers measurement to shadow. Pragmatic-at-authoring-time choice.

4. **Operator strategic pushback during brief review:** *"maybe we should have chsoen option a then for q5?"* Six words, but the right six. The critical pattern: not "you got this wrong," but "did we trade off correctly?"

5. **Reframing in response:** I walked the false-`slot_level` failure mode concretely. Critic guesses `slot_level`, Director re-invokes on flagged slots, Director's re-pick comes from same candidate pool, gets near-identical clip, Critic flags same issue, second cycle, budget exhausts, escalates to human with tangled history. The orchestrator looks like it's trying, produces no progress, operator gets the worst possible UX failure — "the system tried but couldn't converge." Versus (a)'s cost: ~1-2K extra prompt tokens per Critic call (~$0.01-0.02), modest engineering on Critic prompt + signature, plus W8 commit 4 expands ~15-20%. Negligible.

6. **Recommendation: flip to (a).** Operator confirmed: *"lets flip to a, update the brief. cost is acceptible it actually could be evn higher 1 usd also accerptible if necessary."* Brief updated in 8 surgical edits.

7. **Gate A Tier 2 result:** Seed C, designed to validate the (a) signal, didn't trigger structural — the natural seed wasn't sparse enough. **Q5(a) is shipped as code but unvalidated as behavior.** Followup `w8-q5-signal-validation-not-exercised-in-gate-a` flags this for W9 measurement.

**Lessons that generalize:**

- **Strategic pushback ≠ tactical objection.** When operator says *"maybe we should have chosen X?"* — that's a design signal asking for re-evaluation, not a request for defense of the original choice. Reframe, don't defend. The W6.5 case in the previous session followed the same pattern.
- **The cheap-at-authoring-time choice is often expensive in the field.** Q5(b) was cheaper to draft into the brief; Q5(a)'s thrashing failure mode would have been expensive in shadow. Authoring economy is not the right optimization target when pipeline architecture is at stake.
- **"Costs more in prompt tokens" is not a real cost when prompt costs are <$0.02/call and operator budget is $1/video.** Every minute spent discussing whether to absorb a $0.01-0.02 prompt-extension cost is a minute not spent on the real problem.
- **"Code shipped" ≠ "behavior validated."** Gate A's coverage gap on Seed C means Q5(a) is live but unproven. We knew this at merge; flagged as followup; W9 measures. The session should not be remembered as "Q5(a) was validated by Tier 2" — it should be remembered as "Q5(a) is shipped, validation deferred to shadow."

**What still owes W9:** the followup chain `w8-q5-signal-validation-not-exercised-in-gate-a` + `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` + `w8-slot-level-revise-thrashing-without-convergence` are linked. W9 needs to measure: (1) does Critic emit `structural` ever in shadow? (2) on `slot_level`-flagged jobs that exhaust revise budget, did library inventory retrospectively support the form commitment? (3) does widening revise budget to 3 reduce escalation rate without burning cost? These are W9 design inputs, not just measurements.

---

## Architectural decisions (locked this session)

### New rules

None. Rule count remains 42. Rule 42 (single-gate tuning protocol) was the only rule added in the previous session; no W7 or W8 work justified Rule 43.

I considered proposing Rule 43 ("push feature branches to origin continuously during work, not just at task end") after W8's local-only branch incident — the agent kept all 12 W8 commits on the local sandbox until merge, which violated GIT_WORKFLOW Rule 5. But on reflection: GIT_WORKFLOW already states this. The lesson is that the agent missed it once, not that the convention needs promotion. Filed as a kickoff-message reminder for future workstreams; not a new rule.

### Patterns promoted from ad-hoc to convention

- **Param-only tuning ≠ prompt iteration.** W7 commit 9 (maxOutputTokens 4000→8000 + aggressive bounds strip) was explicitly NOT counted against the brief's one-iteration budget for prompt iteration. Parameter-layer changes that don't touch prompt content preserve the iteration budget for actual prompt design fixes. Pattern: distinguish parameter tuning (tokens, retries, schema strip aggression) from prompt iteration (instructions, examples, taxonomy) when budgeting Gate A re-runs.
- **Library inventory at Critic.** Same shape W3 Planner consumes, injected at orchestrator level (cached per-job), passed to Critic on every invocation. Pattern for any future agent that needs "is this plan achievable given what exists" awareness — make library inventory a first-class agent input rather than a prompt-time literal.
- **Translation map > naive prefix concat for state-name namespacing.** W8 commit 13 discovered varchar(30) ceiling on `job_events.to_status`; 7 of 20 Part B event names overflow when prefixed. The fix used a `DB_EVENT_NAMES` translation map; alternative would have been migration 012 widening to varchar(64). Map-first is cheaper and avoids touching DB during a code fix; widen if W10+ overflows force it.
- **Fire-and-forget at the dispatch boundary, not at internal calls.** W8's `runPipelineV2` is wrapped in `.catch()` at the BullMQ planning worker dispatch site, so Part B errors never propagate to Phase 3.5. Internal calls within `runPipelineV2` throw normally (Rule 38 — loud, no silent correction). This is the right architectural level: protect the production boundary, don't pollute internal observability.

### Creative-direction commitments

- **Organic content as pipeline invariant, not brand-level config.** No `hard_sell_allowed` field on BrandPersona. CTA decision lives in Copywriter prompt, driven by `form_id + close-slot energy + narrative_beat`. Pipeline-invariant: never hard-sell. This is the correct level — brand-level voice modulation lives in persona prose; pipeline-level "what kind of content do we even produce" is invariant across brands. May get promoted to Rule 43 if W9 surfaces edge cases.
- **Subject stance modulates voice + overlay density at Copywriter.** `single-subject` ≠ first-person — brand persona's "rarely first-person" tenet binds at brand level; stance modulates within. Copywriter prompt teaches this explicitly. Mixed-subject videos drop overlay density (1-2 total overlays vs single-subject's per-slot).

### Workflow / process

- **Migration-before-merge for additive migrations that new code references.** W8's migration 011 was applied before merge despite agent flagging that fire-and-forget dispatch degraded gracefully without it. Reasoning: graceful degradation is a safety net, not a target state. Apply migrations first; let code merge into a schema that supports it. Pattern for W10+ migrations.
- **Single-seed re-smoke after Gate B fix > full Gate A re-run.** When Gate B surfaces a fix-and-re-verify situation (W8's `job_events` column-mismatch fix), one targeted seed that exercises the fix path is sufficient. Don't burn $4 of Gate A budget on issues that didn't change since the prior smoke.
- **Followups written at merge, not at brief-time.** W7 brief listed 5 candidate followups; only 4 surfaced as load-bearing during execution and were written to `docs/followups.md` at merge. Pattern: brief enumerates candidate followups, merge selects which actually surfaced signal.
- **Session close at workstream-natural breakpoints, not calendar.** W8 was the first runtime-changing merge; W9 is operationally different in character. That's the right session-close boundary, not "we hit X tokens" or "it's getting late." This session ran W7+W8 because both were architectural ships; W9 deserves a fresh planning chat because it's measurement-and-decision work, not code.

### Rejected options from this session

- **Q5 option (b)** — Critic guesses revise scope without library visibility. Rejected during brief drafting in favor of (a). The thrashing failure mode (false-`slot_level` exhausting revise budget on identical re-picks) was strictly worse than (a)'s ~$0.01-0.02 prompt cost extension.
- **W7 option (b) preemptive build** — two-call Copywriter (hook+cta+captions then per-slot overlay). Rejected. Tier 1 smoke was the gate; with maxOutputTokens bump + aggressive bounds strip, Tier 1 went 5/5 with zero retries. Option (b) escalation path remains documented but unbuilt.
- **`hard_sell_allowed: boolean` on BrandPersona.** Rejected. Organic content is pipeline-invariant, not brand-level config. Cleaner contract.
- **W8 option (c) for shadow data** (defer entirely; Part-B-primary cuts over instantly post-shadow without dual-run measurement). Rejected. Q1(c) `shadow_runs` table chosen for clean isolation + measurement infrastructure during shadow.
- **W8 option (a) for shadow data** (write Part B to same `jobs.context_packet`). Rejected. Phase 3.5 owns that column during shadow; Part B writing alongside would muddy the source-of-truth contract.
- **Q3 option (b)** — centralize retries in W8. Rejected. Per-agent retries already shipped; centralizing would re-open W3/W5/W6/W7 internals. (a) keeps W8 scope coordinated to inter-agent retries only.
- **Tactical fix for W8 bug #2** — option (c) "skip job_events for Part B internals." Rejected during fix design. Observability during shadow is the measurement infrastructure W9 depends on; degrading by default is the wrong call. Option (a) shipped: rename + translation map + try/catch removal for Rule 38 compliance.
- **Tier 2 skip for W8 Gate A.** Considered after agent reported 25/25 mocked + synthetic pass; my decision was hold-and-run-Tier-2. Reasoning: first runtime-changing merge deserves full Gate A signature; Critic's library-inventory signal needed exercise; cost was within budget. Tier 2 surfaced two observability bugs and the Q5 validation gap — exactly the kind of signal Tier 2 exists to surface.

---

## What's broken or flagged

### Active followups (14, see HANDOFF for ranked list)

Top three are W9-shadow-mode design inputs:

1. `w8-q5-signal-validation-not-exercised-in-gate-a` — does library-inventory-at-Critic actually move `revise_scope` distribution? Code lives but behavior unproven.
2. `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` — 2-of-3 Gate A seeds escalated to human. Shadow rate measurement decides whether budget=3 helps.
3. `w8-slot-level-revise-thrashing-without-convergence` — does Critic mis-classify, or is retrieval pool too sparse?

Plus carry-overs from previous sessions and lower-priority informational entries. Full list in `docs/followups.md`.

### Technical debt carried forward (not Part B issues)

- Pre-existing npm audit (3 high, 5 critical) untouched; not introduced by any session work.
- VPS stash count likely 7-8 (pre-W7 + pre-W8 lockfile drifts).
- Grandfathered dirty tree (`chore/audit-pre-W0-cruft`) continues to sit.
- 11+ unmerged origin branches (hygiene cleanup deferred).
- Migration 012 (varchar(64) widening on `job_events.to_status`) deferred until next overflow.

None block W9.

---

## Pipeline status at a glance (updated)

| Stage | Phase 3.5 | Part A | Part B |
|---|---|---|---|
| Ingestion | ✅ Production v1 | ✅ V2 flag ON | — |
| Segment analysis | ✅ Production (v2) | ✅ Complete | — |
| Keyframe grids | — | — | ✅ W1 shipped |
| Content Sprint 2 | — | — | ✅ Complete (1116+) |
| Creative Director | ✅ Production (Claude) | — | ✅ Replaced by Planner |
| Brand persona | ✅ Minimal | — | ✅ W2 shipped |
| Planner | — | — | ✅ W3 + W6.5 |
| Retrieval RPC | ✅ v1 | — | ✅ W4 shipped |
| Visual Director | — | — | ✅ W5 shipped |
| Coherence Critic | — | — | ✅ W6 + W6.5 + W8 lib-inv |
| Copywriter | ✅ Production (Claude) | — | ✅ **W7 shipped** |
| Orchestrator | ✅ Phase 3.5 worker | — | ✅ **W8 shipped** |
| Shadow rollout | — | — | 🔴 **W9 NEXT** |
| Audio generation | — | — | 🔴 W10 post-shadow |

---

## Cost tracking — actual session

Rough estimate from agent reports across W7 + W8 work:

- W7 Gate A (3 smoke runs incl. iterations + final): ~$2-3
- W8 Gate A (T1+T3 ~$0; T2 ~$1.0; post-fix re-smoke ~$0.40): ~$1.5
- **Session total: ~$4 in Gemini usage.** Comfortably within available credits.

Production projection unchanged: Part B happy-path ~$0.55-0.75/video; revise-loop worst case ~$1.50/video. Operator $1/video target absorbable with W9-driven revise-budget calibration.

---

## Immediate next action

Open W9 Shadow Rollout brief in fresh planning chat. Expected scope:

- Initial brand + percentage flip cadence
- Operator review workflow design (Sheet view? Supabase query? Dedicated UI?)
- Dual-run threshold for switching to Part-B-only on a brand
- Cutover signals from `part_b_shadow` → `part_b_primary`
- Pause/rollback triggers
- Q5(a) signal validation as W9 measurement surface
- Revise-budget calibration (2 → 3?) based on early shadow rate
- W10 voice generation sequencing relative to shadow brand-by-brand progress

Expected brief length: ~300-500 lines. Fewer commits than W8 (less code, more decision framework). Possibly single-gate per Rule 42 if a tuning iteration emerges, but full two-gate as default.

---

## References (canonical post-session)

- **`docs/HANDOFF_TO_NEW_CHAT.md`** — refreshed this session, read first.
- **`docs/MVP_PROGRESS_17.md`** — this doc.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — updated W7 + W8 shipped.
- **`docs/w2-content-form-taxonomy.md`** — v1.1, unchanged this session (library state stable).
- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, unchanged.
- **`docs/CLAUDE.md`** — 42 rules at session close. No additions this session.
- **`docs/GIT_WORKFLOW.md`** — unchanged.
- **`docs/SUPABASE_SCHEMA.md`** — Migration 011 applied (shadow_runs + brand_configs.pipeline_version + jobs.pipeline_override). Should be reflected in next refresh.
- **`docs/VPS-SERVERS.md`** — unchanged. Memory baseline note (~210MB post-W8) could be added at next refresh.
- **`docs/followups.md`** — 14 active entries at session close.
- **`docs/brand-personas/nordpilates.md`** — unchanged this session.
- **`docs/briefs/W7_COPYWRITER_BRIEF.md`** — W7 source brief, preserved.
- **`docs/briefs/W8_ORCHESTRATOR_BRIEF.md`** — W8 source brief, preserved.
- **`docs/smoke-runs/`** — W7 + W8 Gate A artifacts preserved. Grouped by workstream.

---

## Architecture rule count

CLAUDE.md has **42 rules** at session close. No additions this session.

---

*MVP Progress 17 authored 2026-04-24 evening. W7 Copywriter shipped + merged + deployed; W8 Orchestrator shipped + merged + deployed. Part B pipeline complete as runtime code, dormant until W9 shadow flips a brand. Q5 architectural flip from (b) to (a) during W8 brief drafting was the session's defining moment — second occurrence of the upstream-trace pattern after W6.5. W9 brief is operational, fresh-context, next.*
