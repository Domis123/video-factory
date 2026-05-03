# Session 21 — Lessons compendium

**Session window:** 2026-05-01 to 2026-05-03 (~12+ hours operator+agent work)
**Branch:** `feat/simple-pipeline-editor-agent` from main `8cc181c`; merged to main at `c5681da`
**Workstream:** Editor agent v1.2 build → v1.2.1 prompt iteration → render-path keyframe-snap bug archaeology → c1.2.1.5 + c1.2.1.6 fixes → 3 Gate A retries → merge + deploy
**Final state:** Editor agent live in production; 3/6 c1.2.1.6 Gate A renders rated solid by operator; v1.2.2 prompt re-tune is the next iteration to push toward 4/6 uploadable bar.

---

## Section 1 — Workstream sequence

Commits in lineage order on `feat/simple-pipeline-editor-agent` (from `8cc181c`):

| Commit | SHA | Scope |
|---|---|---|
| c0 | brief commit | Editor agent v1.2 brief filed at `docs/briefs/editor-agent-brief.md` |
| c1.0 | (earlier) | Zod schema + EditorRefinement type + applyClamps |
| c1.1–c1.4 | (earlier) | Editor agent module (src/agents/editor-agent.ts) + integration with simple-pipeline-orchestrator |
| c5.5 | — | editorDisabled per-job toggle (skip Editor on routine via /enqueue payload) |
| c5.6 | — | run-editor-gate-a.ts trigger script (originally) |
| c5.7 | — | per-worker BullMQ limiter applied to all 4 workers (`{ max: 500, duration: 1000 }`) |
| c5.8 | — | trigger-script per-pair atomicity + rollback (insert + enqueue in single try/catch with rollback on enqueue failure) |
| c5.9 | `9845684` | trigger script sleep pacing (`SLEEP_BETWEEN_PAIRS_MS = 2000`) + `--max-pairs` partial-run flag for verification |
| Editor v1.2 Gate A artifact | `4731fa6` | docs/diagnostics/editor-agent-gate-a.md filed (6/6 mechanical pass; operator visual fail surfaced render-path issues) |
| c1.2.1.0 | `9fc3e97` | Editor input expansion: render-context fields (slot_count_total, slot_index, current_render_duration_s, target_render_duration_s) added to EditorAgentInput |
| c1.2.1.1 | `77d6943` | Editor agent prompt v1.2.1 (pacing-aware, distributes overshoot across segments) |
| c1.2.1.2 | (earlier) | M-O-M v1.0.1 prompt (slot-count bias 4-5 + same-parent redundancy + vague-seed handling) |
| c1.2.1.3 | (earlier) | smoke run + v1.2.1 Gate A artifact filed |
| Editor v1.2.1 Gate A artifact | (earlier) | docs/diagnostics/editor-v1.2.1-gate-a.md (6/6 mechanical pass; operator visual "went backward" surfaced render bug) |
| c1.2.1.5 | `eba54a2` | `buildTrimCommand` `-ss`/`-to` BEFORE `-i` → AFTER `-i` (output-seek). Frame-accurate when refined start ≥ keyframe. Closed-GOP edge case surfaced (4/6 Pass A failures). |
| c1.2.1.6 | `25e875e` | `-c copy` → `-c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -ar 44100`. Re-encode for closed-GOP correctness. |
| c1.2.1.6 Gate A artifact | `72805af` | docs/diagnostics/editor-c1.2.1.6-gate-a.md (6/6 mechanical pass; 6/6 fix-validation pass; 5/6 outside [25, 35]s — Editor over-trims) |
| Merge to main | `c5681da` | feat/simple-pipeline-editor-agent merged to main; deployed to VPS |

This lessons compendium adds 4 docs commits on top of `c5681da`:
- `54c0b6c` c-docs.0 SIMPLE_PIPELINE.md
- `b0ddc01` c-docs.1 CLAUDE.md (Rules 44-47 + Rule 43 sightings 11-18)
- `f6f5423` c-docs.2 docs/VPS-SERVERS.md
- `126a062` c-docs.3 docs/followups.md
- (this commit) c-docs.4 docs/diagnostics/session-21-lessons.md

---

## Section 2 — Three Gate A retries: what we learned

