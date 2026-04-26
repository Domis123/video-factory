# W9 n8n + Sheet Integration Spec

**Audience:** Domis (operator) and the n8n-implementation agent.
**Purpose:** Specify exactly what the n8n S-workflow extension and Sheet
column extension need to do for the W9 review surface to work. The
agent does **NOT** touch n8n or the Sheet directly — this document is
the contract.
**Authoritative source:** `docs/briefs/W9_SHADOW_ROLLOUT_BRIEF.md`
§ "Operator review workflow (Q3a Sheet-native)".

---

## What ships in W9 (no implementation in this branch)

This branch ships:

* Migration 012 — `shadow_review` view + three new operator-write columns
  on `shadow_runs` (`creative_quality_feels_organic`,
  `creative_quality_tags`, `creative_quality_notes`)
* `cutover-status.ts` — reads from `shadow_review`
* This spec

Operator implements (post-merge):

* Sheet column additions on the "Video Pipeline" spreadsheet
* Two new n8n workflows (read + write)
* Cron schedule for the read workflow

The Sheet/n8n implementation order is operator's choice, but the read
workflow must land before the operator starts collecting verdicts.

---

## Sheet columns

Add the following columns to the **Jobs** tab (or a new **Shadow Review**
tab — operator decides; spec is identical either way).

| Column | Direction | Type | Source / destination |
|---|---|---|---|
| `Part B Status` | n8n → Sheet | enum string | `shadow_runs.part_b_terminal_state`, with override to `in_progress` if a `partb_planning_started` event exists in `job_events` for the job_id but no `shadow_runs` row yet (Q13: in-flight indicator). When neither is present: `not_run`. |
| `Part B Brief Preview URL` | n8n → Sheet | text/link | `shadow_runs.context_packet_v2` rendered to a preview link. Operator chooses rendering method (S3-style HTML preview, JSON-blob link, or a text dump). |
| `Phase 3.5 Brief Preview URL` | (existing) | text/link | Existing P2 column — no change. |
| `Comparison Verdict` | Sheet → `shadow_runs.operator_comparison_verdict` | enum: `part_b_better \| v1_better \| tie \| n/a` | Operator-write. |
| `Feels Organic` | Sheet → `shadow_runs.creative_quality_feels_organic` | enum: `yes \| no \| n/a` | Operator-write. Maps to BOOLEAN: `yes`→true, `no`→false, `n/a`→NULL. |
| `Quality Tags` | Sheet → `shadow_runs.creative_quality_tags` | multi-select text[] | Allowed values (CHECK constraint on column): `reads-as-ad`, `homogenized-voice`, `stock-footage-y`, `overlay-redundant`, `voice-off-persona`, `pacing-off`, `other`. Empty unless `Feels Organic = no`. |
| `Notes` | Sheet → `shadow_runs.creative_quality_notes` | free text | Operator-write. |

### Column data validations (set in Sheet)

* `Comparison Verdict`: data validation drop-down with the four enum values.
* `Feels Organic`: drop-down with three enum values.
* `Quality Tags`: comma-separated text with informal validation; the
  write workflow does the strict subset check before sending to
  Supabase. (Sheet's multi-select is awkward; comma-separated text +
  validation in n8n is the pragmatic path.)
* `Notes`: no validation.

---

## n8n Workflow A: shadow_review → Sheet (READ)

**Goal:** Pull all `shadow_review` rows that need a Sheet update, project
them onto the Jobs sheet's Part B columns.

### Trigger

Schedule trigger, every 5 minutes (matches P2 cadence).

### Steps

