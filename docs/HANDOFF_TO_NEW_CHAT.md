# Handoff to New Chat — 2026-04-20

**Read this first.** Everything else in `/docs/` is reference material; this doc tells you what's current and what to do next.

---

## TL;DR

Video Factory is an automated short-form video pipeline for ~30 organic (non-ad) fitness/wellness brands, primary test brand is **nordpilates**. The pipeline ingests UGC footage, analyzes it into sub-segments with rich metadata, then assembles ~30-second TikTok/Reels/YouTube Shorts via AI planning + rendering.

**Phase 4 is underway and has been split into two parts:**
- **Part A — Segment Intelligence.** Upgrade segment analyzer to produce rich, structured, Gemini-3-grade metadata. "Perfect clips + metadata + semantics" is the success criterion. **This is where we are now (W0b.1 done, W0b.2 next).**
- **Part B — Pipeline.** Rebuild Creative Director + Visual Director + Coherence Critic + Copywriter on top of the new segment metadata. **Unblocked by Part A. Starts once backfill completes.**

**Immediate next step:** W0b.2 brief — Pass 1 boundary detection validation + transcript regression fix. See `PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` for full context.

**Workflow:** Option B (agent-owned git). You (planning Claude) write briefs; the agent (Claude Code on sandbox) executes; Domis approves in chat. You never write command sequences for Domis to copy-paste. See `GIT_WORKFLOW.md` for full rules.

---

## What is Video Factory

- **Purpose:** Generate short-form video content at scale for ~30 brands spanning diet, fitness, wellness, and productivity (nordpilates, Nordletics, Mindway, Carnimeat, Ketoway, etc.)
- **Output target:** 150-300 videos/week across all brands when at steady state
- **Audience:** Organic social audiences on TikTok/Instagram Reels/YouTube Shorts. **Not ads.** Not direct-response. The pipeline is optimized for retention and brand-building, not conversion.
- **Creative references (what good looks like):** align.app (primary aesthetic model — warm app-coach voice), Move With Nicole, Pilates by Izzy, BetterMe 28-day challenge viral pattern.
- **What good does NOT look like:** Betterme paid ads (dystopian-AI aesthetic, cautionary example).

## Infrastructure

