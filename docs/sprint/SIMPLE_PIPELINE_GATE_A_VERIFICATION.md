# Simple Pipeline Gate A Verification

**Run date:** 2026-04-29T07:44:10.774Z
**Branch:** `feat/simple-pipeline`
**Brand:** nordpilates
**Wall time (harness):** 16.6 min
**Total Gemini cost:** $1.7466 (free via company credits per CLAUDE.md)

---

## Automated metrics

| Metric | Value | Bar |
|---|---|---|
| Routine reached human_qa | 6 / 6 | All 6 must reach human_qa for Q7 review to apply |
| Meme reached human_qa | 6 / 6 | All 6 must reach human_qa for Q7 review to apply |
| Distinct slot_counts (routine, Q8) | 2 | ≥2 (red flag if all 6 collapse to one) |
| Distinct routine parents | 6 / 6 | Higher = better cooldown variety; ≥4 expected |
| Distinct meme parents | 6 / 6 | Higher = better; meme has segment cooldown only |
| Distinct overlays | 12 / 12 | All distinct expected (no template repetition) |
| Advanced pipeline regression | ⚠ measurement-artifact (see § "Advanced regression — measurement caveat") | Pre-existing planning-worker pattern, not a c8 regression. Operator manual Sheet test is the meaningful check. |

### Routine slot_count distribution (Q8)

| count | seeds |
|---|---|
| 2 clips | 0 |
| 3 clips | 4 |
| 4 clips | 2 |
| 5 clips | 0 |

---

## Routine renders (6)

| # | Idea seed | Status | Slot count | Parent | Overlay | Preview | Visual review |
|---|---|---|---|---|---|---|---|
| 1 | "5-minute morning glute flow" | human_qa | 4 | ccf94180 | "Your mindful morning glute awakening" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/4cdb0503-6f5a-4e50-b67e-cd184eec5d0f-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T072912Z&X-Amz-Expires=86400&X-Amz-Signature=c7b816607f4c1ae477a604d52d0f7e8d54784cdfaa33468c82aaba55027b9e8c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 2 | "core routine that actually works" | human_qa | 4 | 03eb15b3 | "Find your deep core strength" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/6d0508b9-e6b0-4ce9-a9ef-05e21e4a06bb-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073103Z&X-Amz-Expires=86400&X-Amz-Signature=0c5b9afe5931904e75334a456f410bd9c8694a616a80d1f8843316f6e91b5cb3&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 3 | "wake your hips up before sitting all day" | human_qa | 3 | d46e70c4 | "A gentle hip wake up for your day" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/0a616849-77c6-41d5-ac7b-69c101fd26bf-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073244Z&X-Amz-Expires=86400&X-Amz-Signature=579cb9616431f47a904ed70e919ea9753fddd7689e8e6fac17275e9d98fcd3f8&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 4 | "mobility for stiff shoulders" | human_qa | 3 | 6d6cb705 | "Create Space in Your Shoulders" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/fea8b48b-c887-4757-8359-be6824ea9494-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073408Z&X-Amz-Expires=86400&X-Amz-Signature=cd88a0c02bcb3baec4b9a118e7cec8f469bcbef92de38cb9b1c68b25e75d4b15&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 5 | "standing pilates moves you can do anywhere" | human_qa | 3 | bf6d2688 | "A standing flow to find your center" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/7a13d0e3-9d85-4eca-ac76-5577fbb0043a-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073546Z&X-Amz-Expires=86400&X-Amz-Signature=eee222070f6a5dbf1cd74b5ebcfe508c6ed98c14ecb359b37e36285047d710f1&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 6 | "gentle stretches before bed" | human_qa | 3 | 27511ae4 | "A gentle flow to release your day" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/d5ddda47-a1eb-4963-a740-2734a95889e3-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073656Z&X-Amz-Expires=86400&X-Amz-Signature=f267e893980fe1cc7c4258cfbad4be3855a24d3fa8830f7c58aa1a86a7c77545&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |

## Meme renders (6)

