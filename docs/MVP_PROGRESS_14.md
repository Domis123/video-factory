# MVP Progress 14 — 2026-04-21

**Supersedes:** MVP_PROGRESS_13.md
**Status cutoff:** End of Phase 4 Part A. W0d complete. Part B unblocked.

---

## Headline

**Phase 4 Part A is complete.** The segment intelligence backfill shipped 190/190 nordpilates parents fully on v2 schema, with fresh Pass 1/Pass 2 analysis, re-cut clips, regenerated keyframes, and new CLIP embeddings. `ENABLE_SEGMENT_V2=true` is live on VPS. All Part B downstream work (Planner, Visual Director, Coherence Critic, Copywriter) is now unblocked on a clean, structurally-enforced foundation.

Library state at close of W0d:
- 190 parents, 100% v2 coverage
- ~700 segments total (down from 903 v1, ~22% reduction — v2 groups related content more tightly)
- All segments have segment_v2 JSONB populated; 0 v1-only rows
- Dual-write pattern active (v2 JSONB + legacy v1 columns) so existing retrieval RPC works unchanged

---

## What shipped this session

### To production (merged to main, running on VPS)

**Phase 4 Part A W0b** (shipped 2026-04-20, commit `ebc78e9` via `feat/w0b-segment-v2-integration` merge):
- `0a024f0` — Schema v2.1 deltas (form_rating, on_screen_text, audio_clarity)
- `73fe591` — Pass 1 boundary validation script + 3-parent diff results
- `b450e75` — Transcript regression fix (hard constraint per Rule 37 pattern)
- `3936160` — Model reconciliation on gemini-3.1-pro-preview
- `fd33564` — Per-parent batched analyzer + end-to-end smoke on d644e28d
- `437ae04` — CLAUDE.md Rule 38 (OOD confabulation)

**Phase 4 Part A W0c** (shipped 2026-04-20, commit `257ae97` via `feat/w0c-segment-v2-integration` merge):
- `a87019d` — Migration 008 (segment_v2 JSONB sidecar + GIN index) + SUPABASE_SCHEMA.md corrections
- `ab80a6a` — ENABLE_SEGMENT_V2 flag + ingestion worker v1/v2 branching + projection helper
- `b47f1dd` — Full-reprocess backfill script with checkpointing + dry-run mode
- `e67b986` — Dry-run smoke on d644e28d validated clean

**Phase 4 Part A W0d** (shipped 2026-04-21 across multiple stages):
- Pre-flight backup: pg_dump + JSONL (both archived to R2 at `backups/w0d-final/` post-completion)
- Phase 1 smoke: 5 content-diverse parents, supervised, clean
- Phase 2 overnight: 186 parents unattended, 13 failures (8 Zod-refine + 4 network + 1 transient)
- Phase 3 Zod fix (`5721211` — `fix/w0d-zod-floor-scope`): scoped duration floor to content-bearing types; cleared the 8 Zod failures
- Phase 3 schema fix re-run: 8/8 parents cleared, library at 187/190
- Phase C EOF confabulation fix (`589cb6c` — `fix/w0d-pass1-eof-confabulation`): Pass 1 prompt constraint + consumer-side clamp prevent boundaries past actual video duration
- Phase D retry budget bump (`abcd250` — `fix/w0d-retry-budget-bump`): withLLMRetry default 30s → 120s with observability
- Phase D final retry: 3/3 stuck parents cleared → 190/190 complete
- Phase D flag flip + production resume + R2 backup archival + checkpoint archival
- W0d closure commit (`3b2d357`): `docs/w0d-complete.md` breadcrumb

**Total commits on main from W0 work:** 14 substantive commits + 2 docs branches + 1 closure commit.

### Documentation shipped

- `docs/MVP_PROGRESS_13.md` (2026-04-20) — W0b retrospective + W0c kickoff
- `docs/w0d-complete.md` (2026-04-21) — W0d closure breadcrumb
- `docs/briefs/` established as canonical home for planning-chat-to-agent briefs (gitignored per deliberate chore in `1543343`)

