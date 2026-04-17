# Phase 3 Design

**Status:** ALL WORKSTREAMS SHIPPED. W1 (2026-04-15), W5 (2026-04-16), W2+W3+W4 (2026-04-17). Phase 3 LIVE. `ENABLE_PHASE_3_CD=true` flipped 2026-04-17.
**Last updated:** 2026-04-17
**Supersedes:** Phase 3 sketch in MVP_PROGRESS (6).md
**Foundation document:** All Phase 3 agent briefs reference this doc

---

## Goal

Eliminate the "every video feels the same" problem that surfaced after Phase 2 cleanup. The Phase 2 curator works correctly — it picks clips intentionally with reasoning. But every video still has the same structural shape, same color palette, same cut style, same vibe. That sameness comes from three sources:

- The Creative Director makes the same structural decisions for every video (fixed 5 slots, single template, no creative variation) — **W1 SHIPPED, addresses this**
- The Remotion composition is hard-coded to one template with one set of visual choices — W4 planned
- There's no concept of "vibe" or "creative direction" beyond mood + energy_level — **W1 SHIPPED, addresses this (vibe param plumbing deferred to post-W1)**

Phase 3 solves all three at once by giving the Creative Director open-ended creative freedom and rebuilding Remotion as a parameterized composition that renders whatever the CD describes.

## Success criterion

8 of 10 consecutive Phase 3 production videos pass operator approval (`jobs.review_decision = 'approve'`). Tracked in the existing approval workflow. **Cannot be measured until W4 ships and ENABLE_PHASE_3_CD + ENABLE_PHASE_3_REMOTION flip together at Milestone 3.3.**

First test brand: nordpilates. Operator (Domis) will fix brand_config product/color drift before testing starts.

## Non-goals (explicitly deferred)

- **Throughput optimization** — parallel workers, queue tuning, render farms. Phase 4+.
- **Reference-guided generation** — system scrapes top-performing similar videos, analyzes them with Gemini, feeds insights to CD as inspiration. Phase 4. Big enough to be its own initiative.
- **Beat-locked music sync** — cuts land on music beats. Requires music ingestion to detect beat timestamps. Phase 4.
- **Per-slot music intensity ducking** — music volume varies per slot. Phase 3.5.
- **Sophisticated overlay timing** — beyond slot-start/full-duration. Phase 3.5.
- **W6: Brand Settings sheet sync** — operator edits brand tuning fields from a sheet, n8n syncs to Supabase. Deferred to Phase 3.5. Interim path: edit `brand_configs` in Supabase web UI directly.

---

## CD output schema (locked, ✅ shipped in W1)

The Creative Director outputs the following structure on every brief generation. All fields required unless marked optional. Validated by Zod before downstream agents consume it. Implemented in `src/agents/creative-director-phase3-schema.ts`.

```typescript
interface Phase3CreativeBrief {
  // Identifiers + metadata
  brief_id: string;
  brand_id: string;
  video_type: string;                                // loose classification, used for analytics
  composition_id: "phase3-parameterized-v1";        // identifies Phase 3 outputs
  total_duration_target: number;                     // seconds
  caption_preset: string;                            // brand-locked caption font/color/animation

  // Operator inputs (passed through from job)
  idea_seed: string;
  vibe: string | null;                               // free-text, optional, e.g. "gentle morning energy"
                                                     // (NOTE: vibe param plumbing deferred from W1 — currently always null)

  // Creative direction (top-level)
  creative_direction: {
    creative_vision: string;                         // free-text paragraph, source of truth for tone
    slot_count: number;                              // 3-12
    energy_per_slot: number[];                       // length matches slot_count, values 1-10
    color_treatment:
      | "warm-vibrant" | "cool-muted" | "high-contrast" | "soft-pastel"
      | "moody-dark" | "natural" | "golden-hour" | "clean-bright";
  };

  // Per-slot decisions
  segments: Array<{
    type: "hook" | "body" | "cta";
    label: string;                                   // human-readable, e.g. "exercise-1"
    pacing: "slow" | "medium" | "fast";
    cut_duration_target_s: number;                   // numeric duration target

    transition_in:
      | "hard-cut" | "crossfade" | "slide" | "zoom"
      | "whip-pan" | "fade-from-black";              // slot 0 typically fade-from-black or hard-cut

    internal_cut_style: "hold" | "hard-cuts" | "soft-cuts";

    text_overlay: {
      style: "bold-center" | "subtitle" | "label" | "cta" | "minimal" | "none";
      position:
        | "top-left" | "top-center" | "top-right"
        | "center"
        | "bottom-left" | "bottom-center" | "bottom-right";
      animation: "pop-in" | "slide-up" | "fade" | "type-on" | "none";
      char_target: number;                           // 10-60, default 30
      // text itself filled in by Copywriter (W3), not CD
    };

    clip_requirements: {
      mood: string;
      has_speech: boolean;
      min_quality: number;
      content_type: string[];
      visual_elements: string[];
      aesthetic_guidance: string;                    // free-text per-slot aesthetic notes
    };
  }>;

  // Audio
  audio: {
    strategy: "music-primary";
    music: {
      mood: string;
      tempo: "slow" | "medium" | "fast";
      energy_level: number;                          // 1-10
      volume_level: number;                          // 0-1
      pinned_track_id: string | null;                // optional explicit pick
    };
  };
}
```