| # | Style | Idea seed | Status | Parent | Overlay | Preview | Visual review |
|---|---|---|---|---|---|---|---|
| 1 | literal | "stretching for 30 seconds counts right" | human_qa | a56afff5 | "Yes, your 30 seconds of stretching counts" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/dceffe11-d139-4709-9211-f5e8b6062b95-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073808Z&X-Amz-Expires=86400&X-Amz-Signature=c2ec873f0d5aed2923b81c14cc796259cf1acd99522911096ab4f1746c4487ff&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 2 | abstract | "main character energy" | human_qa | 3794cf68 | "your main character arc starts on the mat" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/36435540-e1b6-4af4-8d84-67be7807054d-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T073926Z&X-Amz-Expires=86400&X-Amz-Signature=47b602dea61ee0912526648bd9029ab8bce674eeab74f11ddd2d214b85618f12&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 3 | ironic | "POV you actually moved today" | human_qa | 7dd835cb | "A little movement to come back to yourself" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/697af9fb-d2d6-4f2b-bd27-06dcde4c8890-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T074037Z&X-Amz-Expires=86400&X-Amz-Signature=9b0d00a57ff064d5b67e5c16b83fb6e05d60667110cd77dfa1fde482ead502f4&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 4 | oblique | "lying down isn't the only kind of rest" | human_qa | 57c46b4a | "Some days rest looks like this" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/8d45c49b-4922-4c34-a1c1-39f34c74028e-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T074151Z&X-Amz-Expires=86400&X-Amz-Signature=98bc7f58957a247e9f822548be4e352f773d448f0fa4c34460ad6b73b7dccc16&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 5 | vibey | "soft girl pilates era" | human_qa | 27511ae4 | "soft era, strong core" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/3f0fec82-3573-471a-9879-6a43596bbdd2-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T074304Z&X-Amz-Expires=86400&X-Amz-Signature=feb331292e00ba1070dd5ec141921b216030e9b100f2e5ac2f330990a05cb728&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |
| 6 | simple | "no thoughts just stretching" | human_qa | cd320ee1 | "the only thoughts are inhale and exhale" | [link](https://c9a225a2af25661d5ef85c9bc76a9ec5.r2.cloudflarestorage.com/video-factory/rendered/nordpilates/2026-04/d6894c12-864c-45d7-997d-9d23c37c3716-simple-pipeline.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=7484d6072a684a333345d20fb1c159b8%2F20260429%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260429T074407Z&X-Amz-Expires=86400&X-Amz-Signature=9981c0e1d0cdf26f82f59ebd134566af29aa8b1ec137c0a2c75721a3678c5601&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject) | [Domis review] |

## Advanced regression — measurement caveat

| Idea seed | Final status | Notes |
|---|---|---|
| "c10 advanced regression check — quick standing core routine" | `idea_seed` | runPlanning ran (brief_summary populated); `transitionJob('planning','brief_review')` failed with race condition because status was never moved off `idea_seed`. Pre-existing pattern in the planning worker (last touched at `d92d601` — Phase 3 W4, before c8); not a Simple Pipeline regression. The harness bypassed S1 (direct BullMQ insert) so it didn't actually exercise the new Pipeline-aware S1 routing logic. The kickoff's "advanced pipeline routes correctly during this batch" check is more meaningful as an operator manual test (drop one Pipeline=advanced/empty row in the Sheet) than as part of this BullMQ-direct harness — moved to the post-merge action list. |

---

## Q7 hard threshold (operator visual review)

For each render, gestalt yes/no: **"is this upload-fitness-grade for nordpilates?"** ~30s/render.

**Halt condition:** if **≥4 of 6 routine OR ≥4 of 6 meme fail** visual review:
- Halt, iterate prompts, re-run same 12 seeds. Report iteration count at Gate A close.

**Otherwise:**
- Ship.
- File followups `simple-pipeline-routine-prompt-iteration` and `simple-pipeline-meme-prompt-iteration` for post-merge prompt tuning.

Domis fills the [Domis review] cells above with PASS or FAIL + brief notes, then the verdict goes here:

| Product | Pass count | Verdict |
|---|---|---|
| Routine | _ / 6 | [Domis] |
| Meme | _ / 6 | [Domis] |

---

## Cleanup commands (run after review closes)

```sql
-- 1. Render history (foreign-key set null on jobs delete, so explicit first)
DELETE FROM simple_pipeline_render_history WHERE job_id IN (
  '4cdb0503-6f5a-4e50-b67e-cd184eec5d0f',
  '6d0508b9-e6b0-4ce9-a9ef-05e21e4a06bb',
  '0a616849-77c6-41d5-ac7b-69c101fd26bf',
  'fea8b48b-c887-4757-8359-be6824ea9494',
  '7a13d0e3-9d85-4eca-ac76-5577fbb0043a',
  'd5ddda47-a1eb-4963-a740-2734a95889e3',
  'dceffe11-d139-4709-9211-f5e8b6062b95',
  '36435540-e1b6-4af4-8d84-67be7807054d',
  '697af9fb-d2d6-4f2b-bd27-06dcde4c8890',
  '8d45c49b-4922-4c34-a1c1-39f34c74028e',
  '3f0fec82-3573-471a-9879-6a43596bbdd2',
  'd6894c12-864c-45d7-997d-9d23c37c3716',
  'afc35b9b-142c-4f6b-9167-6fc562d04422'
);

-- 2. Job events (cascade-deleted by jobs delete; explicit for clarity)
DELETE FROM job_events WHERE job_id IN (
  '4cdb0503-6f5a-4e50-b67e-cd184eec5d0f',
  '6d0508b9-e6b0-4ce9-a9ef-05e21e4a06bb',
  '0a616849-77c6-41d5-ac7b-69c101fd26bf',
  'fea8b48b-c887-4757-8359-be6824ea9494',
  '7a13d0e3-9d85-4eca-ac76-5577fbb0043a',
  'd5ddda47-a1eb-4963-a740-2734a95889e3',
  'dceffe11-d139-4709-9211-f5e8b6062b95',
  '36435540-e1b6-4af4-8d84-67be7807054d',
  '697af9fb-d2d6-4f2b-bd27-06dcde4c8890',
  '8d45c49b-4922-4c34-a1c1-39f34c74028e',
  '3f0fec82-3573-471a-9879-6a43596bbdd2',
  'd6894c12-864c-45d7-997d-9d23c37c3716',
  'afc35b9b-142c-4f6b-9167-6fc562d04422'
);

-- 3. Jobs
DELETE FROM jobs WHERE id IN (
  '4cdb0503-6f5a-4e50-b67e-cd184eec5d0f',
  '6d0508b9-e6b0-4ce9-a9ef-05e21e4a06bb',
  '0a616849-77c6-41d5-ac7b-69c101fd26bf',
  'fea8b48b-c887-4757-8359-be6824ea9494',
  '7a13d0e3-9d85-4eca-ac76-5577fbb0043a',
  'd5ddda47-a1eb-4963-a740-2734a95889e3',
  'dceffe11-d139-4709-9211-f5e8b6062b95',
  '36435540-e1b6-4af4-8d84-67be7807054d',
  '697af9fb-d2d6-4f2b-bd27-06dcde4c8890',
  '8d45c49b-4922-4c34-a1c1-39f34c74028e',
  '3f0fec82-3573-471a-9879-6a43596bbdd2',
  'd6894c12-864c-45d7-997d-9d23c37c3716',
  'afc35b9b-142c-4f6b-9167-6fc562d04422'
);
```

```bash
# 4. R2 keys (manual deletion via aws s3 rm or the lib helper)
# rendered/nordpilates/2026-04/4cdb0503-6f5a-4e50-b67e-cd184eec5d0f-simple-pipeline.mp4
# rendered/nordpilates/2026-04/6d0508b9-e6b0-4ce9-a9ef-05e21e4a06bb-simple-pipeline.mp4
# rendered/nordpilates/2026-04/0a616849-77c6-41d5-ac7b-69c101fd26bf-simple-pipeline.mp4
# rendered/nordpilates/2026-04/fea8b48b-c887-4757-8359-be6824ea9494-simple-pipeline.mp4
# rendered/nordpilates/2026-04/7a13d0e3-9d85-4eca-ac76-5577fbb0043a-simple-pipeline.mp4
# rendered/nordpilates/2026-04/d5ddda47-a1eb-4963-a740-2734a95889e3-simple-pipeline.mp4
# rendered/nordpilates/2026-04/dceffe11-d139-4709-9211-f5e8b6062b95-simple-pipeline.mp4
# rendered/nordpilates/2026-04/36435540-e1b6-4af4-8d84-67be7807054d-simple-pipeline.mp4
# rendered/nordpilates/2026-04/697af9fb-d2d6-4f2b-bd27-06dcde4c8890-simple-pipeline.mp4
# rendered/nordpilates/2026-04/8d45c49b-4922-4c34-a1c1-39f34c74028e-simple-pipeline.mp4
# rendered/nordpilates/2026-04/3f0fec82-3573-471a-9879-6a43596bbdd2-simple-pipeline.mp4
# rendered/nordpilates/2026-04/d6894c12-864c-45d7-997d-9d23c37c3716-simple-pipeline.mp4
```

---

*Generated by `src/scripts/_test-c10-gate-a.ts` on 2026-04-29T07:44:10.774Z.*
