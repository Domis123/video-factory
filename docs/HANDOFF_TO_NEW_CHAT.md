# Handoff to New Chat — 2026-04-21 (evening)

**Read this first.** Everything else in `/docs/` is reference material; this doc tells you what's current and what to do next.

Supersedes the prior handoff (W1-start-of-day). W1 closed clean; Part B is now mid-design with material architectural changes — read carefully.

---

## TL;DR

Video Factory is an automated short-form video pipeline for ~30 organic (non-ad) fitness/wellness brands. Primary test brand: **nordpilates**. The pipeline ingests UGC footage, analyzes it into sub-segments with rich structured metadata (Part A), then assembles ~30-second TikTok/Reels/YouTube Shorts via AI planning + rendering (Part B, rebuilding).

**Part A (segment intelligence foundation): COMPLETE.** Library is 100% on v2 schema — 720 segments across 190 nordpilates parents, all with structured metadata.

**W1 (keyframe grids): COMPLETE (2026-04-21).** 720/720 segments have `keyframe_grid_r2_key` populated, 4×3 portrait mosaics at 1024×1365 JPEG q80 with EXIF metadata. `ENABLE_KEYFRAME_GRIDS=true` live on VPS; new v2 segments auto-generate grids.

**W1.5 (Content Sprint 2 ingestion): IN PROGRESS (2026-04-21 evening).** Domis is uploading ~2x additional nordpilates content to Drive. n8n S8 workflow + VPS ingestion worker are handling it autonomously via the live v2 path. Library will roughly double (720 → ~1500 segments, 190 → ~400 parents). No agent action required; ingestion auto-runs.

**W2 (brand persona / form taxonomy): IN DESIGN (this session).** Major reframe — see "Creative direction reframe" below. Brief not yet written. Taxonomy draft finalized as v1 (`docs/w2-content-form-taxonomy.md`). W2 brief writing unblocked after: (a) Content Sprint 2 is meaningfully ingested so readiness flags are real numbers, (b) Planning chat + Domis review converged taxonomy + voice-evaluation step.

**Part B (pipeline rebuild): sequence revised.** W1 → W1.5 → W2 → W3 → W4 → W5 → W6 → W7 → W8 → W9 → **W10 (voice generation, added this session, deferred to post-shadow-mode)**.

**Immediate next action:** (a) wait for Content Sprint 2 to ingest meaningfully (measured as `SELECT COUNT(*) FROM assets WHERE brand_id='nordpilates'` stabilizing), (b) pull updated library inventory and audit the ⚠️/🔴 form readiness flags in the taxonomy, (c) write the W2 brief at `docs/briefs/w2-brand-playbook.md`.

---

## What Video Factory is (unchanged)

- **Purpose:** generate short-form video content at scale for ~30 brands (nordpilates, Nordletics, Mindway, Carnimeat, Ketoway, etc.)
- **Output target:** 150–300 videos/week at steady state (currently ~5–10/week)
- **Audience:** organic social (TikTok / Instagram Reels / YouTube Shorts). **Not ads.** Optimized for retention and brand-building.
- **Creative north-star (refined this session):** "pleasurable to watch, feels organic, not selling anything." Retention through pleasure, not persuasion. Hook is load-bearing.

## Infrastructure (unchanged)

- **n8n server:** 46.224.56.174 — orchestration workflows
- **Video Factory VPS:** 95.216.137.35 (Hetzner CX32) — `/home/video-factory`
- **Database:** Supabase at `https://kfdfcoretoaukcoasfmu.supabase.co`
- **Object storage:** Cloudflare R2
- **Queue:** Upstash Redis
- **LLM stack:** Gemini 3.1 Pro Preview (`gemini-3.1-pro-preview`) for everything in Part B. Phase 3.5 production still uses Claude Sonnet 4.6 for CD + Copywriter; migrating to Gemini during Part B build-out.

---

## Current state (end of day 2026-04-21)

### Production (Phase 3.5, still running)