### Schema design principles (validated by W1 ship)

The schema bakes in five principles from the Phase 3 design session. All five held up through W1 implementation and smoke validation:

1. **Hybrid structured + free-text everywhere it matters.** Structured fields for code (Remotion needs numbers, validators need enums). Free-text fields for LLM nuance (creative_vision, aesthetic_guidance). W1 smoke confirmed `aesthetic_guidance` produces specific, actionable per-slot direction.
2. **Open creative range over predictability.** 3-12 slot range, 8 color treatments, 6 transition_in vocabulary. W1 v3 smoke produced 4 unique slot_counts (4, 5, 6, 8) and 5 unique color treatments across 6 briefs — confirming the wider range gets exercised.
3. **Vibe as guidance, not constraint.** CD can push back when idea_seed contradicts. (Vibe param plumbing deferred from W1 — currently always null.)
4. **Brand consistency through small surface area.** Logo, color palette restrictions, caption preset are brand-locked. Everything else is free-form per video.
5. **Polish features deferred.** Beat-locked music, per-slot music intensity, overlay timing — all parked.

---

## Workstreams

Phase 3 has five workstreams. W1-W4 form the rendering critical path. W5 is independent.

### W1 — Creative Director rewrite ✅ SHIPPED

**Shipped:** 2026-04-15. Commit `df6a326` on main, tag `phase3-w1-complete`. Behind `ENABLE_PHASE_3_CD` flag (default false).

**Files touched:**
- `src/agents/creative-director.ts` — Phase 2 logic preserved, renamed `generateBrief` → `generateBriefPhase2`, `generateMockBrief` → `generateMockBriefPhase2`, prompt path updated to `creative-director-phase2.md`
- `src/agents/creative-director-phase3.ts` — NEW. 362 lines. Phase 3 generator with Zod corrective retry, placeholder guard, withLLMRetry wrapping
- `src/agents/creative-director-phase3-schema.ts` — NEW. 121 lines. Zod schema with cross-field validation (energy_per_slot length matches slot_count, segments[0].type === 'hook'), type-equality assertion to keep manual interface and Zod schema in sync
- `src/agents/creative-director-dispatch.ts` — NEW. 31 lines. Flag-gated routing, discriminated union return
- `src/agents/prompts/creative-director.md` — Full rewrite, 462 lines, 4 example briefs (transformation-story, high-energy-listicle, calm-instructional, workout-demo), signal-mapping rules, variety nudges
- `src/agents/prompts/creative-director-phase2.md` — NEW. 210 lines, restored from pre-W1 history for Phase 2 rollback path
- `src/agents/context-packet.ts` — Imports dispatcher; Phase 3 path throws "downstream not yet shipped" until W2/W3/W4 ship
- `src/types/database.ts` — Added Phase3CreativeBrief, Phase3BriefSegment, supporting type unions, allowed_color_treatments field on BrandConfig
- `src/config/env.ts` — Added ENABLE_PHASE_3_CD flag, default false
- `src/scripts/migrations/006_brand_configs_color_treatments.sql` — NEW. Adds allowed_color_treatments TEXT[] + backfills nordpilates and carnimeat
- `src/scripts/smoke-test-cd-phase3.ts` — NEW. 289 lines. 6-fixture validation harness with signal-mapping correctness tracking
- `src/workers/pipeline.ts` — Side fix: writes video_type column (was being dropped); standardized brief_summary format
- `src/agents/context-packet.ts` — Side cleanup: deleted dead `planJob()` (zero callers per Step 0.5 verification)

