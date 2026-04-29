# Supabase Schema Reference

**Project:** Video Factory
**Supabase URL:** `https://kfdfcoretoaukcoasfmu.supabase.co`
**Last updated:** 2026-04-24 (Migration 011 applied; W8 shadow infrastructure landed)
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
- `shadow_runs` (Phase 4 Part B W8, migration 011)
- `simple_pipeline_render_history` (Simple Pipeline c1, migration 013)

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
| `status` | USER-DEFINED | Enum `job_status`: `idle`, `idea_seed`, `planning`, `brief_review`, `queued`, `clip_prep`, `transcription`, `rendering`, `audio_mix`, `sync_check`, `platform_export`, `auto_qa`, `human_qa`, `delivered`, `failed`, `simple_pipeline_pending`, `simple_pipeline_rendering`, `simple_pipeline_failed`, `simple_pipeline_blocked` (last four added 2026-04-28 via migration 015 for Simple Pipeline c1). TS mirror: `JobStatus` in `src/types/database.ts`. |
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
| `parent_asset_id` | uuid | FK to assets.id (parent clip). **ON DELETE CASCADE verified 2026-04-16.** (Migration 001 line 5 — prior versions of this doc called it `asset_id`, that was stale.) |
| `brand_id` | varchar | FK to brand_configs.brand_id |
| `start_s` | numeric | Start timestamp in parent clip |
| `end_s` | numeric | End timestamp in parent clip |
| `segment_type` | text | Enum: 8 types per Phase 1 taxonomy |
| `description` | text | Gemini's natural-language description |
| `editor_use` | text | How a video editor would use this segment |
| `motion_intensity` | int | 1-10 |
| `quality_score` | int | 1-10, Gemini's quality assessment |
| `visual_tags` | text[] | 5-10 visual tags (column name `visual_tags`, not `tags`, per migration 001). |
| `embedding` | vector(512) | CLIP ViT-B/32 embedding |
| `clip_r2_key` | text | **Phase 2.5 + W5:** R2 path to 720p CRF 28 segment clip. Post-W5: cut from 1080p normalized parent (not raw 4K). |
| `segment_v2` | jsonb \| null | ✅ **Added 2026-04-20 via migration 008 (Phase 4 Part A W0c).** Full v2.1 Zod-validated analyzer output (motion, quality, audio, on_screen_text, etc.). NULL on v1-only rows until backfilled by W0d destroy-and-rebuild. Indexed via GIN (`asset_segments_segment_v2_gin`). |
| `keyframe_grid_r2_key` | text \| null | ✅ **Added 2026-04-21 via migration 009 (Phase 4 Part B W1).** R2 path to a 4×3 portrait mosaic (1024×1365 JPEG q80) sampled across the segment's editorial window. `keyframe-grids/{brand_id}/{segment_id}.jpg`. EXIF ImageDescription embeds segment coordinates as JSON. NULL = not yet generated. Populated by backfill script or ingestion worker when `ENABLE_KEYFRAME_GRIDS=true`. No index — simple null-check predicate on queries that already filter by `segment_v2 IS NOT NULL`. |
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
| `aesthetic_description` | text \| null | ✅ **Added 2026-04-28 via migration 014 (Simple Pipeline c1).** Top-level column (not nested in JSONB). Used by Match-Or-Match agent for visual reasoning — kept distinct from `voice_guidelines` per kickoff Q1b (visual vs voice). NULL until populated per brand on Simple Pipeline activation. nordpilates seeded by migration 014 with operator-revisable starter draft; other brands NULL. |
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

**Note (2026-04-28):** `music_tracks` has no `active`/`is_active` flag column. All rows are treated as live. The Simple Pipeline music selector and readiness endpoint count rows directly without an active filter. If a future migration adds an `active` flag, both consumers should layer the filter without code rewrite.

---

## ✅ simple_pipeline_render_history (Simple Pipeline c1, migration 013, applied 2026-04-28)

