# MVP Progress 15 — 2026-04-21 (evening)

**Supersedes:** MVP_PROGRESS_14.md
**Status cutoff:** end of 2026-04-21. W1 closed. W1.5 in flight. W2 in design. W10 added to plan.

---

## Headline

**W1 shipped + strategic reframe of Part B creative direction.** Two things happened today:

1. **W1 (keyframe grids) closed cleanly.** 720/720 v2 segments gridded, flag flipped, VPS deployed. Visual Director (W5) now has its multimodal input tool. Ingestion auto-generates grids for new content.

2. **Mid-W1 Gate B, a strategic concern surfaced** ("we might be over-focusing on exercise-reel-making") that led to a meaningful reframe of Part B's scope and success criteria. Result: two-axis Form × Aesthetic Posture model (replacing single-archetype enum), hook mechanism as first-class Planner output, voice generation added as post-shadow W10 extension, success criterion shifted from auto-QA pass rate to organic-creator-plausibility + form diversity.

Secondary: **Content Sprint 2 kicked off.** Domis uploading ~2x additional nordpilates content via n8n to VPS ingestion. Library will roughly double (190 → ~400 parents, 720 → ~1500 segments). No agent action needed; runs autonomously.

Library state at close of W1:
- 190 parents, 720 segments, 100% v2 coverage
- 720/720 grids generated, 0 null
- `ENABLE_SEGMENT_V2=true` + `ENABLE_KEYFRAME_GRIDS=true` both live
- Content Sprint 2 ingesting in background

---

## What shipped this session

### To production

**W1 — Keyframe grids** (merged to main 2026-04-21, commit `ac62067`):
- Migration 009: `keyframe_grid_r2_key TEXT` column on `asset_segments`
- `src/lib/keyframe-grid.ts`: 4×3 portrait mosaic at 1024×1365, JPEG q80, EXIF IFD0.ImageDescription with per-grid metadata
- `src/scripts/backfill-keyframe-grids.ts`: 2-way parallel, checkpointed, `--smoke`/`--full`/`--dry-run`/`--resume`
- `src/workers/ingestion.ts`: post-v2-analysis grid generation gated by `ENABLE_KEYFRAME_GRIDS`
- `src/scripts/test-keyframe-grid.ts`: single-segment validator (Gate A)
- VPS deployed, flag flipped, checkpoints archived to R2 `backups/w1-checkpoints-20260421/`

### To docs (planning chat output, commit pending agent)

- **`docs/w2-content-form-taxonomy.md` v1** — canonical form/posture playbook. 16 forms × 5 postures, nordpilates allowlist. Source of truth for Planner form_id enum.
- **`HANDOFF_TO_NEW_CHAT.md`** — refreshed for post-W1, Content-Sprint-2-in-flight, W2-in-design state.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — updated workstream sequence (W1.5 + W10 inserted), W2/W3 specs revised for two-axis model + hook mechanism.
- **`docs/MVP_PROGRESS_15.md`** — this doc.
- **`docs/CLAUDE.md`** — Rules 40 + 41 added.

### W1 operational deviations (worth documenting)

- **Test-segment UUIDs were stale.** Part A doc (`PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` §Test segments) lists UUIDs that predate W0d re-segmentation. Agent picked a live segment (`93558eea-…`) for Gate A and noted the swap. Part A doc should get a 1-line update noting "Listed UUIDs predate W0d — for post-W0d test runs, query the live v2 library." Deferred to a docs chore.
- **EXIF tag swap.** Brief specified UserComment; agent used ImageDescription because UserComment (EXIF 2.3) requires an 8-byte character-code prefix that sharp doesn't apply. Documented inline in keyframe-grid.ts.
- **ffmpeg filter swap.** Brief specified `decrease,pad`; agent used `increase,crop` because 1920 × (256/1080) = 455.11 rounds to 456 and pad refuses to shrink. Correct for 9:16 source (lossless); center-crops non-portrait source if raw-fallback path ever fires. Documented in inline comment + logged as followup `w1-raw-fallback-crop`.
- **Backfill network blip mid-run.** Cloudflare R2 DNS ENOTFOUND during full backfill (14:39 UTC). Script bailed gracefully, checkpoint preserved, resume completed cleanly. Pattern worth keeping for future scripts: unattended runs need clean bail + resume, not just retry.

### Gate B visual spot-check finding

Domis eyeballed 5 smoke mosaics. Mechanically clean (dimensions, file size, EXIF all correct). Content-wise, 1 of 5 shows a `segment_type` mismatch — segment `0dbfbc89-…` labeled `transition`, visual evidence suggests `exercise` or `hold`. Sample too small to estimate library error rate. Logged as `part-a-classification-noise-spotcheck` — active, not blocking. Relevant only if W5 Visual Director later shows signal that the type filter mis-buckets content.

---

## Strategic reframe (the important shift)