**Smoke test results (3 iterations):**
- v3 final: 6/6 Zod first-attempt pass, 6/6 signal-mapping correct, 4 unique slot_counts, 5 unique color treatments, 0 color violations, $0.33 cost, 121s wall.
- See `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_0.md` §11.5 for full smoke comparison v1/v2/v3.

**Deferred from W1 (planned for follow-up):**
- Vibe param plumbing through CreativeDirectorPhase3Input (waits for S1 sheet column + Supabase column)
- Sheet `Vibe` column position (probably right after Idea Seed)
- S1 workflow update to pass Vibe through to Supabase
- VIDEO_TYPE_CONFIGS slim (still read by Phase 2 path at runtime; deletion belongs at Milestone 3.3 cleanup)
- Phase 2 CD Zod retrofit (not worth it; path will be deleted at Milestone 3.3)

### W2 — Asset Curator V2 update ✅ SHIPPED

**Shipped:** 2026-04-17, commit `68441bc`.

**Files changed:**
- `src/agents/asset-curator-v2.ts` — +49/-23. Phase 3 branch via `'creative_direction' in brief` discriminant. `SegmentLike` interface abstracts Phase 2/3 segment shapes. Dedup filter rejects same parent clip across slots.
- `src/agents/asset-curator-dispatch.ts` — Phase 3 brief type wiring.
- `src/agents/curator-v2-retrieval.ts` — +1 optional `aestheticGuidance` field on `BriefSlot`.
- `src/agents/prompts/asset-curator-v2.md` — 42→52 lines. Added CREATIVE VISION + AESTHETIC GUIDANCE sections. Eval criteria expanded 4→6 (added aesthetic alignment + creative vision coherence).

**Smoke results:** 16/16 slots filled, avg 3-5 word aesthetic overlap per slot, dedup filter activated 8 times across 3 briefs.

### W3 — Copywriter agent update ✅ SHIPPED

**Shipped:** 2026-04-17, commit `7e381e4`.

**Files changed:**
- `src/agents/copywriter.ts` — +149/-44. Inline Phase 3 branch via `'creative_direction' in brief`. Builds structured text context block with per-slot constraints (style, position, char_target). Phase 3 mock path generates overlays using slot indices.
- `src/agents/prompts/copywriter.md` — 74→107 lines. Added Phase 3 Briefs section, Text Overlay Style Guide (6 styles × char_target rules), Priority Order (char compliance > style match > creative vision), Phase 3 output example.

**Smoke results:** 16/16 overlays within ±20% char_target, $0.12 API cost, 37.5s runtime.

### W4 — Remotion parameterized composition ✅ SHIPPED

**Shipped:** 2026-04-17, commit `d92d601` (squash merge of 7 commits). 11 files, +791/-130 lines.

**New files:**
- `src/templates/layouts/Phase3Parameterized.tsx` (143 lines) — Single parameterized composition. SlotRenderer sub-component handles crossfade opacity interpolation, transition overlays, text overlays. SegmentVideo adapter for existing component reuse.
- `src/templates/components/Phase3TextOverlay.tsx` (238 lines) — 6 styles (bold-center, subtitle, label, cta, minimal, none) × 7 positions × 5 animations (pop-in, slide-up, fade, type-on, none). Exit fade in last 6 frames.
- `src/templates/resolve-phase3.ts` (54 lines) — Resolves Phase 3 brief segments into frame-level timing with transition overlap subtraction and copy overlay lookup.
- `src/templates/color-treatments.ts` (14 lines) — 8 named CSS filter strings.
- `remotion.config.ts` (13 lines) — extensionAlias webpack override for CLI (renderer passes inline).

