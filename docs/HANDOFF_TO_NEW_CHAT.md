# Handoff to next planning chat — 2026-04-27

**Last refreshed:** 2026-04-27 after W9 ship + W9.1 ship + first Phase 1 calibration run
**Status flip line:** **Phase 1 calibration ran on first real seed. Surfaced an operator-Critic calibration mismatch that almost became a Director architecture rebuild before strategic operator pushback collapsed it to a calibration sprint. Production Polish Sprint is the headline next workstream — six pillars including Critic calibration, music library, render template, brand assets, ingestion filters, transitions cleanup.**

---

## Read order for the next planning chat

1. **HANDOFF_TO_NEW_CHAT.md (this doc)** — current state, what's running, what's next, operator context
2. **MVP_PROGRESS_18.md** — historical record of the W11-collapse session + Rule 43 promotion
3. **W9_CALIBRATION_RUN_DIAGNOSTIC.md** — primary evidence document for Polish Sprint pillar 1 (Critic calibration)
4. **PROJECT_CONTEXT_PRIMER.md** — WHY the pipeline exists, organic content vs Betterme anti-reference, what creative success means
5. **CLAUDE.md** — rules, especially the new Rule 43
6. **Then skim PHASE_4_PART_B_PIPELINE.md, the W7/W8/W9 briefs (in `docs/briefs/`, gitignored locally), `followups.md`, and the workflow/schema/server docs as needed**

---

## What shipped this session (2026-04-27)

| Workstream | Status | Notes |
|---|---|---|
| W9 Shadow Rollout | ✅ shipped | 11 commits, merged 005f9cb, two-tier Gate A passed, three operator runbooks |
| W9.1 Cost Tracking | ✅ shipped | Single-gate, merged 940c75a, Q5d cost signal alive ($0.0 → $0.5635) |
| Post-W9 docs | ✅ shipped | ff863dc, three followups added, two resolved |
| Phase 1 calibration flip | ✅ live | nordpilates → part_b_shadow, PART_B_ROLLOUT_PERCENT=100 |
| First real-seed dual-run | ✅ ran | Job 6cd0a2cb, Phase 3.5 shipped to TikTok, Part B failed_after_revise_budget |
| Render-bridge diagnostic | ✅ done (read-only) | Bridge gap classified MEDIUM-leaning-LARGE; workstream deferred |
| W11 Director Architecture | 🚫 collapsed | Reframed as Critic calibration; folded into Polish Sprint pillar 1 |
| Rule 43 promotion | ✅ promoted | Strategic concerns surface design errors; 5th occurrence today |

---

## Pipeline status table

| Pipeline | Status | Brand | Notes |
|---|---|---|---|
| Phase 3.5 | Production | All 5 brands | Has shipped videos to socials since 2026-04-17 |
| Part B | Shadow | nordpilates only | PART_B_ROLLOUT_PERCENT=100, calibration window |
| Part B | Dormant | carnimeat, highdiet, ketoway, nodiet | brand_configs.pipeline_version='phase35' |
| Render bridge | Unbuilt | — | shadow_runs.context_packet_v2 cannot reach renderer |
| Voice generation (W10) | Parked | — | Blocked on first brand cutover |
| n8n shadow review S-workflow | Spec'd, unbuilt | — | Operator implements; raw Supabase queries usable for first ~10 jobs |

---

## Headline workstream for next chat: Production Polish Sprint

Six pillars surfaced from the first real render's quality observations. Single brief or sequence of small briefs — that's a structural decision the next chat makes during kickoff Q&A.

### Pillar 1 — Critic calibration

**Problem:** 4-of-4 real-seed Part B runs terminate `failed_after_revise_budget` on `subject_discontinuity`. Phase 3.5 produces cross-parent storyboards on the same library and ships them as operator-acceptable. Critic is over-strict relative to operator's actual quality criterion.

**Surface:** W6 Critic prompt — `subject_discontinuity` severity classification logic.

