# Simple Pipeline

**Status:** v1 shipped 2026-04-29 (commits c1–c10 on `feat/simple-pipeline`).
**Brief:** [`docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md`](briefs/SIMPLE_PIPELINE_BRIEF_v2.md) (load-bearing technical spec) + Domis kickoff Q1–Q10.
**Sibling pipeline:** [Phase 4 Part B](PHASE_4_PART_B_PIPELINE.md). Both run in production; routing is per-job via the Sheet "Pipeline" column.

The Simple Pipeline is the second production path. Where Part B uses Planner → Director → Critic → Copywriter to compose multi-segment videos with creative variety, the Simple Pipeline uses one library-aware Gemini Pro agent (Match-Or-Match) and ffmpeg to ship two specific products fast: routine videos and meme/vibe videos.

---

## Two products, one infrastructure

| | Routine | Meme / Vibe |
|---|---|---|
| Sheet `Format` value | `routine` | `meme` |
| Sheet `Clips` value | `auto` | `1` |
| Slot count | 2–5 (agent picks) | 1 (forced) |
| Source parents | One parent (parent-anchored) | Any parent (segment-first) |
| Overlay register | Instructive, label-style ("5-min morning flow") | Punchy, hook-style ("no thoughts just stretching") |
| Music | Same brand pool, mood=`chill` preference | Same brand pool, mood=`playful` preference |
| Cooldown | Last 2 parents + last 2 segments per brand | Last 2 segments per brand (parent cooldown implicit) |
| Use case | Routines, sequences, micro-tutorials | Vibe content, snackable moments, ironic captions |

Both products share: BullMQ queue (`simple_pipeline`), worker, orchestrator, agent, render module. The only branches are in the orchestrator (format → overlay generator + minor schema differences) and in the prompts (different register guidance).

---

## Quick architecture

```
Operator fills Brand + Idea Seed + Pipeline=simple + Format + Clips in Jobs sheet
  ↓
n8n S1 (every 30s) reads sheet
  ↓
Route Decision (S1 Code node):
  - Validates Format / Clips per Q8
  - Calls /simple-pipeline/check-readiness
  - On any failure: sets jobs.status=simple_pipeline_blocked + reason in Sheet Row Status
  - On ok: sets jobs.status=simple_pipeline_pending + enqueues to BullMQ simple_pipeline queue
    with payload {format, clipsMode}
  ↓
Simple Pipeline worker picks up
  ↓
Orchestrator (runSimplePipeline):
  1. Atomic transition pending → rendering
  2. Compute exclusions (parent + segment cooldown)
  3. Match-Or-Match agent picks parent + N segments (or 1 segment for meme)
  4. Sum picked-segment durations → music min duration
  5. In parallel: overlay generator (routine OR meme) + music selector
  6. ffmpeg render (4 passes: normalize → concat → overlay+logo → music mix)
  7. Log to simple_pipeline_render_history (cooldown table)
  8. Upload to R2, generate 24h presigned URL, transition rendering → human_qa
  ↓
n8n P1 (existing) syncs status + preview URL to Sheet
  ↓
Operator reviews in Sheet QA tab; approves → S3 transitions to delivered
```

Output: 1080×1920 / 30fps / CRF 18 MP4, 15–45s typical duration.

---

## Operator setup (per brand, one-time)

Before a brand can ship Simple Pipeline videos, populate three things:

### 1. brand_configs row exists with `aesthetic_description` populated

Required column added in migration 014. **NOT** `voice_guidelines` — kickoff Q1b: `aesthetic_description` is the visual channel that Match-Or-Match consumes; `voice_guidelines` is the voice channel that the overlay generators consume. Two distinct fields, two distinct purposes.

The starter draft is operator-revisable. The standard activation pattern is:

  1. Agent drafts a starter `aesthetic_description` from the brand's existing `voice_guidelines` + `content_pillars` + the brand's Sheet content (colors, color_grade_preset, allowed_color_treatments, transition_style, hook_style_preference). The draft focuses on visual feel: palette, lighting, subject presentation, camera/movement style, what's typical vs out-of-bounds.
  2. Agent ships the draft via a migration (or a one-shot `UPDATE` script) and halts for operator review.
  3. Operator revises freely. The text is plain prose for the agent's reading; no schema constraints beyond non-null.