Library-aware CD (Claude) → Asset Curator V2 (Gemini) → Copywriter (Claude) → Remotion render. Videos pass auto QA. NOT being disrupted during Part B — new pipeline builds in parallel, shadow mode first.

### Part A (shipped)

- 190 nordpilates parents, 720 segments, 100% v2 coverage
- Dual-write pattern: v2 JSONB + legacy v1 columns
- `ENABLE_SEGMENT_V2=true` on VPS; new ingestion uses v2 path

### W1 (shipped today)

- Migration 009 applied: `keyframe_grid_r2_key TEXT` column on `asset_segments`
- `src/lib/keyframe-grid.ts` + backfill + ingestion integration
- 720/720 segments gridded, 0 null
- `ENABLE_KEYFRAME_GRIDS=true` live on VPS
- 7 window-fallback + 12 missing-tile warnings during backfill, all degraded-ok per spec
- Operational note: swapped from brief's `IFD2.UserComment` to `IFD0.ImageDescription` for EXIF (prefix-byte issue); swapped from `decrease+pad` to `increase+crop` in ffmpeg filter (even-dimension rounding). Both documented inline in `src/lib/keyframe-grid.ts`.
- Known issue from Gate B spot-check: 1-of-5 visual mismatch between `segment_type` label and visual content (segment `0dbfbc89-…` labeled `transition`, looks like exercise/hold). Logged in followups; not blocking — Part B is pivoting to solve creative variance upstream, not via segment taxonomy.

### W1.5 (in progress as of this handoff)

- Content Sprint 2 upload started in n8n
- Live auto-ingestion path: Drive → S8 → VPS `/ugc-ingest` → `preNormalizeParent` → v2 analyzer → keyframe grid → R2 + Supabase
- No agent action needed; library populates autonomously
- Watch-signal: `SELECT COUNT(*) FROM assets WHERE brand_id='nordpilates'` climbs from 190 to ~400 over hours-to-days depending on upload volume
- Expect ~4-6 min/parent batched ingestion time

### W2 (in design this session — no code written)

- Taxonomy draft at `docs/w2-content-form-taxonomy.md` (v1, 16 forms, 5 aesthetic postures, nordpilates-specific Form×Posture allowlist)
- Brief NOT yet written
- Prerequisite for writing brief: Content Sprint 2 meaningfully ingested so ⚠️/🔴 readiness flags can be refreshed with real numbers
- Voice-selection step (ElevenLabs sample audition) added to W2 as a non-blocking preparation step for W10

### W3–W9 (not started)

See Part B spec (`docs/PHASE_4_PART_B_PIPELINE.md`). W3 unblocked after W2 ships. Revised scope notes below.

### W10 (audio generation, new)

Added this session as post-shadow-mode extension. See "Voice generation" below.

---

## Creative direction reframe (IMPORTANT)

This session surfaced that Part B's original framing — "fix clip-picking to match intent" — was necessary but insufficient. The real goal is producing videos that feel like organic creator content, not AI-produced slop. That reframe introduced several architectural decisions that Part B docs now encode:

### 1. Segment taxonomy (Part A) is accepted as fixed

Not because it's perfect — the nordpilates sample surfaced 1 likely mislabel out of 5 spot-checked, and the 8-type taxonomy is fitness-shaped. Accepted because (a) creative problems should be fixed upstream in persona+Planner, not by expanding structural labels, and (b) post-W0d, re-analysis is too expensive to revisit casually. Logged as CLAUDE.md Rule 40.

### 2. Form × Aesthetic Posture two-axis model