- **n8n server:** 46.224.56.174 (orchestration workflows)
- **Video Factory VPS:** 95.216.137.35 (Hetzner CX32), path `/home/video-factory`
- **Database:** Supabase at `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Object storage:** Cloudflare R2
- **Queue:** Upstash Redis
- **LLM stack:** Gemini 3.1 Pro Preview (`gemini-3.1-pro-preview`) for everything — ingestion, curation, planning, rendering critique. Historical Claude usage (CD, Copywriter) is being migrated to Gemini in Part B for stack unification.
- **Rendering:** Remotion, audio mix, Cloudflare R2 for distribution.

## Current State (as of 2026-04-20)

### Shipped to main

- `feat/architecture-pivot` — Phase 3.5 pivot: `library_inventory` module, body_focus matching, post-selection copywriter context, style constraints preventing off-library exercise invention. (Commits fd63a35 + 5327188)
- `fix/quick-wins` — Prep clip hard-filter in curator dispatch + `subject_consistency` field on creative_direction with curator enforcement modes. (Commits a9be904 + c71e1ae)
- `feat/w0a-segment-v2-prototype` — Phase 4 W0a: SegmentV2 schema + two-pass analyzer design + prototype tested on 3 segments. (Commit afde783)
- Merge commit: **919ee73** on origin/main brings all three to production.

### In progress — `feat/w0b-segment-v2-integration`

- **W0b.1 DONE (commit 0a024f0):** Schema v2.1 deltas applied (form_rating enum refined per Gemini self-critique, `setting.on_screen_text` added, `speech` → `audio` block rename with `audio_clarity` sub-field). Prototype re-run on 3 test segments. Zod validation clean. Wall time 27-102s/segment (variance due to Files API polling).
- **W0b.2 NEXT:** Pass 1 boundary detection validation — compare v2 Pass 1 boundaries against v1's existing segmentation on 3 parent clips. Also: patch Pass 2 prompt to fix transcript_snippet regression (when has_speech=true, snippet was returning null in W0b.1).
- **W0b.3 PENDING W0b.2 APPROVAL:** Per-parent batching + end-to-end smoke on 1 parent. Migration 008 (segment_v2 JSONB sidecar column) created but not applied.

### Not yet started

- **W0c:** Ingestion integration + feature flag + backfill script with checkpointing
- **W0d:** Full backfill of ~903 existing segments (estimated 2-4 hours with 4-way parallel parents)
- **Phase 4 Part B:** Planner, Visual Director, Coherence Critic, Copywriter rebuild

---

## Key decisions made in the previous chat

### Architecture

1. **Phase 4 split into Part A (Segment Intelligence) and Part B (Pipeline).** Part A is foundational — everything downstream depends on segment metadata quality. Part B is blocked until Part A completes backfill.

2. **Gemini 3.1 Pro Preview everywhere.** Model string: `gemini-3.1-pro-preview`. This is Google's current flagship (released April 15, 2026, 77.1% ARC-AGI-2). "Preview" is their release naming convention — preview IS production. There is no non-preview 3.1 Pro.

3. **Two-pass segment analysis.** Pass 1: full parent clip at 1 FPS → boundaries + segment types. Pass 2: re-analyze each segment individually at 5 FPS using `videoMetadata.start_offset/end_offset` for deep structured output. 

4. **Per-parent batching is mandatory.** Upload parent clip to Gemini Files API ONCE; run Pass 1 + all Pass 2 calls against that upload; delete once. ~4x savings vs. naive one-upload-per-segment.

5. **SDK migration: `@google/genai` (new unified SDK) for all new code.** Old `@google/generative-ai@^0.24.1` coexists temporarily for existing ingestion/curator code; cleanup happens post-W0d.

6. **SegmentV2.1 is the canonical segment schema.** See `PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` for full spec. Gemini's `responseSchema` feature enforces structured output.

### Critical technical gotchas discovered

1. **Gemini `responseSchema` rejects non-string enums.** Any enum field, even conceptually numeric ones (count, schema_version), MUST be string-valued in Zod. Convert at consumer.

2. **Parent-asset reference column is `parent_asset_id`, not `asset_id`.** PHASE_4_DESIGN.md (v1) had this wrong in migration 011 draft — needs correction in Part B doc. Verified via direct Supabase query in session.

3. **CoT preamble in prompt can pull attention from transcription.** W0b.1 showed `transcript_snippet: null` on a talking-head clip where W0a (no CoT) returned the full transcript. Fix: add hard constraint "If has_speech=true, transcript_snippet MUST NOT be null."

4. **Numeric 1-10 scores suffer clustering bias with LLMs.** 80% of clips rate 7-8. Categorical enums (excellent/good/poor/unsuitable) are more reliable. Gemini itself flagged this; W0b.1 results confirm.

5. **"Preview" model IDs change.** Old `gemini-3-pro-preview` deprecated March 9, 2026 and now aliases to 3.1. Pin model IDs in env vars (`GEMINI_INGESTION_MODEL`, `GEMINI_CURATOR_MODEL` — specialized per use).

6. **Source clips are already 1080×1920 post-W5 normalizer.** `safe_to_crop_9x16` field was debated but deferred — we're not building aggressive re-crop logic for now.

### Workflow decisions

1. **Option B git workflow adopted.** Agent owns the full git cycle (create branch, commit, push, merge, delete, deploy VPS, rollback). Domis approves in chat. Planning Claude writes briefs. See `GIT_WORKFLOW.md` (v2 on main).

2. **Docs live in the repo.** Same flow as code. Authoring can be chat-drafted (recommended) or laptop-drafted + pasted-to-chat. Never push docs directly from laptop.

3. **Schema-version gating for segment rows.** During backfill, existing rows stay v1; new writes populate `segment_v2` JSONB sidecar column. Migration 008 adds the column without breaking existing consumers. Full cutover happens in W0c after backfill completes.

---

## How to work in this project

### The three-person loop

- **Planning Claude (you, new chat):** design architecture, write briefs for the agent, review agent output, update docs
- **Domis:** approve briefs, approve merges, provide strategic direction, paste agent reports back
- **Claude Code agent:** execute code changes in its sandbox, run git operations, deploy VPS

### Brief-writing conventions

- Every brief has explicit scope, branch name (always from clean main), files to create/modify, files NOT to touch, expected deliverable, and commit message format.
- Briefs reference `GIT_WORKFLOW.md` rather than restating git rules.
- Briefs specify hard gates (e.g., "STOP after W0b.2, await Domis approval before W0b.3").
- Multi-stage work stays on one branch with separate commits per stage, merged to main once after the final stage.

### Domis's approval vocabulary

- **"merge" / "ship" / "approved to merge"** — agent runs full merge + deploy sequence
- **"hold"** — agent stays on feature branch, awaits further instruction
- **"revert X" / "rollback"** — agent runs `git revert` on the specified commit and redeploys
- **"proceed"** — move to next stage of multi-stage work

### When to ask Domis questions

Use the input widget for binary/multi-choice decisions that materially affect scope or architecture. Don't ask for clarification on things you can infer from context. Read the docs first; ask only when genuinely stuck.

### When NOT to overthink git

The git workflow is documented in `GIT_WORKFLOW.md`. Follow it mechanically. Don't invent new patterns. If a brief requires something unusual (e.g., stacking branches), the brief must explicitly authorize it.

---

## Immediate next action

Write the **W0b.2 brief**. Scope:

1. **Pass 1 boundary detection validation.** Create `src/scripts/validate-pass1-boundaries.ts` that takes a parent_asset_id, runs Pass 1 on the full parent clip at 1 FPS, compares output against existing v1 segments for that parent, prints diff analysis. Run on 3 parents (the parents of the 3 W0a test segments: f9788090, 03c60575, f36d686b).

2. **Patch Pass 2 prompt for transcript regression.** Add to `src/agents/prompts/segment-analyzer-v2-pass2.md`:
   > "If `audio.has_speech` is true, `audio.transcript_snippet` MUST NOT be null. Extract the first 100 characters of intelligible speech. The segment analyzer is the only point in the pipeline where this transcript is captured — if you omit it, it's lost."

3. **Re-run W0b.1 prototype** with the patched prompt to verify transcript regression is fixed on segment f36d686b (the talking-head test).

Hard gate: Domis approves W0b.2 output before W0b.3 starts.

Brief should be delivered under Option B — agent executes, pushes, reports, awaits merge approval. No Domis laptop commands. See `GIT_WORKFLOW.md` session-end checklist.

---

## Architectural documents (for deeper reference)

- **`PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — full spec for segment analyzer work (SegmentV2.1 schema, two-pass design, per-parent batching, backfill plan)
- **`PHASE_4_PART_B_PIPELINE.md`** — full spec for downstream Planner/Director/Critic/Copywriter work (depends on Part A completion)
- **`GIT_WORKFLOW.md`** — Option B workflow rules (agent-owned git)
- **`CLAUDE.md`** — architecture rules (Rule 1-29 historical, additions in `CLAUDE_MD_ADDITIONS.md` from this session)
- **`MVP_PROGRESS_12.md`** — current status snapshot (supersedes MVP_PROGRESS_11)
- **`SESSION_GUIDE.md`** — the three-person loop and brief-writing conventions
- **`SUPABASE_SCHEMA.md`** — database schema
- **`VIDEO_PIPELINE_ARCHITECTURE_v6.md`** — full pipeline architecture (still authoritative for infrastructure; Phase 4 specifics are now in Part A/Part B docs)