**Approach options:**
- Loosen severity from `high` to `medium` (surgical)
- Downgrade from `slot_level`-triggering to `info`-only (more aggressive)
- Make threshold stance-conditional on `subject_consistency`: strict for `single-subject`, looser for `prefer-same`, off for `mixed` (most precise but more work)

**Risk:** loosening too far = Critic stops catching real cross-parent quality regressions (e.g., outfits jarringly off-brand). Calibration target: operator-acceptable, not coder-clean.

**Estimated effort:** 2-3 days. Single-gate per Rule 42 (prompt iteration, no new code paths). Re-run a calibration seed at completion to confirm.

**Primary evidence:** `W9_CALIBRATION_RUN_DIAGNOSTIC.md`. Read this doc; it captures both the technical evidence and the reframed conclusion that bounds Pillar 1's scope.

### Pillar 2 — Music library expansion

**Problem:** Operator-named: "if we would have bigger music library." Current track selection feels limited; same fallback tracks recur. Today's job fell back to "Gigi Perez Sailor Song" through emotional → meditative cascade.

**Surface:** S7 ingestion workflow + `music_tracks` Supabase table + brand-allowed mood/energy combinations in `brand_configs`.

**Approach options:**
- Bulk ingest more music (operator-driven; agent provides ingestion harness if needed)
- Widen brand-allowed moods/energies (config-only)
- Both

**Estimated effort:** ingestion of N tracks is operator-bound, not agent-bound. Agent work is at most ~half-day on harness improvements if the existing S7 flow has friction.

### Pillar 3 — Render template text placement

**Problem:** Operator-named: "better text in terms of text placement." Overlay positioning in render template doesn't sit cleanly against visual content in some compositions.

**Surface:** Remotion composition + caption_preset config in `brand_configs`.

**Approach options:**
- Tune Remotion composition globally (e.g., dynamic text-region detection)
- Per-form text-placement rules (more deterministic, more config)
- Both

**Estimated effort:** 2-3 days for global tuning + per-form rules; visual judgment-heavy work, expect iteration.

### Pillar 4 — Brand assets (logo wiring)

**Problem:** Operator-named: "actual real logo used." `nordpilates.json` has `logo_r2_key` populated but operator reports no logo on shipped video.

