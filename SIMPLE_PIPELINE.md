# Simple Pipeline — Production Reference

**Status:** v1.0 + v1.1 merged to main and deployed (2026-04-29).
**Production verification:** pending — first end-to-end production render not yet exercised. Editor agent (next workstream) ships before Simple Pipeline is verified through real operator usage.
**Predecessor:** Phase 3.5 + Part B (advanced pipeline) — still in production for advanced-quality renders. Simple Pipeline runs in parallel; not a replacement.
**Successor (next workstream):** Editor agent — smart-trim at segment boundaries.

---

## What Simple Pipeline is

A second video production pipeline that runs alongside Phase 3.5 / Part B. Same VPS, same Supabase, same R2 storage, but a different code path with much simpler architecture: one Gemini Pro library-aware agent picks segments + an overlay text generator + ffmpeg render. No Critic. No Director. No Planner.

Built to ship operator-uploadable nordpilates (and other-brand) videos within days, not weeks. Polish Sprint timeline (4-8 weeks for advanced pipeline) didn't fit business pressure for content this week.

**Two products from one infrastructure:**

| Product | Sheet `Format` value | Slot count | Picker output | Overlay style |
|---|---|---|---|---|
| Routine videos | `routine` | 2-5 (agent picks; Sheet `Clips=auto`) | N ranked segment_ids from one parent (parent-first, cooldown of 2) | Routine prompt — instructive, brand-anchored, label-style |
| Meme videos | `meme` | 1 (forced; Sheet `Clips=1`) | 1 segment_id from any parent (segment-first, cooldown of 2) | Verbatim mode default — operator's idea seed used as overlay text |

Both products share: same BullMQ queue (`simple_pipeline`), same worker, same orchestrator (with format branch), same Match-Or-Match Gemini Pro agent (different output shapes), same render path (ffmpeg), same music selector, same brand_config logic.

---

## Architecture flow

```
Operator fills Brand + Idea Seed + Pipeline=simple + Format + Clips + Overlay Mode in Jobs Sheet
  ↓
n8n S1 polls Jobs sheet (every 30s)
  ↓
S1 reads Pipeline, Format, Clips, Overlay Mode columns
  ↓
S1 calls VPS POST /simple-pipeline/check-readiness?brand_id=X
  - SELECT COUNT(DISTINCT parent_asset_id) WHERE brand_id=X AND ≥10 segment_v2-analyzed segments per parent
  - Confirms brand_configs.aesthetic_description populated
  - Confirms ≥5 active music_tracks across ≥2 distinct moods
  - Returns {ok: true} or {ok: false, reason: "<token>"}
  ↓
If readiness fails: S1 sets jobs.status='simple_pipeline_blocked' with reason in Sheet
  ↓
If readiness passes: S1 inserts jobs row, status='simple_pipeline_pending'
  S1 calls VPS POST /enqueue {queue: 'simple_pipeline', jobId, format, slot_count, overlay_mode}
  ↓
Simple Pipeline Worker picks up job from BullMQ (concurrency=1, limiter 500 cmd/sec)
  ↓
Orchestrator entry: simple-pipeline-orchestrator.ts
  ↓
1. Fetch job + brand_config from Supabase
  ↓
2. Branch on format:
   - format='routine' → Routine flow
   - format='meme' → Meme flow
  ↓
3. Match-Or-Match Agent (single Gemini Pro call, both flows, different output shape)
   - Inputs: brand_id, idea_seed, format, slot_count, aesthetic_description, eligible segments, exclusion lists
   - Filters: only segments where segment_v2 IS NOT NULL; only parents with ≥10 v2-analyzed segments
   - Routine: agent picks parent first (excluding last 2 used per brand), then picks N segments
     within that parent — agent chooses N between 2 and 5 based on what fits the parent + idea seed
   - Meme: agent picks 1 segment from any parent (excluding last 2 segments used per brand)
   - Returns: { segment_ids, parent_asset_id, slot_count, reasoning }
   - Cost: ~$0.015
   - Wall: 8-12s
  ↓
4. Cooldown enforcement (post-agent):
   - Routine: log parent + each segment to simple_pipeline_render_history
   - Meme: log segment to simple_pipeline_render_history
  ↓
5. Overlay text:
   - If overlay_mode='verbatim' (default for meme):
     - Use operator's idea_seed as overlay text directly
     - Skip Gemini call entirely; cost $0; wall 0s
   - If overlay_mode='generate' (default for routine):
     - Branch on format → overlay-routine.ts or overlay-meme.ts (Gemini Pro call)
     - Reads brand voice_guidelines (NOT aesthetic_description — that's for Match-Or-Match)
     - Output: 4-15 word overlay text string
     - Cost: ~$0.005; wall: 5s
     - Failure: retry once; second failure → fallback to idea_seed verbatim
  ↓
6. Music Selector
   - Reuses existing music selection logic from advanced pipeline
   - Filter music_tracks by brand-allowed moods
   - Weighted random pick
  ↓
7. Render (ffmpeg) — see "Render path" below
  ↓
8. Upload to R2 → status = human_qa
  ↓
9. n8n P1 sync: status update visible in Sheet, preview URL populated
  ↓
10. Operator views, approves/rejects in Sheet
  ↓
11. n8n S3 (existing QA decision workflow) handles approve → delivered;
    reject → operator-side cleanup or re-render
```

