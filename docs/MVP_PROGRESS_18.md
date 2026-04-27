# MVP Progress — Session 18

**Session date:** 2026-04-27
**Predecessor:** MVP_PROGRESS_17 (W7 Copywriter + W8 Orchestrator, 2026-04-24)
**This session shipped:** W9 Shadow Rollout, W9.1 Cost Tracking, W9 first real-seed calibration runs, render-bridge diagnostic
**Headline outcome:** Phase 1 calibration ran; surfaced an operator-Critic calibration mismatch that almost became a 1-2 week architecture rebuild before strategic operator pushback reframed it as a calibration sprint
**Next workstream:** **Production Polish Sprint** (multi-pillar cleanup: Critic calibration + music library + render template + transitions + brand assets + ingestion filters), then demo render bridge, then cutover, then W10 voice

---

## TL;DR

Five workstreams shipped this session, and one wasn't shipped that almost was. The session's load-bearing pattern is what didn't ship: a W11 Director Architecture Rebuild that was diagnostically supported, scoped, and ready to brief — and was the wrong workstream. Strategic operator pushback ("the video wasn't bad, success looks different to me than to you") reframed the entire architecture conclusion as a Critic calibration mismatch. The right next workstream is much smaller and bundles other production polish concerns surfaced in the same conversation.

This is the fifth occurrence of the W6.5/Q5 pattern (strategic concerns in tactical work surface design errors) in the project's history, and is being promoted to **Rule 43** in this session's docs touch.

---

## What shipped

### W9 — Shadow Rollout
- Brief drafted, executed through 11 commits, merged at 2548a81 (docs session-close pre-merge), then 005f9cb (W9 merge), 940c75a (W9.1 merge), 7e59020 (W9 docs touch), ff863dc (post-W9 followups)
- Migration 012 applied (shadow_review view + creative-quality columns on shadow_runs)
- Three operator runbooks: W9_SHADOW_OPERATIONS.md, W9_BRAND_EXPANSION_CRITERIA.md, W9_N8N_SHEET_INTEGRATION_SPEC.md
- Pre-flip worker-dispatch verification (Tier 1 Gate A) — passed clean
- Forced-structural synthetic seed (Tier 2 Gate A) — code path exercised, structural classification observed-not-emitted (logged as `w9-q8c-structural-classification-not-exercised`)
- Cutover decision rule formalized: composite 5-signal rule with `feels_organic` ≥80% as creative-quality veto

### W9.1 — Cost Tracking Wireup
- Single-gate single-tier per Rule 42
- Cost path was wired in name only post-W8: agents dropped `usageMetadata`, orchestrator's CostAccumulator was unpopulated, shadow-writer received hardcoded `cost_usd: 0`
- 6 commits across `src/lib/llm-cost.ts`, four agent type files, four agent files, orchestrator wiring, test-script updates
- Gate A: $0.0 → $0.5635 across four agents (planner $0.0114, picks $0.1566, critic $0.0123, copy $0.0152)
- Cutover rule's cost signal (Q5d) now alive

### Phase 1 calibration — flipped + first real seed run
- Nordpilates flipped to `pipeline_version='part_b_shadow'` with `PART_B_ROLLOUT_PERCENT=100` for calibration window
- First real-seed dual-run: Phase 3.5 + Part B both fired in parallel, no error propagation, fire-and-forget invariant validated in production for the first time
- Phase 3.5 produced its standard output and shipped to TikTok (operator-acceptable, "improvement over earlier output")
- Part B terminated `failed_after_revise_budget` on subject_discontinuity — fourth sighting

### Render-bridge diagnostic
- Read-only investigation of `prepareContextForRender` shape
- Confirmed: function is null-safety stub, not a translator; render worker reads `jobs.context_packet` exclusively; Remotion composition is hardwired to Phase 3.5 CopyPackage shape; multiple required fields missing from context_packet_v2
- Bridge gap classified MEDIUM-leaning-LARGE: real translator + orchestrator enrichment + Part B music selector
- Workstream deferred behind Production Polish Sprint

### Documentation maintenance
- W7 + W8 followup resolution: `w8-q5-signal-validation-not-exercised-in-gate-a` and `w8-phase-3-5-unaffected-check-via-worker-harness` both resolved by W9 deliverables
- W9 followup additions, including the load-bearing `w9-cost-tracking-unwired` (resolved by W9.1) and the still-active `w9-q8c-structural-classification-not-exercised`
- Memory baseline observations: idle ~196MB, dual-run peak ~574MB, render peak ~1.6G during clip-prep with multiple .mov files in flight

