# W9 Calibration Run Diagnostic — preservation document

**Date written:** 2026-04-27
**Source:** Phase 1 calibration first real-seed run, job `6cd0a2cb-ff8c-4279-8d98-5edc45550276`, shadow_runs row `cf104600-5a05-436a-932e-a2473a50dc4a`
**Purpose:** Preserve the technical evidence + the reframed conclusions from today's calibration run. The agent diagnostic that produced this evidence concluded "Director architecture must change"; operator pushback reframed the conclusion as "Critic calibration is over-strict." Both readings of the evidence are documented here so the next chat has the full picture.

---

## Why this document exists

Today's calibration run produced the most detailed evidence yet of the slot-level revise-thrashing pattern (now four sightings: W6 Gate A, W8 Tier 2 Seed B, W9.1 Gate A, W9 Phase 1 calibration). The evidence was technically clean and pointed at a Director architecture issue — the agent diagnostic concluded as much, the planning chat scoped a W11 workstream around the conclusion, and that workstream was 30 minutes from being briefed.

Then operator pushback flipped the framing: the rendered Phase 3.5 video for the same job (which also went cross-parent) was "pretty good in terms of logic." The bar that Critic was enforcing wasn't the operator's success criterion. Rule 43 in action: strategic concern in tactical work surfaces a design error.

This document preserves both the evidence and the reframed reading so the next chat doesn't relitigate the question. Technical evidence stays as-is; conclusions reflect the post-reframe consensus.

---

## Run summary

**Idea seed:** "3 small things that make pilates click"
**Brand:** nordpilates
**Job ID:** 6cd0a2cb-ff8c-4279-8d98-5edc45550276
**Shadow runs ID:** cf104600-5a05-436a-932e-a2473a50dc4a
**Start:** 2026-04-27 08:08:00 UTC
**End:** 2026-04-27 08:15:59 UTC
**Wall time:** 478.6s (~8 minutes)
**Total agent invocations:** 11
**Cost:** $0.5611
**Terminal state:** `failed_after_revise_budget`
**Revise loop iterations:** 2 (max budget exhausted)

---

## Planner output

| Field | Value |
|---|---|
| `form_id` | `targeted_microtutorial` |
| `posture` | P1 |
| `hook_mechanism` | confessional-vulnerability |
| `subject_consistency` | single-subject |
| `slot_count` | 5 |
| `music_intent` | warm-acoustic |
| `creative_vision` | "Warm, single-subject sequence sharing three gentle form shifts to deepen a home practice, framed with personal vulnerability." |

All 5 slots committed to `subject_role: primary` (hook → 3× body → close).

**Observation:** Planner committed `single-subject` against a library where the most-represented parent for the chosen body region had insufficient segments to fill 5 slots. This is the structural setup for the failure that follows. Whether Planner's commitment is operator-required is the question Rule 43 ended up surfacing.

---

## Director picks

Final picks (after 2 revise cycles):

| Slot | Parent | Segment | Duration | Similarity |
|------|--------|---------|----------|------------|
| 1 | 77d40448 | 3d0dc237 | 3.0s | 0.390 |
| 2 | f9f63f61 | 6a66b9f7 | 6.0s | 0.598 |
| 3 | ccf94180 | dcd979b3 | 6.0s | 0.616 |
| 4 | 57c46b4a | f7c11a23 | 6.0s | 0.584 |
| 5 | 52d88710 | bfa32b6b | 4.0s | 0.402 |

Five different parent assets. Zero `same_parent_as_primary=true` on body/close slots.

### Director cycle trajectory

- **Initial pick:** 77d40448, f9f63f61, 6d6cb705, 57c46b4a, 52d88710
- **Cycle 1 retry (all 5 slots flagged):** 77d40448, f9f63f61, 6d6cb705, 57c46b4a, 52d88710 — **identical to initial**
- **Cycle 2 retry (all 5 slots flagged):** 77d40448, f9f63f61, ccf94180, 57c46b4a, 52d88710 — only slot 3 changed; still 5 different parents

The Director's picks are deterministic given the candidate pool. Re-running with the same constraints produces near-identical output. The "thrashing" is actually over-determinism without a global constraint.

### Diagnostic warning emitted

`[visual-director] cross-parent primary pick: prior=X now=Y` warnings fire on every slot >1 in every cycle (4 warnings/cycle × 3 cycles = 12 total). The system already emits a diagnostic signal for this pattern. Not a new error path.

---

## Critic verdicts

**Cycle 1 verdict (08:11:23):** revise, scope=`slot_level`, slots [1,2,3,4,5]
- Issue: subject_discontinuity (severity high)
- Prose: "5 different parents for a single-subject plan...posture drift in slot 4..."

