# Polish Sprint — Pillar 1.3 Planner subject_consistency Audit

**Date:** 2026-04-28
**Workstream:** Polish Sprint Pillar 1.3
**Sample:** all 3 nordpilates `shadow_runs` rows pre-dating Pillar 1
**Branch:** `feat/polish-sprint-pillar-1-critic-calibration`

---

## Purpose

Confirm whether Planner is over-committing to `subject_consistency: single-subject` on idea seeds that don't clearly require it. Read-only diagnostic per brief Section 1.3. Output is a written analysis with per-row agent-factual columns and an operator-judgment column held open for Domis.

The audit is **not a Pillar 1 blocker**. If 2+ rows are flagged as over-commit on ambiguous seeds, file followup `pillar1-planner-overcommits-subject-consistency`. Followup decision is deferred to operator review (see "Followup decision" section).

---

## Caveats — read these first

1. **n=3 is small.** Three shadow_runs rows is not enough to draw a steady-state pattern. The audit's value at this stage is establishing the diagnostic surface, not catching anything definitive.

2. **All three rows are pre-Pillar-1.** They were emitted under the W6.5 Critic prompt, before the charter rewrite (commit `b4d6b9c`). Any correlation between Planner stance and Critic verdict in the rows below reflects pre-charter Critic behavior. Post-Pillar-1 seeds (the four to be run in Pillar 1.4 c5) will be the first stance + Planner data under the charter-rewritten Critic. Do not read the patterns below as steady-state.

3. **Operator-judgment column is held open.** Brief asks "would operator have wanted single-subject for this seed?" That is a Domis call, not an agent call. The agent populates the seed + Planner-commitment + agent-factual reading columns; the operator-judgment column carries `[Domis review]` per row and is filled at Tier 1 Gate A or earlier.

4. **All three Planner commitments are `single-subject`.** Sample is monochromatic on the dimension being audited. This audit cannot detect under-commitment patterns from this sample; it can only detect potential over-commitment.

---

## Method

```sql
SELECT
  s.id,
  s.created_at,
  s.planner_output->>'form_id'             AS form_id,
  s.planner_output->>'subject_consistency' AS subject_consistency,
  s.planner_output->>'hook_mechanism'      AS hook_mechanism,
  s.planner_output->>'creative_vision'     AS creative_vision,
  s.part_b_terminal_state,
  s.revise_loop_iterations,
  j.idea_seed,
  j.brand_id
FROM shadow_runs s
JOIN jobs j ON j.id = s.job_id
WHERE j.brand_id = 'nordpilates'
ORDER BY s.created_at ASC;
```

Pulled 2026-04-28 via service-role client; 3 rows returned.

---

## Per-row analysis

### Row 1 — `cb87d32c` (W9.1 Gate A forced-structural seed)

| Column | Value |
|---|---|
| created_at | 2026-04-26T13:49 UTC |
| idea_seed | "30-second fire hydrant deep dive — show progression from beginner setup to glute burn" |
| form_id | `single_exercise_deep_dive` |
| hook_mechanism | `visual-pattern-interrupt` |
| Planner committed `subject_consistency` | `single-subject` |
| posture | P5 |
| slot_count | 4 |
| Critic terminal_state | `failed_after_revise_budget` |
| revise_iters | 2 |

**Agent-factual reading of the seed framing.**
- "deep dive" + "progression from beginner setup to glute burn" reads as a guided exercise demonstration — typically a single demonstrator across the progression
- Form chosen by Planner (`single_exercise_deep_dive`) is itself shaped around one exercise, which usually pairs with one practitioner showing the progression
- No first-person possessive ("my", "I") and no compilation cues ("different", "various", "everyone")
- Provenance note: this seed was the W9.1 Gate A forced-structural test seed (job had `pipeline_override='force'` until Polish Sprint pre-work cleared it 2026-04-28). It was crafted to exercise the structural revise path on a single-exercise library where the same-exercise-name pool is thin

**Operator judgment ("would operator have wanted single-subject?"):** `[Domis review]`

---

### Row 2 — `ff67fc55`

| Column | Value |
|---|---|
| created_at | 2026-04-26T19:09 UTC |
| idea_seed | "slow sunday stretching with the windows open" |
| form_id | `aesthetic_ambient` |
| hook_mechanism | `visual-pattern-interrupt` |
| Planner committed `subject_consistency` | `single-subject` |
| posture | P1 |
| slot_count | 5 |
| Critic terminal_state | `failed_after_revise_budget` |
| revise_iters | 2 |

**Agent-factual reading of the seed framing.**
- "sunday stretching" + "windows open" reads as a specific domestic moment, leaning toward one person in one place
- No first-person possessive, but the singular-domestic framing is more first-person-adjacent than compilation-adjacent
- Form chosen (`aesthetic_ambient`) is content-agnostic on subject — aesthetic compilations across multiple subjects also qualify as `aesthetic_ambient`. The form does not by itself imply single-subject
- The seed contains no explicit signal toward multi-subject (no "different", "various", "everyone", "trends", "you can")
- Plausibly readable both ways: single-subject (one person stretching by their windows) OR mixed (a compiled aesthetic of several Sunday-morning practitioners). The Planner picked single-subject