---

## Anti-patterns to avoid

**Don't do what the previous chat did wrong:**

1. **Don't hand Domis long copy-paste command sequences.** Under Option B, the agent runs commands. Briefs go to the agent; summaries go to Domis.

2. **Don't restate git rules in every brief.** `GIT_WORKFLOW.md` is canonical. Reference it.

3. **Don't assume model names or SDK versions.** Pin them, verify them, document them. Gemini model IDs shift; Gen AI SDKs have migrated.

4. **Don't let branches stack.** Max depth 1, and only for multi-stage work on the same conceptual feature. Everything else branches from main.

5. **Don't skip Zod validation on Gemini output.** Gemini's `responseSchema` is strict but still benefits from defense-in-depth at the consumer.

6. **Don't mix scopes in one branch.** W0b is segment analyzer work; if you notice a CTA overlay bug, it gets its own branch.

7. **Don't backfill without a feature flag and checkpointing.** 903 segments × 30-60s each = hours. You will want to pause/resume; you will want to roll back; design for that.

8. **Don't invent exercises the library doesn't have.** This was the original Phase 3 failure mode. The `library_inventory` module exists specifically to prevent it. Phase 4 enforces it structurally via `exercise.name` being nullable with confidence gating.

---

## Context on the user (Domis)

- Lithuanian, based in Vilnius, academic background (recently completed bachelor's thesis at Vilnius University)
- Runs 30+ brands, operates as a builder/orchestrator across automated systems
- Stack fluency: n8n, Supabase, Google Sheets as operator interfaces, Hetzner VPS
- Communication style: direct, spelling occasionally loose (not a style judgment, just a fact — don't over-correct or dwell), action-oriented. Prefers quick decisions over protracted analysis.
- Frustration triggers: copy-paste commands that don't work, branch pile-ups, re-litigating decisions already made.
- Reward signals: fast iteration, clean execution, the agent handling git without his involvement.

---

*This handoff was written 2026-04-20 following a long working session where Phase 4 W0a shipped, W0b.1 completed, and Option B git workflow was adopted. The previous chat is approaching context limits; this doc captures state so a fresh chat can pick up cleanly on W0b.2.*
