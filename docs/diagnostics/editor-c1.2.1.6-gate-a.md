# Editor c1.2.1.6 — Gate A diagnostic

**Date:** 2026-05-03
**Branch:** `feat/simple-pipeline-editor-agent` at HEAD `25e875e` (VPS-deployed)
**Path:** Sheet → n8n S1 → BullMQ `simple_pipeline` → worker (post-c1.2.1.6 deploy)
**Workstream:** c1.2.1.6 ffmpeg re-encode trim — closed-GOP edge case fix on top of c1.2.1.5 frame-accurate trim

## Summary

6/6 routine Gate A renders completed through `human_qa`. **0 closed-GOP failures** (vs 4/6 failures on c1.2.1.5). **6/6 fix_gap ≤ +0.1s** — frame-accurate trim verified across all renders. Editor invoked on every render. **0 fallbacks across 24 segments; 20/24 (83%) refined.**

**Mechanical bar: PARTIAL — duration band fails on the under-trim side.** 5/6 renders fell BELOW the [25, 35]s target band (range 15.6–22.4s; one at 26.1s in band). 1/6 has 3+ adjacent picks from one parent (#3 "pilates stretches that feel like rest", run-of-3 at parent indices `[8,9,10]`).

The c1.2.1.5 + c1.2.1.6 fix-pair is doing exactly what was specified: refined boundaries reach ffmpeg accurately, video stream survives, output duration matches refined within frame-rounding tolerance. **The new failure mode is upstream: Editor v1.2.1's pacing-aware prompt is over-trimming now that the keyframe-snap padding is gone.** v1.2.1 prompt was authored without knowing the trim was buggy; the +30s soft target was effectively producing ~38-42s renders due to ~2s/segment keyframe-snap padding. With trim now frame-accurate, the same prompt over-shoots toward the floor instead.

## Per-render outcomes

| # | Job ID | Idea seed | Slots | Refined / no_change / fallback | Duration | Picks sum | Fix gap | Same-parent run | Render wall | Editor wall | Editor cost | Total cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `e96d4cde` | morning core flow for tight hips | 4 | 4 / 0 / 0 | **22.10s** ❌ | 33.50s | −11.40s ✓ | 1 | 153.5s | 25.3s | $0.0179 | $0.0729 |
| 2 | `c3df3112` | pilates breathing reset | 4 | 0 / 4 / 0 | 26.10s | 26.00s | +0.10s ✓ | 1 | 104.2s | 15.2s | $0.0176 | $0.0708 |
| 3 | `bb29a56c` | slow leg circles for stiff knees | 4 | 4 / 0 / 0 | **20.00s** ❌ | 40.00s | −20.00s ✓ | 2 | 140.5s | 26.8s | $0.0179 | $0.0702 |
| 4 | `6aeba119` | gentle full body wakeup | 4 | 4 / 0 / 0 | **21.90s** ❌ | 26.50s | −4.60s ✓ | 2 | 144.7s | 36.1s | $0.0179 | $0.0701 |
| 5 | `d7c733c5` | posture correction for desk workers | 4 | 4 / 0 / 0 | **22.40s** ❌ | 38.80s | −16.40s ✓ | 1 | 152.5s | 36.8s | $0.0181 | $0.0706 |
| 6 | `223635f8` | pilates stretches that feel like rest | 4 | 4 / 0 / 0 | **15.60s** ❌ | 34.00s | −18.40s ✓ | **3** ❌ | 117.3s | 25.0s | $0.0178 | $0.0720 |

**Fix gap** = `duration_s − sum_of_picked_segments_original_durations`. Frame-accurate output-seek + re-encode predicts gap ≈ 0 ± frame_rounding for the no_change case, and gap = `−(total Editor trim)` for the all-refined case. Both observed.

## Fix-validation table (the load-bearing test of c1.2.1.5 + c1.2.1.6)

| Render | fix_gap | Interpretation | Status |
|---|---|---|---|
| 1 (morning core) | −11.40s | Editor refined 4 segments, total ~11s of inward trim, all of which actually applied | ✅ |
| 2 (breathing reset) | +0.10s | Editor returned no_change on all 4 segments; rendered duration matches picks_sum within 1 frame | ✅ |
| 3 (slow leg circles) | −20.00s | Editor's heaviest trim of the run; reflected in output (40s → 20s) | ✅ |
| 4 (gentle full body wakeup) | −4.60s | Editor refined 4 segments with light total trim; cleanly applied | ✅ |
| 5 (posture correction) | −16.40s | Editor refined 4 with substantial trim; cleanly applied | ✅ |
| 6 (pilates stretches) | −18.40s | Editor refined 4 holds; substantial trim applied | ✅ |

**6/6 frame-accurate.** Maximum positive overshoot 0.10s (≪ 0.5s tolerance, well within frame-rounding). Pre-c1.2.1.5 v1.2.1 baseline showed *positive* gaps (`duration > picks_sum`) consistent with keyframe-snap padding. c1.2.1.5 alone broke 4/6 (closed-GOP missing-stream); c1.2.1.6 unblocked all 6 with frame-accurate cuts.

## Comparison table — v1.2.1 vs c1.2.1.5 vs c1.2.1.6 (same seeds across 3 attempts)

| Seed | v1.2.1 duration | c1.2.1.5 duration | c1.2.1.6 duration | c1.2.1.6 picks_sum | c1.2.1.6 fix_gap |
|---|---|---|---|---|---|
| morning core flow for tight hips | 42.07s | 24.20s | **22.10s** | 33.50s | −11.40s |
| pilates breathing reset | 18.07s | **FAIL** | 26.10s | 26.00s | +0.10s |
| slow leg circles for stiff knees | 30.03s | **FAIL** | 20.00s | 40.00s | −20.00s |
| gentle full body wakeup | 40.13s | 34.67s | 21.90s | 26.50s | −4.60s |
| posture correction for desk workers | 27.83s | **FAIL** | 22.40s | 38.80s | −16.40s |
| pilates stretches that feel like rest | 33.47s | **FAIL** | 15.60s | 34.00s | −18.40s |

What this shows:
- v1.2.1 produced 3/6 over-band (42, 40, 33+) and 1/6 under-band (18) — keyframe-snap padded refined trims so they didn't visibly apply.
- c1.2.1.5 broke 4/6 (closed-GOP); the 2 surviving (morning core 24.2, gentle full body 34.7) showed the trim actually applying for the first time.
- c1.2.1.6 renders all 6 cleanly with full Editor trim applied. Now Editor is over-trimming because its pacing prompt was tuned against keyframe-snap-padded outputs.

## Mechanical bar check-by-check

| Check | Threshold | Result | Status |
|---|---|---|---|
| All 6 reach `human_qa` (closed-GOP regression must be gone) | 6/6 | 6/6 | ✅ |
| `editor_outcome.editor_invoked === true` | 6/6 | 6/6 | ✅ |
| `rendered_duration ≤ picks_sum + 0.5s/segment` (fix landed) | 6/6 | 6/6 (max gap +0.10s) | ✅ |
| Both video and audio streams in output | 6/6 | 6/6 (all renders human_qa with preview URLs; no Pass A failures = both streams emerged from Pass A) | ✅ |
| Slot count distribution median ≥ 4 | median ≥ 4 | distribution `{4:6}` → median **4** | ✅ |
| Refined boundaries within original | by construction | guaranteed by `applyClamps()` | ✅ |
| Refined duration ≥ 1.5s | by construction | guaranteed by clamp 3 | ✅ |
| `segments_fallback === 0` per render | 6/6 | 6/6 (24/24 segments) | ✅ |
| Total render duration in [25s, 35s] | 6/6 | **1/6** (only c3df3112 at 26.1s) | ❌ |
| Wall delta vs c6 baseline median (~129s) < 90s | all renders | max wall 153.5s = +24.5s vs baseline (well under 90s ceiling) | ✅ |
| No 3+ consecutive parent indices per render | all renders | **5/6** (#6 has run-of-3 at parent `[8,9,10]`) | ❌ |

**Mechanical bar overall: PARTIAL.** The fix landed cleanly; the duration band failure is upstream (Editor v1.2.1 prompt over-trimming).

## Halt-condition status (per kickoff)

| Condition | Threshold | Result | Triggered |
|---|---|---|---|
| `<6 jobs found` within window | <6 | 6 found | no |
| Any render fails Pass A with stream-missing error | any | 0 | no — fix verified |
| Any render shows `rendered_duration > picks_sum + 1.0s` | any | 0 (max gap +0.10s) | no |
| `>2 of 6` outside [25s, 35s] | >2 | **5 of 6** | **YES** |
| Any clamp violation | any | 0 | no |

**Duration halt triggered (5/6).** Surfacing for operator visual review. Fix-validation halt-conditions all clear; halt is purely on the prompt-tuning side.

## Aggregate stats

### Cost (per render, USD)

| | min | median | max | p95 (n=6) | sum |
|---|---|---|---|---|---|
| Editor cost | $0.0176 | $0.0179 | $0.0181 | $0.0181 | $0.1072 |
| Total cost | $0.0701 | $0.0707 | $0.0729 | $0.0729 | $0.4266 |

Editor cost essentially flat across 6 renders (every render had 4 segments at this slot_count distribution). vs v1.2.1: similar median ($0.0180 → $0.0179). vs c6: ~2x ($0.0091 → $0.0179) consistent with the longer pacing-aware prompt.

### Wall (per render, seconds)

| | min | median | max | p95 (n=6) |
|---|---|---|---|---|
| Render wall (orchestrator t0) | 104.2 | 142.6 | 153.5 | 153.5 |
| Editor wall (within render wall) | 15.2 | 26.0 | 36.8 | 36.8 |

Render wall median 142.6s — c1.2.1.6 added ~33s vs v1.2.1's median 109s. Per-segment Pass A re-encode at preset medium + CRF 18 costs ~5-8s on the VPS for typical segment sizes. With 4 segments and Pass A serial within a render, that's ~20-32s of additional Pass A wall — matches the observed delta. Still well under the 90s mechanical bar (max wall 153.5s = +24.5s vs c6 baseline 129s).

### Slot count distribution

| Slots | Count |
|---|---|
| 4 | 6 |

Median **4**, mode **4**. Tighter than v1.2.1's `{3:1, 4:4, 5:1}`. M-O-M v1.0.1 still active and converging on 4-slot picks consistently.

### Editor outcome distribution (segment-level)

| Outcome | Count | Share | vs v1.2.1 |
|---|---|---|---|
| `refined_ok` | 20 | 83% | 19/24 = 79% |
| `no_change_needed` | 4 | 17% | 5/24 = 21% |
| `fallback` | 0 | 0% | 0% |

24 segments. All-`no_change` render (#2 "pilates breathing reset") — picks_sum=26s already in band; Editor correctly held boundaries. The other 5 renders show 4/4 refined per render (no per-segment hold-back).

### Same-parent adjacency

| # | Job | Slot count | Parent | Sorted parent indices | Max run |
|---|---|---|---|---|---|
| 1 | e96d4cde | 4 | 072f4446 | [2, 6, 10, 12] | 1 |
| 2 | c3df3112 | 4 | 57c46b4a | [2, 8, 14, 18] | 1 |
| 3 | bb29a56c | 4 | 350467ca | [5, 9, 15, 16] | 2 |
| 4 | 6aeba119 | 4 | 072f4446 | [1, 2, 7, 10] | 2 |
| 5 | d7c733c5 | 4 | 6d6cb705 | [0, 5, 7, 13] | 1 |
| 6 | **223635f8** | **4** | **57c46b4a** | **[8, 9, 10, 18]** | **3 ❌** |

5/6 pass. **Job 6 ("pilates stretches that feel like rest")** has 3 consecutive picks `[8, 9, 10]` from parent `57c46b4a`. All 4 picks are `hold` segments, with three of them adjacent in the parent timeline. M-O-M v1.0.1 prompt explicitly forbids this — the model emitted it anyway on a feel-shaped seed where tonal coherence (all-hold) may have over-ridden the redundancy directive.

## Preview URLs (24h presigned, expire ~09:21 UTC 2026-05-04)

1. **morning core flow for tight hips** (`e96d4cde`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/e96d4cde-84c6-4f51-877f-511fa23fadf9-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T091022Z&X-Amz-Expires=86400&X-Amz-Signature=c84bb336b75311b842d0fcabce16055b3507f547488951a2443d0087b60f4040&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

2. **pilates breathing reset** (`c3df3112`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/c3df3112-6a15-4a4d-901f-ae25773bffac-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T092122Z&X-Amz-Expires=86400&X-Amz-Signature=b682f81b4e2f6736599e4ed26e3423b963529b3169cdbc0430873b69cf2a340b&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

3. **slow leg circles for stiff knees** (`bb29a56c`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/bb29a56c-3d83-4bee-989c-1774ea5b0eb5-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T091938Z&X-Amz-Expires=86400&X-Amz-Signature=aa3a8e60fa032dab8c8145aa02b0da1337a7304e0c05a154c5ad83d83ee12092&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

4. **gentle full body wakeup** (`6aeba119`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/6aeba119-4263-48f4-9378-7de15484676c-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T091717Z&X-Amz-Expires=86400&X-Amz-Signature=42bb4d796df91e4af1a34c110769cd8dc0f108c79cf399db101782f8f344ac00&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

5. **posture correction for desk workers** (`d7c733c5`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/d7c733c5-c604-4f0f-8b34-04fbdbef6680-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T091254Z&X-Amz-Expires=86400&X-Amz-Signature=2ded3a3d2e2ec9a77ed90c88faf759db22c4a8e9d1f5d551fa755fdf6e9a3154&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

6. **pilates stretches that feel like rest** (`223635f8`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/223635f8-3cc6-4e7a-9e94-b138c7b77449-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260503%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260503T091452Z&X-Amz-Expires=86400&X-Amz-Signature=28995738ee0f066f14ab9d207b262929e6e69afd42ea89d192e7e9aa09cfcf42&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

## Notable observations

- **Closed-GOP regression eliminated.** 0/6 Pass A failures vs c1.2.1.5's 4/6. Re-encode unblocked the cases where output-seek + `-c copy` would have dropped the video stream.
- **Fix-validation across 6 renders is the load-bearing result.** Maximum positive fix_gap of +0.10s confirms frame-accurate trim end-to-end. The c1.2.1.5 + c1.2.1.6 fix-pair structurally correct.
- **Editor v1.2.1 prompt now over-trims systematically.** 5/6 below 25s floor. The pacing-aware prompt was authored when the trim was buggy — refined boundaries weren't actually applying due to keyframe-snap padding. With trim now working, the prompt's same-aggressiveness produces ~10s shorter renders. Renders 1, 3, 5, 6 dropped 11-20s vs picks_sum.
- **Job 2 ("pilates breathing reset") is the only in-band render** at 26.1s. Editor returned `no_change` on all 4 segments, so no Editor over-trim contributed; M-O-M picked 4 short hold-segments summing to 26s already, and Editor correctly held them. Suggests M-O-M's slot-count + segment-length distribution is the right shape; Editor's pacing prompt is the over-trimming layer.
- **Same-parent run-of-3 surfaced once** (#6 "pilates stretches that feel like rest"). Same parent as v1.2.1's job 6 (`57c46b4a`) — feel-shaped seed where M-O-M's tonal-coherence directive (4 holds) over-rode the redundancy directive. Worth visual review whether 3 adjacent holds from one shoot reads as one continuous take.
- **Pass A wall budget held.** Re-encode added ~5-8s/segment × 4 segments = ~20-32s total. Render wall median 142.6s (vs v1.2.1's 109s) is +33.6s, within the 90s ceiling delta vs c6 baseline (~129s).
- **Editor cost flat.** $0.0179 median (was $0.0180 in v1.2.1, $0.0091 in c6). Identical prompt; identical slot-count distribution.

## Source-of-truth

`/tmp/c1216-gate-a-raw.json` — 6-record JSON dump with full `editor_outcome`, segment_ids, parent indices, costs, walls, preview URLs, fix_gap calculations.

## Stack note

Branch `feat/simple-pipeline-editor-agent` at HEAD `25e875e` (c1.2.1.6). NOT stacked. VPS-deployed HEAD: `25e875e`.

---

**c1.2.1.6 Gate A awaiting operator visual review. Hold for review or merge?**