Old: single-archetype enum.
New: FORM (structural shape — what's the video made of) + AESTHETIC POSTURE (tonal/visual framing — how does it feel) as separate axes. Brand persona restricts posture mix; Planner commits to form per video. Each form producible in multiple postures.

16 forms + 5 postures. Nordpilates allowlist ≈ 38 form-posture combinations. Logged as CLAUDE.md Rule 41.

### 3. Hook mechanism as first-class Planner output

Every form has a "hook mechanism" — the specific reason the first 1.5 seconds work. Not the hook's words; the hook's *why*. 7 mechanisms observed across the form taxonomy: specific-pain-promise, visual-pattern-interrupt, opening-energy, authority-claim, confessional-vulnerability, narrative-intrigue, trend-recognition.

Planner output schema (W3) includes `form_id` + `hook_mechanism` + `narrative_beat` — three coupled but distinct fields.

### 4. Success criterion shifted

Old: "auto-QA pass rate" (technical).
New: "organic-creator-plausibility + form diversity across the output library" (qualitative). Auto-QA remains a necessary gate but is not the bar. Measured via human review at shadow-mode phase + spot-check of 30-50 random outputs during Part B ramp.

### 5. Voice generation as post-shadow Part B extension (W10)

ElevenLabs or equivalent integrated AFTER W9 shadow mode proves the text-only pipeline works. Unlocks ~30% of the form taxonomy currently talking-head-gated (Teacher-Cue Drop, Myth-Buster variants, potentially Reaction). Adds Posture P6 (Voice-Over-Led). Brand persona schema at W2 already includes `voice_config: null` to keep W10 as field-population, not schema migration.

Deferred to W10 (not W7.5) because: (a) voice adds complexity that should not mask foundational problems during Part B validation, (b) if Part B ships well without it, voice is pure upside, (c) if Part B struggles, we want visibility without VO hiding issues.

---

## Infrastructure of Part B work (unchanged from prior handoff)

### The three-person loop

- **Planning Claude:** design architecture, write briefs as markdown files in `docs/briefs/`, review agent output, update docs
- **Domis:** approve briefs, approve merges, strategic direction, paste agent reports back
- **Claude Code agent (VPS sandbox):** read brief files, execute code changes, run git operations, deploy VPS

### Brief-writing conventions (unchanged)

- Briefs go to `docs/briefs/<stage>.md`
- Each brief: scope, branch name, files to create/modify, files NOT to touch, expected deliverable, commit message templates, hard constraints, gates for merge
- Briefs reference `GIT_WORKFLOW.md`, `CLAUDE.md`, `docs/PHASE_4_PART_B_PIPELINE.md` — don't restate
- Hard gates for multi-stage work ("STOP after Task 1, await Domis approval before Task 2")
- Explicit non-goals section

### Agent scope discipline (proven through W0 + W1)

Continues to work. Agent pushed back on correct assumptions during W1 Gate A (stale test-segment UUIDs, EXIF prefix issue, ffmpeg rounding). Trust its reviews, read critically.

---

## Immediate next actions (prioritized)

1. **Monitor Content Sprint 2 ingestion.** Domis is uploading; n8n + VPS handle autonomously. Watch `assets` row count. Spot-check a random new asset's v2 analysis + keyframe grid during first hour to verify ingestion is firing correctly on fresh content.

2. **Pull updated library inventory** once ingestion stabilizes. Specifically:
   - Total segments count
   - `segment_type` distribution (especially talking-head count — is the bottleneck relieved?)
   - `b-roll` lifestyle-vs-exercise-adjacent breakdown (new query — classifies via `setting.location` + `setting.equipment_visible`)
   - Long-hold segments (≥10s for Cinematic Slow-Cinema viability)
   - Same-exercise-name distribution (for Single-Exercise Deep-Dive viability)

3. **Refresh taxonomy readiness flags** with real numbers. Promote ⚠️/🔴 forms to ✅ where Sprint 2 unblocks them. Log remaining gaps to `docs/content-library-gaps.md`.

4. **Write W2 brief** at `docs/briefs/w2-brand-playbook.md`. Scope: define brand persona schema, author nordpilates persona document, include voice-evaluation prep step for future W10.

5. **Write W3 brief** after W2 ships. Updated scope vs. original Part B spec: Planner output includes `form_id` + `hook_mechanism`; `content_form` supplements/replaces `archetype`.

---

## Architectural documents (reference)

- **`docs/w2-content-form-taxonomy.md`** — **NEW this session.** Canonical form/posture playbook. Source of truth for Planner form_id enum.
- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, fully implemented. Reference for v2 schema fields.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — Part B spec. **Updated this session** with W1.5 + W10, two-axis model in W2/W3, hook-mechanism in W3.
- **`docs/MVP_PROGRESS_15.md`** — **NEW this session.** Supersedes MVP_PROGRESS_14. W1 closed, W1.5 in-flight, W2 designed, W10 added.
- **`docs/CLAUDE.md`** — Architecture rules. **New this session: Rules 40 + 41.**
- **`docs/content-library-gaps.md`** — NEW (deferred to post-Sprint-2 when real gap numbers are known).
- **`docs/GIT_WORKFLOW.md`** — Option B, unchanged.
- **`docs/SUPABASE_SCHEMA.md`** — DB schema, current through Migration 009.
- **`docs/VPS-SERVERS.md`** — infrastructure.
- **`docs/w0d-complete.md`** — historical closure breadcrumb.
- **`docs/followups.md`** — known issues.
- **`docs/briefs/`** — planning-chat-to-agent briefs (gitignored).

---

## Anti-patterns to avoid (updated)

1. **Don't paste briefs inline in chat.** File-based delivery via `docs/briefs/`.
2. **Don't restate git rules in every brief.** GIT_WORKFLOW.md is canonical.
3. **Don't assume model names or SDK versions.** `gemini-3.1-pro-preview`, `@google/genai`.
4. **Don't let branches stack.** Max depth 1, multi-stage work on same branch.
5. **Don't skip Zod validation on Gemini output.**
6. **Don't mix scopes in one branch.** Part B work revealing a Part A bug → separate branch.
7. **Don't refactor Phase 3.5 paths.** Still in production. Touch only via explicit migration workstreams.
8. **Don't promote confabulated output.** Rule 38.
9. **Don't add Zod refines that encode soft rules as hard constraints.** Rule 39.
10. **Don't grand-clean the grandfathered dirty tree** as part of Part B work. Still deferred.
11. **NEW: Don't try to solve creative-quality problems by expanding segment taxonomy.** Rule 40. Creative variance lives in persona + Planner + Copywriter prompts. Segment taxonomy is an ingredient list, not the recipe book.
12. **NEW: Don't collapse FORM and POSTURE into a single enum.** Rule 41. They're separately extensible. A new brand onboard probably restricts posture, not forms; a new trend probably adds a form, not a posture. Keep them orthogonal.
13. **NEW: Don't try to add voice generation during core Part B workstreams.** Deferred to W10 post-shadow-mode deliberately.

---

## Context on Domis (unchanged)

Lithuanian, based in Vilnius, academic background. Runs 30+ brands, operates as builder/orchestrator. Stack fluency: n8n, Supabase, Google Sheets, Hetzner VPS.

Communication style: direct, spelling occasionally loose (don't correct), action-oriented, prefers quick decisions. Frustration triggers: commands that don't work, branch pile-ups, re-litigating. Reward signals: fast iteration, clean execution, agent handling git without his involvement. Recent framing: "groundbreaking for the video pipeline industry." Take it seriously.

This session specifically: Domis raised a real strategic concern mid-W1 ("we are over-focusing on exercises and treating this project as organic exercise reel maker"). Planning chat and Domis worked through the reframe in dialogue, landed on: segment taxonomy is fixed, creative variance solved upstream. That pattern — real concern surfaced mid-tactical-work, strategic dialogue, doc updates, resume — is worth preserving. Take strategic concerns seriously when they surface; don't reflexively return to tactical work.

---

*Handoff written 2026-04-21 evening after W1 closed, Content Sprint 2 kicked off, and W2 design converged on taxonomy v1 + voice deferral to W10. Next planning chat (or this one post-ingestion-completion) should read this first.*
