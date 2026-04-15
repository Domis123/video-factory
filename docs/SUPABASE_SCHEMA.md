# Supabase Schema Reference

**Project:** Video Factory
**Supabase URL:** `https://kfdfcoretoaukcoasfmu.supabase.co`
**Last updated:** 2026-04-15
**Status:** Mixed — some tables fully verified via SQL inspection, others inferred from code/migrations and need verification

**Verification key:**
- ✅ Verified via `information_schema.columns` query
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
| `context_packet` | jsonb | The full creative brief (CD output + curator output + copywriter output + brand_config snapshot + music selection). Source of truth for everything downstream. |
| `brief_summary` | text | Short text summary like `"hook-demo-cta \| 38s \| 5 segments"` |
| `full_brief` | text | **NEW (Phase 2 cleanup):** Human-readable formatted dump of context_packet for operator review in sheet. ~3000 chars typical. Populated by worker on planning completion. |
| `hook_text` | text | Selected hook variant text |
| `cta_text` | text | CTA text |
| `template_id` | varchar | Currently `"hook-demo-cta"`. Will be `"phase3-parameterized-v1"` in Phase 3. |
| `clip_selections` | jsonb | Curator output: which segments picked per slot, with trim windows, scores, rationales |
| `copy_package` | jsonb | Copywriter output: hook variants, captions per platform, hashtags per platform, overlay text |
| `review_decision` | varchar | `approve`, `reject`, or null |
| `rejection_notes` | text | Operator notes on rejection |
| `rejection_count` | int | Count of rejections for this job |
| `render_worker_id` | varchar | Which worker picked up render (currently always `worker-1`) |
| `render_started_at` | timestamptz | |
| `render_completed_at` | timestamptz | |
| `rendered_video_r2_key` | text | R2 path of master rendered MP4 |
| `preview_url` | text | Pre-signed R2 URL for sheet preview (24h TTL) |
| `auto_qa_results` | jsonb | 8 automated QA check results |
| `auto_qa_passed` | boolean | True if all 8 passed |
| `qa_decision` | varchar | Operator's QA decision (`approve`/`reject`) |
| `qa_issues` | jsonb | Operator-flagged issues |
| `qa_notes` | text | Operator notes |
| `qa_reviewed_by` | varchar | Operator identifier |
| `qa_reviewed_at` | timestamptz | |
| `final_outputs` | jsonb | Per-platform R2 paths: tiktok, instagram, youtube |
| `metadata_sidecar` | jsonb | TBD — currently null in observed rows |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `video_type` | text | Loose classification, used for analytics. Currently set by Creative Director. |

**Phase 3 additions (planned, not yet in schema):**
- May add `vibe` column or pass through context_packet — TBD during W1
- `composition_id` will replace or supplement `template_id` for Phase 3 outputs

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
| `details` | jsonb | Event-specific data: render time, clip count, sync drift, QA results, etc. |
| `created_at` | timestamptz | |

---

## ⚠️ asset_segments (inferred, partially verified via Phase 1/2 work)

Sub-clip segments extracted from parent UGC clips. Created by Gemini Pro segment analyzer at ingestion time. 182 rows for nordpilates as of Phase 2.5.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `asset_id` | uuid | FK to assets.id (parent clip) |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `start_s` | numeric | Start timestamp in parent clip |
| `end_s` | numeric | End timestamp in parent clip |
| `segment_type` | text | Enum or text: `exercise`, `hook`, `transition`, `b-roll`, `talking-head`, `setup`, `closing`, possibly more (8 types per Phase 1) |
| `description` | text | Gemini's natural-language description of the segment |
| `editor_use` | text | How a video editor would use this segment |
| `motion_intensity` | int | 1-10 |
| `quality_score` | int | 1-10, Gemini's quality assessment |
| `tags` | text[] | 5-10 visual tags |
| `embedding` | vector(512) | CLIP ViT-B/32 embedding for retrieval |
| `clip_r2_key` | text | **Phase 2.5:** R2 path to pre-trimmed segment clip (~720p). Populated for all 182 rows. |
| `created_at` | timestamptz | |

**Phase 3 W5 will add:**
- Either replace or supplement `clip_r2_key` to point at clips trimmed from pre-normalized 1080p parents
- Existing 182 rows will be DROPPED (clean-slate ingestion per design decision)

