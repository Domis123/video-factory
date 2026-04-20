# MVP Progress 12 — 2026-04-20

**Supersedes:** MVP_PROGRESS_11.md
**Status cutoff:** end of Phase 4 W0b.1; W0b.2 next.

---

## What shipped this session

### To production (merged to main, running on VPS)

- **Phase 3.5 architecture pivot** (commits fd63a35, 5327188) — library_inventory module, body_focus matching, post-selection copywriter context, exercise-naming style constraints.
- **Quick wins** (commits a9be904, c71e1ae) — setup-clip hard filter in curator, subject_consistency field + curator enforcement (single-subject / prefer-same / mixed modes).
- **Phase 4 W0a prototype** (commit afde783) — SegmentV2 schema, two-pass analyzer, tested on 3 segments.
- **All three merged** via commit 919ee73.

### In progress (on `feat/w0b-segment-v2-integration`)

- **W0b.1** (commit 0a024f0) — Schema v2.1 deltas: `form_rating` enum refined per Gemini self-critique, `setting.on_screen_text` added for OCR, `speech` block renamed to `audio` with `audio_clarity` sub-field added. Re-prototype on 3 segments. Zero Zod validation failures.
- **GIT_WORKFLOW.md v1** (commit 300e374/57598a1) — initial git rules documentation.
- **GIT_WORKFLOW.md v2** (commit 0b8e6c6) — updated to Option B workflow (agent owns merges).

---

## What's broken or flagged

### Known regressions

- **W0b.1 transcript regression.** On the talking-head test segment (f36d686b), W0b.1 returned `audio.transcript_snippet: null` with `audio.has_speech: true`. Same clip, same model — W0a returned the full transcript. Hypothesis: CoT preamble pulled Gemini's attention from transcription. **Fix deferred to W0b.2** — one-line prompt constraint: "If has_speech=true, transcript_snippet MUST NOT be null."

### Known inefficiencies

- **Pass 2 latency variance.** W0a wall time: 27-42s/segment. W0b.1 wall time: 27-102s/segment. Agent attributes to Files API polling variance. **Mitigation:** per-parent batching in W0b.3 reduces uploads to 1/parent, eliminating most polling cost per segment.

### Grandfathered dirty tree

- Both agent sandbox and VPS have uncommitted changes from before W0 work started (CLAUDE.md modification, 9 `docs/` deletions, 6 untracked files including context_packets and newer docs).
- Decision: **do not clean up until post-W0b**. Earmarked for a future `chore/audit-pre-W0-cruft` branch. Using `git add <file>` explicitly per commit prevents any dirty-tree bleed into W0 commits.

### Git backlog cleanup

- Three approved branches (pivot, quick-wins, W0a) were deleted from origin after merge.
- 11 additional older branches remain on origin (phase3-w2-curator, env-gemini-cleanup, etc.).
- Weekly hygiene cleanup pending — not blocking; earmarked for next Friday.

---

## Decisions made this session

### Architectural

1. **Phase 4 split into Part A (Segment Intelligence) + Part B (Pipeline).** Canonical docs: `PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`, `PHASE_4_PART_B_PIPELINE.md`.
2. **Gemini 3.1 Pro Preview confirmed as flagship.** Model string: `gemini-3.1-pro-preview`. Pinned in env as `GEMINI_INGESTION_MODEL`.
3. **Gemini everywhere** — including Planner (W3) and Copywriter (W7), moving from Claude. Accept prompt re-tuning cost.
4. **SDK migration to `@google/genai`** for all new code. Old SDK coexists until post-W0d.
5. **Two-pass segment analysis** — 1 FPS boundaries + 5 FPS per-segment deep.
6. **Per-parent batching** — upload once, analyze N segments, delete once.
7. **Schema v2.1** — three additions from Gemini self-critique incorporated (on_screen_text, audio_clarity, form_rating refined). Rejected: numeric hook_score (LLM clustering bias), funnel_stage_fit (wrong mental model for organic content), safe_to_crop_9x16 (source is already 9:16).

