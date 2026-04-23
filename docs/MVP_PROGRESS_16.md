# MVP Progress 16 — 2026-04-23 (evening)

**Supersedes:** MVP_PROGRESS_15.md
**Status cutoff:** end of 2026-04-23. W1 through W6 shipped + W6.5 tuning iteration. W7 unblocked.

---

## Headline

**Seven ships in two calendar days. Part B pipeline now complete from Planner through Critic.** The major architectural move of the session was treating subject continuity as a per-video creative decision rather than a brand-level rule — surfaced by W6 Critic findings, redesigned at W6.5 via Planner prompt tuning with matching conditional Critic check. This is the pattern for how Part B self-corrects: shipped components expose real architectural issues, tuning iterations address them upstream without re-opening original scope.

Secondary headline: the **single-gate tuning protocol** was invented organically this session and promoted to Rule 42. Prompt-only iterations on shipped workstreams don't need full two-gate ceremony when scope is schema-additive, code-path-unchanged, and validated by existing test scripts.

Library state at close:
- 1116+ segments (Sprint 2 still climbing; mid-session checks showed 866 → 969 → 1116 as the aggregator fix revealed true counts)
- 100% v2 coverage on all v2-eligible rows
- 100% keyframe-grid coverage
- Sprint 2 ingestion continuing autonomously

---

## What shipped this session

See `HANDOFF_TO_NEW_CHAT.md` §"What shipped this session" for the complete chronological list with merge SHAs and per-workstream details. Summary:

1. **Legacy Flash removal** — unblocked Sprint 2 from 429'ing on free-tier quota
2. **W2 — Brand persona + form/posture loader** — runtime-structured brand creative contract
3. **W3 — Planner** — form_id + hook_mechanism + slot structure per idea
4. **W4 — match_segments_v2 RPC** — per-slot candidate retrieval with soft relaxation
5. **W5 — Visual Director (multimodal)** — per-slot clip picks from keyframe grids
6. **W6 — Coherence Critic** — 3-verdict pre-render storyboard review
7. **W6.5 — Subject stance tuning** — Planner commits per-video + conditional Critic check

None of W2 through W6.5 has a runtime consumer yet. All are importable modules validated by test scripts. W8 orchestrator is the first production consumer; W9 shadows.

---

## The subject_discontinuity arc — case study worth preserving

**Why this matters:** this was the most architecturally consequential thread of the session. The pattern — problem surfaces at agent N; fix belongs at agent N-K where the decision lives — is generalizable. Every future Part B tuning question should follow the same upstream-trace reflex before landing on a reactive patch.

**The trace:**

1. **W5 Gate A:** Director picks cross-parent on primary slots 29% of the time. Each individual deviation justified in reasoning ("warm natural lighting better matches P1 posture"). Logged as soft-enforcement signal via reasoning-append. Seemed fine at the individual level.

2. **W6 Gate A:** Critic flagged `subject_discontinuity` on 3/3 real storyboards. The compound math: per-slot 29% cross-parent = ~82% probability of at least one cross-parent pick in a 5-slot primary-only video. What looked reasonable at pick-level was near-universal at storyboard-level.

3. **Initial response (planning chat):** log + wait for W9 shadow. Orchestrator retry loops would converge or exhaust; shadow data was the right measurement. Recommendation: don't tune W5 or W6 pre-shadow.

4. **Domis reframe:** subject continuity is a per-video creative decision, not a brand rule. "My morning routine" needs same-subject; "pilates girls summer compilation" works better mixed. The Planner — which sees the idea seed + form — has the context to commit to a stance per video. The `subject_consistency` field already existed in the schema; Planner wasn't using it.

5. **W6.5 execution:** prompt-only edits to Planner (idea-signal heuristics teaching when to pick each stance) + matching conditional edit to Critic (`subject_discontinuity` fires only when Planner committed to `single-subject`). No schema changes, no new code paths. Single-gate protocol.

6. **Validation:** Planner seed 3 ("soft golden-hour pilates aesthetic, no teaching") flipped to `mixed`; 5-unique-parent storyboard assembled; Critic correctly did NOT fire `subject_discontinuity`. Conditional path validated end-to-end via one spot-check invocation.

**Lessons that generalize:**

- **Individual-pick judgment can compound to storyboard-level failure.** Every per-slot decision with a >0% deviation rate compounds across slot count.
- **Wait-for-shadow is often the right call, but strategic pushback deserves reframing rather than defense.** Domis's pushback wasn't rejecting the measurement approach; it was pointing out a missing creative decision at an upstream agent.
- **Schema-additive fixes are strictly better than reactive severity tuning.** Tightening W5 prompt or downgrading Critic severity would have papered over the missing Planner decision. Teaching Planner to commit to stance was the clean fix.
- **The Critic did its job.** W6 is designed to catch issues the per-slot Director can't see. This was exactly the case — don't de-fang the Critic in response to it correctly catching an issue.

