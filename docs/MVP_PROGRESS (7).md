# Video Factory — MVP Progress Tracker (7)

**Last updated:** 2026-04-15
**Supersedes:** MVP_PROGRESS (6).md
**Companion docs:** `VIDEO_PIPELINE_ARCHITECTURE_v5_0.md`, `PHASE_3_DESIGN.md`, `SUPABASE_SCHEMA.md`, `CLAUDE.md`

---

## Where we are right now

**Phase 3 W1 shipped (2026-04-15).** Creative Director rewrite landed behind feature flag. Production worker continues running Phase 2 path; flag flip waits for W2/W3/W4. Next workstream: W5 (clean-slate ingestion + pre-normalization) per operator decision — independent of W2/W3/W4 critical path, unblocks content sprint.

**Tags shipped:**
- `phase1-complete`
- `phase2-complete`
- `phase3-w1-complete` ✅ (2026-04-15)

**Active feature flags in production:** ENABLE_CURATOR_V2=true, ENABLE_PHASE_3_CD=false, ENABLE_BEAT_SYNC=true, ENABLE_COLOR_GRADING=true, ENABLE_MUSIC_SELECTION=true, ENABLE_AUDIO_DUCKING=true, ENABLE_CRF18_ENCODING=true.

---

## Phase 3 W1 ship report (2026-04-15)

### Six-step delivery

| Step | What landed | Commit (pre-squash) |
|---|---|---|
| Step 0 | Read-only inspection of CD surface area (no code changes) | n/a |
| Step 0.5 | Confirmed `planJob()` is dead code; `runPlanning` is sole writer | n/a |
| Step 1 | Schema + Zod + delete dead `planJob()` + side-fix `runPlanning` writes `video_type` | `eca4b14` |
| Step 2 | CD prompt rewrite (462 lines, 4 examples) + import sweep | `c7b095b` |
| Step 3 | Dispatcher + Phase 3 generator + Zod corrective retry + ENABLE_PHASE_3_CD flag | `d081ee8` |
| Step 4 | Migration 006 + BrandConfig type extension + SUPABASE_SCHEMA.md committed | `f073383` |
| Step 5 | Smoke test harness + first run + prompt patch for allowed_color_treatments | `e793c41` |
| Step 6 | Prompt iteration for variety + smoke v2 + smoke v3 + decision-validated commit | `af9c57a` |
| Squash | All 6 → single commit on main + tag | `df6a326` (main) |

### Smoke test progression (3 iterations)

| Axis | v1 (initial) | v2 (post-prompt-iter) | v3 (final) |
|---|---|---|---|
| Fixtures | 5 nord+carni | 5 nord+carni | 6 nord+carni+highdiet |
| video_type variety | tips-listicle ×5 (DB-locked, see below) | tips-listicle ×5 (DB-locked) | 4 unique |
| Signal-mapping correct | n/a (DB-locked) | n/a (DB-locked) | 6/6 |
| slot_count distribution | {5:1, 6:4} | {5:1, 6:4} | {4:1, 5:1, 6:3, 8:1} |
| color treatments used | 3 unique | 2 unique (regression) | 5 unique |
| Within-brief transition variety | poor (crossfade dominant) | good | excellent |
| Within-brief internal cut variety | poor (hold dominant) | good | good |
| Within-brief overlay variety | poor | good | good |
| Energy curves | flat 6-7 | slight curve | archetype-shaped |
| Zod first-attempt | 5/5 | 5/5 | 6/6 |
| Color violations | 0/5 | 0/5 | 0/6 |
| Cost | $0.25 | $0.28 | $0.33 |
| Wall time | 95s | 101s | 121s |

### Key discoveries during W1

