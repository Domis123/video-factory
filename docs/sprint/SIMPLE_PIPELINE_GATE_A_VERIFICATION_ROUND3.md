# Simple Pipeline Gate A — Round 3 (post-prompt-and-arch-iteration)

**Date:** 2026-04-29T12:16:06.701Z
**Branch:** `feat/simple-pipeline`
**Round 1 (render fix) commit:** `b858f08`
**Round 2 (prompt fix) commit:** `47c1a50`
**Round 3 (verbatim+mute+duration) commit:** `679d362`
**Round 3 hotfix-1 (require→exec) commit:** `afcb1d5`
**Round 3 hotfix-2 (apostrophe→U+2019) commit:** `acb5d92`
**Wall time:** 14.5 min

---

## Automated metrics

| Metric | Value |
|---|---|
| Routine reached human_qa | 6 / 6 |
| Meme reached human_qa | 6 / 6 (5 in original 12-render run + meme #4 backfilled after `acb5d92` apostrophe-escape hotfix) |
| Memes rendered with overlayMode=verbatim | 6 / 6 |
| Routine slot_count distribution | 3×6 |
| Distinct routine parents | 6 / 6 |
| Distinct meme parents | 5 / 6 |
| Distinct overlays | 11 / 12 |
| Total Gemini cost | $1.4893 (free via credits; meme verbatim path saves ~$0.24/render) |

## Routine renders (6) — overlayMode=generate (default for routine)

| # | Idea seed | Slot count | Overlay (generated) | Round 3 preview | c10 ref | R2 ref | Visual review |
|---|---|---|---|---|---|---|---|
| 1 | "5-minute morning glute flow" | 3 | "A gentle flow to awaken your glutes" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/8ed300dc-d19f-406d-9420-c6eecf021f43-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=5588193f47b488f937fde045e82ba58adaa7f2d31cc7357b428e4fef82e0bb58&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `4cdb0503` | (Round 2 doc) | [Domis review] |
| 2 | "core routine that actually works" | 3 | "Awaken your deep core connection" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/07003faa-8d1c-43ab-ab90-cb8519f0b4e4-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=48ff12003e87cf15f2213bbf78d2113260340751b226ff7f6824795619761552&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `6d0508b9` | (Round 2 doc) | [Domis review] |
| 3 | "wake your hips up before sitting all day" | 3 | "Awaken your hips for the day ahead" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/fcbff315-7610-4e80-b9a0-2072046416e8-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=012917e0f1cec61a59f568848ea89a0e81694ff7690cc2259acb645217df6950&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `0a616849` | (Round 2 doc) | [Domis review] |
| 4 | "mobility for stiff shoulders" | 3 | "Breathe space into your shoulders" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/a4d6502c-45ba-42b4-ba1b-ea7028995fdf-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=0a5cbb7b06b13273a12b93f934f25be22873fb58888d0b9c834242d2b796a46b&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `fea8b48b` | (Round 2 doc) | [Domis review] |
| 5 | "standing pilates moves you can do anywhere" | 3 | "A standing flow to ground your day" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/4a1f4601-a03d-40ab-9bdd-1a0451043d4f-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=e91574c003e4558eb71c948074ff4a5a28e962bb78b6b3ffc7656919fcf1bd36&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `7a13d0e3` | (Round 2 doc) | [Domis review] |
| 6 | "gentle stretches before bed" | 3 | "Release the day with gentle movement" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/9ba9009b-09cd-4a58-ae0d-0ef1a0c75159-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=ac3a41d0a750ed6d542acdaf1041745da0986886709257d04048559eb23e71b9&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `d5ddda47` | (Round 2 doc) | [Domis review] |

## Meme renders (6) — overlayMode=verbatim (forced for Round 3 A/B)

Verbatim mode skips the overlay-meme.ts Gemini call and uses the operator's idea_seed verbatim as the overlay text. Compare against Round 2 generated outputs (in the Round 2 Gate A doc).

| # | Style | Idea seed (= overlay text) | Round 3 preview | c10 ref | R2 ref | Visual review |
|---|---|---|---|---|---|---|
| 1 | literal | "stretching for 30 seconds counts right" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/d5eb158d-7277-4235-b881-bc0d53f61833-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=bf5a95d6f591c9e380c893f7edaec21f3a110a3dcdce2493fe746b6fe6230568&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `dceffe11` | (Round 2 doc) | [Domis review] |
| 2 | abstract | "main character energy" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/ab430440-ecc2-40cf-9a20-02f08b52e35f-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=20f1644b75206a4c5a94ce6684b6d022535781511e8a504a97e5f771815993ea&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `36435540` | (Round 2 doc) | [Domis review] |
| 3 | ironic | "POV you actually moved today" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/85aad95f-48a3-44e8-b83e-cda97b575244-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=16f29852612f856fa5b73b94fa9eac2d29645ab99d4985dab2789012a6eb4a08&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `697af9fb` | (Round 2 doc) | [Domis review] |
| 4 | oblique | "lying down isn’t the only kind of rest" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/0013dc21-70cc-48ea-9ee4-8c4eedb46f85-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T122800Z&X-Amz-Expires=86400&X-Amz-Signature=b3fdb7c3750161455758a284241915c2803eed0b3400c130f18037b679e21cc9&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `8d45c49b` | (Round 2 doc) | backfilled after `acb5d92` apostrophe-escape hotfix; jobId `0013dc21`. Apostrophe converted to U+2019 in render |
| 5 | vibey | "soft girl pilates era" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/52dadd7b-600b-4ca1-8c80-c7b3325dd077-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=cdaf3fb21b43011f0ca88a5015b01924ce48ade3620c404e440d20c3686b6013&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `3f0fec82` | (Round 2 doc) | [Domis review] |
| 6 | simple | "no thoughts just stretching" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/c254f780-2a57-4b0b-9c5c-3d0f6f5e6f5d-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T121606Z&X-Amz-Expires=86400&X-Amz-Signature=16f1f3047c4b489ac8ffaf3aed7293cec9233e0ca8ca7ef4238504c31147b595&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | `d6894c12` | (Round 2 doc) | [Domis review] |

---

## Q7 hard threshold (operator visual review)

Per render: gestalt yes/no, **"would I upload this to TikTok today?"** ~30s/render. **Bar excludes Polish Sprint cosmetics** (overlay size/position, logo size/age, transitions). Fail only for: bad clip selection, bad overlay text, creatively unusable.

**Halt:** ≥4 of 6 routine fail OR ≥4 of 6 meme fail → halt for diagnosis (NOT auto-iterate per Round 3 kickoff).

**Else:** ship + file simple-pipeline-routine-prompt-iteration and simple-pipeline-meme-prompt-iteration followups + merge feat/simple-pipeline → main + deploy.

| Product | Pass count | Verdict |
|---|---|---|
| Routine | _ / 6 | [Domis] |
| Meme | _ / 6 | [Domis] |

## Cleanup commands (after Round 3 review closes)

```sql
DELETE FROM simple_pipeline_render_history WHERE job_id IN (
  '8ed300dc-d19f-406d-9420-c6eecf021f43',
  '07003faa-8d1c-43ab-ab90-cb8519f0b4e4',
  'fcbff315-7610-4e80-b9a0-2072046416e8',
  'a4d6502c-45ba-42b4-ba1b-ea7028995fdf',
  '4a1f4601-a03d-40ab-9bdd-1a0451043d4f',
  '9ba9009b-09cd-4a58-ae0d-0ef1a0c75159',
  'd5eb158d-7277-4235-b881-bc0d53f61833',
  'ab430440-ecc2-40cf-9a20-02f08b52e35f',
  '85aad95f-48a3-44e8-b83e-cda97b575244',
  '3217ecc3-c201-4d62-bc1d-c24824d434cb',
  '52dadd7b-600b-4ca1-8c80-c7b3325dd077',
  'c254f780-2a57-4b0b-9c5c-3d0f6f5e6f5d'
);
DELETE FROM job_events WHERE job_id IN (
  '8ed300dc-d19f-406d-9420-c6eecf021f43',
  '07003faa-8d1c-43ab-ab90-cb8519f0b4e4',
  'fcbff315-7610-4e80-b9a0-2072046416e8',
  'a4d6502c-45ba-42b4-ba1b-ea7028995fdf',
  '4a1f4601-a03d-40ab-9bdd-1a0451043d4f',
  '9ba9009b-09cd-4a58-ae0d-0ef1a0c75159',
  'd5eb158d-7277-4235-b881-bc0d53f61833',
  'ab430440-ecc2-40cf-9a20-02f08b52e35f',
  '85aad95f-48a3-44e8-b83e-cda97b575244',
  '3217ecc3-c201-4d62-bc1d-c24824d434cb',
  '52dadd7b-600b-4ca1-8c80-c7b3325dd077',
  'c254f780-2a57-4b0b-9c5c-3d0f6f5e6f5d'
);
DELETE FROM jobs WHERE id IN (
  '8ed300dc-d19f-406d-9420-c6eecf021f43',
  '07003faa-8d1c-43ab-ab90-cb8519f0b4e4',
  'fcbff315-7610-4e80-b9a0-2072046416e8',
  'a4d6502c-45ba-42b4-ba1b-ea7028995fdf',
  '4a1f4601-a03d-40ab-9bdd-1a0451043d4f',
  '9ba9009b-09cd-4a58-ae0d-0ef1a0c75159',
  'd5eb158d-7277-4235-b881-bc0d53f61833',
  'ab430440-ecc2-40cf-9a20-02f08b52e35f',
  '85aad95f-48a3-44e8-b83e-cda97b575244',
  '3217ecc3-c201-4d62-bc1d-c24824d434cb',
  '52dadd7b-600b-4ca1-8c80-c7b3325dd077',
  'c254f780-2a57-4b0b-9c5c-3d0f6f5e6f5d'
);
```

```bash
# R2 keys (manual via lib helper or aws s3 rm)
# rendered/nordpilates/2026-04/8ed300dc-d19f-406d-9420-c6eecf021f43-simple-pipeline.mp4
# rendered/nordpilates/2026-04/07003faa-8d1c-43ab-ab90-cb8519f0b4e4-simple-pipeline.mp4
# rendered/nordpilates/2026-04/fcbff315-7610-4e80-b9a0-2072046416e8-simple-pipeline.mp4
# rendered/nordpilates/2026-04/a4d6502c-45ba-42b4-ba1b-ea7028995fdf-simple-pipeline.mp4
# rendered/nordpilates/2026-04/4a1f4601-a03d-40ab-9bdd-1a0451043d4f-simple-pipeline.mp4
# rendered/nordpilates/2026-04/9ba9009b-09cd-4a58-ae0d-0ef1a0c75159-simple-pipeline.mp4
# rendered/nordpilates/2026-04/d5eb158d-7277-4235-b881-bc0d53f61833-simple-pipeline.mp4
# rendered/nordpilates/2026-04/ab430440-ecc2-40cf-9a20-02f08b52e35f-simple-pipeline.mp4
# rendered/nordpilates/2026-04/85aad95f-48a3-44e8-b83e-cda97b575244-simple-pipeline.mp4
# rendered/nordpilates/2026-04/52dadd7b-600b-4ca1-8c80-c7b3325dd077-simple-pipeline.mp4
# rendered/nordpilates/2026-04/c254f780-2a57-4b0b-9c5c-3d0f6f5e6f5d-simple-pipeline.mp4
```