**What still owes W9:** the followup `w6-subject-discontinuity-prevalence-at-director` stays active until shadow mode confirms (a) Planner stance distribution across real operator idea seeds is healthy; (b) single-subject storyboards still hit same-parent ≥80% reliably; (c) orchestrator revise-loop convergence rate is acceptable; (d) no new false-positive patterns emerged from the conditional Critic logic.

---

## Architectural decisions (locked this session)

### New rules

**Rule 42 — Mid-stream tuning iterations follow a single-gate protocol.** When a shipped workstream surfaces a prompt-tuning concern that is schema-additive, code-path-unchanged, and validated by existing test scripts, the iteration uses a single-gate brief (Gate A = Commit A push + smoke + merge) instead of two-gate. Required: explicit "single-gate justified because…" paragraph in the brief. Example: W6.5 subject-stance tuning.

### Patterns promoted from ad-hoc to convention

- **`stripSchemaBounds()` helper on all Gemini `responseSchema` calls.** Established in W3 after empirical constraint-density ceiling on `gemini-3.1-pro-preview`. Zod keeps bounds and re-enforces at parse time; Gemini gets the stripped schema. Reused in W5 + W6.
- **Naming-conflict guards at branch-start.** Every new agent file check: does a Phase 3.5 file with the same name already exist? If yes, rename with `-v2` suffix or equivalent. Pattern set in W3 (`library-inventory-v2.ts`), reused in W4 (`candidate-retrieval-v2.ts`), W5 (`r2-fetch.ts` reused existing `r2-storage.ts`).
- **Smoke-output preservation to non-ephemeral paths.** Pattern: `docs/smoke-runs/w{N}-gate-a-YYYYMMDD.txt`. `/tmp/` is not acceptable for Gate artifacts that planning chat may need to reference across sessions. Established W5 Gate A onward.
- **Defensive parse-retry matcher widening.** Gemini multimodal intermittently returns HTTP-success-but-empty. Treat these as parse-retry-eligible alongside JSON/Zod failures. Established in W5.
- **Pre-compute mechanical hints for Critic-like agents.** Injected as prompt observations ("observed: segments X picked at slots A AND B"), NOT as pre-judged verdicts. Preserves model judgment for the real judgment calls while ensuring mechanical issues aren't missed. Established in W6.

### Creative-direction commitments

- **Subject stance as per-video Planner commitment.** Added to the two-axis (form × posture) model as a semi-orthogonal third axis. Not yet a formal rule but architecturally treated as one; may be promoted to Rule 43 if W9 shadow confirms it's load-bearing.

### Workflow / process

- **Docs refresh at session close, not mid-session.** Mid-session docs updates fragment attention; end-of-session single consolidated refresh captures the full arc coherently. Pattern reinforced this session.
- **Handoff doc rewrites, not versions.** `HANDOFF_TO_NEW_CHAT.md` overwrites in place; `MVP_PROGRESS_N.md` numbers up. Two docs serve different purposes — handoff is "where are we now," MVP_PROGRESS is historical record.

### Rejected options from this session

- **Waiting for W9 shadow to address subject_discontinuity via severity tuning.** Rejected in favor of W6.5 architectural fix. Strategic pushback beat measurement-first heuristic.
- **Hard-enforcing subject continuity in W5 wrapper (override cross-parent picks).** Rejected — would violate Rule 38 silent-correction principle.
- **Adding a fourth subject_consistency enum value.** Rejected — three existing values suffice; use them properly via prompt guidance.
- **Modifying nordpilates persona prose to allow mixed subjects.** Rejected — persona describes default preference; idea-level override belongs in Planner prompt, not persona prose. Keeps future brand onboarding simpler.

---

## What's broken or flagged

### Active followups (eight, from `docs/followups.md`)

Top three are W9-shadow-mode relevant:

1. **w5-subject-role-all-primary-in-planner** — partially resolved by W6.5. Stays active until shadow confirms healthy stance distribution.
2. **w5-duplicate-segment-across-slots-in-director** — addressed by W6 `duplicate_segment_across_slots` issue type. Revisit only if W6 misses it in production.
3. **w6-subject-discontinuity-prevalence-at-director** — partially resolved by W6.5. Load-bearing measurement criteria for W9.

Remaining five:
4. **v1-curator-flash-nulls-if-emergency-rollback** — informational, rollback-only.
5. **part-a-classification-noise-spotcheck** — deferred unless W5/W6 show signal in production.
6. **w1-raw-fallback-crop** — deferred, hypothetical.
7. **part-a-test-segment-uuid-drift** — docs-only.
8. **w3-naive-singularization-es-words** — deferred, not affecting decisions.