### Architecture rule count

CLAUDE.md grew from 29 → 38 over the W0 workstream. This session (W0d) did NOT add further rules inline, but this MVP_PROGRESS update establishes what SHOULD land as Rule 38 extension + Rule 39 in a follow-on docs commit (see `CLAUDE_MD_ADDITIONS_W0D.md` shipping alongside this progress doc).

---

## What's broken or flagged

### No Part A holdouts

Unlike earlier MVP_PROGRESS snapshots, this one carries no known-broken items from Part A. Every parent completed; every retry converged; every fix held on re-run. Rare enough in a multi-week workstream that it deserves a sentence of acknowledgement: **the layered fix discipline (Zod refine scope, EOF clamp, retry budget bump) compounded into a clean close.**

### Technical debt carried forward (not Part A issues, just old debt)

- **Grandfathered dirty tree.** Accumulated across every W0 stage. `CLAUDE.md` modification + 9 `docs/` deletions + 6 untracked files sitting on both VPS and agent sandbox. Still earmarked for `chore/audit-pre-W0-cruft` branch. Not blocking Part B; still deferred deliberately.
- **Duplicate `GIT_WORKFLOW.md` on main.** Stale `/GIT_WORKFLOW.md` at repo root alongside canonical `/docs/GIT_WORKFLOW.md`. Trivial chore commit pending.
- **11 old origin branches.** Pre-W0 branches still on origin (phase3-w2-curator, env-gemini-cleanup, etc.). Earmarked for weekly hygiene cleanup, not blocking.
- **`pre-W0-*` VPS stashes.** Multiple `git stash` entries accumulated on VPS across deploys. Safe to drop once inspected.

### n8n pause state anomaly (worth investigating)

During W0d Phase D verification, n8n S1 + S2 were observed **active** despite Phase 0's report that they had been paused. Three possibilities:
- Phase 0's pause didn't persist through n8n restart
- Workflows were reactivated by some other process during the backfill window
- Phase 0's "confirmed paused" report was technically incorrect

No production job failures observed during the backfill window, likely due to low job throughput during odd hours. Worth verifying pause state programmatically in future destructive operations rather than trusting a single "confirmed" report.

---

## Decisions made this session

### Architectural

1. **W0d backfill strategy: full re-processing (destroy-and-rebuild).** Chosen over additive JSONB-only backfill. Rationale: avoid asymmetric library (new ingestion v2 / old data v1) which would force dual-read logic on every Part B consumer. Cost paid once; Part B built on consistent foundation.

2. **Staged W0d execution: smoke on 5 parents → overnight on 186.** Smoke under human supervision to catch script bugs before they destroy R2 for 191 parents. Overnight with checkpointing for unattended safety. Human gate between stages non-negotiable.

3. **Both pg_dump AND JSONL backups before any destructive work.** Max-confidence backup strategy. Both archived to R2 after completion for off-site durability. JSONL kept because the agent had built a paired restore script; pg_dump added because it's industry-standard and understandable by any future DBA.

4. **Pause n8n workflows during backfill window.** Chose clean production window over clever transactional-safety tricks. Simpler reasoning, proven pattern.

5. **Zod duration floor scoped to content-bearing segment types.** After W0d overnight surfaced 8 failures on legitimate sub-1.5s setup/transition segments. Floor now applies only to exercise, hold, talking-head, b-roll. Setup/transition/cooldown can legitimately be short.

6. **Pass 1 EOF confabulation fix as Rule 37 + Rule 38 application.** Both levers: prompt constraint ("no boundaries past {parent_duration_s}") + consumer-side clamp (defensive drop/truncate). Defense-in-depth per Rule 37 pattern.

7. **withLLMRetry default budget: 30s → 120s.** After Phase C showed 30s exhausted in 1-2 attempts on real Gemini weather. 4x headroom chosen as safe middle (60s too marginal, 300s hits outer wrappers). Observability added to monitor whether 120s is sufficient over time.

