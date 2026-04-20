# MVP Progress 13 — 2026-04-20

**Supersedes:** MVP_PROGRESS_12.md
**Status cutoff:** End of Phase 4 Part A W0b. Merged to main. VPS deployed. W0c next.

---

## What shipped this session

### To production (merged to main, running on VPS)

- **W0b.2** (commits 73fe591, b450e75) — Pass 1 boundary validation script run on three test parents; Pass 2 prompt patched with a hard constraint against null `transcript_snippet` when `has_speech: true`. Addressed the W0b.1 transcript regression.
- **W0b.2.5** (commit 3936160) — Model reconciliation. VPS was already canonical (`gemini-3.1-pro-preview`); the agent sandbox's local `.env` was drifted to `gemini-2.5-pro`, which is what W0a/W0b.1/W0b.2 had silently been running against. Local updated, validation re-run on canonical model: 22% faster Pass 1, zero duration violations, transcript fix still holds.
- **W0b.3** (commits fd33564, 437ae04) — Per-parent batched analyzer (`src/agents/gemini-segments-v2-batch.ts`) + smoke script. End-to-end smoke on parent `d644e28d`: 1 upload, 1 Pass 1, 4 Pass 2, 1 delete, 2m 10s total wall time, zero Zod failures, zero Rule 37 violations. CLAUDE.md Rule 38 appended.
- **W0b branch merge** (commit ebc78e9) — 9-commit W0b branch merged to main via a `/tmp/vf-merge-w0b` worktree (sidestepped the grandfathered dirty tree). VPS fast-forwarded from 16535f7 → ebc78e9. Service active since 2026-04-20 13:50:32 UTC.

### In progress

- Nothing active. W0c not yet started.

---

## What's broken or flagged

### Known issues

- **Duplicate git-workflow docs on main.** Stale `/GIT_WORKFLOW.md` (first-draft) alongside canonical `/docs/GIT_WORKFLOW.md` (Option B). Trivial chore commit — delete the root copy, redirect any lingering references to `/docs/`. Not blocking.
- **Pass 1 output is non-deterministic.** Same prompt + same model + same parent → different segment counts across runs (W0b.2.5 found 5 segments on d644e28d, W0b.3 found 4). LLM sampling variance, not a defect. Important for W0c backfill design: do not assume idempotent re-runs.

### Known inefficiencies

- **Per-parent batching real savings smaller than projected.** Part A doc estimated ~20s per would-have-been-separate-upload saved. W0b.3 measured ~12s (upload 5.3s + poll 6.6s). Still meaningful — ~2.3 hours across a 191-parent backfill — but W0c backfill timing estimate can be tightened.

### Grandfathered dirty tree (still grandfathered)

- Untouched across W0a, W0b.1, W0b.2, W0b.2.5, W0b.3, and the merge. Every commit used `git add <specific-file>` to isolate.
- Plus: a `pre-W0b-merge-deploy` stash now exists on VPS from the pre-merge-deploy stash-taking. Inspect and drop when convenient.
- Decision unchanged: earmarked for `chore/audit-pre-W0-cruft` branch. Resolve when it can be done in isolation. Do NOT roll into W0c.

---

## Decisions made this session

### Architectural

1. **Pass 1 boundary detection validated on `gemini-3.1-pro-preview`.** Produces better type accuracy than v1 on all three test parents. Zero duration violations on 3.1 (one on 2.5). First real validation of Pass 1 — prior W0a/W0b.1 work was Pass 2 only.
2. **Transcript regression fix generalizes across models.** Rule 37-style hard constraints in prompts work on both 2.5-pro and 3.1-pro-preview. Not a model-specific patch.
3. **Per-parent batching contract (Rule 31) validated end-to-end.** Real upload/delete counters at 1 each, Pass 2 calls reuse upload URI cleanly, `finally`-block delete works.
4. **W0b.2.6 parent-duration audit cancelled.** The 48a5f3b7 "60s of hidden content" finding that triggered the audit was 2.5-pro confabulating. Real video is 5.5s talking-head exactly as the container metadata claimed. No library-wide data integrity issue, no audit needed.
5. **Gemini model nomenclature clarified.** `gemini-3-pro-preview` was discontinued March 26, 2026 — calling it now 404s. `gemini-3.1-pro-preview` is the only available 3-series Pro model. Google's "preview" lifecycle label means "production-capable with shorter deprecation notice than `stable`," not "pre-release / lower quality." Env stays on `gemini-3.1-pro-preview`, CLAUDE.md Rule 33 stays as written.
6. **CLAUDE.md Rule 38 added.** LLM confabulation on OOD inputs is now a permanent architecture rule with concrete example (48a5f3b7 / 2.5-pro / 12 fabricated exercises on a 5.5s talking-head clip).

### Workflow

1. **Worktree-based merges for dirty-tree branches.** Agent used `/tmp/vf-merge-w0b` worktree to keep the grandfathered uncommitted changes from polluting the merge. Pattern worth keeping for any future merge where the main working tree is dirty.
2. **Agent re-syncs CLAUDE.md (or any branch-point-sensitive file) before appending.** W0b branch was cut from `0f25ea2` — pre-Rules-30-37. Agent caught this pre-emptively in the Rule 38 commit to avoid merge conflict. Correct move, called out in commit message.
3. **Canonical model-name nomenclature in reports.** `gemini-3.1-pro-preview` and `gemini-2.5-pro` in full, not abbreviated to `3.1-prev`. Hard constraint introduced in W0b.3 brief after the W0b.2.5 table confused the reviewer.