**Operator judgment ("would operator have wanted single-subject?"):** `[Domis review]`

---

### Row 3 — `cf104600` (W9 Phase 1 calibration first real-seed run; the run that triggered the Polish Sprint reframe)

| Column | Value |
|---|---|
| created_at | 2026-04-27T08:16 UTC |
| idea_seed | "3 small things that make pilates click" |
| form_id | `targeted_microtutorial` |
| hook_mechanism | `confessional-vulnerability` |
| Planner committed `subject_consistency` | `single-subject` |
| posture | P1 |
| slot_count | 5 |
| Critic terminal_state | `failed_after_revise_budget` |
| revise_iters | 2 |

**Agent-factual reading of the seed framing.**
- "3 small things that make pilates click" — the "things" framing reads enumerative; could be one teacher's 3 cues (single-subject) OR 3 different practitioners' insights (mixed). Both are linguistically natural
- `confessional-vulnerability` hook mechanism leans toward a single first-person voice ("here's what I learned"), which pulls toward single-subject
- `targeted_microtutorial` form is content-agnostic on subject continuity — form taxonomy doesn't mandate single-subject for microtutorials
- Documentary precedent: `docs/diagnostics/W9_CALIBRATION_RUN_DIAGNOSTIC.md` records that operator viewed the Phase 3.5 cross-parent rendering of THIS exact seed and judged it "pretty good in terms of logic." That rendering (which the operator accepted) had cross-parent picks. This observation is operator data, not agent inference, and it is the load-bearing signal that prompted the Polish Sprint Pillar 1 reframe in the first place
- The seed text alone is plausibly readable both ways. The hook mechanism nudges toward single-subject. The operator's acceptance of cross-parent rendering on this seed nudges away from single-subject as a load-bearing constraint

**Operator judgment ("would operator have wanted single-subject?"):** `[Domis review]`

---

## Summary table

| shadow_run.id | seed | form_id | Planner committed | Operator judgment |
|---|---|---|---|---|
| cb87d32c | "30-second fire hydrant deep dive…" | single_exercise_deep_dive | single-subject | `[Domis review]` |
| ff67fc55 | "slow sunday stretching with the windows open" | aesthetic_ambient | single-subject | `[Domis review]` |
| cf104600 | "3 small things that make pilates click" | targeted_microtutorial | single-subject | `[Domis review]` |

---

## Patterns the agent CAN see (non-operator-judgment observations)

1. **Planner committed `single-subject` on all three pre-Pillar-1 seeds.** No row used `prefer-same` or `mixed`. This is consistent with Planner's W6.5 prompt language (single-subject when first-person possessive / named-routine / authority framing; mixed for trend / community / compilation cues), but it also means the sample provides no evidence about how Planner behaves on seeds with explicit multi-subject cues.
2. **All three runs terminated `failed_after_revise_budget` with revise_iters=2.** That is the 4-sighting pattern documented in `W9_CALIBRATION_RUN_DIAGNOSTIC.md`. The audit reproduces it as a third sighting; the fourth is the W6 Gate A run, which is not in `shadow_runs` (predates W8 schema).
3. **Form_id varied across the three rows.** `single_exercise_deep_dive`, `aesthetic_ambient`, `targeted_microtutorial`. The cross-parent revise-thrash pattern is form-independent — it is a stance × library-thinness pattern, not a form pattern.
4. **The seed-framing-vs-Planner-commitment relationship is what the audit is set up to surface.** With operator-judgment column open, the agent cannot complete that loop; the relationship will be readable once Domis fills the column.

---

## Followup decision

**Filed:** No (deferred).

**Reasoning:** The brief's followup threshold is "2+ rows show Planner over-committing on ambiguous seeds." Whether a seed counts as "ambiguous" is operator judgment per the c3 brief, not agent inference. With operator-judgment column open across all three rows, the threshold cannot be evaluated by the agent.

**When to revisit:** Domis populates the operator-judgment column at Tier 1 Gate A or earlier. If two or more rows are operator-judged "would not have wanted single-subject" while Planner committed single-subject anyway, file followup `pillar1-planner-overcommits-subject-consistency` at that point. If zero or one rows are flagged, the audit's evidence is "Planner did not over-commit on this sample" — note in the followups index but no separate active entry needed.

**Future expansion:** the audit re-applies to any future shadow_runs naturally. The four Pillar 1.4 calibration seeds (Pillar 1 c5) will produce four new rows, three of which will be on `prefer-same` or `mixed` per design. Re-run this query post-c5 to extend the table; the new rows will provide the first under-commitment signals (i.e., did Planner respect the multi-subject framing of the seeds we deliberately shaped to lean that way).

---

## Closing — operator review pending

This audit's agent-populated columns are factual reads of the seed text and the Planner output as recorded. The operator-judgment column ("would operator have wanted single-subject?") is intentionally held open per Domis's c3 instructions. The agent does not pre-fill operator judgment, including the followup-filing decision that depends on it.

Domis fills the operator-judgment column at Tier 1 Gate A or earlier, then the followup decision flows from that.