**Surface:** Render template (Remotion composition's watermark logic) + brand_config wiring path.

**Approach:**
1. Investigate: is `logo_r2_key` being read by the render path? If yes, why no visible output? If no, where's the gap in the wire?
2. Fix: likely small (one-line read fix or watermark default change)
3. Verify: render a test job, confirm logo appears

**Estimated effort:** 0.5-1 day. Could be very small if the bug is straightforward.

### Pillar 5 — Ingestion filter for body composition

**Problem:** Operator-named: "never use overweight people in our videos." No ingestion-level filter; off-brand body composition passes through.

**Surface:** S7 ingestion workflow + asset_segments analysis at ingest time.

**Approach options:**
- AI vision classifier at ingest (Gemini analyze step extended)
- Manual moderation step in S7 (operator gate before publish)
- Hybrid (AI flags, operator confirms)

**Risk:** body-composition classification is ethically loaded; flagging needs explicit operator-controlled per-brand thresholds, not implicit AI judgment. Frame as "off-brand fit" not as a body-shape value judgment in the prompt.

**Estimated effort:** 2-3 days for AI vision filter + 1 day for moderation step UI. May require more if classifier accuracy needs iteration.

### Pillar 6 — Transitions library cleanup

**Problem:** Operator-named: "current transition library is bad. we need simple clean cuts or simple transitions no long ones with animations they dotn fit here."

**Surface:** Transition definitions in render template / Remotion composition.

**Approach:**
- Default to cut on every transition unless explicitly overridden
- Prune long-animation transitions from the available set
- Restrict animations to specific form/posture combinations only (e.g., aesthetic_montage may permit subtle slow fade; targeted_microtutorial defaults to cut)

**Estimated effort:** 0.5-1 day. Mostly config + minor template logic.

---

## Decisions the next chat needs to make at kickoff

1. **Sprint structure.** Single brief covering all 6 pillars vs sequence of small briefs per pillar. My lean: single brief. Pillars are tightly related and one Gate A render-test exercises multiple pillars cheaply. Trade-off: bigger brief is harder to keep focused.

2. **Pillar order.** Critic calibration is pillar 1 because it unblocks Part B's escalation rate. Logo and transitions are quick wins. Music library has operator-side blocking. Body-composition filter is most ethically and technically delicate. Suggested order: Critic → Logo → Transitions → Music → Render text → Body filter.

3. **Stance-conditional Critic threshold or uniform loosening?** Pillar 1's biggest open call. Per-stance is more precise but is more prompt complexity. Uniform is simpler but may over-correct.

4. **Body filter implementation approach.** Frame as "off-brand fit" classifier or skip Pillar 6 to a later sprint? Operator's bar is real but the implementation is delicate.

5. **Demo render bridge timing.** After Polish Sprint? Or one more single-gate iteration before? My lean: after. Polish Sprint output is what makes a demo worth showing; bridging shadow_runs to render before that = demoing flawed output.

6. **Sequencing of W10 voice generation.** Still parked behind cutover. Polish Sprint doesn't change this.

---

## Production state at session close

### What's running

- **Phase 3.5:** production pipeline. All 5 brands. Unaffected by Part B.
- **Part B:** shadow on nordpilates (PART_B_ROLLOUT_PERCENT=100); dormant on 4 brands.
- **Cost tracking:** alive end-to-end.
- **Memory:** idle ~196MB cold / ~210MB warm; dual-run peak ~574MB; render peak ~1.6G.

### Shadow_runs rows in flight

| ID | Source | Terminal state |
|---|---|---|
| cb87d32c | W9 Q8c synthetic seed | failed_after_revise_budget (calibration marker — preserve) |
| ff67fc55 | W9.1 Gate A forced-structural | failed_after_revise_budget |
| cf104600 | W9 Phase 1 first real seed (today) | failed_after_revise_budget |

### Anthropic API limit

- Hit during today's calibration; raised by operator
- No production impact (demo seed completed before throttle bit)
- Watch item: dual-run mode roughly doubles Claude consumption per nordpilates job
- Logged as `claude-api-limit-watchitem`

### Git state at session close

- main: ff863dc (post-W9 followups commit) + 940c75a (W9.1 merge) + 7e59020 (W9 docs touch)
- VPS: synchronized with main, service active, idle
- Open branches: none
- Open followups: see followups.md, 13+ active entries

---

## Operator context — Domis (don't skip this)

### Stack fluency
- n8n, Supabase, Hetzner, Google Sheets, AI pipelines all native
- Lithuanian, Vilnius timezone
- Direct communicator; spelling can be loose ("vidoe", "geenrate") — parse for intent

### Communication signals (operator pattern observed across sessions 17-18)

- **"seems alright, continue"** = full approval, ship
- **"I don't care"** = stop optimizing, move on
- **"explain simpler"** = reset on jargon
- **Strategic pushback during tactical work** = pause, reframe, do not defend (Rule 43)
- **"success looks different to me than to you"** = the most powerful version of strategic pushback — operator is naming a frame disagreement, not a tactical objection
- **Short replies to multi-question Q&A** = decisions made, trust earned, proceed
- **"maybe we should have chosen X then?"** = strategic pushback asking for re-evaluation, not a tactical objection

### Frustrations
- Commands that don't work
- Re-litigating decisions; if it's in the docs, trust the docs
- Hedging language
- Tactical dismissal of strategic concerns

### Rewards
- Fast iteration, decisive moves
- Agents handling git autonomously
- Architectural thinking — tracing problems upstream to where the creative decision lives
- Plain-language explanations when jargon compounds

### What today taught about the pattern

Today's session is the textbook Rule 43 case study. Planning chat (me) was 30 minutes from briefing W11 Director Architecture Rebuild based on diagnostically-supported evidence. Operator pushed back with a single observation about the rendered Phase 3.5 video being "pretty good" plus the line "success looks different to me than to you." The architectural conclusion collapsed; W11 became Critic calibration in 5 minutes; that became Polish Sprint in another 5 minutes.

**The pattern:** when operator raises a strategic-shaped doubt during execution-phase work, treat it as an architectural signal. The reframe always points at a design error upstream of where the symptom showed. Tactical defense of the original conclusion is wrong every time so far (5/5).

---

## Active followups summary (full list in followups.md)

### Load-bearing for Polish Sprint
- `w8-slot-level-revise-thrashing-without-convergence` — 4 sightings; reframed as Critic calibration; Pillar 1
- `w9-q8c-structural-classification-not-exercised` — Critic emits `slot_level` even when prose identifies structural issues; Pillar 1
- `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` — 4-of-4 real seeds; reframed as Critic threshold; Pillar 1
- `w9-music-library-needs-expansion` — Pillar 2
- `w9-render-text-placement-suboptimal` — Pillar 3
- `w9-brand-logo-not-rendering` — Pillar 4
- `w9-ingestion-needs-body-composition-filter` — Pillar 5
- `w9-transitions-library-too-animated` — Pillar 6
- `w9-color-grade-needs-per-posture-presets` — possibly Pillar 3 sub-scope, or its own pillar

### Watch items
- `claude-api-limit-watchitem` — revisit if Anthropic 429s under sustained dual-run load
- `w9-demo-render-bridge-deferred-behind-polish-sprint` — render bridge workstream paused; revisit after Polish Sprint
- `w9-cutover-sample-threshold-tuning` — 30-comparison minimum is initial estimate
- `w9-feels-organic-veto-threshold-calibration` — 80% threshold is initial estimate
- `w9-cost-aggregate-threshold-tuning` — $5/day alert is initial estimate
- `w9-dual-run-to-part-b-only-implementation` — workflow-only seam; may need code if first-brand experience requires

---

## What the next chat should NOT do

- Re-derive the W11 architecture decision. It collapsed for a reason; the reasoning is preserved in W9_CALIBRATION_RUN_DIAGNOSTIC.md and MVP_PROGRESS_18. Defer Director architecture as future-conditional only if Polish Sprint output reveals genuine quality regression.
- Start with a Q-and-A about whether to do Polish Sprint at all. The decision is locked. Q&A is on structure (single brief vs sequence), pillar ordering, Pillar 1's calibration approach, Pillar 5's implementation approach, Pillar 6 inclusion or deferral.
- Re-litigate Critic's role. Critic stays. The question is calibration, not removal.
- Skip Pillar 4 (logo) as "too small to brief." Logo not rendering is a visible defect on every shipped video; fix.
- Try to bundle render-bridge work into Polish Sprint scope. Render bridge is its own workstream after Polish Sprint stabilizes the things that make videos worth watching.

---

## What the next chat SHOULD do

- Read this handoff. Then MVP_PROGRESS_18 for case study. Then W9_CALIBRATION_RUN_DIAGNOSTIC for primary evidence. Then PROJECT_CONTEXT_PRIMER for the organic-content frame.
- Verify state with the agent: confirm git state, Supabase row counts, brand_configs.pipeline_version values, env var values on VPS.
- Draft Polish Sprint kickoff Q&A — ~10-12 questions covering pillar order, Pillar 1 approach, body-composition framing, single-brief vs sequence, demo render bridge timing.
- Honor Rule 43 in execution. If a strategic-shaped doubt surfaces during Polish Sprint drafting, reframe and re-evaluate. Don't defend.

---

*HANDOFF rewritten 2026-04-27 after the W11-collapse session. Polish Sprint is the next workstream. Six pillars, single-brief preferred. Critic calibration is pillar 1 and the most load-bearing. Operator velocity respected: small kickoff Q&A, focused brief, fast iteration.*