**Modified files:**
- `src/templates/components/TransitionEffect.tsx` — +83 lines. 18 transition types total (added fade-from-black, fade-to-black, slide-down, slide-right, whip-pan, blur-through, glitch). `mapTransitionName()` export for Phase 3→internal name mapping. Crossfade returns null (handled by composition opacity).
- `src/templates/Root.tsx` — +25 lines. Phase3Parameterized composition registered as `phase3-parameterized-v1`.
- `src/templates/types.ts` — +39 lines. Phase3TemplateProps, Phase3ResolvedSegment interfaces.
- `src/types/database.ts` — +21 lines. Phase3ContextPacket type (separate from ContextPacket to avoid breaking Phase 2 consumers).
- `src/workers/renderer.ts` — +84/-46. Phase 3 detection, Phase3TemplateProps build, resolvePhase3Segments for frame calculation.
- `src/agents/context-packet.ts` — +129/-91. Phase 3 throw removed. Full Phase 3 pipeline: CD → Curator → Copywriter → music → Phase3ContextPacket. Extracted `extractClipSelections()` and `selectMusic()` helpers.
- `src/workers/pipeline.ts` — +31/-22. Phase 3 job storage (composition_id, cta_text, brief_summary). `generateSlug` widened.

**Architecture decisions:**
- Crossfade via opacity interpolation on SegmentVideo wrappers (both clips visible in overlap window), not overlay.
- Transition overlap = 10 frames (0.33s) for all non-hard-cut transitions.
- Color treatment as CSS filter on root AbsoluteFill.
- Separate Phase3ContextPacket type to avoid cascading breaks in pipeline.ts/sync-checker.ts.
- `ENABLE_PHASE_3_REMOTION` flag was NOT used — composition is always registered and selected by `composition_id` from the brief.

### W5 — Clean-slate ingestion + pre-normalization ✅ SHIPPED

**Shipped:** 2026-04-16. Commit `f1b8120` on main, tag `phase3-w5-complete`. Four-step branch (`feat/phase3-w5-ingestion`) squash-merged from laptop.

**Files touched:**
- `src/lib/parent-normalizer.ts` — NEW (74 lines). `preNormalizeParent()` — sibling to existing `buildNormalizeCommand` (kept for render-time use). FFmpeg: 1080×1920 30fps H.264 CRF 22 medium, AAC 128k 44.1k stereo, `scale+pad+fps` filter chain.
- `src/scripts/migrations/007_pre_normalized_clips.sql` — NEW. Adds `pre_normalized_r2_key TEXT` nullable to `assets`. No default, no backfill.
- `src/workers/ingestion.ts` — pre-normalization step inserted between raw R2 upload and `assets` INSERT. Downstream (Gemini Pro segment analyzer, keyframe extraction, segment trim) reads the normalized local path. Orphan raw cleanup on pre-normalize failure.
- `src/types/database.ts` — `Asset.pre_normalized_r2_key?: string | null`
- `src/scripts/test-pre-normalize.ts` — NEW (77 lines). Standalone smoke harness + `npm run test:pre-normalize`.
- `src/scripts/test-ingestion-w5.ts` — NEW (129 lines). End-to-end /ugc-ingest verification harness.
- `src/scripts/clean-slate-nordpilates.ts` — NEW (147 lines). Scripted DB + R2 wipe + `npm run clean-slate:nordpilates`.

**Architecture (as shipped):**
- On ingestion, parent clip streamed to `/tmp/ugc-ingest/{uuid}.{ext}` (RAM ~64KB, 2GB cap).
- Raw parent uploaded to R2 first (archival) at `assets/{brand}/{uuid}.{ext}`.
- `preNormalizeParent()` runs ffmpeg to 1080×1920 30fps H.264 CRF 22 medium → uploads to R2 at `parents/normalized/{brand}/{asset_id}.mp4`.
- `assets` INSERT populates `pre_normalized_r2_key` from start (no UPDATE dance).
- Segment analyzer + keyframe extractor + 720p segment trim all read the normalized local path.
- All `clip_r2_key` references in `asset_segments` now point to segments cut from 1080p normalized parents.
- Hard-required: throw on pre-normalize failure (after best-effort cleanup of orphan raw R2 key). No soft-fallback.

