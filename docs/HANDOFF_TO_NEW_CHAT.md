# Handoff to New Chat — 2026-04-21

**Read this first.** Everything else in `/docs/` is reference material; this doc tells you what's current and what to do next.

This handoff is written at the close of Phase 4 Part A. Phase 4 Part A is **complete**. Your job is Part B.

---

## TL;DR

Video Factory is an automated short-form video pipeline for ~30 organic (non-ad) fitness/wellness brands. Primary test brand: **nordpilates**. The pipeline ingests UGC footage, analyzes it into sub-segments with rich structured metadata, then assembles ~30-second TikTok/Reels/YouTube Shorts via AI planning + rendering.

**Part A (segment intelligence foundation): COMPLETE.** Library is 100% on v2 schema — 190/190 nordpilates parents, ~700 segments, all with structured metadata (subject descriptors, exercise identification with confidence, framing, audio, editorial hints). `ENABLE_SEGMENT_V2=true` is live on VPS; new ingestion uses v2 path going forward.

**Part B (pipeline rebuild): YOUR TURN.** Rebuild Creative Director + Visual Director + Coherence Critic + Copywriter on the v2 foundation. Sequence: W1 (keyframe grids) → W2 (brand persona) → W3 (Planner) → W4-W6 (Director + Critic) → W7 (Copywriter) → W8-W9 (integration + shadow rollout).

**Immediate next step:** Write the W1 brief. See `docs/PHASE_4_PART_B_PIPELINE.md` for scope.

**Workflow:** Option B (agent-owned git). You (planning Claude) write briefs as markdown files in `docs/briefs/`; the execution agent (Claude Code on VPS sandbox) reads them and executes; Domis approves in chat. See `docs/GIT_WORKFLOW.md` and the "Workflow lessons from Part A" section below.

---

## What Video Factory is

- **Purpose:** Generate short-form video content at scale for ~30 brands (nordpilates, Nordletics, Mindway, Carnimeat, Ketoway, etc.)
- **Output:** 150–300 videos/week at steady state (currently ~5–10/week during build-out)
- **Audience:** Organic social (TikTok / Instagram Reels / YouTube Shorts). **Not ads.** Optimized for retention and brand-building.
- **Creative references:** align.app (warm app-coach voice, primary aesthetic model), Move With Nicole, Pilates by Izzy, BetterMe 28-day challenge viral pattern.
- **Anti-references:** Betterme paid ads (dystopian-AI aesthetic, cautionary example).

## Infrastructure (unchanged through Part A)

