# Editor agent v1.2 — Gate A diagnostic

**Date:** 2026-05-01
**Branch:** `feat/simple-pipeline-editor-agent` at HEAD `9845684` (deployed to VPS `8992657` for the renders below; `9845684` is defensive trigger-script infra not exercised on this run)
**Path:** Sheet → n8n S1 → BullMQ `simple_pipeline` → worker (Path C from session 21 plan)

## Summary

6/6 routine Gate A renders completed through `human_qa`. Editor agent invoked on every render. **0 fallbacks across 19 total segments.** 11/19 segments refined (58%); 8/19 returned `no_change_needed`. Mechanical bar: PASS on all 6 renders. Awaiting operator visual review.

## Per-render outcomes

| # | Job ID | Idea seed | Slots | Refined / no_change / fallback | Editor wall | Editor cost | Total cost | Render wall |
|---|---|---|---|---|---|---|---|---|
| 1 | `5d627575` | morning glute activation routine | 3 | 1 / 2 / 0 | 34.8s | $0.0089 | $0.0617 | 143.5s |
| 2 | `71bfed56` | gentle hip openers for desk workers | 3 | 2 / 1 / 0 | 36.3s | $0.0091 | $0.0622 | 138.0s |
| 3 | `c16db819` | unwind your spine before bed | 4 | 2 / 2 / 0 | 24.4s | $0.0120 | $0.0587 | 110.7s |
| 4 | `6fdf838e` | pilates that actually feels good in your body when you're tired | 3 | 3 / 0 / 0 | 20.2s | $0.0091 | $0.0535 | 141.5s |
| 5 | `5ff8f65f` | core engagement basics — 4 movements that actually transfer | 3 | 1 / 2 / 0 | 19.2s | $0.0090 | $0.0602 | 119.8s |
| 6 | `903e83f7` | slow controlled flow — no jumping no momentum just breath and intent | 3 | 2 / 1 / 0 | 22.5s | $0.0093 | $0.0619 | 118.4s |