---

## What didn't ship — and why it matters

W11 Director Architecture Rebuild was diagnostically scoped, ready to brief, and was the wrong workstream.

**The chain that led to W11 being the apparent answer:**
1. Tier 2 Seed B (W8 Gate A): subject_discontinuity, slot-level thrashing
2. W9.1 Gate A (forced-structural seed): subject_discontinuity, slot-level thrashing on aesthetic_ambient
3. W9 Phase 1 first real seed (today): subject_discontinuity, slot-level thrashing on targeted_microtutorial
4. Diagnostic agent's verdict: "Director picks slots in parallel (Promise.all), so each slot's pick has no visibility into what the others chose — the constraint can't physically be honored at the per-slot level today"
5. Planning chat's conclusion: W11 is needed — sequential Director with parent-anchoring or parent-locking at retrieval, ~5-7 day workstream

**The reframe that collapsed W11:**

Operator: *"the vidoe generated wa snot very bad if we would have bigger music library, better text in terms of text palcement and visual look and actual real logo used and never use overweight people in our videos. The video itself was pretty good in terms of logic."*

And: *"success to you and to me are very different I think"*

That collapsed the architecture conclusion. The output isn't broken; the gate is. Phase 3.5's curator goes cross-parent on the same library and produces operator-acceptable output. Part B's Director going cross-parent isn't an architecture failure — it's the same behavior the production system already does, plus a Critic calibrated to a stricter bar than the operator.

**The right workstream:** Critic calibration, not Director rebuild. Loosen `subject_discontinuity` severity for plans where cross-parent is operator-acceptable. Single-gate per Rule 42 — prompt iteration, not new architecture.

This was a textbook Rule 43 moment: confidently scoped a 1-2 week architecture rebuild based on diagnostic evidence; operator pushback reframed the success criterion; the workstream collapsed to a few commits of prompt iteration.

---

## Q-marker case study — the operator-Critic calibration mismatch

**Symptom:** 4-of-4 real-seed Part B runs terminate `failed_after_revise_budget` on subject_discontinuity (slot_level scope).

**Apparent diagnosis:** Director architecture limit. Per-slot parallel Director can't enforce cross-slot subject continuity. Needs sequential picks anchored on slot 0's parent or parent-locking at retrieval.

**Apparent solution:** W11 Director Architecture Rebuild, ~5-7 day workstream.

**Reframe trigger:** Operator watched the Phase 3.5 video that rendered for the same job. Same library. Phase 3.5 also picked cross-parent. Phase 3.5 video was "pretty good in terms of logic." Operator named the actual pain points: music library, text placement, visual look, brand logo, no-overweight-people filter, transitions library — none of which are creative-pipeline scope.

**Real diagnosis:** Critic's `subject_discontinuity` is calibrated to flag cross-parent storyboards as failed. Operator's success criterion is content the audience doesn't bounce off. These are different bars. Critic is over-strict relative to operator. Reductio: if Phase 3.5 ships cross-parent storyboards weekly without complaints, single-subject continuity is not an operator-required quality property.

**Real solution:** Loosen Critic's `subject_discontinuity` severity from 'high' to 'medium', or downgrade the issue from `slot_level`-triggering to `info`-only. Two days of prompt iteration plus a calibration re-run.

**The trap that almost caught us:** Diagnostic evidence can be technically correct and strategically wrong. The diagnostic agent's analysis ("Director can't honor the constraint") was accurate. The implied conclusion ("therefore Director architecture must change") was wrong because the constraint itself isn't operator-required. The whole error chain was: trust the constraint as given (because Planner committed to it) → diagnose how Director violates it → conclude Director must change. The skipped question was: *is the constraint correct in the first place?*

**Pattern with W6.5 and Q5:**
- W6.5 (subject-stance commitment): per-slot Critic was flagging continuity issues; operator pushback reframed it as Planner needing to commit per-video
- Q5 (library-inventory-at-Critic): Critic was guessing structural-vs-slot; operator pushback reframed it as Critic needing inventory data
- Today (W11 collapse to W9.5 calibration): Critic was flagging subject_discontinuity; operator pushback reframed it as Critic threshold being miscalibrated