1. **`brand_configs.allowed_video_types` was single-type per brand** (MVP simplicity, not strategy). v1 and v2 smokes saw 5/5 tips-listicle because that's all the brands allowed. Updated 2026-04-15 via manual SQL to multi-type per brand. After update, signal-mapping verified 6/6.
2. **`runPlanning` was silently dropping `video_type`.** Pre-existing bug, not Phase 3 related. Job c83c31dc has video_type=null because of this. Fixed in W1 Step 1.
3. **`planJob()` was dead code** (zero callers). Deleted in W1 Step 1.
4. **Prompt iteration matters.** v1 prompt produced monotonous output even with the new schema. v2 iteration restructured examples (transformation first, added workout-demo example) and added signal-mapping rules in Step A — variety improved meaningfully.
5. **Color anchoring on examples.** v2 added a workout-demo example using warm-vibrant; nordpilates briefs collapsed to warm-vibrant 3/3. Resolved naturally in v3 by spreading fixtures across multiple video_types.

### Architectural decisions locked

- **Dispatcher pattern** (`creative-director-dispatch.ts`) — mirrors curator-v2-dispatch. Phase 2 path preserved as `generateBriefPhase2` for instant rollback.
- **Zod corrective retry** — single shot, sends schema errors back to model, throws if still bad. No silent normalization. Phase 2 cleanup pattern from Curator V2 finally landed at CD.
- **No normalize defaults** — defensive coercion (the 120-line `normalizeBrief` in Phase 2 path) deliberately not replicated in Phase 3 path. Schema correctness or throw.
- **Placeholder guard** (`ensureBriefId`) — substitutes `<will be set by system>` and `<from input>` placeholders with real values before Zod parses. Prevents valid-but-garbage strings reaching the DB.
- **VIDEO_TYPE_CONFIGS slim deferred** — Phase 2 CD path still reads it at runtime via the dispatcher's Phase 2 branch. Real deletion belongs at Milestone 3.3 cleanup.
- **Vibe param plumbing deferred** — CD takes optional vibe (currently always null). Wires through when S1 sheet column + Supabase column ship.
- **Phase 3 brief operator visibility** — Phase 3 path throws before DB write (W1 Step 3 design). Operator validates briefs via dev smoke harness, not Full Brief column. Resolves at W2/W3 ship.

### Cost summary

- Step 5 first smoke: $0.25 for 5 briefs
- Step 6 smoke v2 (prompt iteration): $0.28 for 5 briefs
- Step 6.5 smoke v3 (final): $0.33 for 6 briefs
- **Total W1 dev cost: ~$0.86 against Claude API.** All other steps (schema, dispatcher, prompt edits, migration) used zero LLM calls.

### Time spent

- 6 agent sessions across 1 day
- Roughly matches the original W1 estimate (2-3 sessions, expanded due to prompt iteration loop being worth doing)

---

## Where we go next

### Decided: W5 ships next

Per operator decision (2026-04-15), W5 (clean-slate ingestion + pre-normalization) is the next workstream. Rationale:
- Independent of W2/W3/W4 (rendering critical path)
- Unblocks content sprint with new pre-normalized pipeline
- Library content gap was the FIRST diagnosed bottleneck for the 4-5/10 V1 video
- Doing content sprint against the old ingestion path means re-doing it later

### W5 scope

- `src/lib/segment-trimmer.ts` extension to output 1080p H.264 normalized parent
- `src/scripts/migrations/007_pre_normalized_clips.sql` adds `pre_normalized_r2_key TEXT` to assets
- `src/workers/ingestion.ts` calls new pre-normalization step on every new ingestion
- Drop existing 182 nordpilates segments (clean-slate)
- Re-ingest content sprint UGC through new pipeline

### After W5: content sprint

Operator drops 15-20 more nordpilates ab/core UGC clips into the Drive folder. Each one ingests through new W5 pipeline. New `asset_segments` rows populated with `clip_r2_key` pointing at clips trimmed from 1080p normalized parents.

### After content sprint: W2/W3/W4 in sequence

- W2 (Curator V2 reads aesthetic_guidance + creative_vision) — 1-2 sessions
- W3 (Copywriter generates per-slot overlay text) — 1-2 sessions
- W4 (Remotion parameterized composition) — 4-6 sessions, largest

