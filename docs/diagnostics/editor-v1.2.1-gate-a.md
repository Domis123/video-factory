# Editor agent v1.2.1 + M-O-M v1.0.1 — Gate A diagnostic

**Date:** 2026-05-01
**Branch:** `feat/simple-pipeline-editor-agent` at HEAD `e8a6987` (VPS-deployed code through `a347f4e`; `e8a6987` is trigger-script-only, not exercised on the Sheet path)
**Path:** Sheet → n8n S1 → BullMQ `simple_pipeline` → worker
**Workstream:** v1.2.1 (Editor pacing-aware) + M-O-M v1.0.1 (slot count bias + same-parent + vague seed)

## Summary

6/6 routine Gate A renders completed through `human_qa`. Editor invoked on every render. **0 fallbacks across 24 segments; 19/24 (79%) refined.** Slot count distribution median shifted from 3 (c6) to 4 (v1.2.1) — the M-O-M v1.0.1 bias is reading.

**Mechanical bar: PARTIAL — duration band fails.** 3/6 renders fell outside the target [25, 35]s band: two over (42s, 40s) and one under (18s). 1/6 has 3+ adjacent picks from one parent (#4 "gentle full body wakeup"). All other mechanical bar checks pass.

Per kickoff halt-condition list, ">1 of 6 has total render duration outside [25s, 35s]" is triggered (3 > 1). Surfacing for operator review before merge.

## Per-render outcomes

| # | Job ID | Idea seed | Slots | Refined / no_change / fallback | Render wall | Editor wall | Editor cost | Total cost | Total duration | Same-parent run | Mechanical bar |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `cf312363` | morning core flow for tight hips | 4 | 4 / 0 / 0 | 134.5s | 25.9s | $0.0179 | $0.0727 | **42.07s** ❌ | 2 | **FAIL** (duration) |
| 2 | `464043c2` | pilates breathing reset | 3 | 0 / 3 / 0 | 92.9s | 19.4s | $0.0131 | $0.0585 | **18.07s** ❌ | 1 | **FAIL** (duration) |
| 3 | `9c0496fc` | slow leg circles for stiff knees | 4 | 4 / 0 / 0 | 97.3s | 21.7s | $0.0180 | $0.0664 | 30.03s | 2 | PASS |
| 4 | `726c23c9` | gentle full body wakeup | 5 | 5 / 0 / 0 | 147.1s | 39.3s | $0.0224 | $0.0749 | **40.13s** ❌ | **3** ❌ | **FAIL** (duration + same-parent) |
| 5 | `b8e4706f` | posture correction for desk workers | 4 | 4 / 0 / 0 | 118.9s | 25.9s | $0.0180 | $0.0704 | 27.83s | 1 | PASS |
| 6 | `141d021c` | pilates stretches that feel like rest | 4 | 2 / 2 / 0 | 99.2s | 21.4s | $0.0177 | $0.0724 | 33.47s | 1 | PASS |

**Total render duration** = `details.duration_s` (the rendered video's actual length post-Editor trim and ffmpeg concat). The Editor's pacing target is 30s ±5s, hence the [25, 35]s mechanical bar.

**Render wall** = orchestrator's `details.wall_time_s` (Match-Or-Match + Editor + overlay + music + ffmpeg + R2 upload + cleanup). Worker concurrency=1, so jobs ran serially.

**Same-parent run** = longest run of consecutive parent-relative indices (sorted) across the picks. Run ≥3 fails the "no 3+ consecutive picks from one parent" mechanical bar check.

## Mechanical bar check-by-check

| Check | Threshold | Result | Status |
|---|---|---|---|
| All 6 reach `human_qa` | 6/6 | 6/6 | ✅ |
| `editor_outcome.editor_invoked === true` | 6/6 | 6/6 | ✅ |
| Slot count distribution median ≥ 4 | median ≥ 4 | distribution `{3:1, 4:4, 5:1}` → median **4** | ✅ |
| Refined boundaries within original | by construction | guaranteed by `applyClamps()` | ✅ |
| Refined duration ≥ 1.5s | by construction | guaranteed by clamp 3 | ✅ |
| `segments_fallback === 0` per render | 6/6 | 6/6 (24/24 segments) | ✅ |
| Total render duration in [25s, 35s] | 6/6 | **3/6** (cf312363 42s, 464043c2 18s, 726c23c9 40s) | ❌ |
| Wall delta vs c6 baseline median (~129s) < 90s | all renders | max wall 147.1s = **+18.1s** vs baseline (well under 90s ceiling) | ✅ |
| No 3+ consecutive parent indices per render | all renders | **5/6** (job 4 has run-of-3 at parent indices `[1,2,3]` from sorted `[1,2,3,7,10]`) | ❌ |

**Mechanical bar overall: FAIL** on duration band (3 of 6) and same-parent (1 of 6).

### Halt-condition status (per kickoff)

| Halt condition | Threshold | Result | Triggered |
|---|---|---|---|
| Trigger script throws (Upstash burst recurrence) | trigger-only | n/a (Sheet path) | no |
| `>0` enqueue rollbacks | 0 | n/a (Sheet path) | no |
| `>1 of 6` fails 90s wall mechanical bar | >1 | 0 of 6 fail | no |
| `>1 of 6` has total render duration outside [25s, 35s] | >1 | **3 of 6** | **YES** |
| `>1 of 6` has slot count < 4 | >1 | 1 of 6 (#2 = 3 slots) | no |
| Any clamp violation in refined boundaries | any | 0 (guaranteed by schema) | no |
| `>2 of 6` hit fallback on every segment | >2 | 0 of 6 (zero fallbacks total) | no |

**Duration halt triggered.** Surfacing before operator visual review.

## Aggregate stats

### Cost (per render, USD)

| | min | median | max | p95 (n=6) | sum |
|---|---|---|---|---|---|
| Editor cost | $0.0131 | $0.0180 | $0.0224 | $0.0224 | $0.1071 |
| Total cost | $0.0585 | $0.0714 | $0.0749 | $0.0749 | $0.4153 |

p95 with n=6 = the maximum sample. Reported for shape consistency with c6 artifact; treat as max.

Comparison vs c6 (v1.2):
- Total cost median: c6 $0.0610 → v1.2.1 $0.0714 (+17%). Driven by more segments (avg 4.0 vs 3.17) requiring more Editor calls + more pacing-aware reasoning per call.
- Editor cost share: c6 ~$0.009 → v1.2.1 ~$0.018 (≈2x). Pacing-aware prompt is denser, but absolute cost still well under the $1/video operator ceiling.

### Wall time (per render, seconds)

| | min | median | max | p95 (n=6) |
|---|---|---|---|---|
| Render wall (orchestrator t0) | 92.9 | 109.05 | 147.1 | 147.1 |
| Editor wall (within render wall) | 19.4 | 23.8 | 39.3 | 39.3 |

Editor wall as fraction of total render wall: median ~22%, range 16–27%. Slightly higher than c6 (~18%) because the longer pacing-aware prompt + larger slot counts (4-5 segments → 4-5 parallel calls vs c6's mostly-3) push more work into the Editor stage.

Wall delta vs c6 baseline median (~129s):
- Renders 2-6 are at or below baseline (range −36s to +18s).
- Render 1 (134.5s) is +5.5s vs baseline.
- Render 4 (147.1s) is +18.1s vs baseline (5-slot render, longer Editor wall).
- All within the 90s ceiling; nothing close to mechanical bar failure on wall.

### Slot count distribution

| Slots | Count |
|---|---|
| 3 | 1 (#2 "pilates breathing reset" — feel-shaped, M-O-M reasoning cited tonal coherence) |
| 4 | 4 |
| 5 | 1 (#4 "gentle full body wakeup") |

**Median: 4.** M-O-M v1.0.1 slot bias is reading — c6 had 5×3-slot + 1×4-slot (median 3); v1.2.1 has 4×4 + 1×3 + 1×5 (median 4).

### Editor outcome distribution (segment-level)

| Outcome | Count | Share | vs c6 |
|---|---|---|---|
| `refined_ok` | 19 | 79% | c6: 11/19 = 58% |
| `no_change_needed` | 5 | 21% | c6: 8/19 = 42% |
| `fallback` | 0 | 0% | c6: 0% |

24 total segments across 6 renders. **Refinement rate up ~21 points** (58% → 79%) — Editor pacing prompt pushed more refinement under the 30s target pressure. Job 2 ("pilates breathing reset", 3 slots × 18.07s ÷ already under target = no_change on all 3) is the single all-`no_change` render — Editor correctly held boundaries when render was already short of target.

### Same-parent adjacency

| # | Job | Slot count | Parent | Sorted parent indices | Max run |
|---|---|---|---|---|---|
| 1 | cf312363 | 4 | d46e70c4 | [12, 19, 29, 30] | 2 |
| 2 | 464043c2 | 3 | 27511ae4 | [0, 3, 9] | 1 |
| 3 | 9c0496fc | 4 | d12b4eba | [2, 5, 6, 9] | 2 |
| 4 | **726c23c9** | **5** | **072f4446** | **[1, 2, 3, 7, 10]** | **3 ❌** |
| 5 | b8e4706f | 4 | 6d6cb705 | [0, 5, 7, 13] | 1 |
| 6 | 141d021c | 4 | 57c46b4a | [2, 9, 18, 21] | 1 |

5/6 pass the "no 3+ consecutive picks" rule. **Job 4 is the exception** — picks at parent indices `[1, 3, 7, 2, 10]` sort to `[1, 2, 3, 7, 10]`, a run of 3. The M-O-M v1.0.1 same-parent-redundancy directive was included in the prompt but the model still emitted this case on the 5-slot pick. Worth surfacing visually whether this read as redundant in the actual render.

## Preview URLs (24h presigned)

1. **morning core flow for tight hips** (`cf312363`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/cf312363-7b23-4830-bcb9-f074eba93675-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T181549Z&X-Amz-Expires=86400&X-Amz-Signature=eda2e10103f1c9ca207ffb57888d5adac9f83ce8e88ec7e9f563e8ecccca8c8c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

2. **pilates breathing reset** (`464043c2`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/464043c2-21c1-47ee-a37a-298e7fd5ef13-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T181723Z&X-Amz-Expires=86400&X-Amz-Signature=298f747f14d9dc340e00806f33640a2004078046844764308d90e8a5d55dc091&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

3. **slow leg circles for stiff knees** (`9c0496fc`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/9c0496fc-1524-4bd9-85f3-37af354a0a23-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T181900Z&X-Amz-Expires=86400&X-Amz-Signature=00d8b28320f4ce5efcd23f850fa21a712f80adea43c71b7059123aa5e04e8710&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

4. **gentle full body wakeup** (`726c23c9`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/726c23c9-fb51-4999-9b7f-bfd7b4fc7521-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T182307Z&X-Amz-Expires=86400&X-Amz-Signature=38edf6fd716737c8943428ec5bdba707c36990f67e648abdbde8977994019f8e&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

5. **posture correction for desk workers** (`b8e4706f`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/b8e4706f-759e-4ed6-a06e-0743c23d85ac-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T182506Z&X-Amz-Expires=86400&X-Amz-Signature=3ef41fe9c02628580a299376ad14adbab10f91f67b53388b5b122d6bd80bd75e&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

6. **pilates stretches that feel like rest** (`141d021c`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/141d021c-5e20-4309-849c-511ee15408da-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T182039Z&X-Amz-Expires=86400&X-Amz-Signature=04883f95cf06dac11ac04bc476ae91631958f60714ce97d3d5b564ecef67eb7e&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

URLs expire 24h after generation (~17:25 UTC 2026-05-02).

## Per-segment detail (M-O-M picks + original boundaries)

For each render, the segments M-O-M selected and their original (pre-Editor) boundaries. The Editor's actual refined boundaries aren't persisted (per brief: "no schema migration, observability via job_events.payload"); only the aggregate count of refined / no_change / fallback is captured in `editor_outcome`.

### #1 cf312363 — "morning core flow for tight hips" (parent d46e70c4, 4 slots, total 42.07s)
- segment `adfcb97a` `hold` [287.00, 298.00]s (11.00s)
- segment `1fd899bd` `exercise` [299.00, 311.00]s (12.00s)
- segment `d4a75890` `exercise` [194.00, 205.80]s (11.80s)
- segment `b13874af` `hold` [120.00, 133.00]s (13.00s)

Total picked-original: 47.80s. Editor refined all 4 → final 42.07s. Trim of ~5.7s, but render still 7s over the 35s ceiling.

### #2 464043c2 — "pilates breathing reset" (parent 27511ae4, 3 slots, total 18.07s)
- segment `b928c71c` `setup` [0.00, 3.50]s (3.50s)
- segment `93558eea` `exercise` [18.00, 25.50]s (7.50s)
- segment `09a742be` `transition` [61.50, 63.80]s (2.30s)

Total picked-original: 13.30s. Editor returned `no_change` on all 3. Render 18.07s — 7s under the 25s floor. M-O-M picked only 3 slots citing feel-shape; total picked-original was already short of target.

### #3 9c0496fc — "slow leg circles for stiff knees" (parent d12b4eba, 4 slots, total 30.03s)
- segment `f0c03c48` `exercise` [18.00, 28.00]s (10.00s)
- segment `7801a934` `exercise` [59.00, 70.00]s (11.00s)
- segment `d0e9b42d` `transition` [48.00, 59.00]s (11.00s)
- segment `ed4ec9a9` `exercise` [90.00, 100.00]s (10.00s)

Total picked-original: 42.00s. Editor refined all 4 → final 30.03s. Clean ~12s trim into the band.

### #4 726c23c9 — "gentle full body wakeup" (parent 072f4446, 5 slots, total 40.13s) — same-parent run-of-3
- segment `af43fcfe` `transition` [1.50, 5.50]s (4.00s)  ← parent index 1
- segment `e9dd82a5` `transition` [10.50, 14.50]s (4.00s)  ← parent index 3
- segment `c3811c36` `exercise` [35.00, 46.00]s (11.00s)  ← parent index 7
- segment `6f3f25be` `exercise` [5.50, 10.50]s (5.00s)  ← parent index 2
- segment `e227bfbb` `exercise` [60.00, 66.50]s (6.50s)  ← parent index 10

Total picked-original: 30.50s. Editor refined all 5 — but final duration is 40.13s, longer than picked-original. **This is suspicious** (expected: refined ≤ picked since Editor only trims, never widens). Possible explanation: ffmpeg concat overhead, or `details.duration_s` is measured post-render (probe of MP4) and includes encoder/audio settling. Worth a closer look on visual review.

Parent indices `[1, 3, 7, 2, 10]` sort to `[1, 2, 3, 7, 10]` — picks at parent positions 1+2+3 form a run of 3, the same-parent redundancy pattern the M-O-M v1.0.1 prompt explicitly forbids. Slot 1 (transition idx 1) + slot 4 (exercise idx 2) + slot 2 (transition idx 3) are likely visually adjacent in the source shoot.

### #5 b8e4706f — "posture correction for desk workers" (parent 6d6cb705, 4 slots, total 27.83s)
- segment `ef9510b0` `exercise` [72.00, 82.00]s (10.00s)
- segment `d9af4ca8` `exercise` [92.00, 101.00]s (9.00s)
- segment `b5a0bf84` `exercise` [163.00, 171.00]s (8.00s)
- segment `1263f4e3` `exercise` [0.00, 11.80]s (11.80s)

Total picked-original: 38.80s. Editor refined all 4 → 27.83s. Clean ~11s trim into the band.

### #6 141d021c — "pilates stretches that feel like rest" (parent 57c46b4a, 4 slots, total 33.47s)
- segment `21f26d70` `hold` [137.00, 148.00]s (11.00s)
- segment `bdbe0ed4` `hold` [59.00, 65.00]s (6.00s)
- segment `d49e1f26` `hold` [11.00, 16.00]s (5.00s)
- segment `a0f61d4c` `hold` [117.00, 124.00]s (7.00s)

Total picked-original: 29.00s. Editor refined 2, kept 2 → 33.47s. All 4 picks are `hold` segments — feel-shaped seed handled per M-O-M v1.0.1 vague-seed section (tonal coherence).

## Notable observations

- **Slot count distribution shifted as designed** (median 3 → 4). M-O-M v1.0.1 slot bias section is reading.
- **Refinement rate jumped 21 points** (58% → 79%). Editor pacing-aware section is reading.
- **All-hold render** (#6) — feel-shaped seed produced 4 hold-type picks. M-O-M v1.0.1 vague-seed handling is reading.
- **3-slot fallback when feel demands it** (#2) — M-O-M correctly picked 3 slots citing tonal coherence rather than padding to 4 with weak picks.
- **Duration band misses split into two patterns:**
  - 2 over (cf312363 42s, 726c23c9 40s): renders with 4-5 long picks where Editor's aggressive trim still didn't bring total under 35s. Editor was constrained by the 1.5s floor + boundary quality from going further.
  - 1 under (464043c2 18s): M-O-M picked 3 short feel-driven segments; total picked-original was 13.3s already; Editor correctly returned no_change since render was already under target. Pre-Editor under-target case isn't something Editor v1.2.1 is designed to fix (Editor only trims, never widens / adds).
- **Same-parent run-of-3 surfaced once** (#4). The M-O-M v1.0.1 prompt warns against this pattern but the model emitted it anyway on a 5-slot pick from a parent with closely-spaced segments. Visual review will determine if it actually plays as redundant.
- **Suspicious duration on render #4**: `details.duration_s = 40.13` exceeds picked-original sum 30.50s. Either a measurement quirk (concat overhead, audio-tail) or a refined-bounds bug. Worth checking if this happens in operator's visual review.
- **Editor cost up to median $0.018**: roughly 2x c6's $0.009. Driven by longer prompt + more slots per render + parallel calls. Still well under the $1/video operator ceiling.

## Halt-condition surface (per kickoff Rule 43 license)

> `>1 of 6 has total render duration outside [25s, 35s]`

**TRIGGERED.** 3 of 6 outside band:
- cf312363: 42.07s (+7 over)
- 464043c2: 18.07s (-7 under)
- 726c23c9: 40.13s (+5 over; also same-parent run-of-3)

Operator visual review will determine whether the duration misses are visually load-bearing or cosmetic. Per Editor v1.2 review pivot, the bar is operator-judgment-based against memory of c6 ("≥4/6 uploadable, 0/6 worse"); this artifact's mechanical bar failure does not automatically block ship.

## Source-of-truth

`/tmp/v121-gate-a-raw.json` — 6-record JSON dump with full `editor_outcome`, segment_ids, parent indices, costs, walls, preview URLs. Should be archived if needed for future reference.

## Stack note

Branch `feat/simple-pipeline-editor-agent` at HEAD `e8a6987` (c1.2.1.4 trigger-script-only). NOT stacked. VPS-deployed HEAD: `a347f4e` (c1.0.1.1 + earlier). All v1.2.1 production code IS on VPS.

Out-of-scope items per brief stay parked as future followups: CLIP-distance scoring, music-driven beat cuts, Editor v2 drop+re-pick, per-form pacing presets, operator-doc seed-writing patterns.

---

**Gate A awaiting operator visual review. Hold for review or merge?**