**Indexes:**
- `embedding` previously had ivfflat index, was DROPPED at small table size (Architecture Rule 23). Sequential scan is faster until ~1000 rows.

**RPC:** `match_segments(query_embedding TEXT, brand_filter TEXT, type_filter TEXT[], limit INT, candidates INT)` — returns top-N candidates by cosine distance. Documented in migration 005. Takes embedding as TEXT, casts internally.

---

## ⚠️ assets (inferred, parent UGC clips)

Parent UGC video files uploaded to R2. Each row = one source clip from operator's UGC library.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `r2_key` | text | R2 path to original parent file |
| `pre_normalized_r2_key` | text | **Phase 3 W5 will add:** R2 path to 1080p H.264 normalized version |
| `filename` | text | Original filename |
| `duration_s` | numeric | Total duration |
| `analyzed_at` | timestamptz | When Gemini Flash analyzed it (legacy ingestion) |
| `analysis` | jsonb | Legacy Gemini Flash analysis — no longer the primary use |
| `created_at` | timestamptz | |

**Notes:**
- 53 rows for nordpilates as of Phase 2.5 (was 54 before one black-screen clip was deleted in Phase 1)
- Legacy `analysis` column from Gemini Flash era. New flow uses `asset_segments` instead.
- Phase 3 W5 will pre-normalize parent on ingestion → 1080p H.264 → upload to `parents/normalized/{brand}/{asset_id}.mp4`

---

## ⚠️ brand_configs (inferred from observed `brand_config` jsonb in jobs.context_packet)

Per-brand configuration: branding, colors, voice, content rules.

| Column | Type | Notes |
|---|---|---|
| `brand_id` | varchar | PK, e.g. `"nordpilates"`, `"carnimeat"`, `"welcomebaby"`, `"nodiet"`, `"ketoway"` |
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
| `caption_preset` | jsonb | Full caption rendering config (font_size, animation, position, etc.) |
| `content_pillars` | text[] | E.g. `["pilates", "flexibility", "wellness", "mindful movement"]` |
| `color_lut_r2_key` | text | Reserved for color grading LUT, currently null |
| `font_weight_body` | int | |
| `font_weight_title` | int | |
| `transition_style` | text | E.g. `"fade"` |
| `voice_guidelines` | text | Multi-paragraph brand voice instructions for Copywriter |
| `watermark_r2_key` | text | Currently null |
| `watermark_opacity` | numeric | |
| `watermark_position` | text | |
| `color_grade_preset` | text | Currently like `"warm-vibrant"` — tied to a single preset per brand |
| `allowed_video_types` | text[] | Brand-restricted video types, e.g. `["tips-listicle"]` |
| `allowed_color_treatments` | text[] | Brand-restricted subset of the 8 Phase 3 color treatments. NULL = no restriction (all 8 allowed). Added in migration 006. |
| `drive_input_folder_id` | text | Google Drive folder for ingestion (currently null) |
| `drive_output_folder_id` | text | Google Drive folder for delivery (currently null) |
| `hook_style_preference` | text[] | E.g. `["pop-in", "slide-up"]` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Phase 3 may add later:**
- Possibly `default_pacing_preference`, `preferred_transition_styles`, `vibe_keywords_blocklist`, `slot_count_range` (deferred to Phase 3.5 W6)

**Verified values for `allowed_color_treatments` (backfilled by migration 006):**
- `nordpilates` = `["warm-vibrant", "soft-pastel", "golden-hour", "natural", "cool-muted"]`
- `carnimeat` = `["high-contrast", "warm-vibrant", "moody-dark", "natural", "clean-bright"]`
- `welcomebaby`, `nodiet`, `ketoway`, `highdiet` = NULL (treated as "all 8 allowed")

---

## ⚠️ music_tracks (inferred)

Music library available to videos. Selected by music selector based on mood + energy_level.

| Column | Type | Notes |
|---|---|---|
| `id` / `track_id` | uuid | PK (column name to verify) |
| `r2_key` | text | R2 path, e.g. `"music/DAME_UN_GRR_-_Pizza_Music__320k_.mp3"` |
| `filename` | text | |
| `duration_seconds` | numeric | Provided by ffprobe at ingestion |
| `tempo_bpm` | int | |
| `mood` | text | E.g. `"energetic"`, `"calm"`, `"uplifting"`, `"intense"` |
| `energy_level` | int | 1-10 |
| `times_used` | int | Counter, observed in selection log: `"Used: 4x"` |
| `created_at` | timestamptz | |

