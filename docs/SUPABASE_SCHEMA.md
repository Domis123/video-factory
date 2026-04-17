# Supabase Schema Reference

**Project:** Video Factory
**Supabase URL:** `https://kfdfcoretoaukcoasfmu.supabase.co`
**Last updated:** 2026-04-17
**Status:** Mixed — some tables fully verified via SQL inspection, others inferred from code/migrations

**Verification key:**
- ✅ Verified via `information_schema.columns` query or production query
- ⚠️ Inferred from code/migrations, needs verification
- 🔮 Speculative, derived from filename or single reference

---

## How to verify any table

If a table below is marked ⚠️ or 🔮, run this against Supabase to get ground truth:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'TABLE_NAME_HERE'
ORDER BY ordinal_position;
```

Or to list all tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

---

## Tables (from screenshot taken 2026-04-14)

The Supabase UI showed these tables and views:

**Tables:**
- `asset_segments`
- `assets`
- `brand_configs`
- `job_events`
- `jobs`
- `music_tracks`

**Views:**
- `v_active_jobs` (UNRESTRICTED)
- `v_brand_stats` (UNRESTRICTED)
- `v_stale_jobs` (presumed)

---

## ✅ jobs (verified 2026-04-14)

Primary table for video generation lifecycle. Each row = one video request.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `status` | USER-DEFINED | Enum: `queued`, `planning`, `brief_review`, `clip_prep`, `transcription`, `rendering`, `audio_mix`, `sync_check`, `platform_export`, `auto_qa`, `human_qa`, `delivered`, `failed` (and possibly more) |
| `idea_seed` | text | Operator-typed video idea |
| `context_packet` | jsonb | The full creative brief. Source of truth for everything downstream. |
| `brief_summary` | text | Short text summary. **Updated post-W1 to format `{video_type} | {template_id} | {duration}s | {N} segments`** (was `{template_id} | {duration}s | {N} segments` pre-W1; historical rows backfilled by SQL on 2026-04-15). |
| `full_brief` | text | **Phase 2 cleanup:** Human-readable formatted dump for operator review. Populated by `runPlanning` on planning completion. ~3000 chars typical. |
| `hook_text` | text | Selected hook variant text |
| `cta_text` | text | CTA text |
| `template_id` | varchar | Currently `"hook-demo-cta"`. Will be `"phase3-parameterized-v1"` in Phase 3 W4 outputs. |
| `clip_selections` | jsonb | Curator output |
| `copy_package` | jsonb | Copywriter output |
| `review_decision` | varchar | `approve`, `reject`, or null |
| `rejection_notes` | text | Operator notes on rejection |
| `rejection_count` | int | Count of rejections for this job |
| `render_worker_id` | varchar | Currently always `worker-1` |
| `render_started_at` | timestamptz | |
| `render_completed_at` | timestamptz | |
| `rendered_video_r2_key` | text | R2 path of master rendered MP4 |
| `preview_url` | text | Pre-signed R2 URL for sheet preview (24h TTL) |
| `auto_qa_results` | jsonb | 8 automated QA check results |
| `auto_qa_passed` | boolean | True if all 8 passed |
| `qa_decision` | varchar | Operator's QA decision |
| `qa_issues` | jsonb | Operator-flagged issues |
| `qa_notes` | text | Operator notes |
| `qa_reviewed_by` | varchar | Operator identifier |
| `qa_reviewed_at` | timestamptz | |
| `final_outputs` | jsonb | Per-platform R2 paths: tiktok, instagram, youtube |
| `metadata_sidecar` | jsonb | TBD |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `video_type` | text | Loose classification, used for analytics. **Post-W1 fix: now actually written by `runPlanning` (was being dropped pre-W1, see job c83c31dc with video_type=null).** Phase 3 CD will pick it; Phase 2 path uses `selectVideoType()`. |

**Phase 3 future additions (planned, not yet in schema):**
- May add `vibe` column or pass through context_packet — TBD when vibe param plumbing ships (deferred from W1)
- `composition_id` will replace or supplement `template_id` for Phase 3 W4 outputs

---

## ✅ job_events (verified 2026-04-14)

Audit log of state transitions per job. Useful for debugging timing, retry analysis, replay.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint | PK, autoincrement |
| `job_id` | uuid | FK to jobs.id |
| `from_status` | varchar | Previous job status |
| `to_status` | varchar | New job status |
| `event_type` | varchar | Currently observed: `state_transition` |
| `details` | jsonb | Event-specific data |
| `created_at` | timestamptz | |

---

## ⚠️ asset_segments (inferred, partially verified via Phase 1/2/W5 work)

Sub-clip segments extracted from parent UGC clips. Created by Gemini Pro segment analyzer at ingestion time.

**Row count post-W5 clean-slate + first sprint ingestion (2026-04-16):**
- 12 rows for nordpilates (first W5 production ingestion verified via production query 2026-04-16)
- Additional rows accruing through 2026-04-16+ content sprint

**Pre-W5:** 182 rows for nordpilates. All dropped via cascade on 2026-04-16.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `asset_id` | uuid | FK to assets.id (parent clip). **ON DELETE CASCADE verified 2026-04-16.** |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `start_s` | numeric | Start timestamp in parent clip |
| `end_s` | numeric | End timestamp in parent clip |
| `segment_type` | text | Enum: 8 types per Phase 1 taxonomy |
| `description` | text | Gemini's natural-language description |
| `editor_use` | text | How a video editor would use this segment |
| `motion_intensity` | int | 1-10 |
| `quality_score` | int | 1-10, Gemini's quality assessment |
| `tags` | text[] | 5-10 visual tags |
| `embedding` | vector(512) | CLIP ViT-B/32 embedding |
| `clip_r2_key` | text | **Phase 2.5 + W5:** R2 path to 720p CRF 28 segment clip. Post-W5: cut from 1080p normalized parent (not raw 4K). |
| `created_at` | timestamptz | |

**Post-W5 behavior:** all new `clip_r2_key` values point at clips trimmed from 1080p normalized parents. Post-W5 first production ingestion verified 12/12 rows have `clip_r2_key` + `embedding` populated (zero partial-write failures).

**Indexes:**
- `embedding` previously had ivfflat index, was DROPPED at small table size (Architecture Rule 23). Sequential scan is faster until ~1000 rows.
- **After content sprint completes and library grows past ~1000 rows, revisit ivfflat recreation with `lists ≈ rows/1000`.**

**RPC:** `match_segments(query_embedding TEXT, brand_filter TEXT, type_filter TEXT[], limit INT, candidates INT)` — see migration 005.

---

## ✅ assets (partially verified 2026-04-16, post-W5)

Parent UGC video files uploaded to R2.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `r2_key` | text | R2 path to original raw parent file (archival). `assets/{brand_id}/{uuid}.{ext}` |
| `pre_normalized_r2_key` | text | ✅ **Added 2026-04-16 via migration 007 (Phase 3 W5).** R2 path to 1080×1920 30fps H.264 normalized version. `parents/normalized/{brand_id}/{uuid}.mp4`. NULL on pre-W5 rows (none currently — all dropped in clean-slate). |
| `filename` | text | Original filename |
| `duration_s` | numeric | Total duration (column exists but note: actual column name in production schema may be `duration_seconds` — needs verification) |
| `analyzed_at` | timestamptz | When Gemini Flash analyzed it (legacy ingestion — scheduled for removal at Milestone 3.3) |
| `analysis` | jsonb | Legacy Gemini Flash analysis (scheduled for removal at Milestone 3.3) |
| `created_at` | timestamptz | |

**Row count post-W5 clean-slate + first sprint ingestion:**
- 1 nordpilates asset (`22dba651-c4a9-4a51-a97a-9fa95cf3a208`, NP_concept_17.MOV, ingested 2026-04-16)
- Additional rows accruing through 2026-04-16+ content sprint

**Pre-W5:** 53 nordpilates rows. All deleted via clean-slate script (`DELETE FROM assets WHERE brand_id='nordpilates'`; cascade dropped 182 asset_segments rows). Re-ingesting through new W5 pipeline.

---

## ⚠️ brand_configs (inferred from observed `brand_config` jsonb in jobs.context_packet)

Per-brand configuration: branding, colors, voice, content rules.

| Column | Type | Notes |
|---|---|---|
| `brand_id` | varchar | PK |
| `brand_name` | text | Human-readable name |
| `active` | boolean | |
| `cta_style` | text | E.g. `"link-in-bio"` |
| `font_family` | text | E.g. `"Montserrat"` |
| `logo_r2_key` | text | R2 path to brand logo |
| `accent_color` | text | Hex |
| `cta_bg_color` | text | Hex |
| `primary_color` | text | Hex |
| `secondary_color` | text | Hex |
| `cta_text_color` | text | Hex |
| `caption_preset` | jsonb | Full caption rendering config |
| `content_pillars` | text[] | E.g. `["pilates", "flexibility", ...]` |
| `color_lut_r2_key` | text | Reserved for color grading LUT, currently null |
| `font_weight_body` | int | |
| `font_weight_title` | int | |
| `transition_style` | text | E.g. `"fade"` |
| `voice_guidelines` | text | Multi-paragraph brand voice instructions for Copywriter |
| `watermark_r2_key` | text | Currently null |
| `watermark_opacity` | numeric | |
| `watermark_position` | text | |
| `color_grade_preset` | text | E.g. `"warm-vibrant"` |
| `allowed_video_types` | text[] | **Updated 2026-04-15** to multi-type per brand (was single-type from MVP simplicity). nordpilates: `['workout-demo','tips-listicle','transformation']`, carnimeat: `['recipe-walkthrough','tips-listicle','transformation']`, highdiet: `['workout-demo','tips-listicle','transformation']`, ketoway/nodiet: unchanged. |
| `allowed_color_treatments` | text[] \| null | ✅ **Added 2026-04-15 via migration 006 (Phase 3 W1).** NULL = no restriction. nordpilates and carnimeat backfilled with 5 treatments each (see PHASE_3_DESIGN.md). |
| `drive_input_folder_id` | text | Google Drive folder for ingestion |
| `drive_output_folder_id` | text | Google Drive folder for delivery |
| `hook_style_preference` | text[] | E.g. `["pop-in", "slide-up"]` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Phase 3 future additions (planned, not yet in schema):**
- Possibly `default_pacing_preference`, `preferred_transition_styles`, `vibe_keywords_blocklist`, `slot_count_range` (deferred to Phase 3.5 W6)

---

## ⚠️ music_tracks (inferred)

Music library available to videos.

| Column | Type | Notes |
|---|---|---|
| `id` / `track_id` | uuid | PK |
| `r2_key` | text | R2 path |
| `filename` | text | |
| `duration_seconds` | numeric | Provided by ffprobe at ingestion |
| `tempo_bpm` | int | |
| `mood` | text | E.g. `"energetic"`, `"calm"`, `"uplifting"`, `"intense"` |
| `energy_level` | int | 1-10 |
| `times_used` | int | Counter |
| `created_at` | timestamptz | |

~15 tracks as of Phase 2.5.

**Phase 3 will allow** CD to pin specific track via `audio.music.pinned_track_id`. Phase 4 will add beat detection for beat-locked cuts.

---

## 🔮 Views (UNRESTRICTED)

- `v_active_jobs` — probably `SELECT * FROM jobs WHERE status NOT IN ('delivered', 'failed')` for n8n P2 sync
- `v_brand_stats` — aggregations per brand for P3 Dashboard
- `v_stale_jobs` — probably jobs stuck in non-terminal status for >N hours

---

## RPCs (Postgres functions)

### ✅ apply_migration_sql(query text) RETURNS void

Created during Phase 2 cleanup. SECURITY DEFINER, service_role only. Allows `supabase-js` to apply DDL via `rpc('apply_migration_sql', { query: sqlContents })`.

```sql
CREATE OR REPLACE FUNCTION public.apply_migration_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  EXECUTE query;
END;
$$;
```

Used by `src/scripts/apply-migration.ts` for migrations 005, 006.

### ✅ match_segments(query_embedding TEXT, brand_filter TEXT, type_filter TEXT[], limit INT, candidates INT)

Vector similarity search. Takes embedding as TEXT (cast to vector internally).

Used by `src/agents/curator-v2-retrieval.ts`.

---

## Migrations applied

| # | File | Status | Purpose |
|---|---|---|---|
| 001 | `001_asset_segments.sql` | Applied (Phase 1) | Create asset_segments table + ivfflat index |
| 002 | `002_asset_segments_type.sql` | Applied (Phase 1) | Add segment_type column |
| 003 | `003_match_segments_function.sql` | Applied (Phase 1) | Initial match_segments RPC |
| 004 | `004_asset_segments_clip_key.sql` | Applied (Phase 2.5) | Add clip_r2_key |
| 004 | `004_add_full_brief_column.sql` | Applied (Phase 2 cleanup) | Add full_brief (numbering collision; touches different table — no conflict) |
| 005 | `005_match_segments_with_clip_key.sql` | Applied | Updated RPC (DROP+CREATE per Architecture Rule 22) |
| 006 | `006_brand_configs_color_treatments.sql` | ✅ **Applied 2026-04-15 (Phase 3 W1)** | Add allowed_color_treatments TEXT[] + backfill nordpilates and carnimeat |
| 007 | `007_pre_normalized_clips.sql` | ✅ **Applied 2026-04-16 (Phase 3 W5)** | Add pre_normalized_r2_key TEXT to assets. Nullable, no default, no backfill (clean-slate drop). |

---

## Manual SQL changes (not in migrations)

| Date | Change | Reason |
|---|---|---|
| 2026-04-15 | `brand_configs.allowed_video_types` updated for nordpilates, carnimeat, highdiet to multi-type arrays | MVP single-type lock was simplicity, not strategy. Updated to enable Phase 3 video_type variety. |
| 2026-04-15 | `jobs.brief_summary` backfilled to new `{video_type} \| {template_id} \| {duration}s \| {N} segments` format for ~6 historical rows | Format alignment after W1 changed `runPlanning`'s output format. |
| 2026-04-16 | **Clean-slate drop (W5):** `DELETE FROM assets WHERE brand_id='nordpilates'` (53 rows → 0, cascade dropped 182 `asset_segments` rows) | Pre-sprint cleanup per Architecture Rule 28. Scripted via `src/scripts/clean-slate-nordpilates.ts`. |
| 2026-04-16 | **R2 prefix deletion (W5):** purged `assets/nordpilates/`, `segments/nordpilates/`, `keyframes/nordpilates/`, `parents/normalized/nordpilates/` + carnimeat test debris | Mirror of DB clean-slate. Same script as above. |
| 2026-04-17 | `ENABLE_PHASE_3_CD` flipped to `true` on VPS `.env` | Phase 3 live. First production video rendered (job `fe34b673`). No DB schema changes — flag is in `.env`. |

---

## RLS (Row-Level Security) policies

Architecture Rule 17: "Supabase needs permissive RLS policies for anon writes OR service role key."

Workers use service role key (bypasses RLS).
n8n uses anon key (subject to RLS).

Verify with:

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';
```

---

## Connection details

```
SUPABASE_URL=https://kfdfcoretoaukcoasfmu.supabase.co
SUPABASE_ANON_KEY=...     (in .env, also hardcoded in n8n workflow JSONs)
SUPABASE_SERVICE_KEY=...  (service role, bypasses RLS, used by VPS worker only)
```

pgvector extension enabled (required for asset_segments.embedding).

---

## What this doc is NOT

- Not a complete RLS policy reference
- Not a complete RPC function reference (only the two most-used)
- Not authoritative for inferred (⚠️) tables — verify before relying

For any question marked ⚠️ or 🔮, run the verification SQL above instead of trusting this doc.

---

## How to extend this doc

When new tables/columns/RPCs are added during Phase 3 W2-W5 work, add them here with ✅ verification status. Keep planned notes inline so future sessions can see what's intentionally upcoming vs what's actually shipped.
