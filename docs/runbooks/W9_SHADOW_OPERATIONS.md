# W9 Shadow Operations Runbook

**Audience:** Domis (operator). Agent-readable for follow-up sessions.
**Scope:** Operating Phase 4 Part B in shadow mode on nordpilates from
brief-merge through cutover.
**Authoritative source for decisions:** `docs/briefs/W9_SHADOW_ROLLOUT_BRIEF.md`.
**This runbook:** the day-to-day operations layer.

---

## Quick map of tools

| File | Purpose |
|---|---|
| `src/scripts/verify-worker-dispatch.ts` | Tier 1 pre-flip verification — Phase 3.5 unaffected |
| `src/scripts/test-forced-structural.ts` | Tier 2 / Q8c synthetic seed — exercises Critic structural-revise path |
| `src/lib/cutover-status.ts` | Computes `getCutoverStatus(brandId)` — 4 numeric signals + creative-quality veto |
| `src/lib/cost-aggregate.ts` | `aggregateDailyCosts({windowDays})` — daily cost rollup for the alert cron |
| `src/scripts/migrations/012_shadow_review_view.sql` | View + creative-quality columns Sheet integration reads/writes |

---

## Pre-flip checklist (Phase 0)

**Trigger:** W9 brief merged, deploy clean.

1. **Apply migration 012 to remote Supabase**
   ```bash
   npx tsx src/scripts/apply-migration.ts 012_shadow_review_view.sql
   ```
   (The runner takes the filename only and prepends `src/scripts/migrations/`.)
   Migration is additive — new columns + new view, no data migration.

2. **Confirm all five brands are still `phase35`**
   ```sql
   SELECT brand_id, pipeline_version FROM brand_configs ORDER BY brand_id;
   ```
   Expected: all five rows show `phase35`.

3. **Run Tier 1 pre-flip verification**
   ```bash
   npx tsx src/scripts/verify-worker-dispatch.ts | tee \
     docs/smoke-runs/w9-pre-flip-verification-$(date -u +%Y%m%d).txt
   ```
   Required passes: Phase 3.5 reaches `brief_review`, zero `partb_*` events,
   shadow_runs unchanged, brand still `phase35`. The script prints the two
   ssh commands the operator runs separately for memory + dispatcher-log
   evidence — capture into the artifact.

4. **Set rollout env to 0 on the worker**
   ```bash
   ssh root@95.216.137.35 'echo "PART_B_ROLLOUT_PERCENT=0" >> /home/video-factory/.env'
   # then restart so it takes effect (0 means: no organic Part B routing)
   ssh root@95.216.137.35 'systemctl restart video-factory'
   ```

5. **Flip nordpilates to `part_b_shadow`**
   ```sql
   UPDATE brand_configs SET pipeline_version='part_b_shadow' WHERE brand_id='nordpilates';
   ```
   Tier 3 percent=0 means even though the brand is shadow-eligible, no
   organic job will dual-run. The next step exercises the path manually.

6. **Run Tier 2 forced-structural seed**
   ```bash
   npx tsx src/scripts/test-forced-structural.ts | tee \
     docs/smoke-runs/w9-forced-structural-$(date -u +%Y%m%d).txt
   ```
   Cost ~$1-2. Captures full agent trace + asserts on `partb_revise_structural`.
   "Evidence not conclusion" — see brief § Q8c if structural didn't fire.

7. **Bump rollout to 100 to begin Phase 1 calibration** (next section).

---

## Ramp protocol

| Phase | Trigger | Operator action |
|---|---|---|
| **0. Pre-flip** | Brief merged | Migration 012 + Tier 1 + flip nordpilates + Tier 2 |
| **1. Calibration** | Tier 1+2 clean | `PART_B_ROLLOUT_PERCENT=100` on worker; restart. Run for first ~10 nordpilates jobs. Verdict + creative-quality on every job. |
| **2. Steady-state** | 10 dual-runs collected, no Class 1 regression | `PART_B_ROLLOUT_PERCENT=30`. Continue dual-run. Weekly signal review. |
| **3. Dual-run cutoff** | ≥20 verdicts AND Q4d signals pass | Operator stops reviewing Phase 3.5 brief; ships from Part B output. **No code change.** Workflow change only. |
| **4. Cutover** | ≥30 verdicts AND `getCutoverStatus(brand).cutover_eligible === true` | `UPDATE brand_configs SET pipeline_version='part_b_primary' WHERE brand_id='nordpilates';` Phase 3.5 stops on this brand. shadow_runs continues recording (informational). |
| **5. W10 sequencing** | Nordpilates stable on primary ≥1 week | W10 voice-generation brief drafted. |