**Clean-slate scope (executed 2026-04-16):**
- 53 nordpilates assets + 182 segments (cascade) dropped from DB.
- R2 purged: `assets/nordpilates/`, `segments/nordpilates/`, `keyframes/nordpilates/`, `parents/normalized/nordpilates/`.
- Also: carnimeat test debris (3 test UUIDs from Step 2/3 validation runs) swept.

**First production ingestion (Step 5 verification, 2026-04-16):** 12 segments from 986MB 4K 3:36 source in ~14 min. 48s for a 22.9MB/3.9s short clip. All segment rows had `clip_r2_key` + `embedding` populated.

**Side fixes delivered during W5:**
- `/ugc-ingest` Content-Length cap raised 500MB → 2GB (commit `22e977e`). 500MB predated the streaming rewrite.
- Upstash Redis: upgraded free → pay-as-you-go after hitting 543k/500k free tier. Diagnosis: no bug; keepAlive pings on 6 persistent connections account for ~518k/mo.
- n8n S8 `Send to VPS` timeout raised 10 min → 30 min (workflow-side change). HTTP was closing before 3-5min 4K ingestions completed.

**Deferred from W5 (filed for Milestone 3.3 cleanup):**
- Legacy `analyzeClip` Gemini Flash call deletion (flagged dead-ish in Step 0 inspection)
- Async ingestion via BullMQ queue (replacing synchronous HTTP; addresses timeout root cause)
- `clip-analysis.ts` reading normalized parent instead of raw 4K (free speedup)

---

## Milestones

Phase 3 ships in three milestones.

### Milestone 3.1 — CD + downstream agents (behind feature flag) ✅ COMPLETE

**Shipped:** 2026-04-17. Includes W1 ✅, W2 ✅, W3 ✅.

All three agents produce Phase 3 output: CD generates parameterized brief, Curator reads creative_vision + aesthetic_guidance, Copywriter generates per-slot overlay text within char_target constraints. Full pipeline flows end-to-end behind `ENABLE_PHASE_3_CD` flag.

### Milestone 3.2 — Clean-slate ingestion (parallel, independent) ✅ SHIPPED

**Includes:** W5 ✅
**Deliverable:** New ingestion path that pre-normalizes parent clips. New uploads use new pipeline. Existing 182 segments dropped.

**Shipped 2026-04-16.** Content sprint in progress — operator dropping 50-100 nordpilates UGC clips through new pipeline.

**Verified:** First production ingestion completed end-to-end (12 segments, `pre_normalized_r2_key` populated, segments derived from 1080p normalized parent, not raw 4K).

### Milestone 3.3 — Remotion + production flip ✅ COMPLETE

**Shipped:** 2026-04-17. First Phase 3 video rendered end-to-end (job `fe34b673`, nordpilates workout-demo).

**What actually happened vs plan:**
- `ENABLE_PHASE_3_REMOTION` flag was NOT used. The parameterized composition is always registered; the renderer selects it via `composition_id` from the brief. Only `ENABLE_PHASE_3_CD=true` was needed.
- Flipped `ENABLE_PHASE_3_CD=true` on VPS after W4 deploy. First video rendered successfully, auto QA passed.
- Two hotfixes deployed same day: transcriber no-audio crash (`57791f6`), CTA white-on-white color fix (`9b377ea`).

**Cleanup deferred to Phase 3.5:**
- Delete Phase 2 CD path (`generateBriefPhase2`, `creative-director-phase2.md`)
- Delete `selectVideoType()` and slim `VIDEO_TYPE_CONFIGS`
- Delete old Remotion template variants (HookDemoCTA, HookListicleCTA, HookTransformation)
- Remove `ENABLE_PHASE_3_CD` flag (hardcode true)

**Quality validation:** First video revealed clip selection quality issues (see Post-ship quality issues section). 8/10 approval criterion tracking begins after quality iteration.