### Workflow

1. **Option B git workflow adopted.** Agent owns full git cycle (branch/commit/push/merge/delete/deploy/rollback). Domis approves in chat. Planning Claude writes briefs. Canonical doc: `GIT_WORKFLOW.md` v2.
2. **Documentation flow:** chat-authored → downloaded for Domis review → agent files to repo. Laptop is review surface, not a git working tree that Domis has to maintain.
3. **Hard gates between multi-stage work.** W0b.1 → W0b.2 → W0b.3 all on one branch with explicit Domis approval between stages.

### Rejected options

- **Dropping git entirely.** Would lose undo capability + off-site backup. Current pain was process, not tool.
- **Funnel stage classification.** Direct-response concept; Video Factory is organic-only. Would produce hallucinated classifications.
- **Numeric hook scores.** LLMs cluster at 7-8; enums are more reliable.

---

## Technical gotchas discovered

1. **Gemini `responseSchema` rejects non-string enums.** Even for conceptually numeric values (count: 1/2/3+, schema_version: 2). Use `z.enum(['1','2','3+'])` and `z.literal('2')`. Convert at consumer.
2. **`parent_asset_id` is the correct column name** on `asset_segments` (not `asset_id`). Verified via direct query. Older design docs had this wrong.
3. **Gemini preview model IDs alias forward.** `gemini-3-pro-preview` was deprecated March 9, 2026 and now aliases to `gemini-3.1-pro-preview`. Pin explicit model IDs; don't rely on aliases.
4. **`zod-to-json-schema` needs `$refStrategy: 'none'`** — Gemini rejects $ref-heavy schemas.
5. **CoT preamble can pull model attention from specific fields.** Defensive: hard constraints in prompt ("MUST not be null") for critical fields.
6. **Gemini best practice: text AFTER video in contents array.** Not before.
7. **`@google/genai` (new SDK) vs `@google/generative-ai` (old SDK)** — new SDK supports Gemini 3 features better. Install both during migration.

---

## Immediate next action

**Write W0b.2 brief.** Scope:
1. Pass 1 boundary validation on 3 parents (parents of f9788090, 03c60575, f36d686b) — compare Pass 1 output vs existing v1 segments, print diff analysis
2. Patch Pass 2 prompt for transcript regression fix
3. Re-run W0b.1 prototype with patched prompt on segment f36d686b to confirm fix

Deliverable under Option B — agent executes, pushes, reports, awaits approval.

---

## What comes after W0b.2

- **W0b.3:** per-parent batching + end-to-end smoke on 1 parent
- **W0c:** ingestion integration + feature flag + backfill script
- **W0d:** execute backfill of ~903 segments
- **Part B kickoff:** W1 (keyframe grids) + W2 (nordpilates brand persona)
- **Part B full build:** W3 (Planner) through W9 (shadow mode rollout)

Full timeline estimate: W0 complete in ~1 week, Part B in ~4-6 weeks. Video Factory v2 running in shadow by mid-May 2026 target.

---

## Pipeline status at a glance

| Stage | Phase 3.5 | Phase 4 Part A | Phase 4 Part B |
|---|---|---|---|
| Ingestion | ✅ Running | 🟡 Partial (prototype done) | — |
| Segment analysis | ✅ Running (v1) | 🟡 W0b in progress | — |
| Creative Director | ✅ Running (Claude) | — | 🔴 Blocked on Part A |
| Curator | ✅ Running (Gemini) | — | 🔴 Blocked on Part A |
| Copywriter | ✅ Running (Claude) | — | 🔴 Blocked on Part A |
| Remotion render | ✅ Running | — | — |
| Platform export | ✅ Running | — | — |

Legend: ✅ production · 🟡 in progress · 🔴 not started · — not applicable