Any Class 1/2/3 trigger pauses or reverses progression — see "Pause /
rollback triggers" below.

### Setting the rollout percent

The env var `PART_B_ROLLOUT_PERCENT` is read at decider-time per job by
`feature-flags.ts`. Changes require worker restart:

```bash
ssh root@95.216.137.35
sed -i 's/^PART_B_ROLLOUT_PERCENT=.*/PART_B_ROLLOUT_PERCENT=30/' /home/video-factory/.env
systemctl restart video-factory
```

Sanity-check after restart:
```bash
journalctl -u video-factory --since "1 min ago" | grep -i 'rollout\|part_b'
```

---

## Operator review workflow (Sheet-native)

### What lands on the Sheet

Per Q3a, the Jobs sheet is extended with Part B columns. n8n S-workflow
extension writes from the `shadow_review` view; operator writes the
verdict + quality columns; complementary n8n workflow flows them back to
`shadow_runs`. Spec for the n8n implementation lives in
`docs/runbooks/W9_N8N_SHEET_INTEGRATION_SPEC.md`.

| Column | Direction | Source/destination |
|---|---|---|
| `Part B Status` | n8n → Sheet | `shadow_runs.part_b_terminal_state` (or `in_progress` if shadow_runs not yet written) |
| `Part B Brief Preview URL` | n8n → Sheet | `shadow_runs.context_packet_v2` rendered |
| `Phase 3.5 Brief Preview URL` | (existing) | `jobs.context_packet` (Phase 2 path) |
| `Comparison Verdict` | Sheet → `shadow_runs.operator_comparison_verdict` | `part_b_better \| v1_better \| tie \| n/a` |
| `Feels Organic` | Sheet → `shadow_runs.creative_quality_feels_organic` | `yes \| no \| n/a` |
| `Quality Tags` | Sheet → `shadow_runs.creative_quality_tags` | multi-select (only when Feels Organic = no) |
| `Notes` | Sheet → `shadow_runs.creative_quality_notes` | free text |

### How the operator fills it in

1. Job runs through Phase 3.5 + Part B (dual-run); both surfaces become
   reviewable on the Sheet.
2. Operator inspects both `Brief Preview URL`s + the rendered video (Phase
   3.5 ships the video; Part B is brief-only at W9 — no render).
3. Operator emits `Comparison Verdict` per their own preference between
   the two briefs. Treat the Phase 3.5 surface as the production-quality
   reference; Part B is the candidate.
4. `Feels Organic` is independent of the comparison. Even if Part B reads
   as "better," it can still feel like an ad. The veto fights silent drift.
   - `yes` = doesn't trigger ad-radar
   - `no` = reads as paid / homogenized; fill `Quality Tags`
   - `n/a` = couldn't tell or genre-ambiguous (excluded from veto denominator)
5. `Quality Tags` taxonomy (when `feels_organic=no`):
   - `reads-as-ad` — overall feeling of paid content
   - `homogenized-voice` — voice is generic-fitness, not nordpilates-specific
   - `stock-footage-y` — clip selection feels like stock library, not real UGC
   - `overlay-redundant` — text duplicates what's visible
   - `voice-off-persona` — script doesn't match the brand persona
   - `pacing-off` — rhythm broken or templated
   - `other` — edge case; please add a Note explaining

### Cadence

- n8n cron polls `shadow_review` view every 5 min, writes any
  newly-completed Part B rows to Sheet (matches existing P2 cadence).
- Operator review cadence is opportunistic — review when a job lands;
  weekly retrospective for trend reading.

### What "complete" looks like for a single dual-run

- `shadow_runs` row exists with non-null `part_b_terminal_state`
- Sheet row has `Comparison Verdict` and `Feels Organic` populated
- (optional) `Quality Tags` if `feels_organic=no`, `Notes` if relevant

### Status semantics by mode (Q13)

The `Part B Status` column reads differently across rollout modes:

- **Dual-run mode** (Phase 1-2; default during shadow): `escalated` is a
  flag, not a job-level status. The job's normal `status` column tracks
  Phase 3.5 lifecycle (`brief_review`, `rendering`, ...). `Part B Status =
  escalated` means Part B couldn't converge; no operator action required —
  Phase 3.5 brief is still the production candidate. Operator may inspect
  `Part B Brief Preview URL` for diagnostic interest.