---

## Brand color palettes (initial values, ✅ shipped via migration 006)

Loaded into `brand_configs.allowed_color_treatments` via migration 006 (2026-04-15). Operator can edit directly in Supabase web UI until W6 ships in Phase 3.5.

### nordpilates (✅ backfilled)

```
allowed_color_treatments: ["warm-vibrant", "soft-pastel", "golden-hour", "natural", "cool-muted"]
```

5 treatments. Excludes `high-contrast`, `moody-dark`, `clean-bright` as off-brand for soft wellness positioning.

### carnimeat (✅ backfilled)

```
allowed_color_treatments: ["high-contrast", "warm-vibrant", "moody-dark", "natural", "clean-bright"]
```

5 treatments. Excludes `cool-muted`, `soft-pastel`, `golden-hour` as too soft for the bold masculine positioning.

### Other brands (welcomebaby, nodiet, ketoway, highdiet)

NULL in DB. CD treats NULL as "no restriction; pick from any of 8 treatments." Backfill when those brands begin Phase 3 production.

---

## Brand video_type allowances (updated 2026-04-15)

`brand_configs.allowed_video_types` updated via manual SQL (not migration) on 2026-04-15 to support multi-type per brand. Original single-type lock was MVP simplicity, not brand strategy.

| Brand | allowed_video_types |
|---|---|
| nordpilates | `['workout-demo', 'tips-listicle', 'transformation']` |
| carnimeat | `['recipe-walkthrough', 'tips-listicle', 'transformation']` |
| highdiet | `['workout-demo', 'tips-listicle', 'transformation']` |
| ketoway | (unchanged from MVP) |
| nodiet | (unchanged from MVP) |

CD signal-mapping in Phase 3 prompt picks video_type from the brand's allowed list based on idea_seed signals.

---

## Schema migrations

| # | Migration file | Status | Purpose |
|---|---|---|---|
| 006 | `006_brand_configs_color_treatments.sql` | ✅ Applied 2026-04-15 (Phase 3 W1) | Add `allowed_color_treatments TEXT[]` to brand_configs. Backfill nordpilates and carnimeat. |
| 007 | `007_pre_normalized_clips.sql` | ✅ Applied 2026-04-16 (Phase 3 W5) | Add `pre_normalized_r2_key TEXT` to assets table |

Migrations 008+ as needed during W2/W3/W4. Migration runner from Phase 2 cleanup (`apply_migration_sql` RPC + `apply-migration.ts`) handles all.

---

## Feature flag strategy

Phase 3 shipped with a single feature flag:

- `ENABLE_PHASE_3_CD=true` — flipped 2026-04-17 on VPS. Controls whether planning uses Phase 3 CD (`generateBriefPhase3`) vs Phase 2 CD (`generateBriefPhase2`). All downstream consumers (Curator, Copywriter, Renderer) detect Phase 3 via `'creative_direction' in brief` discriminant — no separate flags needed.
- `ENABLE_PHASE_3_REMOTION` — **NOT used.** The parameterized composition is always registered; renderer selects it by `composition_id` from the brief. No flag gate needed.

Old code paths (Phase 2 CD prompt + `hook-demo-cta` Remotion template) preserved for rollback. To revert: set `ENABLE_PHASE_3_CD=false` and restart worker. Phase 2 path still works end-to-end.

---

## Operator workflow during Phase 3

### Editing brand_config (until W6 ships)

Worker logs into Supabase web UI → Tables → `brand_configs` → finds brand row → edits `allowed_color_treatments` array directly. Saves. Effective immediately on next CD generation.

This is a temporary workflow until W6 (Brand Settings sheet sync) ships in Phase 3.5.

### Setting per-video vibe (deferred from W1)

**Not yet wired.** Plan: worker adds new optional `Vibe` column to the Jobs sheet. Types free-text vibe per row, e.g. "gentle morning energy" or "punchy gym hype." S1 workflow needs minor update to pass Vibe through to Supabase as part of job creation. Currently CD always receives vibe = null and invents one based on idea_seed.

### Reviewing Phase 3 briefs