### Milestone 3.3: flag flip + first Phase 3 production video

When W2/W3/W4 done. Success criterion: 8 of 10 consecutive Phase 3 videos approved.

---

## Phase history (compressed)

### Phase 1 — Ingestion Overhaul ✅ (2026-04-13)
- 182 segments across 53 nordpilates clips
- pgvector + asset_segments table + match_segments RPC
- Gemini Pro Files API for native video segment analysis
- CLIP ViT-B/32 embeddings via @xenova/transformers (self-hosted, free)
- ~98% success rate, $3.47 total cost

### Phase 2 — Curator Overhaul ✅ + LIVE (2026-04-13 13:46 UTC)
- `asset-curator-v2.ts` + dispatcher + retrieval + trimmer
- Per-slot CLIP retrieval, type+quality filters, on-the-fly ffmpeg trim
- Gemini Pro pick + self-critique
- Parent cache, variety preference
- Validated 9-10/10 on all 5 test slots, ~$0.20/video incremental

### Phase 2.5 — Pre-trim optimization ✅ + LIVE (2026-04-13)
- Ingestion pre-trims 720p CRF 28 clips to R2 at `segments/{brand}/{uuid}.mp4`
- Trimmer FAST PATH streams ~5MB instead of downloading full parent + ffmpeg
- Backfill complete: 182/182 segments, 355 MB to R2, 25m 26s, $0
- Curator wall time: 17.9 min → 4.4 min (4.1× speedup)

### Phase 2 production validation ✅ (2026-04-14)
- First V2 video rendered: job `d74679d2-3c62-4e10-8e03-6da774b55dc1`
- "5 min pilates abs burner", nordpilates, 35s, 5 segments
- End-to-end ~16 min (planning ~5 min, render + export the rest)
- Rated **4-5/10** by operator
- V2 worked correctly; rating ceiling came from three layers below the picker:
  - Library content gap (only ~3-6 ab segments in nordpilates)
  - Creative Director monotony (CD makes only 3 decisions)
  - Remotion template monotony (single template per video_type)

### Phase 2 cleanup ✅ + LIVE (2026-04-14, commit `269ff99`, tag `phase2-complete`)
- Centralized retry helper `src/lib/retry-llm.ts` (handles 429/502/503/504/529, Anthropic overloaded_error, network errors)
- Zod corrective retry on V2 picker (caught two real "Expected object received array" Pro malformations)
- `full_brief` column on jobs + sheet column with apostrophe escape
- Reusable migration runner (`apply_migration_sql` SECURITY DEFINER + `apply-migration.ts`)
- V2 prompt soft visual variety rule
- Side fixes: S1 runaway loop bug (filter on Job-ID-empty without status writeback), BullMQ drain script, migration 005 fix

### Phase 3 design ✅ (2026-04-15)
- 5 workstreams, 3 milestones, 2 feature flags
- Schema locked field-by-field
- Brand color palettes locked for nordpilates and carnimeat
- See PHASE_3_DESIGN.md

### Phase 3 W1 ✅ (2026-04-15, commit `df6a326`, tag `phase3-w1-complete`)
- See ship report above

---

## Active n8n workflows

Per VPS-SERVERS.md:

| # | Workflow | Status | Notes |
|---|---|---|---|
| S1 | New Job | ✅ | 30s poll. **Pending: Vibe column passthrough when sheet column ships.** |
| S2 | Brief Review | ✅ | 30s poll. Includes brief_summary update. |
| S3 | QA Decision | ⏸ | Needs v2 rebuild before first `delivered` |
| S4 | Brand Config | ⏸ | Deactivated for MVP |
| S5 | Caption Preset | ⏸ | Deactivated for MVP |
| S6 | Music Track | ⏸ | Deactivated for MVP |
| S7 | Music Ingest | ✅ | 5min poll |
| S8 | UGC Ingest | ✅ | Manual |
| P1 | Job Status Push | ✅ | Webhook from VPS |
| P2 | Periodic Sync | ✅ | 5min, includes Full Brief column with apostrophe escape |
| P3 | Dashboard Refresh | ⏸ | Deactivated for MVP |
| P4 | Monthly Archive | ⏸ | Deactivated for MVP |