- **Part-B-only mode** (Phase 3+; within `part_b_shadow` after dual-run
  cutoff): `escalated` IS the brief_review reason. Phase 3.5 isn't running.
  Operator handles brief_review per W8's escalation design — full revise
  history in context, decide approve / re-plan / reject.
- **Primary mode** (Phase 4+; `part_b_primary`): same as Part-B-only.

---

## Pause / rollback triggers

Three classes. Each has a defined response. Severity and decision-maker
differ.

### Class 1 — Hard regression (auto-rollback eligible)

**Trigger:** Part B dispatch is breaking Phase 3.5's lifecycle. Examples:

- Phase 3.5 jobs failing at rates above pre-W8 baseline
- Phase 3.5 `brief_review` timing materially degraded
- `job_events` showing Phase 3.5 transitions interleaved with `partb_*`
  errors that propagate
- Worker memory ballooned past +50MB of pre-W9 baseline (~210MB)
- Worker crashing / restart-loop

**Response:**

1. Immediately set `pipeline_version='phase35'` on the affected brand:
   ```sql
   UPDATE brand_configs SET pipeline_version='phase35' WHERE brand_id='nordpilates';
   ```
2. If the regression is dispatch-level (Part B code is breaking the worker
   process itself, not just shadow runs), `git revert` the merge commit on
   main + redeploy per `docs/GIT_WORKFLOW.md` emergency rollback pattern:
   ```bash
   ssh root@95.216.137.35
   cd /home/video-factory
   git log --oneline -5         # find the W9 merge sha
   git revert <merge-sha> -m 1
   git push origin main
   npm install && npm run build && systemctl restart video-factory
   ```
3. Capture state in a followup with full evidence chain.

**Decision-maker:** auto-revertable by agent on Domis directive (no chat
re-litigation needed in true emergencies); confirmation in chat post-action.

### Class 2 — Soft operational signal exceeded ceiling

**Triggers (any of), sustained over ≥3 consecutive days with ≥10 jobs:**

- Escalation rate >50%
- Cost p95 >$1.50/video
- Critic-unavailable (default-approve) rate >5%
- Q5(a) `revise_scope='structural'` emission rate >20%
  (suggests Critic over-calling — not auto-rollback, warrants Critic
  prompt review in W9.5)

**Response:**

1. **Pause ramp progression.** Do NOT increase `PART_B_ROLLOUT_PERCENT`.
   Do NOT transition dual-run → Part-B-only. Do NOT flip to primary.
2. Investigate via shadow_runs analysis:
   ```sql
   -- Escalation rate breakdown
   SELECT date_trunc('day', created_at) AS day,
          COUNT(*) AS runs,
          SUM(CASE WHEN part_b_terminal_state='failed_after_revise_budget' THEN 1 ELSE 0 END) AS escalated,
          ROUND(100.0 * SUM(CASE WHEN part_b_terminal_state='failed_after_revise_budget' THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
     FROM shadow_runs
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY 1 ORDER BY 1 DESC;
   ```
3. Operator decides: (a) hold, (b) reduce rollout percent, (c) full rollback to phase35.

**Decision-maker:** Domis. No auto-action.

### Class 3 — Creative drift

**Trigger:** `creative_quality_feels_organic = false` rate ≥40% (i.e.,
`feels_organic` rate <60%) over 10 consecutive Part B jobs.

**Response:**

1. **Pause ramp progression.**
2. Investigate which `creative_quality_tags` are firing — failure-mode
   distribution informs whether the drift is voice (Copywriter), visual
   (Director), or structural (Planner):
   ```sql
   SELECT tag, COUNT(*) AS hits
     FROM shadow_runs sr,
          UNNEST(sr.creative_quality_tags) AS tag
    WHERE sr.creative_quality_feels_organic = false
      AND sr.created_at >= NOW() - INTERVAL '14 days'
    GROUP BY tag ORDER BY hits DESC;
   ```
3. Domis decides: (a) continue measuring with awareness, (b) tune the
   implicated agent's prompt (W9.5 or later workstream), (c) rollback.

**Decision-maker:** Domis. The 60% threshold is the "Betterme guard" — if 4
in 10 read as ads, the success criterion is failing even if escalation
rate and cost look fine.

---

## Cost alert handling (Q10b)

### Threshold

Daily aggregate alert: `daily_total_usd > $5`.