### Technical debt carried forward (not Part B issues)

- Pre-existing npm audit (3 high, 5 critical) untouched, not introduced by any session work.
- VPS stash count now 6 (pre-W2 through pre-W6.5 lockfile drifts). Consistent with documented pattern.
- Grandfathered dirty tree (`chore/audit-pre-W0-cruft`) continues to sit — anti-pattern #10 honored throughout session (no `git add -A`; explicit per-path staging).
- 11+ old origin branches (hygiene cleanup deferred).

None of these block W7 or W8.

---

## Pipeline status at a glance (updated)

| Stage | Phase 3.5 | Part A | Part B |
|---|---|---|---|
| Ingestion | ✅ Running v1 | ✅ V2 flag ON | — |
| Segment analysis | ✅ Running (v2) | ✅ Complete | — |
| Keyframe grids | — | — | ✅ **W1 shipped** |
| Content Sprint 2 | — | — | 🟡 **in progress** |
| Creative Director | ✅ Running (Claude) | — | 🟢 **Replaced by Planner** |
| Brand persona | ✅ Minimal | — | 🟢 **W2 shipped** |
| Planner | — | — | 🟢 **W3 + W6.5 shipped** |
| Retrieval RPC | ✅ v1 match_segments | — | 🟢 **W4 shipped (v2)** |
| Visual Director | — | — | 🟢 **W5 shipped** |
| Coherence Critic | — | — | 🟢 **W6 + W6.5 shipped** |
| Copywriter | ✅ Running (Claude) | — | 🔴 **W7 NEXT** |
| Orchestrator | ✅ Phase 3.5 | — | 🔴 W8 not started |
| Shadow rollout | — | — | 🔴 W9 not started |
| Audio generation | — | — | 🔴 W10 post-shadow |
| Remotion render | ✅ Running | — | (unchanged) |
| Platform export | ✅ Running | — | (unchanged) |

Legend: ✅ production · 🟢 complete · 🔵 in design · 🟡 in progress · 🔴 not started · — not applicable

---

## Cost tracking (actual this session)

Rough estimates based on test-script smoke runs:

- W3 Planner smokes (iter 1 + iter 2 + iter 3): ~$1.50 (5 seeds × 3 iterations × ~$0.10/seed)
- W4 RPC (no LLM; free)
- W5 Director smoke: ~$1.00 (14 slots × $0.07 multimodal)
- W6 Critic smoke: ~$0.25 (5 storyboards × $0.05 text-only)
- W6.5 smokes (both scripts re-run + spot-check): ~$1.25

**Session total: ~$4 in Gemini usage for test-script validation.** Comfortably within available credits. Not a concern.

Production cost projection unchanged from PHASE_4_PART_B_PIPELINE.md: ~$0.50/video all-in through W9, $0.52 with W10.

---

## Immediate next action

1. Verify Sprint 2 status via inventory query.
2. If ingestion stable for >1hr: mark Sprint 2 meaningfully complete; final taxonomy readiness refresh (this session already refreshed to v1.1 based on mid-stream inventory; final numbers may shift slightly).
3. Write W7 Copywriter brief. Scope: text-only single Gemini call per video, consumes picks + planner + persona, produces overlay text per slot + hook + CTA + captions, `voiceover_script: null` reserved for W10.

---

## References (canonical post-session)

- **`docs/HANDOFF_TO_NEW_CHAT.md`** — refreshed this session, read first.
- **`docs/MVP_PROGRESS_16.md`** — this doc.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — updated with W1-W6 shipped + W6.5 tuning.
- **`docs/w2-content-form-taxonomy.md`** — v1.1, readiness flags refreshed with Sprint 2 numbers.
- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, unchanged.
- **`docs/CLAUDE.md`** — Rule 42 added (single-gate tuning protocol).
- **`docs/GIT_WORKFLOW.md`** — unchanged.
- **`docs/SUPABASE_SCHEMA.md`** — still current through Migration 010 (W4).
- **`docs/VPS-SERVERS.md`** — unchanged.
- **`docs/followups.md`** — eight active entries at session close.
- **`docs/brand-personas/nordpilates.md`** — unchanged per W6.5.
- **`docs/smoke-runs/`** — W5 + W6 + W6.5 Gate A outputs preserved.

---

## Architecture rule count

CLAUDE.md has 42 rules at session close. Rule 42 added this session.

---

*MVP Progress 16 authored 2026-04-23 evening. Seven ships across W1 (Legacy Flash) + W2 + W3 + W4 + W5 + W6 + W6.5. W7 unblocked. Part B pipeline complete from Planner through Critic; Copywriter + Orchestrator + Shadow + Voice remaining.*