**Common shape:** the LLM-agent doing creative judgment is being asked to produce verdicts against an internal model of "correct" that the operator doesn't share. Each iteration tightens what the agent should care about (Planner stance, library inventory, subject_discontinuity threshold). The fix is always upstream of where the symptom shows.

**Promoted to Rule 43:** *"Strategic concerns in tactical work surface design errors. When operator (or planning chat) raises a strategic-shaped doubt during execution-phase work, treat it as an architectural signal, not a tactical objection. Reframe and re-evaluate. Tactical defense of the original choice is the wrong move five times out of five so far."*

---

## Infrastructure observations from first real render

These surfaced when operator watched the Phase 3.5-rendered video for job 6cd0a2cb. They are out of Part B's creative-pipeline scope but are real production polish targets — bundling into Production Polish Sprint:

1. **Music library is small** — current track selection feels limited; the same fallback tracks recur. Investment: more tracks ingested through S7 workflow, or expand the brand-allowed mood/energy combinations to widen selection.

2. **Text placement is suboptimal** — overlay positioning in render template doesn't always sit cleanly against the visual content. Investment: Remotion composition tuning, possibly per-form text-placement rules.

3. **Visual look needs polish** — the warm-vibrant LUT does its job but doesn't fully nail the soft-pastel nordpilates aesthetic. Investment: brand-specific LUT review, per-posture color-grade presets.

4. **Brand logo not appearing in render** — `nordpilates.json` has `logo_r2_key` populated but operator reports no logo on shipped video. Either render-template doesn't read the field, or watermark_position/opacity defaults are wrong, or the field isn't wired. Investigate first; fix may be one-line.

5. **Asset ingestion lacks body-composition filter** — operator-required brand standard ("never use overweight people in our videos"). Currently no ingestion-level filter; clips with off-brand body composition pass through. Investment: per-brand ingestion filter (AI-vision-based or manual moderation step in S7).

6. **Transitions library has the wrong inventory** — current transitions include long animations that don't fit the soft-aesthetic-cinema register nordpilates lives in. Operator wants: simple clean cuts as default, minimal subtle transitions only. Investment: prune transition library, default to cut, restrict animations to specific form/posture combinations only.

These are all polish-pillar observations. None block Phase 1 calibration; all block the demo from feeling like a confident first video.

---

## Production state at session close