**Cycle 2 verdict (08:13:44):** revise, scope=`slot_level`, slots [1,2,3,4,5]
- Issue: subject_discontinuity (severity high)
- Prose: "...completely fails the single-subject constraint, picking a different parent for every single slot. The Director prioritized aesthetic clip competence over subject identity..."

**Final state:** budget exhausted → `failed_after_revise_budget`.

---

## Comparison vs prior sightings

### vs ff67fc55 (W9.1 Gate A)

Structurally identical along every load-bearing axis:

| Axis | ff67fc55 | cf104600 |
|------|----------|----------|
| Posture | P1 | P1 |
| Slot count | 5 | 5 |
| Subject consistency | single-subject | single-subject |
| Distinct parents picked | 5 / 5 | 5 / 5 |
| Revise iterations | 2 (max) | 2 (max) |
| Total agent invocations | 11 | 11 |
| Final Critic top issue | subject_discontinuity (high) | subject_discontinuity (high) |
| Critic verdict | revise slot_level | revise slot_level |
| Failed via | revise budget exhausted | revise budget exhausted |
| Wall / cost | 447s / $0.5635 | 478s / $0.5611 |

Diverges only on:
- Form: `aesthetic_ambient` vs `targeted_microtutorial` (different commits, same outcome)
- Hook mechanism: `visual-pattern-interrupt` vs `confessional-vulnerability`
- ff67fc55 had 3 final issues (subject_discontinuity + hook_weak + posture_drift); cf104600 had 1 (Critic narrowed to the load-bearing one)

### vs W6 Gate A and W8 Tier 2 Seed B

Pattern stable: single-subject Planner commitment + 5/5 distinct parents from Director + Critic flags subject_discontinuity + revise budget exhausts. Stable across forms, hooks, and seeds.

**Sighting count: 4. Pattern is the steady-state behavior of the current pipeline against the current library.**

---

## The two readings of this evidence

### Reading 1 (the agent diagnostic concluded this; the planning chat scoped W11 around it)

**Conclusion:** Director's per-slot parallel picks cannot honor cross-slot continuity constraints. Each slot is invoked independently via `Promise.all`, with no shared state. When Planner commits `single-subject` and the most-represented parent has fewer than `slot_count` segments, the constraint is unfulfillable. Critic correctly flags the violation. Revise instructions don't help because the Director's per-slot picks are deterministic against the same candidate pool.

**Implied workstream:** W11 — Director Architecture Rebuild. Two viable shapes:
- Sequential picks anchored on slot 0's parent
- Parent-locking at retrieval (W4 returns candidates pre-filtered to one parent when stance is single-subject)

Estimated 5-7 days, two-gate brief.

### Reading 2 (the operator-reframed reading; this is the locked-in conclusion)

**Conclusion:** Critic's `subject_discontinuity` threshold is calibrated to a stricter bar than the operator's actual quality criterion. Phase 3.5 produces cross-parent storyboards on the same library and ships them weekly without operator complaints. The Phase 3.5 video for this exact job (operator viewed) was "pretty good in terms of logic" despite cross-parent picks. The output isn't broken; the gate is over-strict.

The error chain Reading 1 fell into was: trust the Planner's `single-subject` commitment as load-bearing → diagnose how Director violates it → conclude Director must change. The skipped question was: *is the constraint operator-required?* It isn't.

**Implied workstream:** Critic calibration — loosen `subject_discontinuity` severity from 'high' to 'medium', or downgrade from `slot_level`-triggering to `info`-only. Two days of prompt iteration, single-gate per Rule 42.

This iteration folds into the broader Production Polish Sprint as one of six pillars.

---

## Why Reading 2 is correct

1. **Phase 3.5 reductio.** Phase 3.5's curator picks cross-parent on the same library. Operator confirmed visually. Phase 3.5 ships these videos weekly without operator complaints. If single-subject continuity were a load-bearing operator quality property, Phase 3.5's output would already be unacceptable. It isn't.

2. **The operator's pain points name infrastructure, not creative judgment.** Music library, text placement, visual look, brand logo, body composition, transitions — all rendering / asset / ingestion concerns. None of them are "videos cut between people inconsistently." Subject continuity isn't on the operator's list.

3. **Rule 43 frame:** strategic-shaped doubt during execution-phase work indicates a design error, not a tactical objection. Operator's pushback ("the video wasn't bad" + "success looks different to me than to you") is exactly the shape Rule 43 covers. Tactical defense of Reading 1 would be the wrong move per the pattern.

4. **Cheaper fix wins when both fixes shape downstream the same.** If Critic calibration loosens and the cross-parent Part B output starts shipping at operator-acceptable quality, the Director architecture rebuild becomes optional. Cheaper fix first; revisit only if the looser threshold reveals an actual quality regression in production.

---

## What this document does NOT mean