Tracks per-brand parent + segment usage for Simple Pipeline cooldown logic. Routine path: parent cooldown (last 2 used per brand) + segment cooldown (last 2 used). Meme path: segment cooldown only (segment uniqueness implies parent uniqueness when slot_count=1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` default |
| `brand_id` | text | FK → `brand_configs(brand_id)`. `NOT NULL`. |
| `parent_asset_id` | uuid | Parent clip the picked segment belongs to. `NOT NULL`. No FK (denormalized — cooldown should outlive parent deletion). |
| `segment_id` | uuid | Picked segment. `NOT NULL`. No FK (same rationale). |
| `job_id` | uuid \| null | FK → `jobs(id)` `ON DELETE SET NULL`. Cooldown rows survive job deletion. |
| `format` | text | `'routine'` or `'meme'` (CHECK enforced). |
| `created_at` | timestamptz | `NOT NULL DEFAULT NOW()`. |

**Indexes:**
- `idx_simple_pipeline_render_history_brand_created` — `(brand_id, created_at DESC)` for general history reads
- `idx_simple_pipeline_render_history_brand_parent_created` — `(brand_id, parent_asset_id, created_at DESC)` for parent cooldown queries
- `idx_simple_pipeline_render_history_brand_segment_created` — `(brand_id, segment_id, created_at DESC)` for segment cooldown queries

All `created_at DESC` because cooldown reads are "most recent N" patterns.

**Open follow-up:** `simple-pipeline-deletion-policy` — table grows indefinitely; no retention/pruning policy yet.

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
| 008 | `008_segment_v2_sidecar.sql` | ✅ **Applied 2026-04-20 (Phase 4 Part A W0c)** | Add segment_v2 JSONB to asset_segments + GIN index. Nullable, no default. Backfilled by W0d. |
| 011 | `011_shadow_runs.sql` | ✅ **Applied 2026-04-24 (Phase 4 Part B W8)** | Add shadow_runs table + brand_configs.pipeline_version + jobs.pipeline_override (W8 shadow infrastructure). See section below for full schema. |
| 013 | `013_simple_pipeline_render_history.sql` | ✅ **Applied 2026-04-28 (Simple Pipeline c1)** | Create `simple_pipeline_render_history` table + 3 cooldown indexes. See section above. |
| 014 | `014_brand_configs_aesthetic_description.sql` | ✅ **Applied 2026-04-28 (Simple Pipeline c1)** | Add `brand_configs.aesthetic_description TEXT NULL` + seed nordpilates with operator-revisable starter draft. |
| 015 | `015_jobs_status_simple_pipeline.sql` | ✅ **Applied 2026-04-28 (Simple Pipeline c1)** | Extend `job_status` ENUM with `simple_pipeline_pending` / `_rendering` / `_failed` / `_blocked`. Heads-up: kickoff did not call this out; required for Postgres ENUM-typed status column to accept new values. |

> Table is non-exhaustive — migrations 009 (`009_keyframe_grid_column.sql`), 010 (`010_match_segments_v2.sql`), and 012 (`012_shadow_review_view.sql`) exist on disk under `src/scripts/migrations/` but are not yet documented in this table. Backfill at next refresh.

### Migration 011 — Part B shadow infrastructure (applied 2026-04-24)

Adds three changes for W8 Orchestrator's shadow-mode infrastructure:

**1. New table: `shadow_runs`**

Stores Part B pipeline output during shadow mode. Never touches `jobs.context_packet` (which Phase 3.5 owns during shadow).

```sql
CREATE TABLE shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Part B output
  planner_output JSONB NOT NULL,
  retrieval_debug JSONB NOT NULL,
  storyboard_picks JSONB NOT NULL,
  critic_verdict JSONB NOT NULL,
  copy_package JSONB NOT NULL,
  context_packet_v2 JSONB NOT NULL,

  -- Phase 3.5 reference (null if not dual-run)
  context_packet_v1 JSONB,

  -- Run metadata
  revise_loop_iterations INT NOT NULL DEFAULT 0,
  total_agent_invocations INT NOT NULL,
  part_b_wall_time_ms INT NOT NULL,
  part_b_cost_usd NUMERIC(6,4) NOT NULL,

  -- Operator verdict (W9-populated; null at W8-time)
  operator_comparison_verdict TEXT,  -- 'part_b_better' | 'v1_better' | 'tie' | NULL
  operator_notes TEXT,

  -- Failure mode if Part B didn't complete
  part_b_terminal_state TEXT,
  part_b_failure_reason TEXT
);

CREATE INDEX idx_shadow_runs_job_id ON shadow_runs(job_id);
CREATE INDEX idx_shadow_runs_created_at ON shadow_runs(created_at DESC);
CREATE INDEX idx_shadow_runs_terminal_state ON shadow_runs(part_b_terminal_state);
CREATE INDEX idx_shadow_runs_brand_state_time
  ON shadow_runs((context_packet_v2->>'brand_id'), part_b_terminal_state, created_at DESC);
```

**2. New column: `brand_configs.pipeline_version`**

Tier 1 of W8's three-tier feature flag composition. Brand-level eligibility for Part B.

```sql
ALTER TABLE brand_configs
  ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'phase35'
  CHECK (pipeline_version IN ('phase35', 'part_b_shadow', 'part_b_primary'));
```

Values:
- `phase35` — only Phase 3.5 runs. Part B never considered. (Default.)
- `part_b_shadow` — eligible for Part B via Tier 2/3 below. Phase 3.5 still runs.
- `part_b_primary` — Part B serves production; Phase 3.5 not called. (W9 ramp terminal state; unreachable at W8 time.)

All 5 brands defaulted to `phase35` at migration apply time.

**3. New column: `jobs.pipeline_override`**

Tier 2 of W8's three-tier feature flag composition. Per-job override.

```sql
ALTER TABLE jobs
  ADD COLUMN pipeline_override TEXT DEFAULT NULL;
```

Values (read by `src/orchestrator/feature-flags.ts`):
- `NULL` (default) — Tier 3 percentage rollout decides.
- `'part_b'` or `'force'` — Part B runs even if Tier 3 percentage would have skipped.
- `'phase35'` or `'skip'` — Phase 3.5 only, even if Tier 3 would have selected Part B.

Operator workflow for setting this column (n8n + Sheets coordination) is W9 scope.

**Migration verification post-apply:** `src/scripts/verify-011.ts` confirmed all 18 columns of `shadow_runs` are reachable, CHECK constraint on `pipeline_version` rejects nonsense values, default values applied to existing rows, round-trip insert/delete on `shadow_runs` with real `jobs` FK passes.

**Rollback procedure:** rolling back W8 code without rolling back Migration 011 is safe — new columns default to values compatible with pre-W8 code. Rolling back the migration requires verifying no code reads the new columns first (trivial post-revert), then dropping `shadow_runs` table + columns. No data migration; no downtime.

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