### Rejected options

- **Switching env to `gemini-3-pro` (no -preview suffix).** Does not exist as a callable model string. Only 3.1-pro-preview is available in the 3-series Pro tier.
- **Parent-duration audit (W0b.2.6).** Dropped once manual inspection of 48a5f3b7 revealed the video was exactly as long as its metadata said. No data integrity issue to audit.

---

## Technical gotchas discovered

1. **LLMs confabulate structure under `responseSchema`.** Strong prompt expectations + out-of-distribution input + structured output schema = plausible-looking but fabricated data that Zod-validates clean. Only manual spot-checking catches it. See Rule 38 for mitigations (escape paths, edge-input testing, ground-truth spot checks, model-tier consideration).
2. **Pass 1 segment count is non-deterministic across runs.** Same input, different output. Fine for coverage-driven backfill; W0c must not design around idempotency.
3. **Sandbox env ≠ VPS env, silently.** Until W0b.2.5 we didn't know the agent sandbox had `GEMINI_INGESTION_MODEL=gemini-2.5-pro` while VPS was correctly on `gemini-3.1-pro-preview`. The drift only surfaced because we explicitly audited both. Worth periodic audits.
4. **Google's "preview" lifecycle label is not a quality label.** Preview Gemini models are production-capable; the label communicates deprecation cadence, not release maturity. `gemini-3.1-pro-preview` is the flagship, not a beta.
5. **Branch points matter for shared-file edits.** If a branch was cut before a doc-edit commit landed on main, later appending to that doc on the branch produces a spurious conflict. Pre-emptive re-sync (branch's file → main's version + new appends) keeps merges clean.
6. **Nomenclature abbreviations in cross-model tables confuse.** `3.1-prev` next to `2.5-pro` reads as "preview tier vs pro tier," not "same pro tier, different lifecycle label." Use full model names in any report comparing models.

---

## Immediate next action

**Write W0c brief.** Scope (from `PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` § W0c):

1. Apply migration 008 (`segment_v2` JSONB sidecar column on `asset_segments`)
2. Add `ENABLE_SEGMENT_V2=false` feature flag to the ingestion worker (default OFF per Rule 10)
3. Integrate `analyzeParentEndToEndV2()` (from `gemini-segments-v2-batch.ts`, shipped W0b.3) into `workers/ingestion.ts` behind the flag
4. Build backfill script with:
   - Progress checkpointing (resumable after crash/restart)
   - Partial-failure recovery (skip + log + continue)
   - 4-way parallel parent processing
   - Dry-run mode

Deliverable under Option B — agent executes, pushes, reports, awaits approval. W0c is a larger scope than any W0b sub-stage; expect multiple commits on one branch.

---

## What comes after W0c

- **W0d:** Execute backfill of ~903 existing segments. Updated estimate: ~1.5–3 hours with 4-way parallel parents (W0b.3 measured 2m 10s for a mid-size parent, better than Part A doc's 5–6 min estimate).
- **Part B kickoff:** W1 (keyframe grids) + W2 (nordpilates brand persona)
- **Part B full build:** W3 (Planner) through W9 (shadow mode rollout)

Full timeline estimate: W0 complete in ~1 week from today, Part B in ~4–6 weeks. Video Factory v2 in shadow mode target: mid-May 2026.

---

## Pipeline status at a glance

| Stage | Phase 3.5 | Phase 4 Part A | Phase 4 Part B |
|---|---|---|---|
| Ingestion | ✅ Running | 🟡 Ready for integration (W0c) | — |
| Segment analysis | ✅ Running (v1) | 🟢 W0b complete; W0c integration + W0d backfill next | — |
| Creative Director | ✅ Running (Claude) | — | 🔴 Blocked on Part A |
| Curator | ✅ Running (Gemini) | — | 🔴 Blocked on Part A |
| Copywriter | ✅ Running (Claude) | — | 🔴 Blocked on Part A |
| Remotion render | ✅ Running | — | — |
| Platform export | ✅ Running | — | — |

Legend: ✅ production · 🟢 complete · 🟡 ready for next step · 🔴 not started · — not applicable

---

## Architecture rule count

CLAUDE.md now contains 38 rules (1–29 pre-Phase-4; 30–37 added by `docs/ship-phase4-documentation` merge on 2026-04-20; 38 added by W0b.3 on 2026-04-20).

---

## Reference pointers

- **`PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — canonical Part A spec, still authoritative
- **`PHASE_4_PART_B_PIPELINE.md`** — canonical Part B spec, unblocked once Part A completes
- **`GIT_WORKFLOW.md`** (in `/docs/`) — Option B workflow; root-level duplicate pending cleanup
- **`CLAUDE.md`** — rules 1–38
- **`HANDOFF_TO_NEW_CHAT.md`** — was written 2026-04-20 before W0b.2; will benefit from a refresh when the next chat opens on W0c. Not urgent for this tracker update.
- **`SUPABASE_SCHEMA.md`** — still shows stale `asset_id` for `asset_segments` (actual column is `parent_asset_id`). Worth a small doc fix in the same chore commit that resolves the duplicate git-workflow doc.

---

*MVP Progress 13 authored in planning chat on 2026-04-20 after the W0b branch merged and deployed. W0c starts next.*