8. **Accept 100% parent coverage as Part A success criterion.** Originally I was prepared to close at 187/190 or 189/190 with documented holdouts. The retry budget bump cleared all three. No outliers.

### Workflow

1. **File-based brief delivery (`docs/briefs/`).** Chat-paste corruption made long briefs unreliable. Planning chat writes briefs to markdown files; execution agent reads them natively via their view tool. Canonical path: `docs/briefs/<stage>.md`. Gitignored because briefs are transient execution artifacts, not project documentation.

2. **Intermediate gates before destructive or scope-shifting commits.** W0d Phase D introduced an explicit "stop after Commit A pushed, before merge" gate. Agent reports diff + outer-timeout audit + flag verification; Domis acknowledges before merge proceeds. Pattern worth keeping for future fixes that change shared library behavior.

3. **Agent scope discipline maintained through 14+ stages.** Worth naming: across the entire W0 workstream, the agent never ran destructive operations without explicit Domis approval, never bundled scope creep into fix commits, and caught at least three of my planning mistakes before they shipped (Zod non-determinism implications, model drift in sandbox env, paste-corruption detection in brief v2). This is the three-person loop working as designed.

### Rejected options

- **Additive JSONB-only backfill (Option A for W0d).** Would have left permanent v1/v2 asymmetry. Pragmatic short-term, worse long-term.
- **Gemini 2.5 Pro fallback for stuck parents.** Declined due to confabulation risk documented in Rule 38.
- **Individual parent investigation for 8fdedc89.** The retry budget bump cleared it without needing content-specific handling.
- **Bumping undici timeout instead of retry budget.** Would have masked the real issue (Gemini taking longer than expected on some calls) rather than fixing it.
- **Relying on n8n UI toggle for workflow pause.** CLI-based pause is scriptable and verifiable; UI is manual and unverifiable.

---

## Technical gotchas discovered (new in W0d)

1. **LLMs confabulate STRUCTURE past edges of real data**, not just content within edges. Pass 1 on truncated Pilates workouts reliably invented 40-80s of trailing segments matching domain expectations (continued reps, left-leg symmetry after right-leg, trailing cooldowns). Pattern detected on 3 of 4 stuck parents, universally at temperature 0.2. Extension of Rule 38 warranted — see `CLAUDE_MD_ADDITIONS_W0D.md`.

2. **Schema refines that encode soft rules as hard constraints fail on legitimate edge cases.** Second instance this session — W0b.1 transcript-null refine was instance one, W0d Zod duration-floor refine was instance two. Pattern worth elevating to CLAUDE.md Rule 39.

3. **Pass 1 output is non-deterministic even at temperature 0.2.** Same model + same parent + same prompt yields different segment counts run-to-run (observed spread: 4–17 on d644e28d). Consumers must not assume idempotency.

4. **Retry budget of 30s is undersized for real-world Gemini API weather.** Empirically: 503 UNAVAILABLE errors frequently don't clear within 30s but do clear within 120s. Observability now in place to monitor whether 120s is also undersized.

5. **aws-cli is not installable on Ubuntu 24.04 via apt.** VPS has no `awscli` package candidate. Any S3-compatible operations should use the project's existing `src/lib/r2-storage.ts` SDK wrapper, not assume aws-cli availability.

6. **Supabase direct DB connection requires the database password** (separate from service_role API key). Not stored anywhere on VPS by default. pg_dump requires fetching from Supabase dashboard + one-time file drop on VPS. Rotate post-use.

7. **n8n CLI lives inside the docker container**, not on the host. Pause/resume workflows via `docker exec n8n n8n update:workflow --id <ID> --active <bool>` on 46.224.56.174.

8. **Chat paste transport eats characters from long markdown text** (observed on briefs v1 and v2). `//onst` from `// const`, `systrestart` from `systemctl restart`, etc. Mitigation: file-based brief delivery via `docs/briefs/`.