The nordpilates row was seeded by migration 014 with this pattern; subsequent brands follow the same flow.

What to write in: visual mood (warm/cool/neutral, color register, lighting feel), subject presentation (welcoming/intense/instructional/casual), camera/movement style (calm/dynamic/locked-off/handheld), what's typical, what's out-of-bounds (concrete examples of what to avoid).

Example (nordpilates, in production today):

> Warm, soft, and grounded — like a mid-morning pilates session in natural window light. Footage skews peachy, golden-hour, and soft-pastel; the palette stays warm and supportive, never high-contrast, never moody. Subjects move with intention and breath: still poses, slow flows, gentle holds. The camera is calm — locked-off or drifting steadily, never frenetic, never gym-crunchy. Bodies are shown welcomingly across abilities; the visual register is "supportive instructor who believes in you," not "fitness influencer pushing intensity." Outfits skew softly neutral or in the brand's warm palette (peach, cream, charcoal). Avoid: stark gym aesthetics, fluorescent lighting, sweat-glistening intensity, fast-cut explainer-style framing, competitive-fitness energy, or anything that reads as HIIT/bootcamp.

### 2. ≥3 parents with ≥10 v2-analyzed segments each

Per kickoff Q9: only segments where `segment_v2 IS NOT NULL` are pickable. Parents with fewer than 10 v2-analyzed segments are not eligible for the routine path. The readiness gate is brand-level: brands need at least 3 such parents before any Simple Pipeline jobs (routine or meme) will route through.

Drop content via the existing S8 ingest flow (see [`INGESTION_NAMING.md`](INGESTION_NAMING.md)). The Phase 4 W0d analyzer populates `segment_v2` automatically as part of ingestion. Wait for the ≥3-parents-with-≥10-segments threshold; check via the readiness endpoint or a quick SQL query on `asset_segments`.

### 3. ≥5 active music_tracks

