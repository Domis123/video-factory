# Simple Pipeline Gate A — Round 2 (post-prompt-iteration)

**Date:** 2026-04-29T10:51:45.722Z
**Branch:** `feat/simple-pipeline`
**Round 1 (render fix) commit:** `b858f08`
**Round 2 (prompt fix) commit:** `47c1a50`
**Wall time:** 16.8 min

---

## Automated metrics

| Metric | Value |
|---|---|
| Routine reached human_qa | 6 / 6 |
| Meme reached human_qa | 6 / 6 |
| Routine slot_count distribution | 2×1, 3×4, 4×1 |
| Distinct routine parents | 5 / 6 |
| Distinct meme parents | 6 / 6 |
| Distinct overlays | 12 / 12 |
| Total Gemini cost | $1.7389 (free via credits) |

## Routine renders (6) — A/B against c10 first-run

| # | Idea seed | Slot count | Overlay | Round 2 preview | c10 jobId (cross-ref) | Visual review |
|---|---|---|---|---|---|---|
| 1 | "5-minute morning glute flow" | 3 | "Your mindful 5-minute glute awakening" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/1e148ee8-0f23-4c05-babd-625a5ba7fe90-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=20606e404cdaa1668f08480ed9bb7476a576b539756dc482f4478695a5d025e6&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `4cdb0503` | [Domis review] |
| 2 | "core routine that actually works" | 3 | "Awaken your deep core strength" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/fc329b70-f38a-4c76-a51e-b487158fbaea-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=f9db6cd8946a7ccce1af7844c11182788ded7611c0ee0e70ce7216db707fab78&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `6d0508b9` | [Domis review] |
| 3 | "wake your hips up before sitting all day" | 3 | "A gentle awakening for your hips" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/1baddb43-da15-4add-8cf3-041ffd72a292-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=ca9202597338932fe0999984af9d3f02b8916e4aa698278cefaae370e668d202&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `0a616849` | [Domis review] |
| 4 | "mobility for stiff shoulders" | 2 | "Breathe space into your shoulders" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/6d1ede71-4264-43ae-beac-f3311278362a-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=3caa4b4d6d51b6653e30625cb0207d450d20c1061b992205ce2f2b13c6a4d91e&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `fea8b48b` | [Domis review] |
| 5 | "standing pilates moves you can do anywhere" | 3 | "Standing pilates to ground your day" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/38521803-096d-4d20-af5b-8ee4fb999d58-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=d1eabf5abd48ef74113dd02611e50b1331627d06e6b35daebe3429682a1990d9&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `7a13d0e3` | [Domis review] |
| 6 | "gentle stretches before bed" | 4 | "Ease into rest with this gentle flow" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/8f90aed5-94d4-4a5a-9e98-31654f18747e-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=8b7d0858fcc292945843fbcb5996109d54ec37dde00d721ceaa4cc6be65770e3&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `d5ddda47` | [Domis review] |

## Meme renders (6) — A/B against c10 first-run

| # | Style | Idea seed | Overlay | Round 2 preview | c10 jobId (cross-ref) | Visual review |
|---|---|---|---|---|---|---|
| 1 | literal | "stretching for 30 seconds counts right" | "did my one stretch for the day" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/241eb19c-d1e3-4d15-b2c1-43c266d222e9-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=077d6a5b5d203a8e1671a25025ffff61ba65c1a5818a352c2e0e054cd2faf791&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `dceffe11` | [Domis review] |
| 2 | abstract | "main character energy" | "in my workout montage era" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/4cffec5b-9f40-47ad-8bda-3a21b390f080-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=d8989008aad671eb975dd2a24dda7706ecd7bd82f1d39f543f2ceb24dda16476&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `36435540` | [Domis review] |
| 3 | ironic | "POV you actually moved today" | "I am now a health icon" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/672b59b5-b770-4633-a757-b7b0f7aee4d0-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=97aad2ebb3eecd615fca514f2969929bb46924e726a328b1c7c2cafddb12ba5c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `697af9fb` | [Domis review] |
| 4 | oblique | "lying down isn't the only kind of rest" | "the other kind of rest" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/fc4d5059-79a9-48e1-a7fd-2ef0c9152d16-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=57e330015b429beb3a0b1af5e90122d4b0e3f50aefc4d3c3de73efb6ea654622&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `8d45c49b` | [Domis review] |
| 5 | vibey | "soft girl pilates era" | "romanticizing my little workout" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/88b66f7b-ed18-48d7-94f3-a6619e3d70ea-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=b61fba9b84674891b23931682c310677aa1cf19d5b65edb078e574c9af07d2a9&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `3f0fec82` | [Domis review] |
| 6 | simple | "no thoughts just stretching" | "my brain on airplane mode" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/308cf62c-a83e-4e1b-b45a-0295b8ea23db-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T105145Z&X-Amz-Expires=86400&X-Amz-Signature=e4cecafb35ef4718f6c9479002d162ac5950084a070b9e7b15f1457284f576c3&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `d6894c12` | [Domis review] |

---

## Q7 hard threshold (operator visual review)

For each render, gestalt yes/no: **"would I upload this to TikTok today?"**

Bar **excludes** Polish Sprint cosmetic issues (overlay size/position, logo size/age, transitions). Fail only for: bad clip selection, bad overlay text content, creatively unusable output.

