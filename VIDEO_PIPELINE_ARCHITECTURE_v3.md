# Video Factory — Architecture v3 (MVP-focused)

**Status as of 2026-04-09:** Pipeline code is ~90% built and deployed to VPS, but **zero videos have rendered end-to-end**. S7 music ingest is blocked on a Google Drive credential issue, which also blocks UGC clip ingestion. Quality Phases 0–7 are deployed but have never touched real footage — they were only tested on synthetic data.

**Goal of this document:** Replace v2 as the source of truth. Define an MVP that ships the first real video in **7 days** for **3 brands**, then a post-MVP hardening path. Written to be handed directly to a coding agent.

---

## Part 1 — State of reality

### What's actually working

| Component | Status | Evidence |
|---|---|---|
| VPS at `95.216.137.35` | Running | systemd service `video-factory`, HTTP API on :3000 |
| n8n at `46.224.56.174` | Running | 11 workflows imported |
| Supabase schema | Deployed | Base + quality-upgrade migrations applied |
| Upstash Redis | **Near limit** | ~780k cmds/month at current drainDelay, free tier is 500k |
| R2 bucket + folders | Created | Empty of real content |
| Code paths for agents, render, export, QA | Built | 41/41 tests pass on synthetic data |
| Google Sheets "Video Pipeline" | Created | 6 tabs, columns defined but several don't match workflows |

### What's broken or blocked