Mid-W1 Gate B, Domis raised: *"Im starting to worry about the variety of clip classification... this might be a hidden constraint in the lack of different clip namings... we are over-focusing on exercises and treating this project as organic exercise reel maker. This is our downfall."*

This was a legitimate strategic concern, not a tactical issue. Planning chat and Domis worked through it. Outcome:

1. **Segment taxonomy (Part A) is accepted as fixed.** Not because it's perfect — the 8-type taxonomy is fitness-shaped and 1-of-5 spot-check surfaced a mislabel. Accepted because (a) creative problems are better solved upstream in persona + Planner, not via structural-label expansion, and (b) re-analysis is too expensive post-W0d to revisit casually.

2. **Creative variance lives in W2/W3/W7.** Brand persona (W2) carries the content playbook. Planner (W3) commits to form + hook_mechanism. Copywriter (W7) delivers on the hook mechanism. Segment taxonomy is an ingredient list, not the recipe book.

3. **Form × Aesthetic Posture two-axis model.** Old: single-archetype enum. New: FORM (structural shape) + AESTHETIC POSTURE (tonal/visual framing) as separate axes. Brand persona restricts posture; Planner commits to form per video. 16 forms × 5 postures. Nordpilates allowlist ≈ 38 form-posture combinations.

4. **Hook mechanism as first-class Planner output.** Every form has a hook mechanism — specific-pain-promise / visual-pattern-interrupt / opening-energy / authority-claim / confessional-vulnerability / narrative-intrigue / trend-recognition. Planner picks both form and mechanism; Copywriter delivers on the mechanism.

5. **Success criterion shifted.** Old: auto-QA pass rate. New: organic-creator-plausibility + form diversity across output library. Auto-QA remains a necessary gate but is not the bar.

6. **Voice generation added as W10.** ElevenLabs (or equivalent) integration post-shadow-mode, unlocks ~30% of form taxonomy currently talking-head-gated. Deferred to W10 (not W7.5) deliberately: voice adds complexity that should not mask foundational problems during Part B validation. If Part B ships well without it, voice is pure upside.

7. **Chose Path C (variant).** Ship nordpilates pipeline on existing Part A schema. Use W2/W3 as the levers for creative variance. Evaluate at W9 shadow-mode whether the approach actually produces "pleasurable to watch, feels organic, not selling" content on nordpilates. If it does, generalize to other brands. If not, we'll know the upstream design (not the schema) is the problem.

---

## What's broken or flagged

### Active followups

- **`part-a-classification-noise-spotcheck`** — 1-of-5 segment_type mismatch surfaced in W1 Gate B. Not blocking. Revisit if W5 Visual Director rejection rates suggest type filter mis-bucketing.
- **`w1-raw-fallback-crop`** — W1 grid generator uses increase+crop, center-cropping would harm non-portrait raw-fallback source. Deferred; hypothetical edge case post-W5 production data.
- **`part-a-test-segment-uuid-drift`** — Part A doc lists stale test segment UUIDs. Docs-only fix.

### Technical debt carried forward (not Part B issues)

- Grandfathered dirty tree (`chore/audit-pre-W0-cruft`)
- Duplicate `GIT_WORKFLOW.md` on main (root + `/docs/` — root is stale)
- 11+ old origin branches (hygiene cleanup)
- VPS `pre-W0-*` stashes

None of these block Part B.

### n8n pause state monitoring

From W0d: n8n workflow pause self-reports weren't reliable. Programmatic verification needed for future destructive operations. W1 didn't require pause (non-destructive); W1.5 also doesn't. Future destructive operations should include programmatic pause-state verification.

---

## Decisions made this session

### Architectural

1. **Form × Posture two-axis model.** See above. Encoded as Rule 41.
2. **Segment taxonomy fixed as Part A contract.** See above. Encoded as Rule 40.
3. **Hook mechanism as first-class Planner output.** Three-field commitment: form_id + hook_mechanism + narrative_beat.
4. **Voice generation as W10, post-shadow-mode.** Not W7.5. Not during core Part B. Brand persona schema reserves `voice_config: null` field now for cheap W10 field-population later.
5. **Success criterion: organic-plausibility + form diversity over auto-QA pass rate.** Measured via human review at shadow + ramp phases.
6. **Forms dropped or deferred from taxonomy:** Transformation Before/After, Challenge/Protocol teaser, Client Testimonial, Milestone Celebration, Tutorial Carousel, Studio Tour, What-I-Wish-I-Knew (collapsed into Teacher-Cue-Drop). 16 forms remain.
7. **Forms #1 and #17 from draft merged** — Targeted Microtutorial absorbs For-Specific-Audience via `audience_framing` variable.

### Workflow / process