**Render wall** is `details.wall_time_s` from the human_qa transition (orchestrator's t0-to-completion — Match-Or-Match + editor + overlay + music + ffmpeg + R2 upload + cleanup). Worker concurrency=1, so jobs ran serially (visible in `simple_pipeline_rendering` transition timestamps spaced ~140s apart).

## Mechanical bar evaluation

Per kickoff (this run), mechanical bar simplified to: clamps held + completes through human_qa + Editor invoked + duration ≥1.5s on all refinements. Wall delta threshold N/A without paired baseline.

| Check | Threshold | Result |
|---|---|---|
| All 6 reach `human_qa` | 6/6 | ✅ 6/6 |
| `editor_outcome.editor_invoked === true` | 6/6 | ✅ 6/6 |
| `slot_count` in [2, 5] | all | ✅ 5 renders at 3 slots, 1 at 4 |
| `segments_fallback === 0` | all | ✅ 19/19 segments avoided fallback |
| Refined boundaries within original | by construction | ✅ guaranteed by `applyClamps()` (c1 schema) — `refined_ok` outcomes only emitted after pass-through |
| Refined duration ≥ 1.5s | by construction | ✅ guaranteed by clamp 3 in `applyClamps()` — sub-1.5s windows reject to fallback, which would surface in `fallback_reasons` (empty here) |
| `fallback_reasons` empty | yes | ✅ `{}` on all 6 |

**Mechanical bar: PASS on all 6 renders.**

## Aggregate stats

### Editor wall (per render)
| | ms |
|---|---|
| min | 19,236 |
| median | 23,446 |
| max | 36,325 |
| p95 | ≈36,265 (single sample at 36,325; n=6 too small for true p95) |

Editor wall as a fraction of total render wall: median ~18%, range 13–26%. Editor adds meaningful but bounded latency to the routine pipeline.

### Editor cost (per render)
| | USD |
|---|---|
| min | $0.0089 |
| median | $0.0091 |
| max | $0.0120 |

Median cost matches projection (~$0.005-0.01 per segment × ~3 segments). Job 3 (c16db819, 4 slots) is the outlier on cost — slot count drives Gemini calls linearly.

### Total cost (per render)
| | USD |
|---|---|
| min | $0.0535 |
| median | $0.0610 |
| max | $0.0622 |

Sum across 6 renders: $0.3582. Comparison: Phase 3.5 advanced pipeline costs ~$0.55-1.05/video. Simple Pipeline + Editor at ~$0.06/video is well within the $1.00/video operator ceiling.

### Editor outcome distribution (segment-level)
| Outcome | Count | Share |
|---|---|---|
| `refined_ok` (model proposed new bounds, clamps held) | 11 | 58% |
| `no_change_needed` (model returned `no_change_needed: true`) | 8 | 42% |
| `fallback` (Zod fail / clamp rejection / transient error) | 0 | 0% |

19 segments total across 6 renders.

### Fallback-reason distribution
None. `fallback_reasons: {}` on all 6 renders.

## Preview URLs (24h presigned)

1. **morning glute activation routine** (`5d627575`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/5d627575-22ef-4462-bdc7-b19034adf3b1-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T095456Z&X-Amz-Expires=86400&X-Amz-Signature=f2182f35b298ed119b0b555e1d9670dbcb954383bdfff6ff104a4894529594ec&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

2. **gentle hip openers for desk workers** (`71bfed56`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/71bfed56-7adf-4889-b65f-834f9925b51e-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T095715Z&X-Amz-Expires=86400&X-Amz-Signature=afc0de154f2623a019ec240e1b700ae9d4db2de6de2b404a24636e94efb33d2c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

3. **core engagement basics — 4 movements that actually transfer** (`5ff8f65f`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/5ff8f65f-b595-4e83-a056-d802e63e99a5-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T100328Z&X-Amz-Expires=86400&X-Amz-Signature=695838332c0c779d91992d1e5e61445116cd16ebd6b64d2e33be261fd3d2fd03&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

4. **unwind your spine before bed** (`c16db819`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/c16db819-1eff-493f-bda6-cb6df533b4ee-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T095906Z&X-Amz-Expires=86400&X-Amz-Signature=f05166439364b35019f292a948663b22cb5cc61df803f91a7d30ad98c793a847&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

5. **pilates that actually feels good in your body when you're tired** (`6fdf838e`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/6fdf838e-e86d-4c7d-ac45-ed972ea9e145-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T100127Z&X-Amz-Expires=86400&X-Amz-Signature=b41beaf9269046507eaa4d3b5f376c3afc2990074344cabaeffeca928fa78314&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

6. **slow controlled flow — no jumping no momentum just breath and intent** (`903e83f7`): https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-05/903e83f7-5419-4db6-b4b2-dfbe3962b502-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260501%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260501T100526Z&X-Amz-Expires=86400&X-Amz-Signature=fe51c279139c9c8e07fd3cd4ff2f21a9a72edf69a7cba9ce7fd5ccf7d202639f&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject

URLs expire 24h after generation (~10:05 UTC 2026-05-02). Operator regenerates via Sheet's Preview URL refresh if needed past then.

## Notable observations

- **No paired baseline.** Operator chose to review against memory of v1.1 quality rather than render an A/B set. The Q8 spec's `0/6 noticeably worse, ≥4/6 noticeably better` thresholds still apply but evaluated as judgment-call.
- **Render wall is dominated by render-time, not Editor.** Editor median 23.4s vs total render median 128.9s. The Editor is ~18% of the render wall on average.
- **Refinement rate is 58%.** The Editor proposes a refinement on ~3 of every 5 picked segments. The other 42% return `no_change_needed` — escape path is being used as designed (Rule 38 / Rule 39).
- **Zero fallbacks.** No transient Gemini errors, no Zod parse failures, no clamp rejections across 19 segment-level calls. Worth noting that this is a small sample; the c3 production-data smoke also showed 0 fallbacks across 5 segments.
- **Render order ≠ submission order.** Worker processed in BullMQ order: `5d627575 → 71bfed56 → c16db819 → 6fdf838e → 5ff8f65f → 903e83f7`. The total Sheet→completion latency varied from 144s (first picked up) to 745s (last picked up) — a function of `concurrency=1`, not Editor performance.

## Out of scope for this Gate A

- **Per-segment refined-vs-original delta.** Refined boundaries are computed in-memory in the orchestrator, passed to render, and not persisted (per brief: "No schema migration. Observability via `job_events.payload`."). Aggregate counts in `editor_outcome` are the available signal.
- **Side-by-side baseline package** (Artifact 2 of brief). Operator chose judgment-call review against v1.1 memory rather than paired renders.

## Source-of-truth

`/tmp/editor-gate-a-sheet-raw.json` — 6-record JSON dump from the Sheet-watcher with full editor_outcome payloads, preview URLs, and timestamps. Should be archived if needed for future reference (currently in /tmp).

## Stack note

Branch `feat/simple-pipeline-editor-agent` at HEAD `9845684` (post-c5.9). NOT stacked. VPS deploy used the previous HEAD `8992657` (c5.7 worker limiters) — c5.8 trigger-script atomicity and c5.9 sleep-spacing are defensive infra for any future trigger-script use, not exercised on this Sheet-driven run.

---

**Gate A awaiting operator visual review.**