1. **CRITICAL — Google Drive service account cannot download or move files.** Service accounts have no storage quota, so they can read Sheets (which don't consume Drive quota) but fail with `403 storageQuotaExceeded` on any file in a personal Drive folder. S7 music ingest is blocked. UGC clip ingestion is blocked (and there's no workflow for it anyway — see #5).

2. **S5 Caption Preset workflow is broken** — the Sheet tab has columns `Font Color`, `Position X`, `Position Y`, `Animation In`, `Animation Out`, `Max Width`. The workflow expects `Text Color`, `Position`, `Animation Type`, `Max Width %`. Every write silently falls through to defaults. Nobody notices until captions render wrong.

3. **S6 Music Track workflow is broken** — the Sheet has `Track Name`, `BPM`, `License Type`, `Brand Fit`, `Loop Safe`. The workflow expects `Title`, `Tempo BPM`, `License Source`, `Artist`, `Energy Level`. Same silent-default problem.

4. **Monthly Archive only archives `delivered` jobs** despite the node being named "Filter Delivered/Failed". Failed jobs stay in the active sheet forever.

5. **No UGC ingestion workflow exists.** The architecture describes "Workflow 1: Asset Ingestion" but the 11 implemented workflows are S1–S7 and P1–P4 — S7 handles music only. UGC clips have no automated path from Drive to R2. The ingestion *worker code* exists, but nothing triggers it.

6. **P3 Dashboard Refresh clears rows 2+** of the Dashboard tab, which would wipe the `=COUNTA`/`=COUNTIF` formulas currently sitting in those rows. Either those formulas are dead or P3 breaks them every run.

7. **New Job workflow hardcodes `row_number: 0`** in the Sheet update mapping, which will silently break row matching.

8. **Brands tab has 24 columns, only 6 are populated.** Unusable by a graphic designer.

9. **Quality Phases 0–7 have never rendered a real video.** All tests were on synthetic fixtures. Beat sync, color grading, audio ducking, CRF 18 encoding — all untested under real conditions.

### Decision: MVP scope

| Dimension | MVP target | Full target |
|---|---|---|
| Brands | **3** (nordpilates, ketoway, carnimeat) | 30 → 50 |
| Videos/week | 5–10 manually initiated | 150 |
| Video types | **1** (tips-listicle) to start | 4 |
| Quality phases enabled | 3, 4 (audio ducking, CRF 18) | All 7 |
| Quality phases deferred | 0, 1, 2, 5, 6, 7 | — |
| Workflows active | 6 of 11 | 11+ |
| Sheet tabs used by operator | 1 (Jobs) | 6 |
| Timeline | **7 days** to first delivered video | — |
| Cost | Keep under $20/mo | ~$35/mo |

The logic: every phase that has never touched real footage is a risk surface. Shipping a single ugly working video in 7 days is more valuable than shipping 7 broken features. Beat sync, color grading, intelligent music selection, and dynamic pacing all depend on assumptions about real clip behavior that you can't validate until a real clip goes through the pipeline. **Ship plain first, upgrade second.**

---

## Part 2 — Critical fixes (Day 1 blockers)

### Fix 1: Google Drive credentials (highest priority)

**Root cause:** Google service accounts have no storage quota on regular Drive. Error `Forbidden - perhaps check your credentials` with `reason: storageQuotaExceeded` is returned when the service account tries to download, copy, or move a file in a "My Drive" folder owned by a personal account. This is documented at `https://developers.google.com/workspace/drive/api/guides/about-shareddrives`.

**Why Sheets works but Drive doesn't:** Sheets don't consume Drive storage quota, so the same service account reads/writes Sheets without issue. The moment it touches a file in a personal Drive folder it fails.

**The fix — move folders to a Shared Drive:**

1. In Google Drive, create a new Shared Drive called `Video Factory`.
2. Inside it create `Music Uploads/`, `Music Processed/`, and one folder per brand (`nordpilates/`, `ketoway/`, `carnimeat/` to start).
3. Add the Flemingo service account email (`flemingo-service@...iam.gserviceaccount.com` — whatever the actual email is) as a **Content Manager** on the Shared Drive.
4. Move the existing 15 MP3s from the old `Music Uploads/` folder into the new Shared Drive `Music Uploads/`.
5. Update the folder IDs in the workflows. S7 currently has `1s2vUnIoJUt7rltSRlJeY9uqQyQ5_Lzso` (Music Uploads) and `1RtBDaSxM45TT2B7ATvQGXvnY5HB1nWGw` (Music Processed) hardcoded — replace with the new Shared Drive folder IDs.
6. In the Google Drive n8n node, **enable the `Include Shared Drives` option** (under node settings → Options → Shared Drives). Without this, even a Shared Drive folder isn't visible to the node.
7. Delete the OAuth credential `9mzs7zcG6Z9TIcku` ("ai@flmng.ai") and the second service account `jPzsu3UPPrZc0kge` ("Google Service ACC"). Standardize everything on `AIqzMYUXoQjud7IW` ("Flemingo service acc"). Having three different Google credentials in one workflow is a maintenance timebomb.

**Verification:** Run S7 manually once. Expect all 15 tracks to download, ffprobe, upload to R2, insert into Supabase, update the Sheet, and move to Processed.

### Fix 2: Delete S5 and S6 from MVP scope

Both are broken and neither is MVP-critical. For 3 brands:
- Caption presets: seed directly into `brand_configs.caption_preset` via SQL. One-time job.
- Music tracks: S7 already auto-populates `music_tracks` from ffprobe + filename. S6 is the manual fallback and adds zero value for MVP.

**Action:** Deactivate S5 and S6 in n8n. Do not delete — park them for later. Rebuild when the Sheet and workflow schemas can be aligned properly.

### Fix 3: Build the missing UGC ingestion workflow (S8)

This is the biggest architectural gap. Without it, clips can never reach R2, which means no video can render.

**S8 — UGC Ingestion (Drive → VPS → R2 → Supabase):**

Mirrors S7 structure:
1. Every 5 min, read all video files from the brand UGC folders under Shared Drive `Video Factory/brands/{brand_id}/` (use a loop or multi-folder approach).
2. For each file: `Prep Metadata` node parses the filename for `brand_id_description.ext` (matching the convention already documented in CLAUDE.md).
3. Send binary + metadata to a new VPS endpoint `POST /ugc-ingest` with `x-asset-meta` header containing `{filename, brand_id, description}`.
4. VPS endpoint: save to temp, ffprobe, run Gemini analysis, upload to R2 at `assets/{brand_id}/{uuid}.{ext}`, insert into `assets` table with all quality fields (including Phase 1 enrichment: dominant color, motion intensity, brightness — these are already implemented in `clip-analysis.ts`), return the asset record.
5. Back in n8n: move the file from the brand folder to `Video Factory/brands/{brand_id}/processed/` to prevent re-processing.

**Endpoint code signature** (to be added to `src/index.ts`):

```typescript
app.post('/ugc-ingest', async (req, res) => {
  const meta = JSON.parse(req.headers['x-asset-meta'] as string);
  // Save binary to /tmp/ugc-ingest/{uuid}.{ext}
  // Call existing ingestion worker function with filepath + meta
  // Return { asset_id, r2_key, duration_seconds, content_type, quality_score }
});
```

The ingestion worker already exists in `src/workers/ingestion.ts` — this endpoint just wraps it with an HTTP interface the same way `/music-ingest` wraps `music-ingest.ts`.

### Fix 4: Redis — keep Upstash but drastically reduce idle chatter

**The math:** Current `drainDelay: 30s` means each BullMQ worker polls the queue every 30s when idle. With 3 queues (planning, rendering, ingestion) and 1 worker, that's 3 polls × 2 per minute × 60 × 24 = 8,640 commands/day just for empty polls, plus the worker's own housekeeping. The CLAUDE.md note of ~26k/day matches: 8.6k polls + connection heartbeats + misc. Projecting: 26k × 30 = **780k/month, which exceeds the 500k free tier by 56%.**

**Creating a new Upstash account just resets the clock** — you'd burn through it again in ~19 days. That is not a fix, it's procrastination.

**Two real options:**

**Option A (recommended for MVP): Raise `drainDelay` to 120s.** This cuts idle polling by 4×. New math: ~6.5k/day = ~195k/month, comfortably under 500k. Downside: when a job arrives, the worker might take up to 2 minutes to pick it up *if the queue was empty when polling started*. For MVP volume (5–10 videos/week), this is invisible. Change is one line in `src/config/redis.ts`:

```typescript
// src/workers/*.ts — all BullMQ worker constructors
new Worker('planning', processor, {
  connection,
  drainDelay: 120, // was 30
});
```

This is the MVP fix. Zero cost, zero infrastructure change.

**Option B (if MVP Redis is still tight): Self-host Redis on the n8n VPS.** The n8n VPS already exists and has headroom. Install Redis with `apt install redis-server`, configure it to listen on a private interface, update `REDIS_URL` on the video-factory VPS to point at it. Zero marginal cost, unlimited commands. Downside: one more thing to monitor. Worth it for post-MVP.

**Do not** move to paid Upstash — at $0.2 per 100k commands past the free tier, your idle chatter alone would cost ~$3/mo and it scales linearly with activity. Self-hosting is free and faster.

### Fix 5: Simplify the Brands tab (graphic designer UX problem)

You said the designer can't easily provide hex colors. The real insight here is: **the graphic designer shouldn't be filling the Brands tab at all.** Their deliverable is a brand guide (PDF or Figma) — colors, fonts, logo positioning, caption styles. An operator (you, or later a VA) translates that into `brand_configs` rows **once per brand** and forgets about it.

**New brand setup process:**

1. Designer delivers per-brand: `logo.png`, `brand-guide.pdf` (or link), a 10-second "this is how captions should look" mockup video, and a short voice/tone doc.
2. Operator drops `logo.png` into R2 via the VPS (new endpoint `/brand-asset-upload`, or for MVP just `aws s3 cp` manually).
3. Operator runs a SQL insert or a seed script to create the `brand_configs` row with colors, fonts, caption preset JSON, voice guidelines.
4. Done. The row never changes unless the brand rebrands.

**For MVP:** do this manually for 3 brands. Don't use the Brands tab at all. Write a seed script `scripts/seed-brand.ts` that takes a JSON file describing a brand and inserts it.

**For post-MVP:** the Brands tab becomes a read-only view of `brand_configs` with maybe 8 columns total: `Brand ID, Brand Name, Primary Color, Font Family, Voice Guidelines, Allowed Video Types, Active, Last Updated`. Hide everything else behind a "View full config" link that opens a Supabase row.

### Fix 6: Monthly Archive filter

One-line fix:

```javascript
// Current (broken — only archives delivered):
{ "id": "is-terminal", "leftValue": "...Status...", "rightValue": "delivered", "operator": "equals" }

// Fixed (archives both):
"conditions": [
  { "leftValue": "{{ $json['Status'] }}", "rightValue": "delivered", "operator": "equals" },
  { "leftValue": "{{ $json['Status'] }}", "rightValue": "failed", "operator": "equals" }
],
"combinator": "or"
```

Low priority — P4 only runs once per month and there's nothing to archive yet. Fix when convenient.

### Fix 7: New Job workflow `row_number: 0` bug

Delete the `row_number: 0` field from the "Write Job ID to Sheet" mapping and the "Write Error to Sheet" mapping. The Sheet node auto-matches rows by the `matchingColumns` setting, and passing `row_number: 0` either does nothing or corrupts row resolution. Set `matchingColumns: ["Job ID"]` on the write and let n8n handle it.

### Fix 8: P3 Dashboard Refresh formula conflict

The Dashboard tab currently has `=COUNTA`, `=COUNTIF` formulas in rows 3–4. P3 runs "Clear Dashboard (exceptFirstRow)" which wipes those formulas, then appends new rows. Either:
- (a) Keep the formulas and skip P3 entirely — formulas refresh automatically when Jobs tab changes. Simplest.
- (b) Remove the formulas and let P3 write everything. More flexible but means the sheet is empty between runs.

**For MVP:** pick (a). Delete P3 from active workflows. The formula-based dashboard is sufficient for 3 brands.

---

## Part 3 — Simplified architecture

### Data flow (MVP version)

```
┌─────────────┐
│  Operator   │ drops UGC in Drive, fills Jobs row, approves brief, approves QA
│  (human)    │
└──────┬──────┘
       │
       ▼
┌─────────────┐    S8 (NEW) polls Drive every 5min
│   Google    │◄──┐
│   Drive     │   │    S7 polls Music Uploads every 5min
│  (Shared)   │   │
└──────┬──────┘   │
       │          │
       │ S1/S2/S3 read Jobs tab every 30s
       │          │
       ▼          │
┌─────────────┐   │
│   n8n       │───┘
│             │
└──────┬──────┘
       │ HTTP (POST /enqueue, /ugc-ingest, /music-ingest)
       │ HTTP (PATCH /rest/v1/jobs on Supabase)
       ▼
┌─────────────┐         ┌─────────────┐
│  VPS        │◄───────►│  Supabase   │
│  (workers + │         │  (state)    │
│   HTTP API) │         └─────────────┘
└──────┬──────┘
       │
       ├──► R2 (clips, renders, music)
       ├──► Claude API (3 agents)
       ├──► Gemini API (clip analysis)
       ├──► whisper.cpp (local transcription)
       └──► Upstash Redis (BullMQ queue, drainDelay 120s)
```

The flow is the same as v2, with the Drive fix, S8 added, and S4/S5/S6/P3/P4 deactivated.

### The 6 active workflows for MVP

| # | Workflow | Trigger | Action | Priority |
|---|---|---|---|---|
| S1 | New Job | Sheet poll 30s | Jobs row with `Idea Seed` + `Brand` + no `Job ID` → Supabase insert → BullMQ planning queue | Keep |
| S2 | Brief Review | Sheet poll 30s | `Review Decision` filled → update Supabase → if approve, enqueue rendering | Keep |
| S3 | QA Decision | Sheet poll 30s | `QA Decision` filled → update Supabase → approve/reject routing | Keep |
| S7 | Music Ingest | Drive poll 5min | Download MP3, POST to VPS, update Sheet, move to Processed | **Fix cred, keep** |
| **S8** | **UGC Ingest (NEW)** | Drive poll 5min | Download video, POST to VPS, update assets table, move to processed | **Build** |
| P1 | Job Status Push | Webhook from VPS | After state transition, update Sheet row | Keep |
| P2 | Periodic Sync | Cron 5min | Catch any missed updates by pulling active jobs from Supabase | Keep |

**Deactivated for MVP:** S4 (Brand Config), S5 (Caption Preset), S6 (Music Track manual), P3 (Dashboard Refresh), P4 (Monthly Archive).

### Simplified Sheets layout

**Jobs tab (operator's daily workspace) — keep 13 columns, down from 20:**

| Column | Type | Who fills |
|---|---|---|
| Row Status | auto | n8n |
| Job ID | auto | n8n after insert |
| Brand | dropdown (3 options) | operator |
| Idea Seed | text | operator |
| Status | auto | n8n |
| Brief Summary | auto | agents |
| Hook Text | auto | agents |
| Review Decision | dropdown (approve/reject) | operator |
| Rejection Notes | text | operator (on reject) |
| Preview URL | auto link | n8n |
| Auto QA | auto | n8n |
| QA Decision | dropdown (approve/reject) | operator |
| QA Issues | dropdown multi (clip_quality, audio_sync, timing, branding) | operator (on reject) |

**Removed from Jobs tab:** `CTA Text` (never edited by operator, lives in context_packet), `Template` (chosen by agent, never overridden in MVP), `QA Notes` (use Rejection Notes as single free-text field), `QA Reviewed By` (nobody uses this), `Video Type` (agent-selected, not operator concern), `Created At` / `Completed At` (visible in Dashboard tab or Supabase).

**Brands tab: hide or delete.** Seed the 3 MVP brands via SQL.

**Caption Presets tab: hide or delete.** Seed via SQL as part of `brand_configs.caption_preset` JSON.

**Music Library tab: keep read-only.** S7 writes it, operators glance at it. Columns match S7 output: `Track ID, Title, R2 Key, Duration (s), Row Status`. Delete all the stale columns that don't match S7.

**Templates tab: delete.** Video types and layouts are code-level decisions. No sheet needed.

**Dashboard tab: keep the formulas.** Delete P3 workflow. The formulas auto-refresh from Jobs tab changes.

**Net result:** operator sees 2 tabs — Jobs (daily) and Dashboard (read-only). That's it.

---

## Part 4 — Workflow-by-workflow critique

### S1 — New Job

**What it does:** Polls Jobs tab every 30s, filters rows with `Idea Seed` + `Brand` + empty `Job ID`, validates brand against hardcoded list, inserts into Supabase, enqueues to BullMQ planning queue, writes Job ID back to Sheet.

**Problems:**
1. **Brand validation is a hardcoded string contains check** — `"nordpilates,ketoway,carnimeat,nodiet,highdiet"` with `contains` operator. This means `nord` would match, as would `ketoway2`. Use exact-match against an array, or better, query `brand_configs` directly for validation.
2. **JSON body is string-interpolated without escaping.** If a designer puts a double quote in the idea seed ("You've been stretching wrong"), the JSON breaks. Use the `={{ JSON.stringify({...}) }}` pattern or move to expression mode.
3. `row_number: 0` bug (see Fix 7 above).
4. **No handling for `Enqueue to BullMQ` failures.** If the VPS is down, the Supabase job is created but never enters the queue, leaving it orphaned in `idea_seed` status forever.

**MVP fix priority:** High. Fix #2 (JSON escape) and #4 (enqueue retry) at minimum.

**Fix #4 approach:** Add an `Error Trigger` connection on the Enqueue node → write `Row Status: "ERROR: VPS unreachable"` to the Sheet and set Supabase status back to something safe. Or move the BullMQ enqueue to happen inside the VPS itself via a Supabase trigger/webhook — cleaner architecture.

### S2 — Brief Review

**What it does:** Polls Jobs tab every 30s, finds rows with `Status == brief_review` and non-empty `Review Decision`, patches Supabase to `queued` (on approve) or `planning` (on reject), enqueues rendering queue on approve.

**Problems:**
1. **Race condition on approve.** The PATCH uses `?id=eq.X&status=eq.brief_review` as a filter (good — atomic), but the subsequent BullMQ enqueue happens regardless of whether the PATCH matched any rows. If two n8n instances run this workflow (or the same row gets processed twice in a polling race), the second one silently no-ops on the PATCH but still sends to BullMQ, causing duplicate renders.
2. **No guard on consecutive rejections.** A rejection loop could run forever. The `brand_configs` schema has `rejection_count` but S2 doesn't increment it or check a max.
3. **Same JSON escape issue** on rejection notes as S1.

**MVP fix priority:** Medium. The race isn't likely with 1 n8n instance and 30s polling on low volume, but fix #2 (add max 3 rejections) before going live.

### S3 — QA Decision

**What it does:** Same structure as S2 but for `human_qa` → `delivered` / re-plan / re-render, with a routing decision based on `QA Issues`.

**Problems:**
1. **The "Content or Technical" routing uses `contains "clip_quality"` as the only check.** What if the operator picks `audio_sync` and `clip_quality` together? Current logic routes to re-plan because `clip_quality` is present. Arguable but not obviously wrong. Document the decision matrix explicitly.
2. **`completed_at` is set via `new Date().toISOString()` inside a JSON body string** — this is client-side time from n8n, not Supabase time. Minor, but inconsistent with the rest of the schema which uses `DEFAULT NOW()`. Use Postgres `NOW()` via RPC or drop the client timestamp.
3. **No idempotency key on the BullMQ re-enqueue.** If the operator accidentally changes QA Decision twice quickly, you get two re-renders.

**MVP fix priority:** Low — these are edge cases. Ship and monitor.

### S4 — Brand Config

**Deactivate for MVP.** Revisit post-MVP with a stripped-down Brands tab.

When you revisit: the Code node that validates hex colors and reassembles the payload is actually well-written. The problem isn't the workflow, it's the Sheet schema (24 columns) and the designer-as-data-entry UX. Rebuild with an 8-column tab.

### S5 — Caption Preset

**Deactivate for MVP.** Schema is broken. Seed captions via SQL for 3 brands.

### S6 — Music Track

**Deactivate for MVP.** Redundant with S7.

### S7 — Music Ingest

**What it does:** Polls `Music Uploads/` Drive folder every 5min, downloads each MP3, POSTs to VPS `/music-ingest` with metadata, writes track record to Sheet, moves file to Processed.

**Problems:**
1. **THE credential issue** (Fix 1 above). Blocker.
2. **Uses a different Sheet credential (`jPzsu3UPPrZc0kge`)** than every other workflow. Consolidate on `AIqzMYUXoQjud7IW`.
3. **No timeout handling on VPS request.** If `/music-ingest` hangs, the workflow hangs. Set the timeout to 120000 (already there — good) but add an error branch.
4. **"Download Folder Files1" node** downloads every file in the folder on every run. After Fix 1, if the move-to-processed step fails mid-batch, the next run re-downloads everything. Idempotency check should exist in the VPS endpoint: check if a track with the same filename + duration already exists in Supabase before re-inserting.
5. **No mood/energy/genre/BPM enrichment.** S7 sends only `{filename, title}` to the VPS. The VPS does ffprobe for duration and (presumably) BPM detection, but mood/genre/energy levels are never populated, which means music selection (Phase 6) has nothing to filter on even when tracks exist.

**MVP fix priority:** Critical (fix 1) + High (fix 5 — without mood data, the music picker is random). Minimum viable approach for #5: a one-time manual tagging pass after S7 populates the tracks. Operator edits `mood` and `energy_level` columns in the Music Library sheet, and you add a simple n8n workflow that syncs those edits back to Supabase. Or skip it for MVP and hardcode one track per video type.

### S8 — UGC Ingest (NEW, needs building)

Described in Fix 3 above. Build this Day 2.

### P1 — Job Status Push

**What it does:** Webhook endpoint, VPS posts `{jobId, status}` after every state transition, workflow fetches the full job and updates the Sheet row.

**Problems:**
1. **`matchingColumns: ["Job ID"]`** — this relies on the Sheet row existing. If the row was archived or deleted, the update silently fails.
2. **No authentication on the webhook.** Anyone who knows the URL can spoof a status update. For MVP on a private project, low priority, but at minimum put it behind a shared secret header check.
3. **`Auto QA` column concatenates status + details in a single cell.** Works but makes the data hard to filter.

**MVP fix priority:** Low — works as-is. Add webhook auth before expanding beyond you.

### P2 — Periodic Sync

**What it does:** Every 5 min, fetches active jobs from Supabase (status not in delivered/failed), updates matching Sheet rows.

**Problems:**
1. **Overlaps with P1.** P1 handles real-time updates; P2 is the 5-min catch-up. Fine in principle but means the same row may be written twice within seconds. Usually harmless.
2. **50-row limit hardcoded.** If active jobs exceed 50, you miss some. For MVP fine, but document.
3. **Same Sheet-row-missing silent failure** as P1.

**MVP fix priority:** Low.

### P3 — Dashboard Refresh

**Deactivate.** Use sheet formulas instead.

### P4 — Monthly Archive

**Keep deactivated.** Nothing to archive yet. Fix the `delivered/failed` filter before activating post-MVP.

---

## Part 5 — One-week build plan

Each day is ~4 hours of focused work. Adjust to your actual calendar.

### Day 1 — Unblock everything

**Morning:**
- [ ] Create Google Shared Drive `Video Factory`
- [ ] Add Flemingo service account as Content Manager
- [ ] Create subfolders: `Music Uploads/`, `Music Processed/`, `brands/nordpilates/`, `brands/ketoway/`, `brands/carnimeat/`, plus `brands/{x}/processed/` for each
- [ ] Move the 15 MP3s into the new `Music Uploads/`
- [ ] Capture all new folder IDs

**Afternoon:**
- [ ] Update S7 workflow: swap folder IDs, enable "Include Shared Drives" option, delete the OAuth and second-service-account credentials, standardize on Flemingo service account
- [ ] Delete S4, S5, S6, P3 from active workflows (just toggle Active: false — don't delete files)
- [ ] Fix P4 filter to match both `delivered` and `failed`
- [ ] Fix S1 `row_number: 0` bug and JSON escaping
- [ ] Run S7 manually → verify 15 tracks land in R2 + Supabase + Music Library sheet

**End-of-day verification:** `SELECT COUNT(*) FROM music_tracks;` returns 15. R2 has `music/*.mp3`. Music Library sheet has 15 rows with filled Track ID + R2 Key + Duration.

### Day 2 — Build S8 and ingest first UGC

**Morning:**
- [ ] Add `POST /ugc-ingest` endpoint to `src/index.ts`, wrapping existing `ingestion.ts` worker
- [ ] Deploy to VPS, test endpoint with curl against a local video file
- [ ] Verify asset insertion into `assets` table with all fields populated

**Afternoon:**
- [ ] Build S8 workflow in n8n, modeled on S7 structure
- [ ] Drop 5 UGC clips into `Video Factory/brands/nordpilates/` on the Shared Drive
- [ ] Run S8 manually → verify clips land in R2 + `assets` table with Gemini tags

**End-of-day verification:** `SELECT id, brand_id, content_type, quality_score FROM assets WHERE brand_id='nordpilates';` returns 5 rows with non-null content_type and quality_score.

### Day 3 — Seed brands and caption presets

**Morning:**
- [ ] Write `scripts/seed-brand.ts` taking a JSON file → inserts into `brand_configs`
- [ ] Manually write 3 brand JSON files (nordpilates, ketoway, carnimeat) including hardcoded caption preset JSON, voice guidelines, allowed_video_types (just `tips-listicle` for MVP), color_grade_preset
- [ ] Run seed script → verify 3 rows in `brand_configs`
- [ ] Upload logos to R2 manually via `aws s3 cp` or the existing R2 client

**Afternoon:**
- [ ] Simplify Jobs tab: hide unused columns (CTA Text, Template, QA Notes, QA Reviewed By, Video Type, Created At, Completed At), add dropdown validation for Brand (3 options) and QA Issues (multi-select: clip_quality, audio_sync, timing, branding)
- [ ] Update S1 validation to query `brand_configs` for allowed brands instead of hardcoded string
- [ ] Delete Brands, Caption Presets, Templates tabs (or mark them archive)

**End-of-day verification:** Jobs tab has 13 visible columns. Dropdowns work. S1 validates against real brand_configs table.

### Day 4 — First end-to-end test (ugly version)

**Disable quality phases that depend on untested data:**
- Set feature flags for Phase 2 (beat sync), Phase 5 (color grading), Phase 6 (music selection), Phase 7 (dynamic pacing) to OFF via env vars or a config table.
- Keep Phase 3 (audio ducking) and Phase 4 (CRF 18) ON — they're universal improvements and don't need training data.
- For music, hardcode a single track per video type (`tips-listicle` → pick one track from the 15 ingested, always use it).

**Morning:**
- [ ] Add the feature flags to `context-packet.ts` and relevant workers
- [ ] Deploy, restart service
- [ ] In the Jobs sheet, create a single job: Brand=`nordpilates`, Idea Seed=`"3 mistakes people make with pilates warmups"`
- [ ] Wait for S1 → verify status reaches `brief_review` within 2 minutes
- [ ] Review the brief in the Sheet, approve it

**Afternoon:**
- [ ] Monitor VPS logs (`journalctl -u video-factory -f`) as rendering runs
- [ ] Expect failure. Debug. Iterate.
- [ ] Track time-per-phase: clip prep, transcription, render, audio mix, export

**Success criterion:** One video, any quality, reaches `human_qa` state with a preview URL in the Sheet. Watch it. It will probably look rough. That's fine.

### Day 5 — Fix whatever broke on Day 4

Reserved entirely for unknown bugs. Every first run of a complex pipeline surfaces something.

Most likely failure modes to watch for:
- Remotion render timeout (CX22 has 2 vCPU — slow preset might be too slow; fall back to `medium` for MVP if needed)
- whisper.cpp OOM on longer clips (4GB RAM is tight)
- R2 upload failures due to missing `forcePathStyle`
- Supabase row-level update races between P1 webhook and P2 poll
- Context packet JSON too large for a single Supabase update (rare but possible)

Document every fix. Update CLAUDE.md with real numbers (actual render time, actual RAM usage).

### Day 6 — Second video, second brand

- [ ] Ingest 5 UGC clips for `ketoway`
- [ ] Run a ketoway job end-to-end
- [ ] Compare quality to nordpilates video
- [ ] Note any brand-specific issues (caption preset mismatch, logo overlay position wrong, etc.)

### Day 7 — Stabilize + decide what quality phases to enable

- [ ] Review the 2 real videos objectively. What looks bad?
- [ ] Pick the ONE quality phase most likely to fix the worst problem. Enable only that. Re-render both videos.
- [ ] Compare. If better, keep. If worse, roll back.
- [ ] Write a one-page "what we shipped" retro. Update CLAUDE.md status section.

**End-of-week success:** 2 real videos delivered. Pipeline is observably working. You know empirically which quality phases help and which are theoretical.

---

## Part 6 — Post-MVP roadmap

Once the MVP is stable (first ~10 real videos delivered):

### Phase A — Harden

- Fix S1 race conditions properly (move enqueue to Supabase trigger or add idempotency)
- Add webhook auth to P1
- Add `max_rejection_count` enforcement to S2
- Build a real operator dashboard (Supabase Realtime + tiny React page, or keep Sheets if it works)
- Migrate Redis to self-hosted on n8n VPS
- Scale VPS to CX32 (4 vCPU, 8GB RAM) — CX22 will bottleneck on concurrent renders

### Phase B — Re-enable quality phases one at a time

Order of re-enablement, based on which is most likely to help and least likely to break:
1. Phase 6 (music selection) — but only after mood/energy tagging is populated
2. Phase 7 (dynamic pacing) — read template_config in layouts
3. Phase 2 (beat sync) — depends on Phase 6 being solid
4. Phase 5 (color grading) — risky, test on 5 videos before keeping
5. Phase 1 (ingestion enrichment) — needs to reprocess old clips
6. Phase 0 (video type matrix) — expand from 1 type to 4

For each phase: re-enable, render 3 test videos, compare to baseline, decide.

### Phase C — Scale brands and workflows

- Rebuild S4 (Brand Config) with the simplified 8-column tab
- Rebuild S5 (Caption Preset) with matching schema
- Add remaining brands one at a time via seed script
- Add a UGC ingestion rate limiter (30 brands × clips/week could overwhelm Gemini API budget)

### Phase D — Quality Director Agent

Now that real failure modes exist, build the QA agent with a concrete taxonomy. Cut from MVP was correct — you literally couldn't write the prompt before you had real failures to train it on.

### Phase E — A/B performance tracking

Add `performance_metrics` table, integrate with TikTok/Instagram analytics APIs, feed back into agent prompts.

---

## Part 7 — What I like and what I don't

### What I like about the current build

- **Event-driven workflow architecture with Supabase as source of truth.** This is correctly designed. n8n restarts lose nothing, state is always recoverable, rejection loops don't corrupt. The architectural instinct here is right.
- **Drive as drop zone only.** Avoiding the Drive API in the render path is correct — the current credential issue is proof of why.
- **Context Packet as an immutable artifact.** Passing a single JSON through the pipeline is simple and debuggable.
- **Quality upgrade code is written cleanly.** The modular phase structure in `src/lib/` (beat-detector, color-grading, music-selector, template-config-builder) means each feature can be flag-gated independently. That's exactly what you need to defer them for MVP.
- **BullMQ for the queue, not n8n's internal queue.** Correct call.
- **whisper.cpp self-hosted.** Correct call.
- **The 4-video-type matrix** (workout-demo, recipe-walkthrough, tips-listicle, transformation). The thinking is right even though I'm suggesting MVP starts with 1.

### What I don't like

- **Over-engineering for a first-video state.** Phases 0–7 were built before a single video had rendered. That's building the second floor before the foundation has set.
- **Too many Google credentials.** Three different credentials across 11 workflows. One service account is all you need.
- **Sheet schemas drifted from workflow expectations** on at least two tabs (Caption Presets, Music Library). This happened because nobody ran the workflows against real data. The Day 4 test will catch more of these.
- **No UGC ingestion workflow exists** despite being the most fundamental input to the pipeline. This should have been built before music ingest. It's the biggest gap in the 11-workflow set.
- **Music Library has zero real tracks** but music selection logic is already coded. Classic "data-empty feature" anti-pattern.
- **20-column Jobs tab** when the operator actually cares about 5 fields (brand, idea, review decision, QA decision, preview URL). Bloat for no reason.
- **24-column Brands tab** handed to a graphic designer as an input surface. This will never work — designers design, they don't data-enter.
- **Upstash drainDelay of 30s** on a free tier with 500k/mo limit. Whoever set this didn't do the math. (It's fine, it's one line to fix — just pointing it out as a pattern: small operational details can kill free tiers silently.)
- **CLAUDE.md claims "all deployed"** for quality phases that have never touched a real video. The word "deployed" is doing a lot of work here — code is on the VPS, but it's never actually run against reality. That's a dangerous kind of "done."
- **Quality Director agent was correctly cut**, but the QUALITY_UPGRADE_PLAN doc still lists it. Clean up the doc.

### Things to simplify deeply

1. **One video type for MVP, not four.** `tips-listicle` is the most forgiving — medium pacing, any footage works, energy curve is flat. Pick this. Ship. Add others after first video.
2. **Seed brands via SQL, not via Sheets.** Three brands, three JSON files, one script. Done in 30 minutes.
3. **Hardcode one music track per video type for MVP.** Don't even use the selector. Pick one energetic track, use it for every nordpilates video. Pick one chill track for ketoway. Done.
4. **One Sheet tab visible to operator: Jobs.** Hide all others behind a "setup" sheet the operator never touches.
5. **Feature flags for all quality phases.** Default off. Enable one at a time. Measure.

---

## Part 8 — Updated infrastructure summary

### Services

| Service | Host | Purpose | MVP cost |
|---|---|---|---|
| n8n | Hetzner (existing, 46.224.56.174) | Orchestration | $0 (existing) |
| VPS | Hetzner CX22 (95.216.137.35) | Workers + API | $4.50 |
| Supabase | Managed (free tier) | State + assets catalog | $0 |
| Upstash Redis | Managed (free tier, drainDelay 120s) | BullMQ queue | $0 |
| Cloudflare R2 | Managed | Media storage | ~$1 |
| Claude API | Managed | 3 agents per video | ~$1 at MVP volume |
| Gemini API | Managed | Clip analysis | ~$0.10 at MVP volume |
| **Total MVP** | | | **~$7/mo** |

**Note:** MVP volume is ~10 videos/week, so Claude and Gemini costs scale down proportionally from the full-target estimates. Scaling to 150/week puts Claude at ~$4–15/mo depending on token counts.

### Credentials to standardize

Delete these:
- `9mzs7zcG6Z9TIcku` ("ai@flmng.ai" OAuth)
- `jPzsu3UPPrZc0kge` ("Google Service ACC")

Keep:
- `AIqzMYUXoQjud7IW` ("Flemingo service acc") — used for ALL Google Drive and Sheets operations
- `l66cV4Gj1L3T6MjJ` ("Strapi API Token") — used for Supabase HTTP auth

After standardization, every Google node in every workflow uses the same service account. One thing to rotate, one thing to audit.

### Env vars (no changes needed, just documenting)

VPS `.env` is already configured. The only new variable to add is feature flags:

```
# Quality phase feature flags (MVP defaults)
ENABLE_BEAT_SYNC=false
ENABLE_COLOR_GRADING=false
ENABLE_MUSIC_SELECTION=false
ENABLE_DYNAMIC_PACING=false
ENABLE_INGESTION_ENRICHMENT=true  # Keep — ingestion-time only, low risk
ENABLE_AUDIO_DUCKING=true         # Universal improvement
ENABLE_CRF18_ENCODING=true        # Universal improvement
FALLBACK_MUSIC_TRACK_ID=<uuid>    # Hardcoded for MVP
```

---

## Part 9 — Reference: file changes summary

Files to modify:
- `src/index.ts` — add `POST /ugc-ingest` endpoint
- `src/config/redis.ts` — `drainDelay: 120`
- `src/workers/*.ts` — apply `drainDelay` to all BullMQ Worker constructors
- `src/agents/context-packet.ts` — feature-flag quality phase calls
- `src/config/env.ts` — add feature flag env vars
- `scripts/seed-brand.ts` — new file, takes brand JSON, inserts into Supabase

Files to leave alone:
- Everything in `src/lib/` (beat-detector, color-grading, etc.) — feature-flagged at the caller level
- Remotion templates — they'll be exercised only when feature flags enable them
- Existing tests — still valid against synthetic data

Workflow changes in n8n:
- S1: fix `row_number: 0`, fix JSON escaping, switch brand validation to Supabase query
- S7: swap folder IDs, consolidate credentials, enable Shared Drives option
- S8: create new workflow following S7 pattern for UGC
- P4: fix `delivered/failed` filter
- S4, S5, S6, P3: deactivate

Supabase:
- No schema changes needed
- Data: seed 3 brand_configs rows via `scripts/seed-brand.ts`
- Data: after S7 runs, tag 15 music tracks with mood/energy manually via SQL or the sheet

Google Drive:
- Create Shared Drive `Video Factory` + subfolders
- Move existing MP3s in
- Share with Flemingo service account as Content Manager

Google Sheets:
- Jobs tab: reduce to 13 visible columns, add Brand + QA Issues dropdowns
- Hide/delete Brands, Caption Presets, Templates tabs
- Keep Music Library as read-only view (strip stale columns)
- Dashboard tab: keep formulas, skip P3

---

## Part 10 — Success criteria

**End of Day 1:** S7 runs green. 15 tracks in Supabase + R2.

**End of Day 2:** S8 runs green. 5 UGC clips ingested for nordpilates.

**End of Day 3:** 3 brands seeded. Jobs tab operator-ready.

**End of Day 4:** Status: `brief_review` reached for first real job. First attempt at render.

**End of Day 5:** At least one end-to-end video in `human_qa` with a watchable preview URL. Quality doesn't matter. Completeness does.

**End of Day 7:** 2 real videos delivered. Observability adequate. Clear list of next-priority quality phases based on real failures.

If Day 4 doesn't reach `brief_review`, something is structurally wrong and the plan needs a pivot — not more phases.

---

*End of v3 architecture document. Hand this to the coding agent along with the existing source tree. Start with Part 2 fixes in order.*
