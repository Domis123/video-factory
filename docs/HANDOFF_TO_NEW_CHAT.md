# Handoff to New Chat — 2026-04-23 (session close)

**Read this first.** Supersedes prior handoff. Part B is substantially further along than the last handoff reflected — W1 through W6 shipped plus a mid-stream tuning iteration (W6.5). Seven ships across two calendar days. W7 Copywriter is the next brief.

---

## TL;DR

Video Factory is an automated short-form video pipeline for ~30 organic (non-ad) fitness/wellness brands. Primary test brand: nordpilates.

**State at handoff:**

- **W1 (keyframe grids):** shipped 2026-04-21.
- **Legacy Flash removal:** shipped 2026-04-22 morning.
- **W2 (brand persona + loader):** shipped 2026-04-22 afternoon.
- **W3 (Planner — form_id + hook_mechanism + slot structure):** shipped 2026-04-22 evening.
- **W4 (`match_segments_v2` RPC + TS wrapper):** shipped 2026-04-22 evening.
- **W5 (Visual Director — multimodal clip selection):** shipped 2026-04-22 late.
- **W6 (Coherence Critic):** shipped 2026-04-23 afternoon.
- **W6.5 (Planner subject stance + conditional Critic check):** shipped 2026-04-23 late. Single-gate mid-stream tuning iteration addressing the W6-surfaced subject_discontinuity prevalence issue.
- **W1.5 (Content Sprint 2):** STILL IN PROGRESS. Library at 1116+ segments when last checked mid-session; likely larger now. No agent action needed.
- **W7–W10:** not started. W7 is the next brief.