- **n8n server:** 46.224.56.174 — orchestration workflows
- **Video Factory VPS:** 95.216.137.35 (Hetzner CX32) — path `/home/video-factory`
- **Database:** Supabase at `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Object storage:** Cloudflare R2
- **Queue:** Upstash Redis
- **LLM stack:** Gemini 3.1 Pro Preview (`gemini-3.1-pro-preview`) for everything — ingestion, curation, planning, rendering critique. Claude Sonnet 4.6 still running CD + Copywriter in Phase 3.5 production; being migrated to Gemini in Part B for stack unification.
- **Rendering:** Remotion, audio mix, Cloudflare R2 for distribution.

---

## Current state (2026-04-21)

### Production (Phase 3.5, still running)

Phase 3.5 pipeline continues to render videos on a daily basis. End-to-end: library-aware CD (Claude) → Asset Curator V2 (Gemini) → Copywriter (Claude) → Remotion render. Videos pass auto QA. This path is NOT being disrupted during Part B — Part B builds in parallel and goes to shadow mode first.

### Part A (shipped, baseline for Part B)

- 190 nordpilates parents, all analyzed via v2 two-pass analyzer (`src/agents/gemini-segments-v2-batch.ts`)
- ~700 segments with full SegmentV2.1 JSONB in `asset_segments.segment_v2`
- Dual-write: v1 columns still populated so existing retrieval RPC works unchanged
- `ENABLE_SEGMENT_V2=true` on VPS `.env`; new ingestion uses v2 going forward

### Not yet started

**Part B workstreams** (ordered, from `docs/PHASE_4_PART_B_PIPELINE.md`):
- **W1:** Keyframe grids — 12-frame mosaics per segment, `keyframe_grid_r2_key` column, Migration 009
- **W2:** nordpilates brand persona (structured voice context for Planner/Director/Critic/Copywriter)
- **W3:** Planner rebuild on Gemini 3.1 Pro Preview (text-only structural skeleton; replaces current CD)
- **W4–W5:** Visual Director (multimodal, watches keyframe grids, picks clips, writes overlay text)
- **W6:** Coherence Critic (multimodal, reviews full storyboard)
- **W7:** Copywriter rebuild on Gemini
- **W8:** Integration + feature flag
- **W9:** Shadow mode rollout and comparison vs Phase 3.5

---

## Key decisions from Part A that matter for Part B

### Architectural

1. **SegmentV2.1 is the canonical schema.** Every Part B consumer reads from `asset_segments.segment_v2` JSONB first, falls back to v1 columns. See `docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` for field-by-field spec.

2. **Gemini 3.1 Pro Preview everywhere in Part B.** Claude paths in Phase 3.5 get migrated during Part B build-out, not kept. Accept prompt re-tuning cost. Model string: `gemini-3.1-pro-preview`. NOT `gemini-3-pro-preview` (discontinued March 2026) and NOT `gemini-2.5-pro` (confabulates on edge cases — see Rule 38).

3. **Per-parent batching pattern for any Gemini video work.** Upload once per parent, analyze all segments against the same upload, delete once. See Rule 31 + `gemini-segments-v2-batch.ts` reference implementation.

4. **`@google/genai` (unified SDK) for all new code.** Legacy `@google/generative-ai` still coexists on some Phase 3.5 paths until post-Part-B cleanup. Don't mix within a file.

5. **Dual-read during Part B transition.** Retrieval RPCs should prefer `segment_v2` fields when present, fall back to v1 columns otherwise. The RPC migration to JSONB-native is its own later workstream, not blocking Part B.

6. **Feature flag all new Part B code paths.** Follow Rule 10. Default OFF. Flip explicitly only after validation.

### Workflow lessons from Part A (apply these in Part B)

1. **File-based brief delivery.** Chat paste corrupts long markdown. Briefs go to `docs/briefs/<stage>.md` (gitignored). Execution agent reads them natively. Don't paste briefs inline in chat.

2. **Intermediate gates on destructive or library-wide work.** After Commit A of any multi-commit branch, stop for Domis review before merging. Agent reports diff + verification of assumed state; Domis acknowledges; then merge proceeds.

3. **Staged execution for destructive operations.** Smoke on a small sample under human supervision → larger unattended run with checkpointing → verification → cleanup. Don't batch-run destructive work straight-through.

4. **Pre-flight backup discipline.** Before any destructive operation on library-scale data, take a pg_dump (requires Supabase DB password from dashboard, dropped to `/root/.pgpass_<stage>` and rotated post-use) + a JSONL export. Archive both to R2 after the operation completes.

5. **Pause production workflows (n8n S1 + S2) during destructive backfill windows.** Verify pause state programmatically after toggling — don't trust "confirmed paused" reports without verification.

6. **Agent scope discipline is real and valuable.** The three-person loop (planning Claude writes briefs / execution agent executes / Domis approves) works when each role stays in its lane. If the agent asks to pause and clarify role-vs-brief ambiguity, encourage it.

### Technical gotchas specific to Part B work

1. **Pass 1 output is non-deterministic at temperature 0.2.** Same model + same parent yields different segment counts run-to-run. Don't design Part B consumers around idempotency guarantees for re-analysis.

2. **LLMs confabulate structure past edges of real data.** Rule 38 Pattern B — models invent domain-appropriate continuations beyond actual content. Guard Part B prompts with explicit duration/bounds constraints + consumer-side clamps.

3. **Zod refines that encode soft rules as hard constraints fail on edge cases.** Rule 39. Scope refines narrowly or move them to prompt-level guidelines.

4. **withLLMRetry default budget is 120s.** Bumped from 30s during W0d. If Part B code paths need different budgets, override explicitly; don't change the default without planning review.

5. **aws-cli not available on VPS.** Any S3-compatible operations use `src/lib/r2-storage.ts` SDK wrapper, not aws-cli.

6. **n8n CLI lives inside the docker container.** Pause/resume via `docker exec n8n n8n update:workflow --id <ID> --active <bool>` on 46.224.56.174.

---

## How to work in this project

### The three-person loop

- **Planning Claude (you, new chat):** design architecture, write briefs as markdown files in `docs/briefs/`, review agent output, update docs
- **Domis:** approve briefs, approve merges, provide strategic direction, paste agent reports back to planning chat
- **Claude Code agent (on VPS sandbox):** read brief files directly, execute code changes, run git operations, deploy VPS

### Brief-writing conventions

- Briefs go to `docs/briefs/<stage>.md`
- Each brief has: scope, branch name, files to create/modify, files NOT to touch, expected deliverable, commit message templates, hard constraints, gate for merge
- Briefs reference `GIT_WORKFLOW.md` for git rules, `CLAUDE.md` for architecture rules — don't restate
- Briefs specify hard gates for multi-stage work (e.g., "STOP after Task 1, await Domis approval before Task 2")
- Explicit non-goals section at the end of any brief with scope-creep risk

### Domis's approval vocabulary

- **"merge" / "ship" / "approved to merge"** — agent runs full merge + deploy sequence
- **"hold"** — agent stays on feature branch, awaits further instruction
- **"revert X" / "rollback"** — agent runs `git revert` on the specified commit and redeploys
- **"proceed"** — move to next stage of multi-stage work

### When to ask Domis questions

Use the input widget for binary/multi-choice decisions that materially affect scope or architecture. Don't ask for clarification on things you can infer from context. Read the docs first; ask only when genuinely stuck.

---

## Immediate next action

Write the **W1 brief** — keyframe grids.

Scope (per `docs/PHASE_4_PART_B_PIPELINE.md`):
1. Generate 12-frame keyframe mosaics (3×4 grid) from each v2 segment, sampled uniformly across the `editorial.best_in_point_s` → `editorial.best_out_point_s` window
2. Upload mosaics to R2 at `keyframe-grids/{brand_id}/{segment_id}.jpg`
3. Migration 009: add `keyframe_grid_r2_key` TEXT column to `asset_segments`
4. Backfill ~700 existing v2 segments with mosaics
5. Integrate mosaic generation into v2 ingestion worker

Not a Gemini-heavy stage — mostly ffmpeg frame extraction + ImageMagick mosaic assembly + R2 upload. Should be straightforward relative to W0d. Still run it staged (smoke on 5 segments → full sweep) because destructive-to-R2 operations deserve caution.

Draft the brief to `docs/briefs/w1-keyframe-grids.md`. Under Option B, agent reads the file and executes.

---

## Architectural documents (reference)

- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, now fully implemented. Reference for v2 schema fields when Part B consumers need them.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — **Your primary reference.** Part B spec. All 9 workstreams defined.
- **`docs/GIT_WORKFLOW.md`** (in `/docs/`, NOT the root — the root has a stale duplicate) — Option B rules
- **`docs/CLAUDE.md`** — architecture rules 1–39
- **`docs/MVP_PROGRESS_14.md`** — current status, W0 retrospective. Supersedes MVP_PROGRESS_13.
- **`docs/w0d-complete.md`** — W0d closure breadcrumb
- **`docs/followups.md`** — known issues (empty at Part A close)
- **`docs/SUPABASE_SCHEMA.md`** — DB schema (current through Migration 008; Migration 009 pending W1)
- **`docs/VPS-SERVERS.md`** — infrastructure
- **`docs/briefs/`** — planning-chat-to-agent brief files (gitignored)

---

## Anti-patterns to avoid

1. **Don't paste briefs inline in chat.** Write to `docs/briefs/<stage>.md` and have the agent read.
2. **Don't restate git rules in every brief.** `docs/GIT_WORKFLOW.md` is canonical.
3. **Don't assume model names or SDK versions.** `gemini-3.1-pro-preview`, `@google/genai`. Don't abbreviate in reports.
4. **Don't let branches stack.** Max depth 1, and only for multi-stage work on the same conceptual feature.
5. **Don't skip Zod validation on Gemini output.** Belt-and-suspenders even with `responseSchema`.
6. **Don't mix scopes in one branch.** If Part B work incidentally reveals a bug in Part A, file it for a separate branch.
7. **Don't refactor Phase 3.5 paths.** They're still in production through Part B build-out. Touch them only via explicit migration workstreams (W8+).
8. **Don't promote confabulated output.** Rule 38. Spot-check model output against ground truth on edge cases before shipping.
9. **Don't add Zod refines that encode soft rules as hard constraints.** Rule 39. Scope narrowly or move to prompt layer.
10. **Don't grand-clean the grandfathered dirty tree as part of Part B work.** Still deferred to `chore/audit-pre-W0-cruft`.

---

## Context on Domis (unchanged from prior handoff)

- Lithuanian, based in Vilnius, academic background (Vilnius University bachelor's thesis completed)
- Runs 30+ brands, operates as builder/orchestrator across automated systems
- Stack fluency: n8n, Supabase, Google Sheets as operator interfaces, Hetzner VPS
- Communication style: direct, spelling occasionally loose (not a style judgment, just a fact — don't over-correct), action-oriented. Prefers quick decisions over protracted analysis.
- Frustration triggers: copy-paste commands that don't work, branch pile-ups, re-litigating decisions already made.
- Reward signals: fast iteration, clean execution, agent handling git without his involvement.
- Recent stated framing: "groundbreaking for the video pipeline industry." Take that seriously — the care he's putting into this workstream reflects real stakes.

---

*This handoff was written 2026-04-21 after W0d closed with 190/190 parent coverage. Phase 4 Part A is complete. Part B begins with W1 (keyframe grids). This chat is handing off cleanly.*
