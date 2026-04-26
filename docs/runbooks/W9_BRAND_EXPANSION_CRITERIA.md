# W9 Brand Expansion Criteria

**Audience:** Domis (operator). Future agent sessions.
**Purpose:** Lock the criteria for selecting the second brand to flip
from `phase35` → `part_b_shadow` after nordpilates cutover.
**Authoritative source:** `docs/briefs/W9_SHADOW_ROLLOUT_BRIEF.md`
§ "Brand-expansion criteria (Q11b)".

---

## Why this document exists separately

Premature commitment to "the next brand" without first-brand data is
guesswork. This document captures the **criteria** so the decision can be
made cleanly post-cutover, with evidence in hand.

**This document explicitly does NOT name a brand.** The five-brand
portfolio (carnimeat, highdiet, ketoway, nodiet, nordpilates) yields four
candidates after nordpilates cutover. Pick is operator judgment + signal
review, not a static ranking.

---

## When this gate opens

Brand expansion is permitted **only** after both:

1. Nordpilates `pipeline_version='part_b_primary'` for **≥1 week**.
2. No active Class 1, Class 2, or Class 3 trigger (see
   `W9_SHADOW_OPERATIONS.md` § "Pause / rollback triggers") on
   nordpilates during that week.

If either condition is missing, brand expansion is paused. Candidate
analysis below can still be done in advance, but the flip waits.

---

## Eligibility criteria (all four required)

A candidate brand is eligible to flip to `part_b_shadow` only if it
satisfies **all** of the following:

### 1. Library readiness — ≥800 segments at v2 coverage

Part B's Visual Director needs a library deep enough to support form
commitments without structural under-fill. The 800-segment floor is
calibrated against nordpilates' shadow stability — below this, the
structural-revise rate spikes regardless of Critic teaching.

```sql
SELECT COUNT(*) AS v2_segments
  FROM asset_segments
 WHERE brand_id = '<candidate>'
   AND segment_v2 IS NOT NULL;
```

Required: `v2_segments >= 800`.

If under: schedule a content / re-segmentation sprint for that brand
before reconsidering.

### 2. Persona / form coverage — ≥3 shared forms with nordpilates

The Planner prompt patterns and brand-persona-driven posture restrictions
that worked for nordpilates need to transfer. If a candidate's
`form_posture_allowlist` shares fewer than 3 forms with nordpilates, you
are restarting prompt-tuning, not expanding.

Inspect the candidate's persona file at `docs/brand-personas/<brand>.md`
and compare the form/posture allowlist sections against
`docs/brand-personas/nordpilates.md`.

Required: at least 3 form_id values in common.

If under: that brand's form mix is genuinely different — not a W9
expansion target. Schedule a separate persona-specific Planner-tuning
workstream first.

### 3. Production volume — lowest weekly job count among eligible candidates

Lowest-stakes first. Among brands satisfying (1) and (2), pick the one
with the lowest current weekly job count. Rationale: if the second-brand
flip surfaces a problem, the smallest brand has the smallest blast radius.

```sql
SELECT brand_id, COUNT(*) AS jobs_last_4w
  FROM jobs
 WHERE created_at >= NOW() - INTERVAL '28 days'
 GROUP BY brand_id ORDER BY jobs_last_4w ASC;
```

Required: tie-breaker against any brands tied at lowest is operator
judgment (e.g., persona maturity, content sprint recency).

### 4. Persona prose readiness — Project Context Primer's organic-content invariant explicitly captured

`docs/brand-personas/<brand>.md` must exist AND must include the organic-
content invariant inline (the "If a video could pass as a Betterme paid
ad, it fails" framing). This is what feeds the W2-W7 agents' persona
context; without it, Part B has no brand-specific anti-reference to
calibrate against and silent drift is the predicted failure mode.

Required: persona file present + organic-content invariant clause
present.

If under: persona prose work is **pre-work** for the brand flip, not a
W9 deliverable. Schedule a persona-write sprint (referenceable from
`docs/brand-personas/_template.md` + `docs/brand-personas/nordpilates.md`).

---

## Decision flow

1. **Confirm gate is open** (nordpilates ≥1 week stable on primary, no
   active triggers).
2. **Run the four queries / file checks** for each of the four candidate
   brands. Mark each (1)/(2)/(3)/(4) PASS or FAIL.
3. **Filter to candidates passing all four.** If none pass: schedule the
   missing pre-work; do not flip anyone.
4. **Among passing candidates, pick the lowest weekly volume** (criterion
   3). On a tie, operator judgment.
5. **Document the decision** in a session log. Include the four-criterion
   matrix and the rationale for the volume tie-break (if relevant).
6. **Apply the same Phase 0-1 ramp protocol** from
   `W9_SHADOW_OPERATIONS.md`, but for the new brand:
   - Migration 012 is already applied (only once).
   - Tier 1 verification (`verify-worker-dispatch.ts`) — re-runnable; tweak
     `BRAND` in the script or accept it as a CLI arg if multi-brand
     verification becomes recurrent.
   - Tier 2 forced-structural — **brand-specific**. The candidate's
     library shape is different, so the low-coverage exercise is
     different. Re-pick a synthetic seed via the inventory probe before
     running.

---

## Open questions resolved post-first-cutover

The brief flagged the following for revisitation after the first cutover
landed; if signal surfaces, file a followup:

- **Library size threshold (800).** Calibrated against nordpilates. If a
  smaller-library brand cuts over cleanly, lower the floor. If structural
  emissions rise above 20% on a brand at 800, raise it.
- **Three-shared-forms minimum.** If a candidate with two shared forms
  ships clean Part B output, lower the floor or reframe the criterion.
- **Volume-as-tiebreaker.** If lowest-volume brand turns out to be poorly
  positioned for other reasons (e.g., niche content, awkward persona),
  the tiebreaker may need a multi-factor variant.

These are **post-evidence revisions only**. Do not preemptively soften
criteria before first-brand evidence is in.

---

## Multi-brand-shadow non-goal

Shadow mode is single-brand at any given time during W9. Running multiple
brands in shadow simultaneously is **out of scope** for this workstream.
If post-cutover evidence suggests parallel shadow is operationally
manageable (which it likely is, given fire-and-forget dispatch), that's a
follow-up workstream — not a stretch goal of brand expansion.

---

## Files this runbook references

| File | Purpose |
|---|---|
| `docs/briefs/W9_SHADOW_ROLLOUT_BRIEF.md` | Brief — authoritative for criteria |
| `docs/runbooks/W9_SHADOW_OPERATIONS.md` | Operations runbook — ramp protocol applies to new brand |
| `docs/brand-personas/_template.md` | Template for new persona files |
| `docs/brand-personas/nordpilates.md` | Reference persona — form/posture allowlist + organic-content invariant clause |
| `src/scripts/verify-worker-dispatch.ts` | Tier 1 verification (re-run per new brand) |
| `src/scripts/test-forced-structural.ts` | Tier 2 forced-structural (re-pick synthetic seed per new brand) |