Music library is global (not per-brand). The readiness endpoint counts all rows in `music_tracks` (no `active` filter — column doesn't exist; per kickoff Q10 every row is treated as live). nordpilates production has 15 tracks across 6 distinct moods; that's well above the floor.

If music is sparse, ingest more tracks via the existing S7 flow. Mood/energy filters in the music selector default to:
- routine: mood=`chill`, energy [3, 7]
- meme: mood=`playful`, energy [5, 9]

If a brand needs a different musical register, the format → mood mapping in `src/orchestrator/simple-pipeline/music-selector.ts` is the place to tune (or factor into a per-brand override later).

---

## Sheet usage (operator)

Three columns control Simple Pipeline routing. All three were added pre-c1; values are constrained to dropdowns.

| Column | Values | Behavior |
|---|---|---|
| **Pipeline** | `simple`, `advanced` | Empty defaults to `advanced` (Phase 4 Part B path). Set `simple` to route through this pipeline. |
| **Format** | `meme`, `routine` | Required when Pipeline=`simple`. Determines product. |
| **Clips** | `1`, `auto` | Required when Pipeline=`simple`. `1` for `meme`; `auto` for `routine` (agent picks 2–5). Operator does not pick a number. |
| **Overlay Mode** | `generate`, `verbatim` | Round 3 (2026-04-29). Empty defaults by format: meme→`verbatim`, routine→`generate`. `generate` calls overlay-{routine,meme}.ts via Gemini. `verbatim` uses the operator's idea seed text directly as the overlay (skips Gemini, saves ~$0.005/render and ~5s wall, preserves seed register intact). Use `generate` for routines (label generation typically improves on the seed). Use `verbatim` for memes (seeds are usually already in caption-shape; the generator weakens them by paraphrasing). Override the format default if you've written an idea seed that's already a great overlay or that needs paraphrasing. |

If Format/Clips don't match (e.g. `meme` + `auto`), S1 sets the job to `simple_pipeline_blocked` with reason `meme_format_requires_clips_1` or `routine_format_requires_clips_auto` and the operator sees that string in the Sheet's "Row Status" column.

If the brand isn't ready (missing `aesthetic_description`, fewer than 3 eligible parents, fewer than 5 music tracks), S1 sets the job to `simple_pipeline_blocked` with the reason from the readiness endpoint.

The Sheet's "Status" column shows the job's current `jobs.status`. The "Row Status" column carries the human-readable explanation (`OK` or `BLOCKED: <reason>`).

---

## Reason tokens (Q4, stable strings)

S1 persists these to "Row Status" so the operator can fix the underlying issue.

| Token | Cause | Operator action |
|---|---|---|
| `invalid_format` | Pipeline=simple but Format is not `meme` or `routine` | Set Format dropdown |
| `meme_format_requires_clips_1` | Format=meme but Clips≠1 | Set Clips=`1` |
| `routine_format_requires_clips_auto` | Format=routine but Clips≠auto | Set Clips=`auto` |
| `missing_aesthetic_description` | brand_configs row missing or aesthetic_description NULL | Populate the column |
| `insufficient_parents_<N>_of_3_needed` | Brand has <3 parents with ≥10 v2-analyzed segments | Ingest more content for the brand; wait for v2 analysis |
| `insufficient_music_tracks_<N>_of_5_needed` | Library has <5 music_tracks rows | Ingest more music via S7 |
| `readiness_endpoint_unreachable` | VPS endpoint not responding | Check VPS service is running; check network |
| `unknown_pipeline_value:<x>` | Pipeline column has a value other than `simple`/`advanced`/empty | Set Pipeline dropdown to a valid value |

---

## Cost & timing

Per nordpilates VPS measurements (c7 e2e):

| | Routine (3 segments) | Meme (1 segment) |
|---|---|---|
| Match-Or-Match agent | $0.06 | $0.24 |
| Overlay generator | <$0.001 | <$0.001 |
| Render | $0 (ffmpeg) | $0 (ffmpeg) |
| **Total per video** | **~$0.06** | **~$0.24** |
| Wall time (agent → human_qa) | ~80s | ~75s |

The 4× meme delta over routine comes from prompt size: meme prompt lists every eligible v2 segment (currently ~999 nordpilates), routine prompt lists only segments grouped under parents-with-≥10. Cost-irrelevant for v1 per kickoff Q7; if it bites later, prompt-size optimization (drop visual_tags / motion fields, truncate descriptions) is the obvious lever.

Free Gemini API credits make the real per-video cost zero today; numbers above are nominal for budgeting if the credits arrangement ends.

---

## Troubleshooting

**Job is stuck in `simple_pipeline_pending` and not picked up.**

- Check the simple_pipeline worker is running: `ssh root@95.216.137.35 "systemctl status video-factory --no-pager | head -10"`. Look for the startup banner advertising the `simple_pipeline` queue and `POST /simple-pipeline/check-readiness` route.
- Check BullMQ depth: there might be a stuck earlier job. Currently the worker runs concurrency=1 (serial ffmpeg).

**Job moved to `simple_pipeline_failed` quickly with no clear reason.**

- Check `journalctl -u video-factory -n 50` for the `[simple-pipeline] FAIL` line. The full error stack lands in the systemd log; the brief reason is in `job_events.details.error`.
- Common causes:
  - Match-Or-Match agent picked an ID that doesn't exist (rare; happens if the library was modified between agent call and validation — orchestrator throws cleanly)
  - Render failed (font missing, ffmpeg filter error). Check the workdir at `/tmp/video-factory/simple-pipeline/<jobId>/` (only present on failure; orchestrator's error path tries to clean up best-effort)

**A clip selected by the agent isn't on-brand visually (e.g., wrong body composition).**

- The `aesthetic_description` is the agent's only visual filter. Tighten the description's "avoid" section. If the off-brand clip is structurally there in the library, the agent may still pick it occasionally — operator option is to delete the underlying `asset_segments` row (and ideally the parent `assets` row + R2 keys, manual cleanup). See followup `simple-pipeline-clip-rejection-manual-cleanup`.

**Render output looks pixelated or upscaled.**

- Source clips (`asset_segments.clip_r2_key`) are 720p pre-trimmed (Phase 2.5). The Simple Pipeline render upscales them to 1080×1920 in pass A. If artifacts are visible, the alternative is to source from the parent's `pre_normalized_r2_key` (1080p) and ffmpeg-trim at render time — slower per-job but no upscale. Tracked as a perf-vs-quality tradeoff; revisit after c10 Gate A operator review.

**Operator wants to re-render a rejected job.**

- Currently the `human_qa → simple_pipeline_pending` transition is intentionally NOT in the state machine. Easiest path: create a new job with the same idea seed. If c10 testing surfaces a need for in-place re-render, the transition is one line in `src/lib/job-manager.ts`.

---

## Per-brand activation procedure

When onboarding a new brand to the Simple Pipeline:

1. **Drop content** through S8 with the canonical prefix (see [`INGESTION_NAMING.md`](INGESTION_NAMING.md)). Wait for ingestion + v2 analysis to populate ≥3 parents with ≥10 v2-segments each.
2. **Populate brand_configs**:
   - `aesthetic_description` (NEW): operator-edited or agent-drafted-then-revised. Visual feel, see nordpilates example above.
   - `voice_guidelines` (existing): voice/tone for overlay text.
   - `logo_r2_key`, `primary_color`, `color_grade_preset`: required by the render module.
3. **Verify readiness**: `curl -X POST 'http://95.216.137.35:3000/simple-pipeline/check-readiness?brand_id=<brand>'`. Expect `{ok: true}`.
4. **Drop a test idea seed** in the Sheet with Pipeline=simple, Format=routine, Clips=auto. Verify the job reaches `human_qa` and the operator preview is on-brand. If it isn't, iterate `aesthetic_description`.
5. **Drop a meme test** with Format=meme, Clips=1. Same iteration loop.

The activation cost is a few minutes of agent + operator time per brand once content is ingested.

---

## File layout

```
src/orchestrator/
├── simple-pipeline-orchestrator.ts    runSimplePipeline(): public entry from worker
└── simple-pipeline/
    ├── readiness.ts                   checkSimplePipelineReadiness(): used by HTTP endpoint
    ├── parent-picker.ts               planRoutineExclusions(): cooldown + LRU branching
    ├── segment-cooldown-tracker.ts    log/read simple_pipeline_render_history
    ├── music-selector.ts              thin wrapper over src/lib/music-selector.ts
    ├── overlay-routine.ts             label-style overlay text
    ├── overlay-meme.ts                hook-style overlay text
    └── render.ts                      4-pass ffmpeg pipeline

src/agents/
├── match-or-match-agent.ts            single Pro call, dispatches by format
└── prompts/
    ├── match-or-match-routine.md      parent + N segments
    ├── match-or-match-meme.md         single segment
    ├── overlay-routine.md             label register
    └── overlay-meme.md                meme/hook register

src/workers/simple-pipeline.ts          BullMQ wrapper
src/index.ts                            worker registration + readiness endpoint

src/scripts/migrations/
├── 013_simple_pipeline_render_history.sql
├── 014_brand_configs_aesthetic_description.sql
└── 015_jobs_status_simple_pipeline.sql

n8n-workflows/S1-new-job.json           Pipeline-aware S1 (operator imports)
```

---

## Disabling the pipeline

**Per-job disable:** operator sets Pipeline column to `advanced` (or empty). Old advanced path runs unchanged.

**Brand-level disable:** clear `brand_configs.aesthetic_description` for the brand → readiness will block.

**System-level disable (emergency):** stop the worker. The S1 routing will keep enqueueing but the queue will drain when the worker restarts. To soft-stop without dropping queued jobs, comment out `simplePipelineWorker` in `src/index.ts` and restart. To hard-stop and drop pending jobs, drain the BullMQ queue first.

**Code rollback:** `git revert -m 1 <merge-sha>` on main, redeploy. Migrations 013/014/015 can stay (additive, no rollback required).

---

*Drafted 2026-04-29 alongside c9. Living doc — update on prompt iteration, schema changes, or per-brand-activation lessons.*