---

## Data inventory

- 53 assets (nordpilates)
- 182 asset_segments (all with clip_r2_key)
- 15 music_tracks
- 5 brand_configs (3 active for Phase 3: nordpilates, carnimeat, highdiet — others kept at MVP defaults)
- 6+ jobs (including first V2 production render `d74679d2`)

**brand_configs Phase 3 status:**

| Brand | active | allowed_video_types | allowed_color_treatments |
|---|---|---|---|
| nordpilates | ✅ | workout-demo, tips-listicle, transformation | warm-vibrant, soft-pastel, golden-hour, natural, cool-muted |
| carnimeat | ✅ | recipe-walkthrough, tips-listicle, transformation | high-contrast, warm-vibrant, moody-dark, natural, clean-bright |
| highdiet | ✅ (test) | workout-demo, tips-listicle, transformation | NULL (no restriction) |
| ketoway | inherited MVP | (single-type, MVP default) | NULL |
| nodiet | inherited MVP | (single-type, MVP default) | NULL |

---

## Known issues (priority sorted)

| Priority | Issue | Status / target |
|---|---|---|
| Medium | Library content gap on nordpilates ab/core | Content sprint post-W5 |
| Medium | Phase 3 brief operator visibility (throws before DB) | Acceptable for 3.1 validation; resolves W2/W3 |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild before first `delivered` |
| Medium | Phase 2 path templates feel structurally identical | Phase 3 W4 (parameterized composition) |
| Low | Render time variance (6-17 min on clip prep) | Phase 3 W5 pre-normalization |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | Upstash token leaked in chat history | Rotate before public production |
| Low | VPS package-lock.json drifts between deploys | Persistent friction, worked around with stash |
| Low | Music tagging only has energy_level + mood | Tier 3 |
| Low | ENABLE_CURATOR_V2 reads from process.env (not env.ts) — inconsistent with Phase 3 CD pattern | Cleanup at Milestone 3.3 |
| Low | Phase 3 prompt anchors on min_quality 6-7 in smoke output | Re-evaluate after W2 ships (Curator does its own scoring) |
| Low | Vibe param plumbing not yet wired (sheet → S1 → Supabase → CD) | Follow-up after W5 or in parallel |

---

## Cost tracking (rough)

| Component | Per video | Notes |
|---|---|---|
| Phase 2 CD (Sonnet) | ~$0.10-0.15 | Current production path |
| Phase 3 CD (Sonnet) | ~$0.20-0.30 | Behind flag; richer schema = ~2x output tokens |
| Copywriter (Sonnet) | ~$0.10-0.15 | |
| Curator V2 (Gemini Pro) | $0 (credits) | ~$0.20 if credits end |
| Ingestion (Gemini Pro) | $0 (credits) | ~$0.06/clip amortized if credits end |
| **Real out-of-pocket today** | **~$0.25/video** | Phase 2 path |
| **Real out-of-pocket post-W4** | **~$0.35-0.45/video** | Phase 3 path |

Infra: ~€15/mo (Hetzner VPS + n8n server). Storage: ~$1/mo R2.

---

## Document status

- This file (7) — current. Replaces (6).
- `VIDEO_PIPELINE_ARCHITECTURE_v5_0.md` — current. Replaces v4.0.
- `PHASE_3_DESIGN.md` — current. W1 marked shipped.
- `SUPABASE_SCHEMA.md` — current. Migration 006 applied.
- `CLAUDE.md` — current. Reflects W1 ship + brand config updates.
- `VPS-SERVERS.md` — current (no W1 changes).
- Historical: `(6)`, `v4.0`, `v3.9`, etc — keep for archive, do not update.