### What's running
- **Phase 3.5:** production pipeline. Serves all five brands' videos to socials. Has been since 2026-04-17. Unaffected by anything Part B does.
- **Part B:** deployed dormant on 4 brands (carnimeat, highdiet, ketoway, nodiet). Live in shadow on nordpilates with PART_B_ROLLOUT_PERCENT=100. First real-seed dual-run completed today (job 6cd0a2cb).
- **Cost tracking:** alive end-to-end. Q5d's cost signal real.
- **Shadow rows:** 1 in shadow_runs table (cf104600 — today's calibration run, terminal_state=failed_after_revise_budget). Q8c calibration marker (cb87d32c) was preserved through Phase 1 flip. ff67fc55 from W9.1 Gate A also exists.

### What's not running yet
- **Render bridge:** unbuilt. Part B output cannot reach renderer in `part_b_primary` mode. Workstream deferred behind Production Polish Sprint.
- **Voice generation (W10):** parked. Blocked on at least nordpilates cutover.
- **n8n S-workflow extension for shadow review:** spec written (W9_N8N_SHEET_INTEGRATION_SPEC.md), implementation not started. Not blocking calibration; raw Supabase queries work for the first ~10 jobs.
- **Per-brand body-composition ingestion filter:** unbuilt. Polish Sprint scope.
- **Critic calibration:** at default severity for subject_discontinuity. 4-of-4 real-seed escalations confirm threshold is over-strict relative to operator. Polish Sprint scope.

### Anthropic API limit
- Hit during today's calibration run; raised by operator
- No production impact — demo seed completed before throttle bit
- Watch item: dual-run mode roughly doubles Claude consumption per nordpilates job (CD + Copywriter both Sonnet × 2 pipelines)
- Logged as `claude-api-limit-watchitem` followup

### Memory observations
- Idle baseline: ~196MB cold, ~210MB warm
- Dual-run peak: ~574MB (Phase 3.5 curator V2 holding 15 Gemini Files concurrently)
- Render peak: ~1.6G during clip-prep with multiple .mov files in flight
- All within CX32's 8GB capacity (~5x headroom even at render peak)

---

## Followups state at session close

### Resolved this session
- `w8-q5-signal-validation-not-exercised-in-gate-a` — resolved by W9 Q8c synthetic seed; replaced by `w9-q8c-structural-classification-not-exercised`
- `w8-phase-3-5-unaffected-check-via-worker-harness` — resolved by W9 Tier 1 verification
- `w9-cost-tracking-unwired` — resolved by W9.1 single-gate fix at 940c75a

### Active and load-bearing for next workstream
- `w9-q8c-structural-classification-not-exercised` — Critic emits `slot_level` even when prose identifies structural issues. Polish Sprint scope.
- `w8-slot-level-revise-thrashing-without-convergence` — fourth sighting today; reframed as Critic calibration issue, not Director architecture issue. Polish Sprint scope.
- `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` — 4-of-4 real seeds (was 2-of-3). Reframed as Critic threshold issue.

### New active
- `w9-demo-render-bridge-deferred-behind-polish-sprint` — render bridge workstream paused; demo path requires this; sized MEDIUM-leaning-LARGE per render-bridge diagnostic
- `claude-api-limit-watchitem` — limit hit and raised today; revisit if jobs fail with Anthropic 429s under sustained dual-run load
- `w9-music-library-needs-expansion` — operator-named pain point; Polish Sprint scope
- `w9-render-text-placement-suboptimal` — operator-named pain point; Polish Sprint scope
- `w9-brand-logo-not-rendering` — `logo_r2_key` populated but not appearing; investigate first; Polish Sprint scope
- `w9-ingestion-needs-body-composition-filter` — operator-required brand standard; Polish Sprint scope
- `w9-transitions-library-too-animated` — operator wants simple cuts default, minimal subtle transitions; Polish Sprint scope
- `w9-color-grade-needs-per-posture-presets` — current warm-vibrant LUT not nailing soft-pastel; Polish Sprint scope

---

## What's next

### Headline workstream: Production Polish Sprint
Single brief bundling six pillars of operator-named pain points surfaced from the first real render:
1. Critic calibration (loosen subject_discontinuity threshold; the W11-collapse fix)
2. Music library expansion
3. Render template text placement tuning
4. Brand assets (logo wiring, possibly per-brand watermark behavior)
5. Ingestion filter for body composition
6. Transitions library cleanup (cuts default, prune long animations)

Estimated 1-2 weeks. Brief written by next planning chat. Single-gate per pillar where possible; multi-gate for pillars touching multiple components (e.g., body-composition filter touches both ingestion and asset_segments schema).

### Sequenced after Polish Sprint
1. **W9.2 Demo Render Bridge** — only after Polish Sprint stabilizes Critic verdicts and renders look right
2. **First Part B video rendered** — single-tier Gate A on a clean shadow_runs row from a calibration seed
3. **Phase 1 calibration steady-state** — drop PART_B_ROLLOUT_PERCENT from 100 to 30; collect cutover-eligible verdicts
4. **First brand cutover** — Q5d composite rule clears + operator confirms
5. **W10 Voice Generation** — only after first brand cuts over
6. **Brand expansion** — criteria locked in W9 brief; pick deferred until first cutover

### Decisions deferred to next chat
- Polish Sprint brief structure (single multi-gate vs sequence of small briefs per pillar)
- Critic calibration approach (loosen severity vs reclassify issue vs both)
- Whether logo issue is a render-template bug or a brand_config wiring gap
- Ingestion filter implementation: AI vision at ingest time vs manual moderation in S7

---

## Session reflection

This session shipped real work (W9 + W9.1) on schedule, ran the first dual-run in production, and almost rebuilt the wrong thing. The operator pushback that collapsed W11 to W9.5 saved 1-2 weeks of agent work and avoided a workstream that would not have meaningfully improved the operator's experience. The pattern that made the pushback necessary (LLM-agent calibrated to a different bar than operator) is itself a recurring design lesson, now formalized as Rule 43.

The first real render produced operator-acceptable output. Production polish — music, text, transitions, brand assets, ingestion filters — is the actual gate to "first videos higher-ups want to see," not architecture rebuilds. Next chat picks up Polish Sprint as headline workstream.

---

*MVP_PROGRESS_18 written 2026-04-27. Session shipped W9, W9.1, first calibration. Almost shipped W11 architecture rebuild before strategic operator reframe collapsed it to W9.5 Critic calibration, which itself folded into Production Polish Sprint. Rule 43 promoted from observation to rule based on fifth occurrence of the same pattern. Next chat picks up Polish Sprint brief.*