1. **Strategic concerns during tactical work deserve strategic response.** Domis raised "this is our downfall" framing mid-W1 Gate B. Planning chat paused tactical work, reframed Part B, then resumed. Outcome: better scope than if we'd shipped on autopilot. Pattern worth preserving: when Domis surfaces a concern framed at the strategic level, treat it as a design signal, not an objection to manage.
2. **File-based briefs (docs/briefs/) continue to work.** W1 brief delivery + Gate A/B/C reporting cycle validated for a full multi-day workstream with 3 gates, visual spot-check, and clean close.
3. **Intermediate gates within a branch continue to earn their keep.** W1 Gate A caught stale UUIDs + EXIF prefix issue + ffmpeg rounding BEFORE the destructive backfill run. Same pattern as W0d.
4. **"Don't send the agent everything; send what it needs to act on."** When Gate A returned with three decisions requiring acks, planning chat distilled to a 5-line agent message rather than forwarding the full reasoning chain. Planning-chat context = audit trail; agent context = execution-ready.

### Rejected options

- **Path A** (validate concern before acting) — skipped; Domis was decisive, and Path C with the two-axis reframe addresses the concern without the delay of validation.
- **Path B** (widen segment taxonomy, re-analyze) — rejected; too expensive, and creative variance belongs upstream.
- **Voice generation as W7.5** — rejected in favor of W10. Additive, not foundational.
- **Collapse form and posture into single enum** — rejected; separately extensible two-axis model is the right structure for 30-brand expansion.
- **Defer documentation updates** — rejected. Five architectural decisions in one session is exactly the moment to write them down, not "after we finish W2."

---

## Pipeline status at a glance (updated)

| Stage | Phase 3.5 | Part A | Part B |
|---|---|---|---|
| Ingestion | ✅ Running v1 | ✅ V2 flag ON | — |
| Segment analysis | ✅ Running (v2) | ✅ 720/720 v2 | — |
| **Keyframe grids** | — | — | ✅ **720/720 gridded, ingestion auto-generates** |
| **Content Sprint 2** | — | — | 🟡 **in progress** |
| Creative Director | ✅ Running (Claude) | — | 🔴 Replaced by Planner (W3) |
| Brand persona | ✅ Minimal | — | 🔵 **W2 in design** |
| Planner | — | — | 🔴 W3 not started (unblocked after W2) |
| Retrieval RPC | ✅ v1 match_segments | — | 🔴 W4 not started |
| Visual Director | — | — | 🔴 W5 not started |
| Coherence Critic | — | — | 🔴 W6 not started |
| Copywriter | ✅ Running (Claude) | — | 🔴 W7 not started |
| Orchestrator | ✅ Phase 3.5 | — | 🔴 W8 not started |
| Shadow rollout | — | — | 🔴 W9 not started |
| **Audio generation** | — | — | 🔴 **W10 added — post-shadow** |
| Remotion render | ✅ Running | — | (unchanged) |
| Platform export | ✅ Running | — | (unchanged) |

Legend: ✅ production · 🟢 complete · 🔵 in design · 🟡 in progress · 🔴 not started · — not applicable

---

## Immediate next action

1. Monitor Content Sprint 2 ingestion. Watch `assets` row count stabilize.
2. Once stable: pull updated library inventory + classify b-roll lifestyle-vs-exercise-adjacent.
3. Refresh readiness flags in `docs/w2-content-form-taxonomy.md` with real numbers.
4. Write W2 brief at `docs/briefs/w2-brand-playbook.md`. Include voice-evaluation prep step.
5. Agent executes W2.

---

## References (canonical post-W1)

- **`docs/HANDOFF_TO_NEW_CHAT.md`** — refreshed, read first.
- **`docs/w2-content-form-taxonomy.md`** — NEW, canonical form/posture playbook.
- **`docs/PHASE_4_PART_B_PIPELINE.md`** — updated for W1.5 + W10 + two-axis + hook mechanism.
- **`docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md`** — Part A spec, fully implemented.
- **`docs/CLAUDE.md`** — 41 rules now (+40 + 41 this session).
- **`docs/GIT_WORKFLOW.md`** — unchanged.
- **`docs/SUPABASE_SCHEMA.md`** — current through Migration 009.
- **`docs/VPS-SERVERS.md`** — unchanged.
- **`docs/followups.md`** — three new entries this session (classification-noise, raw-fallback-crop, test-segment-uuid-drift).
- **`docs/content-library-gaps.md`** — DEFERRED, post-Sprint-2.

---

## Architecture rule count

CLAUDE.md has 41 rules at W1 close. Rules 40 (creative-variance-lives-upstream-not-in-taxonomy) and 41 (form-and-posture-are-orthogonal-axes) added in this session's docs commit.

---

*MVP Progress 15 authored 2026-04-21 evening. W1 shipped. Content Sprint 2 running autonomously. Part B scope reframed with two-axis model, hook mechanism, and W10 voice deferral. W2 brief-writing unblocked after Content Sprint 2 meaningfully completes and library inventory refreshes.*