**Notes:**
- ~15 tracks as of Phase 2.5 docs
- Selection currently weighted random within matching mood + energy band
- Phase 3 will allow CD to pin specific track via `audio.music.pinned_track_id`
- Phase 4 will add beat detection (timestamps) for beat-locked cuts

---

## 🔮 Views (UNRESTRICTED)

Per the Supabase UI screenshot, three views exist. Purposes inferred from names:

- `v_active_jobs` — probably `SELECT * FROM jobs WHERE status NOT IN ('delivered', 'failed')` for n8n P2 sync
- `v_brand_stats` — aggregations per brand (counts by status, etc.) for P3 Dashboard
- `v_stale_jobs` — probably jobs stuck in non-terminal status for >N hours, for monitoring

Verify with:

```sql
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public';
```

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

Locked down: REVOKE from PUBLIC, anon, authenticated. GRANT EXECUTE TO service_role.

Used by `src/scripts/apply-migration.ts` for all Phase 3 migrations.

### ✅ match_segments(query_embedding TEXT, brand_filter TEXT, type_filter TEXT[], limit INT, candidates INT)

Vector similarity search for asset_segments. Documented in migration 005. Takes embedding as TEXT (cast to vector internally — don't change this signature).

Returns top-N candidates by cosine distance.

Used by `src/agents/curator-v2-retrieval.ts`.

---

## Migrations applied (history from `src/scripts/migrations/`)

| # | File | Status | Purpose |
|---|---|---|---|
| 001 | `001_asset_segments.sql` | Applied (Phase 1) | Create asset_segments table + ivfflat index |
| 002 | `002_asset_segments_type.sql` | Applied (Phase 1) | Add segment_type column |
| 003 | `003_match_segments_function.sql` | Applied (Phase 1) | Initial match_segments RPC |
| 004 | `004_asset_segments_clip_key.sql` | Applied (Phase 2.5) | Add clip_r2_key to asset_segments |
| 004 (Phase 2 cleanup) | `004_add_full_brief_column.sql` | Applied (Phase 2 cleanup) | Add full_brief TEXT to jobs |
| 005 | `005_match_segments_with_clip_key.sql` | Applied | Updated RPC to return clip_r2_key. Now includes DROP FUNCTION IF EXISTS for return-type changes (Architecture Rule 22) |
| 006 | `006_brand_configs_color_treatments.sql` | Applied (Phase 3 W1) | Add allowed_color_treatments TEXT[] to brand_configs, backfill nordpilates and carnimeat |
| 007 | `007_pre_normalized_clips.sql` | **Phase 3 W5, planned** | Add pre_normalized_r2_key TEXT to assets |

**Note on migration numbering collision:** Migration 004 number was used twice (Phase 2.5 added clip_key, Phase 2 cleanup added full_brief). They touch different tables so no actual conflict, but the numbering is inconsistent. Worth a cleanup pass during Phase 3 to renumber if needed.

---

## RLS (Row-Level Security) policies

Architecture Rule 17: "Supabase needs permissive RLS policies for anon writes OR service role key."

Workers use service role key (bypasses RLS).
n8n uses anon key (subject to RLS).

Specific policies not documented in this file. Verify with:

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';
```

---

## Connection details

```
SUPABASE_URL=https://kfdfcoretoaukcoasfmu.supabase.co
SUPABASE_ANON_KEY=...     (in .env, also hardcoded in n8n workflow JSONs — known accepted risk)
SUPABASE_SERVICE_KEY=...  (service role, bypasses RLS, used by VPS worker only)
```

pgvector extension is enabled on the database (required for asset_segments.embedding).

---

## What this doc is NOT

- Not a complete RLS policy reference
- Not a complete RPC function reference (only the two most-used)
- Not authoritative for inferred (⚠️) tables — verify before relying

For any question marked ⚠️ or 🔮, run the verification SQL above instead of trusting this doc.

---

## How to extend this doc

When new tables/columns/RPCs are added during Phase 3 work, add them here with ✅ verification status. Keep the Phase 3 "planned" notes inline so future-Claude sessions can see what's intentionally upcoming vs what's actually shipped.
