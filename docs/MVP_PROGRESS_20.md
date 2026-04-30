# MVP Progress — Session 20

**Session date:** 2026-04-29
**Predecessor session:** Session 19 (2026-04-28: Polish Sprint pause, S8 chore, Simple Pipeline pivot)
**Successor:** New chat handoff for Editor agent workstream
**Headline outcome:** Simple Pipeline v1.0 + v1.1 built, iterated through three quality rounds, polished, merged to main, deployed. Production verification pending Editor agent ship.

---

## Session arc in one sentence

Simple Pipeline v1.0 shipped from c1 through c10 with two render-path bug fixes (graininess, audio-mute) and a major prompt iteration round driven by operator visual review (Q7 fired on meme path), then v1.1 cosmetic polish addressed logo + overlay sizing + N-line wrap algorithm — both versions merged to main, deployed, and production-verified pending Editor agent.

---

## What shipped this session

### Simple Pipeline v1.0 (10 commits c1-c10 + 3 quality rounds + 3 hotfixes)

**Branch:** `feat/simple-pipeline` from main `8723398`. Merged to main as commit `cc973d0`, branch deleted from origin.

Commit log:
- `ea0b2c9` c1: schema (3 migrations: render_history table, brand_configs.aesthetic_description column, jobs.status enum extension) + nordpilates aesthetic_description starter draft
- `1b3a08f` c2: Match-Or-Match agent (Gemini Pro library-aware picker, two output shapes for routine/meme)
- `b7aa43c` c3: overlay generators (routine + meme, separate prompts)
- `3b230cb` c4: cooldown tracker + parent picker
- `eab3671` c5: music selector wrapper (thin wrapper over existing logic)
- `d18f58d` c6: render path (ffmpeg pipeline, Pass A-D)
- `5b16e56` c7: orchestrator + worker + readiness endpoint
- `1718bdd` c8: n8n S1 routing JSON + /enqueue payload extension
- `dff51e9` c9: architecture doc + ingestion-naming + clip-rejection-cleanup followup
- `f74d13c` c10: Gate A verification artifact (12-render run)
- `8368747` audio-fix-1 (mid-c10): silent UGC clip handler in render Pass D
- `2532dfa` redis-limiter-fix (mid-c10): defensive 500 cmd/sec limiter on simple_pipeline worker
- `b858f08` Round 1: graininess fix — render reads pre_normalized parent + ffmpeg-trim (was reading 720p clip_r2_key, upscaling to 1080p, producing visibly grainy output)
- `47c1a50` Round 2: prompt iterations (Inv 1 meme register drift, Inv 2 routine same-parent visual redundancy, Inv 3 routine setup/transition literalism)
- `679d362` Round 3: verbatim overlay mode + no-speech UGC mute + 30s duration hint
- `afcb1d5`, `acb5d92` Round 3 hotfixes: ESM require() bug + drawtext apostrophe escape
- `9eb9c75` Round 3 close: routine + meme prompt-iteration followups filed

**Total: 19 commits + 3 quality rounds across ~36 hours of session time.**

### Simple Pipeline v1.1 (6 commits c1-c6 + 1 iteration round)

**Branch:** `feat/simple-pipeline-v1-1` from new main (post v1.0 merge). Merged to main, branch deleted.