This is intentional drift-detection, not per-job alerting. First-week
steady-state at 30% rollout on nordpilates' ~10-20 jobs/week should run
~$1-3/day. $5 catches drift, not noise.

### When the alert fires

1. Pull the daily breakdown:
   ```bash
   npx tsx -e "
   import { aggregateDailyCosts } from './src/lib/cost-aggregate.js';
   aggregateDailyCosts({ windowDays: 7 }).then((rows) =>
     console.table(rows));
   "
   ```
2. Identify whether the spike is **volume** (more jobs) or **per-job**
   (mean / p95 climbed). Volume spikes are usually fine; per-job
   spikes warrant deeper inspection.
3. If per-job: spot-check the most-expensive shadow_runs row from that
   day:
   ```sql
   SELECT id, job_id, part_b_cost_usd, total_agent_invocations,
          revise_loop_iterations, part_b_terminal_state
     FROM shadow_runs
    WHERE created_at >= '<alert-day>'::date
      AND created_at <  '<alert-day+1>'::date
    ORDER BY part_b_cost_usd DESC
    LIMIT 5;
   ```
   Look for: revise loops running to budget, agent retry storms, unusually
   high `total_agent_invocations`.

### What it doesn't do

- Hard-cap. No job is halted on cost (Q10b decision).
- Per-job alerts. Drift is the signal, not individual outliers.

---

## Cutover decision flow

Trigger: Phase 3 dual-run cutoff cleared, ≥30 verdicts collected at
steady-state, no Class 2/3 triggers active.

```bash
npx tsx -e "
import { getCutoverStatus } from './src/lib/cutover-status.js';
getCutoverStatus('nordpilates').then((s) =>
  console.log(JSON.stringify(s, null, 2)));
"
```

Read the returned object:

- `cutover_eligible: false` + non-empty `blockers[]` → cutover blocked,
  fix the failing signal first
- `cutover_eligible: true` → numerics + veto + sample size all clear

**The eligible flag is advisory, not auto-action.** Domis decides:

1. Read `blockers[]` even when empty — confirm signal trends are
   stable, not just-passing.
2. Optional: re-run with `sampleWindow: 50` to widen confidence:
   ```ts
   getCutoverStatus('nordpilates', { sampleWindow: 50 })
   ```
3. Flip the brand:
   ```sql
   UPDATE brand_configs SET pipeline_version='part_b_primary' WHERE brand_id='nordpilates';
   ```
4. Document the decision + cutover-status output in a session log.

After cutover, `shadow_runs` continues recording (informational; no longer
dual-run). Phase 3.5 is no longer running on this brand.

---

## Quick SQL reference

```sql
-- Brand state snapshot
SELECT brand_id, pipeline_version FROM brand_configs ORDER BY brand_id;

-- Shadow run trend (7d)
SELECT date_trunc('day', created_at) AS day,
       COUNT(*) AS runs,
       SUM(CASE WHEN part_b_terminal_state='failed_after_revise_budget' THEN 1 ELSE 0 END) AS escalated,
       AVG(part_b_cost_usd)::numeric(6,4) AS mean_cost,
       PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY part_b_cost_usd)::numeric(6,4) AS p95_cost
  FROM shadow_runs
 WHERE created_at >= NOW() - INTERVAL '7 days'
 GROUP BY 1 ORDER BY 1 DESC;

-- Operator-verdict breakdown (most recent 50)
SELECT operator_comparison_verdict, COUNT(*)
  FROM (SELECT operator_comparison_verdict
          FROM shadow_runs
         WHERE operator_comparison_verdict IS NOT NULL
         ORDER BY created_at DESC LIMIT 50) sub
 GROUP BY operator_comparison_verdict;

-- Creative-quality tag frequency (failed-organic only)
SELECT tag, COUNT(*) AS hits
  FROM shadow_runs sr,
       UNNEST(sr.creative_quality_tags) AS tag
 WHERE sr.creative_quality_feels_organic = false
 GROUP BY tag ORDER BY hits DESC;
```

---

## Appendix: pre-flip checklist if a future brand is being added

When the time comes to flip a second brand (post-nordpilates cutover),
follow `docs/runbooks/W9_BRAND_EXPANSION_CRITERIA.md` first to confirm
candidate eligibility, then run the same Phase 0-1 sequence above with
the new brand_id. Tier 1 verification on the new brand is required.
Tier 2 forced-structural is brand-specific (different library shape ⇒
different low-coverage exercises) — re-pick a low-coverage seed via the
inventory probe before running.