**Currently dev-only.** Smoke harness `npm run test:cd-phase3` generates 6 briefs against live Claude. Operator reads them in chat or terminal output. The Full Brief sheet column is not populated for Phase 3 briefs because the flag is off in production.

Once W2+W3 ship and the Phase 3 path stops throwing at downstream, briefs will land in `jobs.context_packet` and become operator-visible via Full Brief column.

---

## Total effort (completed)

| Workstream | Sessions | Calendar |
|---|---|---|
| W1 — Creative Director rewrite | 6 | 2026-04-15 (1 day) |
| W5 — Clean-slate ingestion | 5 | 2026-04-16 (1 day) |
| W2 — Curator V2 update | 2 | 2026-04-17 |
| W3 — Copywriter update | 1 | 2026-04-17 |
| W4 — Remotion composition | 1 | 2026-04-17 |
| **Total** | **15 sessions** | **3 days (2026-04-15 → 2026-04-17)** |

---

## Open during Phase 3 (resolve as we go)

- **Exact CSS filter values per color treatment** — initial values in W4 doc above, refine during W4 implementation
- **Whip-pan transition implementation** — Remotion plugin (`@remotion/transitions` or community package) vs hand-rolled. Decide during W4.
- **Sheet `Vibe` column position** — probably new column right after `Idea Seed`. Coordinate with S1 update.
- **S1 workflow update** — small change to pass Vibe through to Supabase. Coordinate with W1 follow-up (vibe plumbing).
- **`min_quality` per-slot defaults** — Phase 3 CD anchored on 6-7 in smoke. Curator V2 has its own scoring; re-evaluate after W2 ships whether the prompt should specify defaults.
- **`brand_configs.allowed_video_types` for ketoway/nodiet** — kept at MVP single-type defaults. Update when those brands begin Phase 3 production.
- **`brand_configs.allowed_color_treatments` for welcomebaby/nodiet/ketoway/highdiet** — currently NULL. Backfill when those brands begin Phase 3 production.
- **Legacy `analyzeClip` Gemini Flash cleanup** — runs on every ingestion populating legacy columns nothing reads. Defer to Milestone 3.3 (stays for Phase 2 rollback path).
- **Async ingestion via BullMQ** — synchronous HTTP for 3-15 min work is an architecture smell. 30-min n8n timeout as interim workaround. Filed to Milestone 3.3.

---

## Post-ship quality issues (identified 2026-04-17)

First Phase 3 video (job fe34b673) passed auto QA but revealed quality issues:

1. **Clip selection mismatch:** CD generates exercise names ("cat-cow stretch"); CLIP embeddings and Gemini Pro can't match exercise terminology to visual content. Segments described generically ("woman doing exercise on mat").
   - Fix: CD prompt describes visual appearance instead of exercise names
   - Fix: Curator prompt rejects "preparation" clips explicitly

2. **Hook duration too short:** 4s for talking-head = speaker cut off mid-sentence.
   - Fix: CD prompt minimum 7s for talking-head hooks

3. **Talking-head reuse:** Only ~6 talking-head segments. Hook and CTA pick from same thin pool.
   - Fix: More talking-head content + CTA b-roll fallback in CD prompt

4. **Music mismatch:** "Rock That Body" for a calm morning stretch. Library has no calm/ambient tracks.
   - Fix: Upload calm tracks to music_tracks

5. **Full Brief display garbled:** "SLOT undefined" — formatFullBrief reads Phase 2 fields.
   - Fix: Update formatFullBrief for Phase 3 segment shape

See HANDOFF_PHASE3_QUALITY.md for detailed 4-layer analysis and fix plan.

## Document status

- This doc — Phase 3 master design, source of truth. All workstreams shipped.
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — architecture reference (no W2-W4 updates needed, details here).
- `MVP_PROGRESS (9).md` — living progress tracker. Supersedes (8).
- `HANDOFF_PHASE3_QUALITY.md` — quality iteration handoff, 4-layer analysis.
- `SUPABASE_SCHEMA.md` — DB schema reference, current (migrations 006 + 007 applied, no W2-W4 schema changes).