This is not a closed-and-resolved diagnostic in the sense that "Critic prompt is wrong, fix prompt, ship." Several things remain genuinely open:

1. **Severity vs reclassification call.** Loosening severity from high to medium is the surgical option. Reclassifying subject_discontinuity from `slot_level`-triggering to `info`-only is the more aggressive option. Polish Sprint brief decides which.

2. **Threshold calibration cost.** "Operator-acceptable cross-parent" is not a code-able threshold; it's an operator-judgment property that needs to be encoded as Critic prompt. Calibration risk: if loosened too far, Critic stops catching genuinely bad cross-parent outputs (e.g., outfits that are jarringly off-brand). Need the next chat to think about how to draw the line.

3. **Per-stance threshold differentiation.** `subject_consistency` has three values: `single-subject`, `prefer-same`, `mixed`. Loosening the threshold uniformly is one option; making it stance-conditional is another. Polish Sprint scope.

4. **Whether the operator-acceptability bar holds at scale.** One render's worth of "the video wasn't bad" is not a complete dataset. Phase 1 calibration steady-state will produce more samples; if loosened-Critic Part B output starts feeling drifty, revisit.

5. **The Director architecture isn't proven to be fine.** It's just not the binding constraint right now. If Polish Sprint loosens Critic and Part B output still feels off in some persistent way, the architecture rebuild may resurface as a real workstream. Reading 1's diagnostic stays on file as evidence for that future case.

---

## Field-level evidence (preserved for future reference)

### Shadow_runs row content (relevant fields)

```sql
SELECT
  id,
  job_id,
  part_b_terminal_state,
  part_b_failure_reason,
  revise_loop_iterations,
  total_agent_invocations,
  part_b_cost_usd,
  part_b_wall_time_ms,
  planner_output->'form_id' AS form_id,
  planner_output->'hook_mechanism' AS hook_mechanism,
  planner_output->'subject_consistency' AS subject_consistency,
  planner_output->'posture' AS posture,
  storyboard_picks,
  critic_verdict
FROM shadow_runs
WHERE id = 'cf104600-5a05-436a-932e-a2473a50dc4a';
```

Returns:
- `part_b_terminal_state`: `failed_after_revise_budget`
- `revise_loop_iterations`: 2
- `total_agent_invocations`: 11
- `part_b_cost_usd`: $0.5611
- `part_b_wall_time_ms`: 478,610
- `planner_output.form_id`: `targeted_microtutorial`
- `planner_output.hook_mechanism`: `confessional-vulnerability`
- `planner_output.subject_consistency`: `single-subject`
- `planner_output.posture`: P1
- `storyboard_picks.slots`: 5 picks across 5 different parent assets

### Job_events trajectory

```sql
SELECT to_status, payload, created_at
FROM job_events
WHERE job_id = '6cd0a2cb-ff8c-4279-8d98-5edc45550276'
  AND to_status LIKE 'partb_%'
ORDER BY created_at ASC;
```

Sequence:
- 08:08:01 partb_planning_started
- 08:08:27 partb_planning_completed
- 08:08:27 partb_retrieval_started
- 08:08:28 partb_retrieval_completed
- 08:08:28 partb_director_started
- ...director phase ~30s
- ~08:09:00 partb_director_completed (initial)
- partb_snapshot_building_*
- partb_parallel_fanout_started
- partb_critic_started
- partb_critic_completed (verdict: revise slot_level)
- 08:11:23 partb_revise_slots (cycle 1)
- ...director re-pick on flagged slots
- partb_critic_started (cycle 1 review)
- partb_critic_completed (verdict: revise slot_level)
- 08:13:44 partb_revise_slots (cycle 2)
- ...director re-pick on flagged slots
- partb_critic_started (cycle 2 review)
- partb_critic_completed (verdict: revise slot_level)
- 08:15:59 partb_pipeline_terminal (failed_after_revise_budget)

---

## Companion: render-bridge diagnostic

Today's session also produced a separate read-only diagnostic on the render-bridge gap, preserved at `docs/diagnostics/w9-2-render-bridge-state-20260427.md`. Summary: `prepareContextForRender` is a null-safety stub, not a translator; render worker reads `jobs.context_packet` exclusively (never shadow_runs); Remotion composition is hardwired to Phase 3.5 CopyPackage shape; multiple required fields missing from context_packet_v2.

That diagnostic stays factual; it correctly characterizes a real gap that needs a real workstream when demo time arrives.

---

*W9 Calibration Run Diagnostic written 2026-04-27 immediately after the W11-collapse. Preserves both the technical evidence and the reframed reading. Pattern stable at 4 sightings; reframed conclusion locks Critic calibration as Polish Sprint pillar 1, defers Director architecture as future-conditional workstream.*