| Round | Date | Mechanical bar | Visual bar | Lesson |
|---|---|---|---|---|
| **v1.2** | 2026-05-01 | 6/6 PASS (all reach human_qa, clamps held, 0 fallbacks) | 2/6 solid, 1/6 good-but-long, 3/6 below uploadable | First Gate A. Surfaced "operator quality bar > mechanical bar" gap. Editor v1.2 prompt produced refinements but renders looked unchanged from no-Editor baseline — first hint that something downstream was discarding the work. Misdiagnosed as "Editor needs more aggressive prompt." |
| **v1.2.1** | 2026-05-02 | 6/6 PASS | "Poor results overall, went backward" | More aggressive prompt → renders looked worse, not better. Editor's larger refinements should have produced visibly tighter cuts. Instead, 5/6 renders looked similar-or-worse than v1.2. The "going backward" signal was operator-flagged before agent caught it. Misdiagnosis hours: ~6 across iteration loops. Surfaced the load-bearing-but-silent failure mode (mechanical bar PASS while real output broken — see Rule 43 sighting #17). |
| **c1.2.1.6** | 2026-05-03 | 6/6 PASS + 6/6 fix-validation PASS (rendered_duration ≤ picks_sum + 0.5s, frame-accurate trim verified) | 3/6 solid, 3/6 not solid yet, "moving in right direction" | First Gate A where Editor's refinements actually applied to the render output. Frame-accurate trim revealed: 1/6 in [25, 35]s band, 5/6 below band. Editor v1.2.1 prompt now over-trims because it was tuned against keyframe-snap-padded outputs (~2s/segment padding masked the trim → prompt ramped up aggressiveness → real fix landed → prompt now over-shoots). Successor workstream `editor-v1.2.2-prompt-retune` filed. |

**The progression shows how render-path bug masked prompt iteration quality.** Three rounds against the same 6 fresh seeds:

```
v1.2     refined ~5s avg per render → ~5s discarded by keyframe-snap → render looks same as no-Editor
v1.2.1   refined ~12s avg per render → ~12s discarded → "going backward" (overshoot more visible)
c1.2.1.6 refined ~14s avg per render → 14s actually applied → renders 5-15s shorter, "moving in right direction"
```

Editor was working harder each round; only at c1.2.1.6 could anyone tell.

---

## Section 3 — Render-path keyframe-snap bug archaeology

### Discovery sequence

The bug existed in `src/lib/ffmpeg.ts` `buildTrimCommand` since v1.0 (~8 weeks) but only became visible at v1.2.1's aggressive Editor trim levels. Trace through the discovery:

**v1.2.1 Gate A render #4 ("gentle full body wakeup"):**
- Editor decided refined bounds for 5 picked segments
- Sum of refined durations: 30.5s (well within [25, 35]s target band)
- Rendered duration: 40.13s ❌

This is **impossible if Editor only trims**. Editor's `applyClamps()` enforces `refined_start_s ≥ original_start_s` and `refined_end_s ≤ original_end_s`. Sum-of-refined-durations should be the ceiling on rendered duration; rendered being 9.6s longer is a category violation.

**Trace through orchestrator → render:**
1. `runEditorStep()` returns `refinedBoundsBySegmentId` — verified contains the right values via job_events.editor_outcome
2. `renderSimplePipeline()` calls `fetchSegmentsInOrder(segmentIds, refinedBoundsBySegmentId)` — verified passes refined map
3. `resolveTrimWindow(seg, refined)` returns `{trim_start_s, trim_end_s}` — verified returns refined values when present
4. `buildTrimCommand(parent, output, trim_start_s, trim_end_s)` — **bug here**

**Bug found:**

```typescript
// pre-c1.2.1.5
buildTrimCommand(input, output, startSec, endSec) {
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-ss', String(startSec),    // ← BEFORE -i: input-seek
      '-to', String(endSec),
      '-i', input,
      '-c', 'copy',                // ← stream-copy: snaps to keyframe
      '-avoid_negative_ts', 'make_zero',
      output,
    ],
  };
}
```