**Immediate next actions (new planning chat):**
1. Verify Sprint 2 status — `SELECT COUNT(*), MAX(created_at) FROM assets WHERE brand_id='nordpilates'`. If count stable for >1hr, meaningfully complete; refresh taxonomy readiness flags with real numbers (already partly done in this session's docs batch — check `w2-content-form-taxonomy.md` for v1.1 marker).
2. Confirm no issues surfaced from any of the seven ships during the handoff window. Agent should be idle.
3. Write W7 Copywriter brief. Prereqs all satisfied.

---

## What Video Factory is (unchanged)

- Purpose: 150–300 organic short-form videos/week at steady state across ~30 brands
- Creative north-star: "pleasurable to watch, feels organic, not selling." Retention through pleasure, not persuasion.
- Audience: organic social (TikTok, Instagram Reels, YouTube Shorts)

## Infrastructure (unchanged)

- n8n server: 46.224.56.174
- Video Factory VPS: 95.216.137.35 (Hetzner CX32), `/home/video-factory`
- Supabase: `https://kfdfcoretoaukcoasfmu.supabase.co`
- R2, Upstash Redis, Gemini 3.1 Pro Preview, ElevenLabs (W10 only)

---

## Part B pipeline status (current)

```
       Idea seed + brand_id
              │
              ▼
     ┌────────────────┐
     │  Planner       │  ✅ W3 shipped — form_id + hook_mechanism + 
     │                │     subject_consistency + slot structure
     │                │     W6.5: subject stance commits per idea
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Candidate      │  ✅ W4 shipped — match_segments_v2 RPC
     │ Retrieval      │     layered filters + soft relaxation + 
     │                │     subject-hint boost (0.02)
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Visual         │  ✅ W5 shipped — multimodal Gemini per slot
     │ Director       │     parallel non-primary + sequential primary
     │                │     consumes W1 grids + W4 candidates
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Coherence      │  ✅ W6 shipped — 13-issue taxonomy, 3-verdict
     │ Critic         │     pre-compute hints for mechanical issues
     │                │     W6.5: subject_discontinuity conditional
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Copywriter     │  🔴 W7 — NEXT BRIEF
     │ (post-select)  │     text-only single call
     │                │     consumes picks + planner + persona
     └────────┬───────┘
              │
              ▼
     [Orchestrator W8]    🔴 not started
     [Shadow mode W9]     🔴 not started
     [Voice gen W10]      🔴 post-W9
              │
              ▼
        Remotion render
```

**None of W2 through W6.5 has a runtime consumer yet.** All are importable modules validated by test scripts. W8 orchestrator is the first consumer; W9 shadows. This is by design — Part B is building the full pipeline statelessly, then wiring it behind a feature flag once coherent.

---

## What shipped this session (2026-04-22 + 2026-04-23)

Seven ships across two calendar days. Chronological:

### 2026-04-22

**Legacy Flash removal** (merge `99d661e`, fix `e862ee8`, followup `1824029`):
- Removed `analyzeClip` call from `src/workers/ingestion.ts` hot path
- Dropped Flash-populated columns from `assets` insert
- V1 asset-curator rollback path stays as an emergency door per followup `v1-curator-flash-nulls-if-emergency-rollback`

**W2 — Brand persona + form/posture loader** (merge `6b139e4`):
- `src/types/content-forms.ts`, `src/types/brand-persona.ts`, `src/agents/brand-persona.ts`
- `docs/brand-personas/nordpilates.md` — persona v1 content canonicalized
- `docs/brand-personas/_template.md` — onboarding template
- YAML frontmatter + prose body; loader in-memory cached; Zod-validated
- Agent collapsed FormId parallel-declaration pattern into single-source-of-truth (`export type FormId = (typeof FORM_ID_VALUES)[number]`) — better than the brief

**W3 — Planner** (merge `7894ee2`):
- `src/lib/text-normalize.ts`, `src/types/library-inventory.ts`, `src/agents/library-inventory-v2.ts`
- `src/types/planner-output.ts`, `src/agents/planner-v2.ts`, `src/agents/prompts/planner-v2.md`
- `src/scripts/test-planner.ts`
- Form_id + hook_mechanism + subject_consistency + slot structure per idea + brand + library inventory
- `stripSchemaBounds()` defensive helper added after Gemini rejected heavy-constraint schemas (reused in W5, W6)
- Iteration passes addressed homogenization (music_intent collapsed to calm-ambient, creative_vision opener laziness, slot_count compression) and a 1000-row PostgREST silent-truncation bug in the aggregator

**W4 — `match_segments_v2` RPC** (merge `516b3ae`):
- Migration 010: PL/pgSQL RPC with layered filters + soft relaxation + composite boost scoring
- `src/agents/candidate-retrieval-v2.ts` — TS wrapper (naming-conflict-guard renamed from brief's suggested `curator-v2-retrieval.ts`)
- `src/types/candidate-set.ts` + test script + migration applier
- p95 latency 328ms on 1116 segments, well under 500ms target
- Iteration: subject-hint boost retuned from 0.10 → 0.02 after scenario 5 returned 100% same-parent (eclipsed cross-parent variety)

**W5 — Visual Director** (merge `2e29f4a`):
- `src/types/slot-pick.ts`, `src/agents/visual-director.ts`, `src/agents/prompts/visual-director.md`
- `src/lib/r2-fetch.ts` (reuses existing `src/lib/r2-storage.ts`), `src/scripts/test-visual-director.ts`
- First multimodal Part B agent; consumes W1 keyframe grids + W4 candidate sets
- Per-slot Gemini call with up to 18 attached grids + structured metadata
- `pickClipForSlot` (primitive) + `pickClipsForStoryboard` (parallel-non-primary + sequential-primary coordination)
- Soft subject-continuity enforcement — log cross-parent on primary slots, append to reasoning, don't throw
- Gate A surfaced duplicate-segment-across-slots finding (storyboard 1 slots 3+4 both picked 9f86f752 at in_point 259.00) — logged as `w5-duplicate-segment-across-slots-in-director`, explicitly addressed at W6
- Defensive parse-retry matcher widening (HTTP-success-but-empty Gemini responses treated as parse-retry-eligible)

### 2026-04-23

**W6 — Coherence Critic** (merge `2255dcf`):
- `src/types/critic-verdict.ts` (13-issue enum + 3-verdict enum + 3-severity enum)
- `src/agents/coherence-critic.ts`, `src/agents/prompts/coherence-critic.md`, `src/scripts/test-coherence-critic.ts`
- Text-only Gemini call, temperature 0.3, pre-compute mechanical hints (duplicate_segment_ids, parent_distribution, total_duration_s, energy_sequence) injected into prompt as observations model must address
- 3 real storyboards + 2 synthetic failure cases (forced duplicate + forced duration)
- Both synthetic mechanical assertions PASS; duplicate-segment-across-slots from W5 issue caught correctly
- Gate A exposed subject_discontinuity firing on 3/3 real storyboards — load-bearing architectural finding (see below)

**W6.5 — Planner subject stance + conditional Critic check** (merge `370db5e`):
- Single-gate mid-stream tuning iteration. Prompt-only edits to `planner-v2.md` + `coherence-critic.md`; no schema changes; no new code paths
- Addressed followup `w6-subject-discontinuity-prevalence-at-director`
- Planner learns when to commit to `single-subject` / `prefer-same` / `mixed` per idea-seed signals (first-person possessive → single-subject; "vibes/aesthetic/compilation" → mixed; authority framing → single-subject-teacher)
- Critic's `subject_discontinuity` becomes conditional: fires on `single-subject`, fires at low severity on `prefer-same`, does not fire on `mixed`
- Agent added proactive note-length cap to Critic prompt after first smoke hit Zod overflow; observable wins (faster latency, shorter notes, no correctness loss)
- Validated end-to-end via one spot-check invocation (Planner seed 3 → W4 → W5 → Critic on a `mixed` aesthetic storyboard with 5 unique parents across 5 picks): Critic did NOT fire subject_discontinuity; conditional path validated

---

## The subject_discontinuity arc — worth understanding

This was the most architecturally consequential thread in the session. Understanding it is load-bearing for W7 onward.

**Initial state (post-W5 Gate A):** Director picked cross-parent on primary slots 29% of the time. Logged as soft-enforcement violation via reasoning-append. At the individual pick level, each deviation was justified in reasoning (posture fit, body_focus fit). Seemed acceptable.

**W6 Gate A finding:** Critic flagged `subject_discontinuity` on 3/3 real storyboards. The compound math that W5 Gate A missed: per-slot 29% cross-parent becomes ~82% probability of at least one cross-parent pick in a 5-slot primary-only video. Individual-pick judgment aggregated to near-universal storyboard-level continuity breaks.

**Initial recommendation (mine):** log + wait for W9 shadow mode. Orchestrator retry loops would either converge on these or exhaust retry budget; shadow data was needed to tune.

**Domis's reframe:** subject continuity is not a universal brand rule; it's a per-video creative decision that depends on the idea. "My morning routine" needs single-subject; "pilates girls summer compilation" works better with mixed subjects. The Planner — which sees the idea seed — is the right agent to commit to a stance per video. The `subject_consistency` schema field already existed; Planner wasn't using it.

**W6.5 outcome:** Planner now picks stance per idea (validated canary on seed 3 "soft golden-hour pilates aesthetic, no teaching" → `mixed`); Critic's subject_discontinuity is conditional on that stance. Architectural fix rather than reactive tuning. False-positive verdicts on mixed-subject ideas eliminated; genuine continuity breaks on single-subject ideas still caught.

**Architectural pattern this established:** problems surfaced at agent N can be solved at agent N-K where a better creative decision lives. Don't reflexively patch at the point of failure; trace the decision chain upstream.

---

## Architectural rules added or relevant

**Rule 42 (new, added this session in CLAUDE.md):** Mid-stream tuning iterations follow a single-gate protocol when the iteration is schema-additive, code-path-unchanged, and validated by existing test scripts. Example: W6.5 subject-stance tuning.

**Rules 40 + 41 (from MVP_PROGRESS_15, still load-bearing):** Creative variance lives upstream in persona + Planner, not in segment taxonomy. Form + posture are orthogonal axes.

**Rule 38 (confabulation awareness, exercised heavily this session):** validation failures throw, not silently correct. Applied to Planner semantic validation, Director segment_id confabulation check, Critic approve-with-high-severity self-contradiction check.

---

## Known state for next chat to verify

- **Sprint 2 progress:** query `SELECT COUNT(*), MAX(created_at) FROM assets WHERE brand_id='nordpilates'`. Library was 215 parents / 866 segments when session started (2026-04-22 mid-morning), 241 / 969 during W3, 1116 segments during W4 (aggregator pagination fix revealed the true count), ongoing through W6.5. If count stable for >1hr, Sprint 2 meaningfully complete; unblocks the final taxonomy readiness-flag refresh (most ⚠️ already refreshed in this session's docs batch to v1.1).

- **No production-consumer state changes:** W2 through W6.5 are all unwired. No feature flag has been flipped to route traffic to Part B. Phase 3.5 (Creative Director → Curator → Copywriter) is still the production pipeline.

- **VPS operational stashes:** up to 6 stashes now (pre-W2, pre-W3, pre-W4, pre-W5, pre-W6, pre-W6.5 lockfile drift). Consistent with pattern from prior sessions; not new tech debt.

- **Pre-existing npm audit findings (3 high, 5 critical):** remain unaddressed. Not introduced by any W-work this session; out-of-scope.

---

## Open followups (from `docs/followups.md`)

Active (top of file, most recent first):

- **w5-subject-role-all-primary-in-planner** — partially resolved by W6.5 (Planner now emits `subject_role: 'any'` on mixed-subject videos). Followup stays active until W9 shadow confirms full-rate single-subject assignment is correctly varied.
- **w5-duplicate-segment-across-slots-in-director** — addressed by W6's `duplicate_segment_across_slots` issue type; Critic catches it. Revisit if W6 misses it in practice.
- **w6-subject-discontinuity-prevalence-at-director** — partially resolved by W6.5. Load-bearing for W9 shadow-mode measurement: how often orchestrator revise-loop converges vs exhausts retries.
- **v1-curator-flash-nulls-if-emergency-rollback** — informational; only relevant if `ENABLE_CURATOR_V2=false` flipped.
- **part-a-classification-noise-spotcheck** — deferred unless W5/W6 show signal.
- **w1-raw-fallback-crop** — deferred; hypothetical.
- **part-a-test-segment-uuid-drift** — docs-only.
- **w3-naive-singularization-es-words** (`crunches → crunche`, `sunglasses → sunglasse`) — deferred; not affecting Planner decisions.

All eight active. None blocking. W9 shadow is the natural revisit point for the top three.

---

## Creative direction commitments (still current)

1. **Segment taxonomy (Part A) accepted as fixed.** Rule 40.
2. **Form × Aesthetic Posture two-axis model.** Rule 41.
3. **Hook mechanism as first-class Planner output** (7 mechanism types).
4. **Subject stance as per-video Planner commitment** (W6.5 addition — not yet a formal rule but architecturally treated as one).
5. **Success criterion: organic-creator-plausibility + form diversity + subject-stance-appropriateness over auto-QA pass rate.** Measured at shadow + ramp phases.
6. **W10 voice generation deferred to post-shadow-mode.** Brand persona schema has `voice_config: null` reserved.

---

## Where W7 work lives (next brief)

W7 Copywriter reads:
- `PlannerOutput` (form, hook_mechanism, subject_consistency, narrative_beats per slot)
- `StoryboardPicks` from W5 (final clip picks with in/out points)
- `BrandPersona` (voice tenets + prose body)
- Optionally: segment_v2 metadata on picked clips (via same snapshot pattern Critic uses)

W7 produces:
- Per-slot overlay text + timing
- Hook text + CTA
- Platform captions + hashtags
- `voiceover_script: null` field reserved for W10

Single Gemini text-only call per video (not per-slot — W7 has full storyboard context, writes coherently across slots).

Estimated brief size: similar to W3 (~400-500 lines). Temperature likely 0.5-0.6 (Copywriter is creative, needs more variance than Critic).

Does NOT depend on W6 or W6.5 runtime — Copywriter and Critic are parallel at orchestrator level, both consume picks independently.

---

## Anti-patterns reminder (unchanged from prior handoff, reinforced this session)

1. File-based brief delivery, never inline paste for long docs.
2. Git rules in GIT_WORKFLOW.md — don't restate in briefs.
3. Model names: `gemini-3.1-pro-preview`. SDK: `@google/genai` for new code, `@google/generative-ai` legacy coexists.
4. Max stack depth 1.
5. Zod validation always on Gemini output.
6. One scope per branch.
7. Don't refactor Phase 3.5 — it's still production.
8. Rule 38 confabulation awareness on LLM output.
9. Rule 39 soft-rule-in-refine avoidance.
10. Rule 40 creative-variance-in-persona-not-taxonomy.
11. Rule 41 form×posture orthogonality preserved.
12. Strategic concerns from Domis during tactical work = strategic response, not tactical dismissal. (Reinforced this session: subject-stance reframe was exactly this pattern.)
13. **Rule 42 (new): mid-stream tuning iterations follow single-gate protocol.**
14. **Apply `stripSchemaBounds()` to all Gemini `responseSchema` calls in new code.** Pattern established in W3, reused in W5 + W6.
15. **Naming-conflict guards at branch-start on every new agent file.** Pattern established in W3 (`library-inventory-v2.ts`), reused in W4 (`candidate-retrieval-v2.ts`), W5 (`r2-fetch.ts` reused existing helper).
16. **Preserve smoke outputs to non-ephemeral paths.** Pattern: `docs/smoke-runs/w{N}-gate-a-YYYYMMDD.txt`. Established W5 Gate A onward.

---

## Context on Domis (unchanged, still accurate)

Lithuanian, Vilnius. Runs 30+ brands. Stack-fluent: n8n, Supabase, Sheets, Hetzner. Direct communication, spelling occasionally loose (parse for intent, don't correct), prefers quick decisions, "I don't care" means "stop optimizing around this, move on." Rewards: fast iteration, clean execution, agent handling git autonomously. Frustrations: commands that don't work, re-litigating decisions, hedging language.

**This session specifically:**
- Domis pushed back on the "wait for W9" recommendation when W6 surfaced subject_discontinuity prevalence. Correct pushback — the architectural fix (W6.5) was strictly better than the reactive tuning path. Preserve this pattern: Domis's strategic pushback during tactical work is signal to reframe, not to defend.
- Domis asked for plain-language explanation of "cross-parents" when the buzzwords got dense. Good sign that communication was getting too jargony; the ensuing plain-language explanation led directly to the architectural reframe. Don't over-anchor on technical vocabulary when discussing creative direction.
- Domis approved single-gate workstreams and shortened kickoffs readily. Respects velocity when the risk profile justifies it.

---

## Session close metadata

- Session duration: ~2 calendar days of active work (2026-04-22 morning through 2026-04-23 late)
- Total ships: 7 (6 W-workstreams + Legacy Flash removal + W6.5 tuning iteration)
- Docs batch at close (this): HANDOFF (this doc), MVP_PROGRESS_16.md, PHASE_4_PART_B_PIPELINE.md updates, w2-content-form-taxonomy.md v1.1 refresh, CLAUDE.md Rule 42 addition.
- No production cutover. Phase 3.5 still serves all traffic.

---

*Handoff written 2026-04-23 at session close. Supersedes prior handoff (2026-04-22). Next planning chat reads this first, verifies Sprint 2 state + no issues from latest ships, then drafts W7 Copywriter brief.*