1. **Fetch active shadow runs.**
   ```
   GET {{ SUPABASE_URL }}/rest/v1/shadow_review
       ?order=created_at.desc
       &limit=100
       &select=run_id,job_id,brand_id,part_b_terminal_state,context_packet_v2,operator_comparison_verdict,creative_quality_feels_organic,creative_quality_tags,creative_quality_notes,created_at
   ```
   Auth: `apikey` header with anon key (service role not needed for
   read; the view exposes only what's intended). Use the same
   credential pattern as P2.

   The `shadow_review` view also surfaces `phase35_status` and the full
   brief blobs — only the columns above are needed for the Sheet write.
   Trim the query to keep payload small.

2. **In-flight detection.**
   For each `shadow_review` row where `part_b_terminal_state` is NULL,
   that's an in-progress run — set `Part B Status = in_progress` instead
   of NULL.

   For `Part B Status = not_run` (jobs that exist but have NO
   `shadow_review` row), this workflow does NOT see them. The existing
   P2 workflow already drives Phase 3.5 lifecycle columns; Part B
   columns just stay blank for `phase35`-only jobs. That's correct
   behavior — `not_run` is the absence of data, not a labeled state.

3. **Render `Part B Brief Preview URL`.**
   The preview URL is operator-defined. Three pragmatic options:
   * (a) JSON dump — link to a Supabase storage bucket pre-rendering
     the JSON blob as `.txt`.
   * (b) HTML render — small Express endpoint on the VPS that takes a
     run_id and renders `context_packet_v2` as a readable page.
   * (c) inline text — paste the brief text directly into the column
     (limited by Sheet 50K-char cap).

   Pick one and wire it. The brief is intentionally agnostic on this.

4. **Map to Sheet columns.**
   Code node like P2's mapper. Match by `Job ID` (existing column)
   and append the Part B columns.

5. **Sheet update.**
   Use Google Sheets `update` operation with `valueInputOption=RAW`
   and the Job ID as the lookup key. Same auth as P2 (service account
   credential `AIqzMYUXoQjud7IW`).

### Idempotency / no-op detection

The mapper should compare the Sheet's existing row content to the
incoming Supabase row before writing. n8n's "If" node can short-circuit
on no-change rows. This avoids burning Sheet API quota on noise.

### Expected throughput

At 30% rollout on nordpilates' ~10-20 jobs/week, this workflow processes
~3-5 active shadow runs per cron tick. Well under quota.

---

## n8n Workflow B: Sheet operator edits → shadow_runs (WRITE)

**Goal:** When the operator fills in `Comparison Verdict`, `Feels
Organic`, `Quality Tags`, or `Notes`, write back to the corresponding
`shadow_runs` columns.

### Trigger

Sheet edit trigger (Google Sheets webhook). Filter on the four
operator-write columns above.

### Steps

1. **Identify the run.**
   Read the `Job ID` value from the edited row. Resolve to
   `shadow_runs.id` via:
   ```
   GET {{ SUPABASE_URL }}/rest/v1/shadow_runs?job_id=eq.{{ jobId }}&select=id&order=created_at.desc&limit=1
   ```
   If no `shadow_runs` row exists for the job_id (e.g., the operator
   wrote a verdict on a Phase-3.5-only job), abort with a Sheet "Row
   Status" warning. Do not write.

2. **Validate input enums.**
   Reject with a clear error message in the Sheet's "Row Status"
   column if:
   * `Comparison Verdict` ∉ `{part_b_better, v1_better, tie, n/a}`
   * `Feels Organic` ∉ `{yes, no, n/a}`
   * `Quality Tags` contains any value not in the allowed seven (CHECK
     will reject the row anyway, but failing early gives a clearer error).
   * `Quality Tags` is non-empty when `Feels Organic ≠ no` (operator
     hint, not a hard rule — log a warning, still write).

3. **Map values.**
   * `Comparison Verdict`: passthrough, store as text. Use `n/a` as the
     literal stored value if you want explicit operator-skipped. (Or
     normalize to NULL; choose one and document.)
   * `Feels Organic`: `yes` → `true`, `no` → `false`, `n/a` → NULL.
   * `Quality Tags`: comma-split, trim, enforce subset, build a Postgres
     array literal `'{tag1,tag2}'`.
   * `Notes`: passthrough text.

4. **PATCH the shadow_runs row.**
   ```
   PATCH {{ SUPABASE_URL }}/rest/v1/shadow_runs?id=eq.{{ runId }}
   Headers: apikey + Authorization (service role for write — anon RLS
            blocks shadow_runs writes by design)
   Body: {
     "operator_comparison_verdict": "...",
     "creative_quality_feels_organic": true|false|null,
     "creative_quality_tags": "{tag1,tag2}",
     "creative_quality_notes": "..."
   }
   ```
   Only PATCH columns the operator actually edited (n8n diff against
   previous Sheet state, or just send the four columns each time —
   PATCH is idempotent).

5. **Confirm to Sheet.**
   Write `Row Status = OK` on success; `Row Status = ERROR: <message>`
   on failure.

### Auth note

PostgREST anon role does not have UPDATE on `shadow_runs` (RLS deny by
default — Architecture Rule 17). The write workflow needs the service
role key, NOT anon. Hardcode in the workflow per Architecture Rule 11
(no n8n `$env` references).

### Edge cases

* **Late row, late shadow_runs.** Job has a `shadow_runs` row but the
  Sheet update fires within a 5-min P2 sync gap → Workflow B sees the
  Job ID resolved, writes successfully. No race.
* **No shadow_runs row yet.** Operator filled in verdict on a Phase
  3.5-only or in-flight Part B run → return Sheet error.
* **Operator edits a verdict from `tie` → `part_b_better` later.**
  PATCH with new value; cutover-status helper picks up the new value
  on next call. No cascading invalidation needed.
* **Tags edited after verdict locked.** Same as above — PATCH accepted.

---

## Cron / scheduling

| Workflow | Trigger | Cadence |
|---|---|---|
| A: shadow_review → Sheet | Schedule | every 5 min |
| B: Sheet → shadow_runs | Sheet edit webhook | event-driven |

Workflow B is event-driven; A's 5-min cadence ensures the Sheet stays
fresh as Part B runs complete asynchronously to the Phase 3.5 lifecycle.

If 5-min feels too slow during the Phase 1 calibration window (operator
wants near-realtime to verify the dispatch fired), drop A's interval to
1 min temporarily. Bump back to 5 min for steady-state.

---

## Validation pass before shipping

Operator checklist before declaring the integration "done":

1. [ ] Sheet columns added with data validation drop-downs
2. [ ] Workflow A runs and populates Part B Status / Preview URL on
       at least three test jobs
3. [ ] Workflow B writes a test verdict back; verify in Supabase:
       ```sql
       SELECT id, job_id, operator_comparison_verdict,
              creative_quality_feels_organic, creative_quality_tags,
              creative_quality_notes
         FROM shadow_runs
        WHERE id = '<test-run-id>';
       ```
4. [ ] Sheet "Row Status" shows OK on success, descriptive ERROR on bad
       input (e.g., misspelled tag)
5. [ ] `cutover-status.ts` returns non-zero `comparison_count` for
       nordpilates after ≥1 verdict written

If all five clear, the operator review surface is live.

---

## Files this spec references

| File | Role |
|---|---|
| `src/scripts/migrations/012_shadow_review_view.sql` | Defines view + new columns |
| `src/lib/cutover-status.ts` | Consumes the view + new columns |
| `n8n-workflows/P2-periodic-sync.json` | Reference pattern for Workflow A |
| `n8n-workflows/S2-brief-review.json` | Reference pattern for Workflow B (Sheet → Supabase write) |
| `docs/runbooks/W9_SHADOW_OPERATIONS.md` | Day-to-day operator guidance using this surface |

---

## Out of scope for this spec

* Comparison UI beyond Sheet (Q3a chose Sheet-native; UI is a future
  workstream if signal collection feels constrained).
* Render-pipeline integration for Part B briefs (Part B is brief-only at
  W9; no rendered video to compare against).
* Batch-update tooling for retroactively annotating old shadow_runs rows
  (out of W9 scope; if needed, write a one-off script).