**Halt:** ≥4 of 6 routine fail OR ≥4 of 6 meme fail → halt, iterate prompts again, re-run.

**Else:** ship + file simple-pipeline-routine-prompt-iteration and simple-pipeline-meme-prompt-iteration followups for any remaining post-merge polish, then merge feat/simple-pipeline → main + deploy.

| Product | Pass count | Verdict |
|---|---|---|
| Routine | _ / 6 | [Domis] |
| Meme | _ / 6 | [Domis] |

## Cleanup commands (after Domis review closes Round 2)

```sql
DELETE FROM simple_pipeline_render_history WHERE job_id IN (
  '1e148ee8-0f23-4c05-babd-625a5ba7fe90',
  'fc329b70-f38a-4c76-a51e-b487158fbaea',
  '1baddb43-da15-4add-8cf3-041ffd72a292',
  '6d1ede71-4264-43ae-beac-f3311278362a',
  '38521803-096d-4d20-af5b-8ee4fb999d58',
  '8f90aed5-94d4-4a5a-9e98-31654f18747e',
  '241eb19c-d1e3-4d15-b2c1-43c266d222e9',
  '4cffec5b-9f40-47ad-8bda-3a21b390f080',
  '672b59b5-b770-4633-a757-b7b0f7aee4d0',
  'fc4d5059-79a9-48e1-a7fd-2ef0c9152d16',
  '88b66f7b-ed18-48d7-94f3-a6619e3d70ea',
  '308cf62c-a83e-4e1b-b45a-0295b8ea23db'
);
DELETE FROM job_events WHERE job_id IN (
  '1e148ee8-0f23-4c05-babd-625a5ba7fe90',
  'fc329b70-f38a-4c76-a51e-b487158fbaea',
  '1baddb43-da15-4add-8cf3-041ffd72a292',
  '6d1ede71-4264-43ae-beac-f3311278362a',
  '38521803-096d-4d20-af5b-8ee4fb999d58',
  '8f90aed5-94d4-4a5a-9e98-31654f18747e',
  '241eb19c-d1e3-4d15-b2c1-43c266d222e9',
  '4cffec5b-9f40-47ad-8bda-3a21b390f080',
  '672b59b5-b770-4633-a757-b7b0f7aee4d0',
  'fc4d5059-79a9-48e1-a7fd-2ef0c9152d16',
  '88b66f7b-ed18-48d7-94f3-a6619e3d70ea',
  '308cf62c-a83e-4e1b-b45a-0295b8ea23db'
);
DELETE FROM jobs WHERE id IN (
  '1e148ee8-0f23-4c05-babd-625a5ba7fe90',
  'fc329b70-f38a-4c76-a51e-b487158fbaea',
  '1baddb43-da15-4add-8cf3-041ffd72a292',
  '6d1ede71-4264-43ae-beac-f3311278362a',
  '38521803-096d-4d20-af5b-8ee4fb999d58',
  '8f90aed5-94d4-4a5a-9e98-31654f18747e',
  '241eb19c-d1e3-4d15-b2c1-43c266d222e9',
  '4cffec5b-9f40-47ad-8bda-3a21b390f080',
  '672b59b5-b770-4633-a757-b7b0f7aee4d0',
  'fc4d5059-79a9-48e1-a7fd-2ef0c9152d16',
  '88b66f7b-ed18-48d7-94f3-a6619e3d70ea',
  '308cf62c-a83e-4e1b-b45a-0295b8ea23db'
);
```

```bash
# R2 keys (manual via lib helper or aws s3 rm)
# rendered/nordpilates/2026-04/1e148ee8-0f23-4c05-babd-625a5ba7fe90-simple-pipeline.mp4
# rendered/nordpilates/2026-04/fc329b70-f38a-4c76-a51e-b487158fbaea-simple-pipeline.mp4
# rendered/nordpilates/2026-04/1baddb43-da15-4add-8cf3-041ffd72a292-simple-pipeline.mp4
# rendered/nordpilates/2026-04/6d1ede71-4264-43ae-beac-f3311278362a-simple-pipeline.mp4
# rendered/nordpilates/2026-04/38521803-096d-4d20-af5b-8ee4fb999d58-simple-pipeline.mp4
# rendered/nordpilates/2026-04/8f90aed5-94d4-4a5a-9e98-31654f18747e-simple-pipeline.mp4
# rendered/nordpilates/2026-04/241eb19c-d1e3-4d15-b2c1-43c266d222e9-simple-pipeline.mp4
# rendered/nordpilates/2026-04/4cffec5b-9f40-47ad-8bda-3a21b390f080-simple-pipeline.mp4
# rendered/nordpilates/2026-04/672b59b5-b770-4633-a757-b7b0f7aee4d0-simple-pipeline.mp4
# rendered/nordpilates/2026-04/fc4d5059-79a9-48e1-a7fd-2ef0c9152d16-simple-pipeline.mp4
# rendered/nordpilates/2026-04/88b66f7b-ed18-48d7-94f3-a6619e3d70ea-simple-pipeline.mp4
# rendered/nordpilates/2026-04/308cf62c-a83e-4e1b-b45a-0295b8ea23db-simple-pipeline.mp4
```