9. **Gemini 3.1 Pro "preview" is the production serving mode**, not a pre-release. Preview lifecycle label ≠ quality label. Confirmed via Google docs — `gemini-3-pro-preview` (no 3.1) was discontinued March 26, 2026 and now 404s. 3.1-preview is the flagship.

---

## Pipeline status at a glance

| Stage | Phase 3.5 | Phase 4 Part A | Phase 4 Part B |
|---|---|---|---|
| Ingestion | ✅ Running v1 | ✅ V2 flag ON, live path | — |
| Segment analysis | ✅ Running (v2) | ✅ Backfill 190/190 complete | — |
| Creative Director | ✅ Running (Claude) | — | 🔴 Not started (first Part B workstream: W3) |
| Visual Director | — | — | 🔴 Not started (Part B workstream: W4-W5) |
| Coherence Critic | — | — | 🔴 Not started (Part B workstream: W6) |
| Copywriter | ✅ Running (Claude) | — | 🔴 To be rebuilt (Part B workstream: W7) |
| Remotion render | ✅ Running | — | — |
| Platform export | ✅ Running | — | — |

Legend: ✅ production · 🟢 complete · 🔴 not started · — not applicable

---

## Immediate next action

Start Part B. First brief to draft: **W1 — keyframe grids**. Scope (from PHASE_4_PART_B_PIPELINE.md):

1. Generate 12-frame keyframe mosaics from each v2 segment (3×4 grid, uniformly sampled across the segment's editorial best_in_point_s / best_out_point_s window)
2. Upload mosaics to R2 under `keyframe-grids/{brand_id}/{segment_id}.jpg`
3. Add `keyframe_grid_r2_key` column to `asset_segments` (Migration 009)
4. Backfill all ~700 v2 segments with mosaics (new script, not a full re-analysis — just ffmpeg frame extraction + mosaic assembly + upload)
5. New ingestion (flag-gated) generates the mosaic as part of V2 path going forward

Estimated scope: ~1 day of agent work including a staged backfill (smoke on 5 segments → full library sweep).

After W1: **W2 — nordpilates brand persona**. Structured voice context for downstream Planner/Director/Critic/Copywriter. Smaller scope, maybe half a day.

After W2: **W3 — Planner rebuild** on Gemini 3.1 Pro Preview. Bigger scope — new code path, prompts, evaluation against v2 segment metadata, shadow mode testing.

---

## What comes after Part A (forward-looking, not scope)

- **Part B timeline estimate:** 4–6 weeks if W1-W9 ship at ~1 stage per week average.
- **Video Factory v2 shadow mode target:** mid-May 2026 per earlier planning.
- **Part B success criterion:** end-to-end video production entirely through the v2 pipeline (Planner → Director → Critic → Copywriter → Remotion → export) running in parallel with Phase 3.5 production, with outputs comparable or better on a test sample.

---

## References (canonical, post-W0)

- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, now fully implemented
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — Part B spec, now actively consultable for W1+ briefs
- **`docs/GIT_WORKFLOW.md`** (in `/docs/`) — Option B
- **`docs/CLAUDE.md`** — Rules 1–38 (+ Rule 38 extension + Rule 39 landing alongside this progress doc)
- **`docs/w0d-complete.md`** — W0d closure breadcrumb
- **`docs/followups.md`** — known issues scaffold, empty at Part A close
- **`docs/briefs/`** — canonical home for planning-chat-to-agent briefs (gitignored)
- **`HANDOFF_TO_NEW_CHAT.md`** — refreshed for Part B kickoff

---

## Architecture rule count

CLAUDE.md has 38 rules at W0 close. Rule 38 extension (fabricating-structure-past-edges) and Rule 39 (schema-refine-soft-rule-fail-mode) land in the same docs commit as this progress doc.

---

*MVP Progress 14 authored in planning chat on 2026-04-21 after W0d closed with 190/190 parent coverage. Phase 4 Part A complete; Part B begins next session.*