`-ss` BEFORE `-i` with `-c copy` triggers ffmpeg's **input-seek + stream-copy** mode. ffmpeg seeks to the nearest preceding keyframe and copies from there. For Editor's refined start at e.g. 5.2s with the nearest preceding keyframe at 0s (start of segment), the output renders 0s..end instead of 5.2s..end. 5.2s of unwanted leading footage padded to the front of the segment.

Across 5 picked segments × ~2s average snap = ~10s overshoot. Matches job 4's observed +9.63s.

### Why it was silent for 8 weeks

v1.0 / v1.1 / v1.2 era had no Editor; Pass A always trimmed at the segment's original `start_s` / `end_s` boundaries. These boundaries came from ingest's segment-detection step, which placed cuts at scene-change boundaries — which are usually GOP starts (i.e., keyframes). So input-seek + `-c copy` happened to be keyframe-aligned by accident.

v1.2.1's aggressive Editor produced refined timestamps at arbitrary positions (anywhere from `original_start_s` to `original_end_s`). Suddenly the trim points were not keyframe-aligned, and the keyframe-snap became visible as 5-12s padding overshoot.

### c1.2.1.5 fix attempt

Move `-ss` AFTER `-i` for output-seek behavior:

```typescript
// c1.2.1.5
'-y', '-i', input, '-ss', String(startSec), '-to', String(endSec),
'-c', 'copy', '-avoid_negative_ts', 'make_zero', output,
```

Output-seek decodes-and-discards frames up to the requested timestamp, then begins copying. **Frame-accurate when refined start ≥ keyframe.**

Standalone test passed: segment b9246eb2, refined [3.0, 9.0]s, rendered duration 6.023s (overshoot +0.023s, frame-rounding only, well under 0.5s tolerance).

c1.2.1.5 production Gate A: 4/6 Pass A failures with `Stream specifier ':v' matches no streams` (exit 234). The 2 surviving renders showed Editor's trim actually applying for the first time (e.g., job 5 picks_sum 38.0s → rendered 22.4s, fix_gap −15.6s).

### Closed-GOP edge case

Output-seek + `-c copy` has a documented-but-easy-to-miss edge case: when the requested start lies BEFORE the first keyframe of the kept range, ffmpeg drops the video stream entirely. The audio stream survives because audio frames are independent. Pass A produces audio-only output; Pass B's concat assembles audio-only fragments; Pass C's complex filter `[0:v]colorlevels=...` rejects with "matches no streams."

### c1.2.1.6 fix

Replace `-c copy` with explicit re-encode:

```typescript
// c1.2.1.6
'-y', '-i', input, '-ss', String(startSec), '-to', String(endSec),
'-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
'-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
'-avoid_negative_ts', 'make_zero', output,
```