---

## Render path

Per v1.0 Round 1 fix + v1.1 polish, the ffmpeg pipeline is:

**Pass A — Per-segment trim from pre-normalized parent:**
- Read `assets.pre_normalized_r2_key` (1080×1920 30fps libx264, the full-quality normalized parent)
- Cache parent download across multiple segments from the same parent (routine path hits this; meme always single-parent)
- ffmpeg-trim each segment by `start_s`/`end_s` with `-c copy` (stream-copy, no re-encode)
- Fallback to `clip_r2_key` only if `pre_normalized_r2_key` is null (defensive — none currently exist post-W5 clean-slate)
- **Critical:** Do NOT read `clip_r2_key` (720p CRF 28 segment files) for render. That was the v1.0 graininess bug — upscaling CRF 28 to 1080p produced visibly grainy output. Always source from pre-normalized parent.

**Pass B — Concat:**
- ffmpeg concat demuxer joins trimmed segments
- No re-encode at this stage

**Pass C — Overlay text + logo + color grade:**
- drawtext for overlay text (per-line invocations for multi-line; see overlay sizing below)
- overlay filter for brand logo (loaded from `brand_configs.logo_r2_key`)
- color grade LUT applied
- Single re-encode at libx264 CRF 18 slow (matches Phase 3.5's normalize quality)
- This is the only re-encode of pixel data in the entire pipeline

**Pass D — Audio mix:**
- ffprobe + silencedetect on the concatenated UGC overlay
- If silence_ratio < 0.15 (mostly silent) OR no audio stream at all: music-only mix, no UGC audio
- Else: sidechain-ducked mix (UGC audio at full level, music at -16dB ducked under speech)

**Output:** 1080×1920 / 30fps / CRF 18 MP4. Wall ~30-60s per render. Net re-encode count of any frame: 2 (one at parent-normalize ingest time, one at Pass C). No upscale ever.

---

## Overlay sizing rules (v1.1)

- **Base font size:** 0.7× of v1.0's original size (45px on 1920 composition).
- **Line wrap algorithm:** try 1 line at base size; if longest line exceeds 80% composition width (864px on 1080), try 2 lines; if 2 doesn't fit, try 3 lines; up to 5 lines max at base font.
- **Scale-down fallback:** only if 5 lines at base doesn't fit, scale font down 5% increments to a 30px floor; emit a `console.warn` (operator-visible signal that the seed is unreasonably long).
- **Line splitting:** at nearest whitespace to length/N targets per line.
- **Line spacing:** 1.2× font size.
- **Vertical position:** ~27% from top edge (centered horizontally), text vertical center anchored.
- **Box padding (translucent background per line):**
  - Single-line: 16px (preserves v1.0 generous look)
  - Multi-line: `floor((lineHeight - font_size) / 2) - 1` (3px at 45px, 2px at 29px) — prevents inter-line darkening that compounds when adjacent line boxes overlap.
- **Drop shadow / outline / stroke:** preserved from v1.0; per-line drawtext invocations isolate shadow per line.

## Logo sizing rules (v1.1)

- **Height:** 0.0375× composition height (~72px on 1920px composition). Halved twice from v1.0 c6's original 0.15×.
- **Vertical position:** ~78% from top (= ~22% from bottom). NOT tight to bottom edge — TikTok's UI overlays would clip it.
- **Horizontal position:** centered.
- **Opacity:** 0.75.
- **Source:** `brand_configs.logo_r2_key` (operator manually places the file in R2 at `brands/<brand_id>/logo.png`).

---

## Operator workflow

### Per-job (production usage)

1. Open Jobs sheet.
2. Fill row: Brand, Idea Seed, Pipeline=simple, Format=meme/routine, Clips=1 or auto, Overlay Mode=generate/verbatim (or leave empty for default-by-format: routine→generate, meme→verbatim).
3. Wait ~5-10 min for render.
4. Watch preview URL in Sheet.
5. Approve → delivered → manually upload to TikTok / Reels / YouTube Shorts.

**Operator over-generation pattern (until Editor agent ships):** v1.1 ships hard cuts at imperfect segment boundaries. Some renders will have preparation footage at cut points or other minor edit issues. Operator workflow until Editor agent ships: drop ~6 idea seeds per actual target video, review all 6, pick the 3 best, discard the rest. Editor agent solves this by smart-trimming at segment boundaries; until then, operator over-generates.

**Verbatim mode for memes:** the meme idea seed you type IS the overlay text on the video. If the seed isn't punchy/funny/hook-shaped, the overlay won't be either. The agent isn't paraphrasing it. Write idea seeds that read as actual TikTok captions, not topics or descriptions.

### Per-brand activation

For each new brand to activate Simple Pipeline:

1. **Ingestion**: drop UGC content via S8 with correct filename prefix (e.g., `CL_morning_001.mp4` for cyclediet). Wait for ingestion to populate ≥3 parents with ≥10 segment_v2-analyzed segments. Operator-paced.
2. **Brand config**: ensure brand_configs row exists for the brand.
3. **Aesthetic description**: write `brand_configs.aesthetic_description` text. Standard procedure:
   - Agent drafts a starter from existing `voice_guidelines` + `content_pillars` + brand Sheet content (per Q2 of v1.0 kickoff)
   - Operator revises before first production render
   - Visual aesthetic-shaped, not voice-shaped (different field, different purpose)
4. **Logo**: place brand logo at R2 path `brands/<brand_id>/logo.png` (transparent PNG, any sensible aspect ratio — render path scales to 0.0375× composition height).
5. **Music**: ensure ≥5 active rows in `music_tracks` across ≥2 distinct moods compatible with the brand's `allowed_music_intents` (or moods if column is `mood`).
6. **First test render**: drop an idea seed in the Jobs sheet with that brand; visual verify in QA flow.

If readiness fails at S1: jobs.status will read `simple_pipeline_blocked` with a token like `missing_aesthetic_description` or `insufficient_parents_<N>_of_3_needed` or `insufficient_music_tracks_<N>_of_5_needed`. Address the specific reason, then re-drop the idea seed.

---

## Schema additions (v1.0)

**`simple_pipeline_render_history`** (migration 013):
- Tracks parent + segment usage per brand for cooldown enforcement.
- Indexed by (brand_id, created_at), (brand_id, parent_asset_id, created_at), (brand_id, segment_id, created_at).
- Grows indefinitely; cleanup policy is a future followup.

**`brand_configs.aesthetic_description`** (migration 014):
- TEXT NULL column added.
- Per-brand visual aesthetic prompt for Match-Or-Match.
- nordpilates seeded with starter text in same migration; other brands NULL until activated.

**`jobs.status` enum extension** (migration 015):
- Added: `simple_pipeline_pending`, `simple_pipeline_rendering`, `simple_pipeline_failed`, `simple_pipeline_blocked`.
- Postgres `ALTER TYPE ADD VALUE` (not just TS-side enum addition — DB needs the values too).

---

## Cost & latency

| Stage | Cost | Wall time |
|---|---|---|
| Match-Or-Match agent (Gemini Pro) | ~$0.015 | 8-12s |
| Overlay generator (Gemini Pro, generate mode) | ~$0.005 | 5s |
| Overlay generator (verbatim mode) | $0 | <1s |
| Music selection | $0 | <1s |
| Render (ffmpeg) | $0 | 30-60s |
| **Total per video** | **~$0.015-0.025** | ~50-90s |

Far below the $1/video cost ceiling. Operator-confirmed cost-irrelevant for v1.

Verbatim mode (now meme default) saves ~$0.005 + 5s per meme render.

---

## Endpoints

**`POST /simple-pipeline/check-readiness?brand_id=X`**

Always returns HTTP 200. Body:
- `{ok: true}` — brand passes readiness gate, Simple Pipeline routes for it
- `{ok: false, reason: "missing_aesthetic_description"}` — brand_configs.aesthetic_description is NULL
- `{ok: false, reason: "insufficient_parents_<N>_of_3_needed"}` — fewer than 3 parents with ≥10 v2-analyzed segments
- `{ok: false, reason: "insufficient_music_tracks_<N>_of_5_needed"}` — fewer than 5 active rows in music_tracks (or fewer than 2 distinct moods)

n8n S1 calls this before enqueueing any Pipeline=simple job.

**`POST /enqueue` (extended)**

Now accepts payload `{queue, jobId, format, slot_count, overlay_mode}` for simple_pipeline routing. Existing planning queue routing unchanged.

---

## Hard constraints (do NOT violate)

- **Polish Sprint Pillar 1 branch (`feat/polish-sprint-pillar-1-critic-calibration` at `cebfc46`)** — parked, intentionally unmerged. Do NOT touch, rebase, merge, or modify. Resumption picks up at c5 when Editor agent ships and content cadence stabilizes.
- **n8n write access is operator-only.** All n8n changes ship as JSON in repo; operator imports via web UI.
- **Per-brand readiness gating:** Simple Pipeline refuses jobs for brands not meeting the ≥3-parents-with-≥10-v2-segments + aesthetic_description + music readiness floor. S1 blocks at routing.
- **No advanced-pipeline contamination:** Simple Pipeline never reads from / writes to `shadow_runs`, `context_packet`, or any Part B / Phase 3.5 state.
- **Pre-existing pipelines untouched:** Phase 3.5 routing preserved. Part B routing preserved.
- **v2-only segment policy:** Match-Or-Match considers ONLY segments where `segment_v2 IS NOT NULL`. v1-only segments are not pickable.
- **Render quality bar:** 1080×1920 / 30fps / CRF 18 minimum. Source from `pre_normalized_r2_key`, never from `clip_r2_key`.

---

## Known limitations (v1.1)

These are not bugs; they're scoped-out items that the next workstream(s) address:

1. **Imperfect cut boundaries.** Hard cuts at segment boundaries can land mid-rep, mid-prep, or at awkward moments. Editor agent (next workstream) addresses this with smart-trim. Operator over-generates and discards bad-boundary renders until Editor ships.
2. **Logo can occasionally overlap subject.** v1.1 halved logo size to mitigate; full subject-aware placement requires CV detection — `simple-pipeline-logo-subject-collision-detection` followup, low priority.
3. **Non-portrait source clips show black bars.** Source clips not at 1080×1920 letterbox at render. `simple-pipeline-non-portrait-source-letterbox` followup.
4. **Same-parent visual redundancy on routine.** Match-Or-Match can pick 3 segments from one continuous shoot that look near-identical. Round 2 prompt iteration mitigated; full fix would require CLIP-distance scoring between segments. Followup territory.
5. **Meme creativity is operator-driven (verbatim default).** Generate mode for memes was producing instructor-voice output; verbatim is now default for meme. If operator wants to re-explore generate mode, `simple-pipeline-meme-generate-mode-prompt-iteration` followup is the landing pad.
6. **Render history table grows indefinitely.** `simple-pipeline-deletion-policy` followup (low priority).

---

## Files (in `src/orchestrator/simple-pipeline/`)

- `simple-pipeline-orchestrator.ts` — entry; format branch; calls agent + overlay + music + render
- `match-or-match-agent.ts` (in `src/agents/`) — single Gemini Pro library-aware picker
- `prompts/match-or-match-routine.md`, `prompts/match-or-match-meme.md` — agent prompts (Round 2 iterated)
- `prompts/overlay-routine.md`, `prompts/overlay-meme.md` — overlay text generator prompts
- `overlay-routine.ts`, `overlay-meme.ts` — overlay generator modules (called when overlay_mode=generate)
- `parent-picker.ts` — parent eligibility + cooldown filtering
- `segment-cooldown-tracker.ts` — render history reads/writes
- `music-selector.ts` — wraps existing music selection
- `render.ts` — ffmpeg pipeline (Pass A through D)
- `readiness.ts` — readiness endpoint logic

Worker registration: `src/index.ts` registers `simplePipelineWorker` with `concurrency: 1` + `limiter: { max: 500, duration: 1000 }`.

n8n workflow: `n8n-workflows/S1-new-job.json` — Pipeline-aware routing, calls /simple-pipeline/check-readiness before enqueueing.

---

## Why ffmpeg, not Remotion

Advanced pipeline's render bridge (W9.2) is tangled — Remotion composition is hardwired to Phase 3.5 CopyPackage shape, `prepareContextForRender` is a null-safety stub, multiple required fields missing from `context_packet_v2`. Simple Pipeline avoids that entirely by using ffmpeg directly. Cleaner separation, no shared rendering machinery to touch.

If at some future point the advanced pipeline's render bridge is rebuilt cleanly, Simple Pipeline could potentially share it — but that's a future-conditional decision, not a current intent.

---

## Production verification status

**As of 2026-04-29:**

- v1.0 merged to main, deployed to VPS (commit `cc973d0`)
- v1.1 merged to main, deployed to VPS (HEAD of main)
- Service active, running new code path
- All Gate A verifications passed (12-render Q7 review at v1.0 Round 3; 6+4+3 cosmetic verification at v1.1)
- **End-to-end production render through Sheet → S1 → worker → human_qa → operator approval → manual upload: not yet exercised**

First real production render is expected after Editor agent ships (operator wants smart-trim before shipping to TikTok at volume). Until then, Simple Pipeline is deployed but not in active production use.

If something goes wrong in first production exercise, surface to planning chat — bugs caught at Gate A may not exhaustively cover real Sheet-driven flow.

---

*Living reference. Update on each material Simple Pipeline workstream (Editor agent next, then any subsequent v1.x or v2 versions).*