Commit log:
- `1b21873` c1: logo size + position + opacity (0.075× height, 78% from top, 75% opacity)
- `d24b44d` c2: overlay text dynamic sizing + 2-line wrap + 27% from top
- `9986775` c3: Gate A verification artifact (6 render initial batch)
- `fbc5e08` c4: halve logo to 0.0375× (round of operator feedback after first Gate A)
- `645a990` c5: multi-line overlay box-padding fix (per-line dynamic padding to prevent inter-line darkening)
- `5668d90` c5 docs: iteration block + 2 future followups (logo-subject-collision, meme-generate-mode-iteration)
- `11aaf2a` c6: extend wrap algorithm to 1..5 lines before scale-down (operator feedback: 132-char text didn't fit at 2 lines + 29px scaled-down floor)
- `42b155c` c6 docs: iteration 2 block on Gate A doc

**Total: 8 commits across ~3 hours of session time.**

### Three migrations applied to Supabase

- 013: `simple_pipeline_render_history` table (3 indexes for cooldown queries)
- 014: `brand_configs.aesthetic_description TEXT NULL` + nordpilates seed
- 015: `jobs.status` enum extension (4 new values)

### Render path quality fix (graininess) — Round 1 of v1.0

The single most important architectural correction this session.

**Original brief:** Simple Pipeline read `clip_r2_key` (720p CRF 28 segment files, pre-cut at ingestion for cheap Gemini analysis).

**Symptom:** All 12 c10 first-run renders showed visibly grainy output. Operator confirmed Phase 3.5 produces HQ output from the same library.

**Root cause:** Render path was upscaling 720p CRF 28 segments to 1080p and re-encoding at CRF 18. CRF 18 cannot recover detail already lost at CRF 28; upscaler amplifies original compression artifacts.

**Fix (commit `b858f08`):** render.ts Pass A restructured. Reads `pre_normalized_r2_key` (1080×1920 30fps libx264, the full-quality normalized parent). Caches parent download across multi-segment routines from same parent. ffmpeg-trims each segment with `-c copy` (stream-copy, no re-encode). Single re-encode happens at Pass C when overlay/logo/grade are applied.

**Result:** Bitrate jumped from ~2.7 Mbps to ~5.07 Mbps for same dimensions. Operator visually confirmed HQ quality matching Phase 3.5.

**Lesson:** Brief-process gap. The original brief specified `clip_r2_key` reads as if those were the canonical post-ingest source for renders, but they were a Phase 2.5 ingestion-cost optimization, not a render input. Worth Rule 38-adjacent — pre-trimmed cached artifacts are NOT canonical sources for downstream rendering; verify upstream what the format/quality is before consuming. Filed as a docs note.

### Q7 visual review cycle (3 rounds)

**c10 first-run results:**
- Routine: 5/6 yes (Video 6 unusable: prep + outro only, no exercise content)
- Meme: 2-3/6 yes (instructor-voice register drift on overlays)

**Round 2 changes (commit `47c1a50`):**
- Inv 1: meme prompt rewrite — anchor on idea seed tone, not brand voice; few-shot meme examples
- Inv 2: routine prompt — penalize 3+ visually-similar consecutive picks
- Inv 3: routine prompt — discourage setup/transition/cooldown segment_types; agent over-indexed on segment_type names as flow positions

**Round 2 results:**
- Routine: 4/6 yes (5/6 borderline — passes Q7)
- Meme: 4/6 yes (passes Q7) but operator flagged: "the second text is bad, the first text was the meme"

**Round 3 (commit `679d362`):** verbatim overlay mode introduced. Operator's diagnosis surfaced via Q&A: when meme idea seeds are already meme-shaped (which most are), Gemini paraphrasing was destroying value. Solution: new Sheet column "Overlay Mode" with default-by-format (routine→generate, meme→verbatim). Verbatim skips Gemini call entirely.

**Round 3 results (visual review skipped per operator decision — would re-rate after v1.1 polish):**
- Automated metrics: 12/12 renders to human_qa, slot_count distribution healthy, no Q8 collapse, distinct overlays 12/12.

### Operator-flagged issues at Round 3 (deferred to subsequent workstreams)

Surfaced during informal review while skipping Q7 visual:
- **Logo wrong/big/position:** addressed in v1.1 (operator uploaded real logo file, halved twice from 0.15× to 0.0375×, repositioned bottom-centered with social-media-safe margin)
- **Overlay text too big and awkward position:** addressed in v1.1 (dynamic sizing, top-anchored, N-line wrap)
- **Cuts/transitions need polish:** deferred to Editor agent (next workstream)
- **Some clips have prep/outro that should be trimmed:** Editor agent
- **Memes hit lottery 2-3 of 6:** verbatim mode means operator-driven; quality scales with seed quality. `simple-pipeline-meme-generate-mode-prompt-iteration` filed for future re-exploration of generate mode.
- **Body composition off-brand on some clips:** operator manually deletes from R2 + asset_segments + assets. Workable at small volume; Polish Sprint Pillar 5 territory long-term.

### Hotfixes during the run (transparent)

Three small bugs surfaced during Round 3 + iterations:

1. **ESM require() vs exec helper** (commit `afcb1d5`): silencedetect implementation used `require()` in an ESM module context. Caught at runtime, fixed in 30 sec.

2. **drawtext apostrophe escape** (commit `acb5d92`): when verbatim mode passes operator-typed text containing apostrophes (e.g., "POV you've actually moved today"), ffmpeg drawtext filter chokes on the apostrophe escape. Fix: substitute U+2019 (curly apostrophe) before drawtext invocation. Note: cosmetically the curly apostrophe is the typographically correct choice in titles anyway.

3. **Wrap algorithm 2-line cap** (was Round 3 wrap; revealed at v1.1 iter-extreme test, fixed in c6): kickoff Q4 specced wrap as "2 lines max with scale-down floor at 30px." Reality: 132-char text doesn't fit 2 lines at any readable size. c6 extended wrap to 1..5 lines at base font before scale-down. Lesson: spec gap, not implementation bug. Q4 should have specced N-line wrap from the start.

### S8 chore re-attempt (abandoned)

Mid-session, attempted to close `s8-v2-json-divergence-followup` early via a chore branch that would commit the operator's working n8n state to repo. Failed twice:

- First attempt: operator's manual paste of n8n export into repo lost characters during chat round-trip (`const name = ...` → `consname = ...`, `'CM': 'carnimeat'` → `'Carnimeat',`). Agent caught both as parse/runtime bugs before committing. Halted.
- Second attempt: operator re-exported and re-pasted; same chat-paste corruption pattern.

**Decision:** abandon chore. Revert dirty file, leave `s8-v2-json-divergence-followup` open. The followup is not blocking; production n8n is correct. Re-export will happen organically when operator next touches n8n web UI for unrelated work.

**Lesson:** large JSON files corrupt during chat-paste. For future n8n workflow refresh, alternatives: gist link, paste-bin, scp to VPS, or minified single-line paste. Don't paste multi-line JSON into chat — the failure mode is silent character loss that JSON parses clean but breaks at runtime.

### Operator-side actions completed this session

- Created `Pipeline`, `Format`, `Clips`, `Overlay Mode` columns in Jobs sheet with dropdowns
- Replaced `brands/nordpilates/logo.png` in R2 with real nordpilates logo file
- Toggled retry-on-fail in S8's Send to VPS node (3 tries × 5000ms wait — auto-defaulted by n8n UI; not the 60s recommended in earlier conversation, but operator chose to ship rather than re-tune)
- Merged `feat/simple-pipeline` to main (commit `cc973d0`)
- Merged `feat/simple-pipeline-v1-1` to main
- Deployed both to VPS via standard ssh + git pull + npm install + build + restart

---

## Decisions locked this session

### Architectural decisions

| Decision | Source |
|---|---|
| Q1: brand_configs.aesthetic_description as new top-level TEXT column (not jsonb, not voice_guidelines reuse) | v1.0 kickoff Q&A |
| Q1b: aesthetic_description (visual) and voice_guidelines (voice) kept as separate fields | v1.0 kickoff Q&A |
| Q2: agent drafts starter aesthetic_description for nordpilates; operator revises before c2 | v1.0 kickoff Q&A |
| Q3: music_tracks readiness floor: ≥5 active rows across ≥2 distinct moods | v1.0 kickoff Q&A |
| Q4: VPS POST /simple-pipeline/check-readiness endpoint for n8n S1 readiness check | v1.0 kickoff Q&A |
| Q5: re-export S8 v2 from n8n during c8 to close divergence followup | Abandoned mid-session due to chat-paste corruption; followup stays open |
| Q6: operator adds Sheet columns + dropdowns BEFORE c1 starts | v1.0 kickoff Q&A |
| Q7: c10 Gate A hard threshold: ≥4 of 6 fail in either format → halt and iterate | v1.0 kickoff Q&A |
| Q8: agent picks slot_count 2-5 for routine (not operator-picks) | v1.0 kickoff Q&A (operator pivot during draft) |
| Q9: v2-only segment policy — Match-Or-Match considers only segments where segment_v2 IS NOT NULL | Pre-work surfacing, locked in agent kickoff |
| Q10: schema/doc drift accepted (column names: segment_v2 not analysis_v2; mood not music_intent; no active column on music_tracks) | Pre-work surfacing |
| Round 3: overlay mode default-by-format (routine→generate, meme→verbatim) | Operator diagnosis: meme idea seeds already meme-shaped, paraphrasing destroys value |

### v1.1 cosmetic decisions

| Decision | Source |
|---|---|
| v1.1 Q1: logo height 0.075× then halved to 0.0375× | v1.1 kickoff Q&A + iteration |
| v1.1 Q2: logo position 78% from top (22% from bottom) — social-media-safe margin | v1.1 kickoff Q&A |
| v1.1 Q3: overlay text vertical position 27% from top | v1.1 kickoff Q&A |
| v1.1 Q4: dynamic sizing (0.7× base) + N-line wrap (1..5) before scale-down at 30px floor | v1.1 kickoff Q&A + iter-extreme feedback |
| v1.1 Q5: keep existing drop shadow / outline / stroke style | v1.1 kickoff Q&A |
| v1.1 Q6: hard cuts as-is, no smart-trim — Editor agent handles next | v1.1 kickoff Q&A |
| Multi-line box padding dynamic (3px multi-line, 16px single-line) — prevents inter-line darkening | v1.1 c5 root-cause discovery (was misdiagnosed as shadow stacking initially) |

---

## Rule 43 sightings this session (3 new, total now 10)

### Sighting 8 — S8 chore "this isn't a clean export, halt instead of committing" (2026-04-29)

When operator hand-pasted S8 v2 JSON into the repo and asked agent to commit it as a "resync to working n8n state," agent halted on diff scope exceeding the documented three-point divergence pattern. Reframe: the framing assumed the diff was bounded; the diff wasn't. Agent surfaced unexpected items (poll cadence change, Drive node restructure, missing retry, credential renames) before committing. Operator confirmed each item, but the broader lesson is that "clean up an open followup early" can drag in scope that's not actually clean. Tactically defending the chore would have been wrong; pausing to verify scope was the right move.

### Sighting 9 — c10 first-run "concurrency was already 1, real cause is cleanup-induced retry burst" (2026-04-29)

When Upstash Redis hit its 1000 cmd/sec cap during c10 first-run, planning chat (me) initially hypothesized "13 jobs in burst exceeded concurrency, lower concurrency." Agent re-read the journal, found that concurrency was already 1 from c7 (5b16e56), and surfaced the real cause: cleanup script deleting Postgres rows mid-flight while BullMQ jobs were still queued, causing worker to retry-burst through orphan jobs at near-CPU-speed. Reframe: my recommended fix was a no-op against current code; the real fix is operational discipline (drain BullMQ before deleting rows) plus a defensive limiter. Agent's pushback prevented shipping a false-fix.

### Sighting 10 — v1.1 iteration 2 wrap algorithm "Q4 spec gap, 2-line cap was wrong shape" (2026-04-29)

When operator review of v1.1 first iteration revealed iter-extreme (132-char overlay) overflowing despite scale-down to 30px floor, planning chat surfaced: this is a Q4 spec gap, not an implementation bug. The kickoff specced "2 lines max + scale-down" but reality required N-line wrap up to 5 lines. Reframe: 2-line cap was the wrong architectural shape; extending to N-line wrap is the right design. Operator's "no, doesn't fit" was strategic-shaped feedback against my tactical iteration plan.

**Pattern across all 10 sightings:** Strategic-shaped concerns during tactical work surface design errors. Tactical defense of the original choice has now been the wrong move 10 times in a row.

**Rule 43 reframe-cost trend:** Sightings caught at brief Q&A (cheapest) — sightings 7, 8 partly. Sightings caught mid-execution (bounded) — 9, 10. Sightings caught after Gate A merged (most expensive) — none this session. Q&A quality continues to compound.

---

## Followups state at session close

### Resolved this session

- `simple-pipeline-overlay-mode-default-by-format` — resolved by Round 3 verbatim mode default
- `simple-pipeline-ugc-audio-mute-on-no-speech` — resolved by Round 3 silencedetect implementation
- `simple-pipeline-routine-duration-target-hint` — resolved by Round 3 prompt addition

### New active

- `simple-pipeline-non-portrait-source-letterbox` — black bars on non-1080×1920 sources (low-medium priority)
- `simple-pipeline-editor-agent-workstream` — next workstream; smart-trim at segment boundaries
- `simple-pipeline-clip-rejection-manual-cleanup` — operator manual deletion of off-brand clips (Polish Sprint Pillar 5 long-term)
- `simple-pipeline-redis-rps-cap-needs-rate-limiting` — defensive mitigation in place (500 cmd/sec limiter); informational
- `simple-pipeline-routine-prompt-iteration` — any remaining tone polish post-merge
- `simple-pipeline-meme-prompt-iteration` — verbatim default works; generate-mode reactivation if operator wants
- `simple-pipeline-logo-subject-collision-detection` — Future, low priority. Halve mitigated; full subject-aware placement deferred
- `simple-pipeline-meme-generate-mode-prompt-iteration` — Future, operator decision

### Still active from prior sessions

- `s8-v2-json-divergence-followup` — chore re-attempt failed twice (chat-paste corruption); pick up next time operator touches n8n
- `s8-retry-wait-too-short` — 5s vs 60s wait; informational, may bite at scale
- `s8-cl-cd-prefix-consolidation`, `s8-subject-group-tagging-future`, `s8-quarantine-cleanup-policy`, `s8-n8n-workflow-versioning` — all deferred
- `pillar1-planner-overcommits-subject-consistency` — Polish Sprint resumption pending
- `s8-brand-configs-lazy-population` — operator activates per-brand on commit-to-ingest
- All W9-era cutover followups — deferred behind Polish Sprint
- `claude-api-limit-watchitem` — low watch
- `w9-q8c-structural-classification-not-exercised` — Polish Sprint may resolve incidentally

---

## Production state at session close

- **Phase 3.5:** still production for advanced-quality renders. Unaffected throughout this session.
- **Part B:** still in shadow on nordpilates (PART_B_ROLLOUT_PERCENT=100). Unaffected.
- **Simple Pipeline v1.0 + v1.1:** merged to main, deployed to VPS, code path active. Worker registered with concurrency=1 + 500 cmd/sec limiter. Readiness endpoint live.
- **Simple Pipeline production verification:** PENDING. First Sheet → S1 → worker → render → human_qa → operator approval → manual upload not yet exercised. Operator wants Editor agent to ship before TikTok-volume usage.
- **Polish Sprint Pillar 1:** branch parked at `cebfc46`, 6 commits ahead of main, still untouched.
- **brand_configs:** 5 rows (carnimeat, highdiet, ketoway, nodiet, nordpilates). Only nordpilates has aesthetic_description populated. Cyclediet/carnimeat/nodiet ingestion not yet started.
- **VPS:** active, healthy, post-v1.1-deploy.

---

## What next chat picks up

**Headline workstream: Editor agent.**

Smart-trim at segment boundaries. Operator-flagged as core to making routine videos genuinely shippable to TikTok at volume. Without it, operator must over-generate (~2x target volume) and discard renders with imperfect cut boundaries.

**Open architectural question for Editor agent kickoff:**
- Real Editor agent (Gemini Pro call ffprobing each picked segment, deciding tighter cuts) vs deterministic heuristic (drop first/last 0.3s of any segment >2s)?
- Cost ceiling and latency budget per render
- Where in orchestrator flow Editor sits (after Match-Or-Match, before Pass A?)
- Scope: just incision cuts on segment boundaries, or also re-rank segments, or full creative judgment

These are real product questions, not implementation details. Editor agent kickoff Q&A in the next chat will scope them.

**After Editor agent:**
- First production-volume Simple Pipeline TikTok uploads (operator timeline)
- Polish Sprint resumption (advanced pipeline) — Pillar 1 c5 onwards, ~4-8 weeks
- W9.2 Demo render bridge (after Polish Sprint)
- Multi-brand activation (cyclediet/carnimeat/nodiet) as ingestion fills

---

## Most instructive observation from this session

The graininess fix in Round 1 was the most important architectural correction. The brief specified `clip_r2_key` reads as if those were canonical render inputs; reality is they're a Phase 2.5 ingestion-cost optimization (720p CRF 28 for cheap Gemini analysis), not a render input. Reading them and upscaling at render time produced visibly grainy output across all 12 c10 renders.

The operator's "saw about 10 different parents, they all can't be grainy since Phase 3.5 produced HQ footage with them" was the strategic-shaped pushback that surfaced this. Without it, the diagnosis would have been "fast render trade-off" rather than "wrong render input." The diff between the two: one is acceptable; the other is non-shippable.

This is the closest the workstream came to merging code that solved the wrong problem. Caught at Round 1 visual review (~10 min of operator time), fixed in 116 lines on render.ts. Without operator pushback, would have shipped to TikTok with 720p-upscaled-to-1080p quality.

---

## Session reflection

This session shipped a real, working second pipeline through 27 commits across two versions. The architecture is sound, the operator-facing surface is clean, and the deployment is production-ready code-wise. The remaining friction is operator-acceptable polish (Editor agent for cuts) and operator-paced multi-brand activation.

The session's pace was uneven — first half (v1.0 c1-c10) was tight planning-relay-execute cadence; mid-section (graininess fix + Round 3 + S8 chore re-attempts) had several halt-and-restart loops where strategic-shaped operator concerns surfaced architecturally; v1.1 finished cleanly. Net Rule 43 sightings: 3, all caught early.

Production verification still owed. Editor agent is the next gate before Simple Pipeline goes to TikTok at volume.

---

*MVP Progress Session 20 — drafted 2026-04-29 at session close. Captures Simple Pipeline v1.0 + v1.1 build, 3 quality rounds, render-path graininess fix, verbatim overlay mode, v1.1 cosmetic polish, and the abandoned S8 chore re-attempt. Filed at `docs/MVP_PROGRESS_20.md`.*