Re-encoding decodes every frame in the kept range and emits new keyframes. No closed-GOP issue. Cost: ~5-8s/segment of re-encode wall on the VPS (vs 0s for stream-copy). Quality: visually lossless at CRF 18 (matches Pass C's quality target).

c1.2.1.6 Gate A: 6/6 reach human_qa with frame-accurate boundaries (max overshoot +0.10s). Three callers benefited:
- `src/orchestrator/simple-pipeline/render.ts` Pass A — load-bearing
- `src/workers/clip-prep.ts` Phase 3 advanced pipeline — silent benefit (advanced trim was usually keyframe-aligned by accident)
- `src/scripts/test-pipeline.ts` test harness

### Reference

- CLAUDE.md Rule 46 — canonical pattern documentation
- CLAUDE.md Rule 47 — per-segment standalone verification template (would have caught this 6 hours earlier)
- `docs/diagnostics/editor-c1.2.1.6-gate-a.md` — fix-validation table

---

## Section 4 — The Rule 43 sightings 11-18 of session 21

Eight sightings landed this session, all documented as a single block in CLAUDE.md Rule 43. Brief recap with one-sentence lessons:

| # | Date | Context | One-sentence lesson |
|---|---|---|---|
| 11 | 2026-05-01 | Brief filename suffix `-brief.md` mismatch | Brief paths may have suffix typos; halt-and-report on path issues, don't plough through |
| 12 | 2026-05-01 | Kickoff HEAD SHA stale vs live git | When kickoff says "HEAD = X" and live git is descendant, surface lineage-clean check before proceeding |
| 13 | 2026-05-01+ | Chat-paste markdown autolink corruption | URL/JSON/special-char content silently corrupts on chat-paste; use file transport via `Write` tool |
| 14 | 2026-05-01 | Upstash burst cap misdiagnosis loop ×3 | Identical error string can mask three different cap mechanisms; pace bulk enqueues OR use n8n cadence (Rule 44) |
| 15 | 2026-05-01 | PING-only health probe insufficient | Single-op probes pass even when bulk-op state is stuck; use multi-op probe matching the failure shape |
| 16 | 2026-05-01 | Cap layer mismatch (Upstash-side vs app-side) | Diagnostic depth needs to match the actual mechanism layer; dashboard-visible state ≠ all state |
| 17 | 2026-05-01 | Mechanical bar PASS while operator visual FAIL | Standalone verification of input-to-output adherence catches load-bearing-but-silent bugs (Rule 47) |
| 18 | 2026-05-02 | Render path bug existed since v1.0, only visible at v1.2.1 | "Load-bearing-but-silent" code paths become "load-bearing-and-broken" when upstream behavior changes (Rule 46) |

For full single-paragraph entries with operator-side context, see CLAUDE.md Rule 43 sightings (11)–(18).

Two complementary observation paragraphs added to Rule 43 in c-docs.1:
- **Mechanical bar passing while operator quality bar fails is a Rule 43 prevention surface** (sighting 17 → Rule 47 mitigation template).
- **Three sightings about probe granularity (#14, #15, #16) reinforce the same pattern** — diagnostic-shape must match failure-shape; layer-aware probing is non-optional.

---

## Section 5 — Operator quality bar history

Three rounds. Same 6 fresh seeds. Operator visual review only (no formal A/B paired runs).

### v1.2 review (2026-05-01)
> "2/6 solid, 1/6 good-but-long, 3/6 below uploadable bar."

Solid: 2 routine renders had clean cuts that read as professional output. The "good but long" had Editor over-staying on a hold; the 3 below were various boundary-quality issues that operator categorized as "doesn't read as edited."

This was the first Gate A; mechanical bar passed clean. Operator visual signal was the load-bearing input — Editor's mechanical work passed verification, but the perceptual output didn't. This was the early signal that something downstream of Editor was off; agent + planning chat misinterpreted as "Editor needs more aggressive prompt."

### v1.2.1 review (2026-05-02)
> "Poor results overall, went backward."

5/6 renders rated worse than v1.2. The "going backward" signal was crucial — Editor's prompt was theoretically more aggressive (larger refinements expected); renders looking worse indicated either prompt regression OR downstream discarding of refinements. Operator's review was the first concrete signal pointing to the latter; agent's investigation surfaced the keyframe-snap bug.

Cost of misdiagnosis between v1.2 review and v1.2.1 review: ~6 hours (two prompt iterations + two Gate A rounds + post-hoc diagnostic). Captured in Rule 47 as the load-bearing rationale for standalone-verification-before-prompt-iteration.

### c1.2.1.6 review (2026-05-03)
> "3/6 solid, 3/6 not solid yet, moving in right direction."

First round where Editor's refinements actually applied. The frame-accurate trim revealed Editor was over-trimming for the new conditions (prompt was tuned against keyframe-snap-padded baseline; with padding gone, same prompt over-shoots). Operator's review:
- 3 renders rated solid (uploadable to TikTok)
- 3 not solid yet (under-trimmed = below 25s floor; reads as "too rushed" or missing the routine's pacing)
- "Moving in right direction" — fix landed; prompt re-tune is the next iteration

Successor workstream `editor-v1.2.2-prompt-retune` (in followups.md) targets the over-trim. Bar to clear: 4/6 uploadable.

---

## Section 6 — Next workstream pointers

### Editor v1.2.2 prompt re-tune
- **Goal:** stop over-trimming. Anchor pacing decisions on overshoot magnitude, not on per-segment "this hold could be shorter" judgment.
- **Validation:** same 6 fresh seeds; mechanical bar threshold remains [25, 35]s; visual bar 4/6 uploadable.
- **Followup:** `editor-v1.2.2-prompt-retune` (HEADLINE NEXT WORKSTREAM)

### M-O-M v1.0.2 seed-vagueness-aware slot count
- **Goal:** seed-type classification (vague/feel vs concrete/exercise) → scaled slot count target. Concrete: 3-4. Vague: 4-5.
- **Validation:** 6 fresh seeds + 2 concrete additions. Likely combined with v1.2.2 in single coordinated workstream.
- **Followup:** `mom-v1.0.2-seed-vagueness-aware-slot-count` (HEADLINE NEXT WORKSTREAM)

### Editor + M-O-M context expansion
- **Goal:** Editor sees M-O-M's narrative arc / per-segment reasoning; M-O-M sees typical Editor trim patterns.
- **Cost room:** ~$0.005 additional per render via single context-passing call; well under $1/video ceiling.
- **Trigger:** revisit when v1.2.2 + v1.0.2 prompt iterations stabilize; if they hit a ceiling, this is the next layer.
- **Followup:** `editor-mom-context-expansion` (Future, design pending)

### Resolution criteria for first TikTok upload
- **4/6 operator-uploadable threshold** on a Gate A retry post-v1.2.2 + v1.0.2 ship.
- After resolution, first-TikTok-upload workstream begins.
- **Followup:** `first-tiktok-upload-readiness-bar` (gating workstream trigger)

---

## Section 7 — Known unfixed limitations

These are real, observable issues that session 21 did NOT fix. Filed for future workstreams.

1. **1920×1080 source footage gets black bars in 1080×1920 output.** parent-normalizer.ts uses `scale=1080:1920:force_original_aspect_ratio=decrease,pad=...` — non-portrait sources letterbox into the 1080×1920 frame. v1.0 round-2 surfaced this; ingestion-time letterbox vs render-time crop debate is open. Followup: `simple-pipeline-non-portrait-source-letterbox`.

2. **M-O-M same-parent on feel-shaped seeds occasionally over-rides redundancy directive.** v1.0.1's same-parent-redundancy-avoidance and vague-seed handling are in tension: feel-shaped seed routines can pick 3+ adjacent segments from one parent (tonal coherence over variety). c1.2.1.6 Gate A render #6 ("pilates stretches that feel like rest") hit this: 4 holds from parent `57c46b4a` at indices [8,9,10,18], adjacency run of 3. Followup: `mom-same-parent-on-feel-shaped-seeds`.

3. **Per-segment Editor observability not in job_events** (only aggregate counts). Refined start_s / end_s / clamp outcomes aren't logged. Surfaced during render-path bug debugging: agent had to read worker code to trace what happened to refined bounds. Followup: `per-segment-editor-observability-missing-from-job-events`.

4. **Editor v1.2.1 prompt over-trims** because tuned-against-broken-render baseline. 5/6 c1.2.1.6 renders below 25s floor. Successor workstream named (`editor-v1.2.2-prompt-retune`); not a regression of Editor itself, just a coordinated-with-render-path-fix re-tune.

5. **Pass A wall +30s post-c1.2.1.6** (acceptable cost for frame-accuracy). Render wall median grew from ~110s (v1.2 era, broken-fast trim) to ~140s (v1.2.1 + c1.2.1.6, working trim). Pre-fix's apparent speed was buying broken trim; trade-off worth it.

6. **n8n S1 production enqueue path lacks atomicity** (same desync risk as pre-c5.8 trigger script). If `/enqueue` fails after Postgres insert succeeds, row stranded in `simple_pipeline_pending` with no BullMQ counterpart. Followup: `production-enqueue-atomicity-postgres-bullmq-desync`.

7. **Upstash burst-rate-limit mechanism unclear.** Workaround in place (sleep pacing for trigger scripts; n8n cadence avoids it naturally). Underlying mechanism not authoritatively confirmed; `upstash-burst-enqueue-rate-investigation` followup tracks the support-ticket workstream.

8. **No periodic Postgres ↔ BullMQ reconciliation.** 3 desync incidents in session 21 alone; cron job to detect orphans deferred to `simple-pipeline-orphan-row-janitor` followup.

---

*Living reference. This compendium captures session 21 (Editor agent build + render-path archaeology). Future session-end docs touches add their own diagnostic in this folder; cross-reference rather than rewrite this one.*
