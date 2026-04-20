# Phase 3 Design

**Status:** ALL WORKSTREAMS SHIPPED. W1 (2026-04-15), W5 (2026-04-16), W2+W3+W4 (2026-04-17). Phase 3 LIVE — `ENABLE_PHASE_3_CD=true`. Segment analyzer rewrite + full re-segmentation complete (2026-04-18, 903 segments). **Architecture pivot needed** — CD designs for exercises it can't verify exist. See `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md`.
**Last updated:** 2026-04-18
**Supersedes:** Phase 3 sketch in MVP_PROGRESS (6).md
**Foundation document:** All Phase 3 agent briefs reference this doc

---

## Goal

Eliminate the "every video feels the same" problem that surfaced after Phase 2 cleanup. The Phase 2 curator works correctly — it picks clips intentionally with reasoning. But every video still has the same structural shape, same color palette, same cut style, same vibe. That sameness comes from three sources:

- The Creative Director makes the same structural decisions for every video (fixed 5 slots, single template, no creative variation) — **W1 SHIPPED, addresses this**
- The Remotion composition is hard-coded to one template with one set of visual choices — **W4 SHIPPED, addresses this**
- There's no concept of "vibe" or "creative direction" beyond mood + energy_level — **W1 SHIPPED, addresses this (vibe param plumbing deferred to post-W1)**

Phase 3 solves all three at once by giving the Creative Director open-ended creative freedom and rebuilding Remotion as a parameterized composition that renders whatever the CD describes.

## Success criterion

8 of 10 consecutive Phase 3 production videos pass operator approval (`jobs.review_decision = 'approve'`). Tracked in the existing approval workflow. **Blocked by architecture pivot** — current pipeline produces videos that pass auto QA but are factually incorrect (overlay text doesn't match clips shown). Prompt-level fixes improved curator scores (4/10 → 9/10) and re-segmentation improved library quality (611→903 segments), but the fundamental problem is architectural: the CD designs for exercises it can't verify exist. Architecture pivot (Milestone 3.5) must ship before measuring against this criterion.

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

**Shipped:** 2026-04-17. Commit `68441bc` on main.

**Files touched:**
- `src/agents/asset-curator-v2.ts` — `creative_vision?: string` on CuratorV2Brief, two new `.replace()` calls with fallbacks, duplicate segment hard-filter in `curateSlot()`
- `src/agents/asset-curator-dispatch.ts` — Phase 3 branch via `'creative_direction' in input.brief` discriminator, `SegmentLike` interface to widen helper signatures for both segment types (+49/-23 lines)
- `src/agents/curator-v2-retrieval.ts` — `aesthetic_guidance?: string` optional field on BriefSlot
- `src/agents/prompts/asset-curator-v2.md` — Two new sections (CREATIVE VISION, AESTHETIC GUIDANCE), evaluation criteria expanded 4→6 items with three-tier priority preamble (42→52 lines)
- `src/scripts/smoke-test-curator-phase3.ts` — NEW (406 lines). Dev smoke harness with cached brief fixtures, token-overlap proxy

**Design decisions:**
- aesthetic_guidance as separate prompt placeholder (not folded into slot_description)
- BriefSlot extended with optional fields (not discriminated union)
- CLIP retrieval query unchanged — aesthetic_guidance is Pro-only context, not retrieval augmentation
- Duplicate segment hard-filter: candidates from already-picked segment IDs removed before Pro sees them

**Smoke results:** 16/16 slots across 3 video types. Aesthetic overlap avg 3-5 words/slot. Vision overlap 10/16 slots. 0 Zod failures. 1 self-critique fire (expected — library gap for figure-four stretch). Dedup filter activated 8 times.

**Estimated:** 1-2 sessions → **Actual: 2 sessions.**

### W3 — Copywriter agent update ✅ SHIPPED

**Shipped:** 2026-04-17. Commit `7e381e4` on main.

**Files touched:**
- `src/agents/copywriter.ts` — Inline Phase 3 branch (no separate dispatcher). Phase 3 user message prepends structured context block (creative_vision + per-slot text_overlay constraints in plain text) before the JSON brief blob. `CopywriterInput.brief` widened to `CreativeBrief | Phase3CreativeBrief`. (+149/-44 lines)
- `src/agents/prompts/copywriter.md` — Phase 3 sections: PHASE 3 BRIEFS intro, TEXT OVERLAY STYLE GUIDE (6 styles), PRIORITY ORDER, Phase 3 output example. Overlay length rule split: Phase 2 (6-8 words) vs Phase 3 (char_target ±20%). (74→107 lines)
- `src/scripts/smoke-test-copywriter-phase3.ts` — NEW (205 lines). Dev smoke harness using cached W2 brief fixtures.

**Design decisions:**
- Keep JSON dump pattern (no template substitution) — Copywriter processes all slots in one LLM call
- Style priority: text_overlay.style → char_target → clip context → creative_vision (softest signal)
- Inline branching via same `'creative_direction' in input.brief` discriminator as W2
- No Zod validation added (existing normalizeCopy loose coercion works for both phases)
- CopyOverlay.segment_id (number) works for both Phase 2 IDs and Phase 3 slot indices

**Smoke results:** 16/16 overlays within ±20% char_target. Style adherence confirmed (bold-center=punchy, label=terse exercise names, cta=actionable). 3 Claude calls, $0.12 total, 37.5s wall.

**Estimated:** 1-2 sessions → **Actual: 1 session.**

### W4 — Remotion parameterized composition ✅ SHIPPED

**Shipped:** 2026-04-17. Commit `d92d601` on main. 11 files, +791/-130 lines, 5 commits on feature branch.

**Files created:**
- `src/templates/layouts/Phase3Parameterized.tsx` — 143 lines. Single parameterized composition handling all video types via `segments.map()`. Crossfade via opacity interpolation on overlapping sequences. Color treatment via CSS filter on root AbsoluteFill.
- `src/templates/components/Phase3TextOverlay.tsx` — 238 lines. 6 styles (bold-center, subtitle, label, cta, minimal, none) × 7 positions × 5 animations. Style-to-rendering mapping: font size, weight, background, text color per style.
- `src/templates/resolve-phase3.ts` — 54 lines. `resolvePhase3Segments()` + `totalPhase3Frames()`. Frame-level timing with transition overlap subtraction.
- `src/templates/color-treatments.ts` — 14 lines. `getColorTreatmentFilter()` mapping 8 treatment names to CSS filter strings.
- `remotion.config.ts` — 13 lines. CLI webpack override (`extensionAlias .js → .tsx`). Required for `npx remotion compositions` command.

**Files modified:**
- `src/templates/components/TransitionEffect.tsx` — expanded to 18 transition types (+83 lines). Added `mapTransitionName()` for Phase 3 → internal name mapping. New types: crossfade (opacity overlap), whip-pan (blur+translate overlay), fade-from-black, fade-to-black, flash, slide-right, slide-down, blur-through (backdrop-filter), glitch (jitter+hue-rotate). Phase 2 types preserved.
- `src/templates/Root.tsx` — Fourth `<Composition id="phase3-parameterized-v1">` registered alongside Phase 2 templates (+25 lines).
- `src/types/database.ts` — `Phase3ContextPacket` type (separate from ContextPacket to avoid cascading type breaks) (+21 lines).
- `src/workers/renderer.ts` — Phase 3 wiring: `'creative_direction' in brief` discriminator, reads `composition_id`, assembles `Phase3TemplateProps`, clipPaths keyed by slot index (+84/-46 lines).
- `src/agents/context-packet.ts` — Phase 3 throw REMOVED. Full Phase 3 pipeline path wired: CD → Curator (W2) → Copywriter (W3) → music selection → assemble Phase3ContextPacket (+129/-91 lines).
- `src/workers/pipeline.ts` — Phase 3 context packet assembly, `formatFullBrief` cast for Phase 3 compatibility (+31/-22 lines).

**Architecture (as shipped):**
- One top-level `<Composition>` maps over `segments[]` (variable 3-12 count)
- Per slot: `<Sequence>` containing `<SegmentVideo>` + `<Phase3TextOverlay>` + `<TransitionEffect>`
- Crossfade: incoming segment's `<Sequence>` starts N frames early; outgoing fades opacity 1→0, incoming 0→1
- SegmentVideo adapter: thin shape-matching literal (SegmentVideo only reads clipPath + durationFrames)
- Color treatment: CSS `filter` property on root `<AbsoluteFill>`
- Duration: `totalPhase3Frames(resolved)` = last segment's startFrame + durationFrames
- Template selection: renderer reads `brief.composition_id` for Phase 3, `brief.template_id` for Phase 2

**Hotfixes shipped alongside W4:**
- Transcriber no-audio (`57791f6`): ffprobe checks for audio streams before extraction. Returns empty transcription for video-only clips.
- CTA white-on-white (`9b377ea`, pending merge): `Phase3TextOverlay` CTA style used `accentColor` (#FFFFFF for nordpilates) as background + hardcoded white text. Fixed to use `brandConfig.cta_bg_color` and `cta_text_color`.

**Estimated:** 4-6 sessions → **Actual: 1 session (comprehensive brief).**

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

Phase 3 ships in five milestones.

### Milestone 3.1 — CD + downstream agents (behind feature flag) ✅ COMPLETE

**Includes:** W1 ✅, W2 ✅, W3 ✅
**Shipped:** 2026-04-17 (W2 + W3 merged to main alongside W4).

All three agents (Creative Director, Asset Curator, Copywriter) handle Phase 3 briefs. Phase 3 path flows end-to-end through context-packet.ts without throwing.

### Milestone 3.2 — Clean-slate ingestion (parallel, independent) ✅ SHIPPED

**Includes:** W5 ✅
**Deliverable:** New ingestion path that pre-normalizes parent clips. New uploads use new pipeline. Existing 182 segments dropped.

**Shipped 2026-04-16.** Content sprint in progress — operator dropping 50-100 nordpilates UGC clips through new pipeline.

**Verified:** First production ingestion completed end-to-end (12 segments, `pre_normalized_r2_key` populated, segments derived from 1080p normalized parent, not raw 4K).

### Milestone 3.3 — Remotion + production flip ✅ COMPLETE

**Includes:** W4 ✅ + feature flag flip ✅
**Shipped:** 2026-04-17.

**`ENABLE_PHASE_3_CD` flipped to true on VPS.** `ENABLE_PHASE_3_REMOTION` was NOT used — W4 shipped without a separate Remotion flag. Phase 3 composition registered alongside Phase 2 templates; renderer selects based on `brief.composition_id`.

**First Phase 3 production video rendered:** job `fe34b673`, nordpilates workout-demo, 5 slots, golden-hour color, auto QA passed. Three platform exports (TikTok 33.6MB, Instagram 15.1MB, YouTube 41.9MB). Render time: 584.8s.

**Quality issues identified (see Post-ship quality issues section below):** clip selection mismatch, hook too short, talking-head reuse, CTA white-on-white (fixed), music mismatch, Full Brief garbled.

**Cleanup items (still pending):**
- Delete Phase 2 CD path (`generateBriefPhase2`, `creative-director-phase2.md`) — defer until quality iteration proves Phase 3 stable
- Delete `selectVideoType()` and slim `VIDEO_TYPE_CONFIGS`
- Delete old Remotion template variants (HookDemoCTA etc.)
- Make `ENABLE_PHASE_3_CD` permanently true in env.ts (or remove the flag entirely)
- Migrate ENABLE_CURATOR_V2 to env.ts pattern for consistency

### Milestone 3.4 — Deep re-segmentation ✅ COMPLETE

**Shipped:** 2026-04-18.

Segment analyzer prompt fully rewritten with 4 failure modes, duration caps (exercise max 12s, hold max 15s), mandatory subject appearance, exercise naming, 10-15 structured tags, movement phase tracking. Backfill reprocess mode added to `backfill-segments.ts` (`--reprocess --brand`). Full re-segmentation run: 191 assets, 611→903 segments, 0 failures, $12.32 Gemini credits, 170 minutes.

**Result:** Library quality dramatically improved. Avg exercise segment dropped from ~25s to 6.2s. Subject appearance tracked in 100% of segments. CLIP embeddings regenerated from new, more specific keyframes. Curator scores improved from 4-5/10 to 9/10.

**However:** prompt-level and segmentation improvements did not fix the fundamental architecture problem (see Milestone 3.5).

### Milestone 3.5 — Architecture pivot (library-aware CD + post-selection copywriting) 🔲 NOT STARTED

**Problem:** The CD designs videos with specific exercise names without knowing what exercises exist in the library. The curator picks the closest match, but "closest" is often a wrong exercise. The copywriter writes text for the CD's plan, not for the actual clips shown. Result: factually incorrect videos.

**Solution:** Flip the pipeline flow:
1. Query library inventory before CD runs → CD knows what content exists
2. CD designs structure + body focus (not exercise names) → curator picks best available clips by body region + energy
3. Copywriter runs AFTER clip selection → writes text describing what's actually on screen

**Scope:** See `HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md` for full design, component changes, and implementation plan.

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

Migrations 008+ as needed during quality iteration. Migration runner from Phase 2 cleanup (`apply_migration_sql` RPC + `apply-migration.ts`) handles all. **No new migrations were needed for W2/W3/W4.**

---

## Feature flag strategy

Phase 3 shipped with one feature flag:

- `ENABLE_PHASE_3_CD` ✅ added in W1 (`src/config/env.ts`). **Flipped to `true` on 2026-04-17.** Phase 3 is the production path.
- `ENABLE_PHASE_3_REMOTION` — **NOT USED.** W4 shipped without a separate Remotion flag. Phase 3 composition registered alongside Phase 2 templates; renderer selects by `composition_id` field in the brief. Simpler than a separate flag.

Phase 2 code paths (CD, Remotion templates) preserved for rollback. Once 8/10 consecutive Phase 3 approvals hit, old paths can be removed in cleanup.

---

## Operator workflow during Phase 3

### Editing brand_config (until W6 ships)

Worker logs into Supabase web UI → Tables → `brand_configs` → finds brand row → edits `allowed_color_treatments` array directly. Saves. Effective immediately on next CD generation.

This is a temporary workflow until W6 (Brand Settings sheet sync) ships in Phase 3.5.

### Setting per-video vibe (deferred from W1)

**Not yet wired.** Plan: worker adds new optional `Vibe` column to the Jobs sheet. Types free-text vibe per row, e.g. "gentle morning energy" or "punchy gym hype." S1 workflow needs minor update to pass Vibe through to Supabase as part of job creation. Currently CD always receives vibe = null and invents one based on idea_seed.

### Reviewing Phase 3 briefs

Phase 3 briefs flow through the full pipeline and land in `jobs.context_packet`. The Full Brief sheet column is populated but has display issues — `formatFullBrief()` reads Phase 2 field names (`segment_id`, `duration_target`), showing "SLOT undefined" for Phase 3 jobs. Cosmetic fix pending.

Operator reviews briefs via the Full Brief column (garbled but readable for key info like video_type, slot count, color treatment) + the Brief Summary column (clean: `workout-demo | phase3-parameterized-v1 | 35s | 5 segments`). After rendering, operator reviews via Preview URL in the sheet.

---

## Total effort (complete)

| Workstream | Estimated | Actual sessions | Ship date |
|---|---|---|---|
| W1 (Creative Director) | 4-6 | 6 | 2026-04-15 |
| W5 (Clean-slate ingestion) | 3-5 | 5 | 2026-04-16 |
| W2 (Curator V2) | 1-2 | 2 | 2026-04-17 |
| W3 (Copywriter) | 1-2 | 1 | 2026-04-17 |
| W4 (Remotion composition) | 4-6 | 1 | 2026-04-17 |
| **Total** | **13-21** | **15 sessions** | **3 days** |

W4 dramatically beat its estimate (1 session vs 4-6 estimated) because comprehensive briefing to the agent + extensive reuse of existing components eliminated the expected iteration cycles.

---

## Open items (resolve as we go)

- ~~**Exact CSS filter values per color treatment**~~ — ✅ RESOLVED in W4. Values in `src/templates/color-treatments.ts`. Operator can tune after seeing more renders.
- ~~**Whip-pan transition implementation**~~ — ✅ RESOLVED in W4. Hand-rolled overlay (blur + translate). No `@remotion/transitions` dependency.
- **Sheet `Vibe` column position** — still deferred. Probably new column right after `Idea Seed`. Coordinate with S1 update.
- **S1 workflow update** — small change to pass Vibe through to Supabase. Still pending.
- ~~**`min_quality` per-slot defaults**~~ — Phase 3 CD anchors on 6-7. Curator V2 has its own scoring. No issue observed in production.
- **`brand_configs.allowed_video_types` for ketoway/nodiet** — kept at MVP single-type defaults. Update when those brands begin Phase 3 production.
- **`brand_configs.allowed_color_treatments` for welcomebaby/nodiet/ketoway/highdiet** — currently NULL. Backfill when those brands begin Phase 3 production.
- **Legacy `analyzeClip` Gemini Flash cleanup** — still runs on every ingestion. Defer to cleanup phase.
- **Async ingestion via BullMQ** — synchronous HTTP with 30-min timeout. Defer to cleanup phase.
- **CD visual description vs exercise names** — **NEW, highest priority.** See Post-ship quality issues.
- **Hook minimum duration for talking-head** — **NEW.** See Post-ship quality issues.
- **formatFullBrief Phase 3 support** — **NEW.** See Post-ship quality issues.

---

## Post-ship quality issues (identified 2026-04-17)

First Phase 3 video (job `fe34b673`, nordpilates workout-demo) passed auto QA but revealed quality issues requiring iteration:

### 1. Clip selection mismatch (HIGHEST PRIORITY)
CD generates specific exercise names ("cat-cow stretch", "spinal twist"). CLIP embeddings can't map exercise terminology to visual content (CLIP trained on image captions, not fitness terminology). Gemini segment descriptions from ingestion are generic ("woman doing exercise on mat"), not exercise-specific. Pro picker matches on text similarity, not visual verification.

**Fix plan:** CD prompt describes visual appearance instead of exercise names ("hands and knees, alternating between arching back upward and dropping belly down" not "cat-cow stretch"). Curator prompt explicitly rejects "preparation/setup" clips. Longer-term: ingestion prompt teaches Gemini to label specific exercises.

### 2. Hook duration too short
CD set `cut_duration_target_s: 4` for a talking-head hook with `pacing: slow`. 4s is too short for a complete sentence.

**Fix:** CD prompt minimum 7s for hooks with `content_type=talking-head`.

### 3. Talking-head reuse
~6 talking-head segments in library. Both hook and CTA request talking-head. Dedup filter prevents exact reuse but pool is too thin for visual distinctness.

**Fix:** More talking-head content uploads + CD prompt CTA b-roll fallback when pool is thin.

### 4. Music mismatch
Morning pilates stretch (calm, gentle) got "Rock That Body" by Black Eyed Peas. Music selector picks closest energy match from 15-track library but has no calm/ambient options.

**Fix:** Upload calm/gentle tracks to `music_tracks`.

### 5. Full Brief display garbled
"SLOT undefined" in sheet column. `formatFullBrief()` reads Phase 2 field names (`segment_id`, `duration_target`).

**Fix:** Update `formatFullBrief()` for Phase 3 segment shape.

### 6. CTA white-on-white text
Phase3TextOverlay CTA style used `accentColor` (#FFFFFF for nordpilates) as background with hardcoded white text.

**Fix:** ✅ FIXED in hotfix `9b377ea` (pending merge + deploy). Uses `cta_bg_color` and `cta_text_color` from brandConfig.

**See `HANDOFF_PHASE3_QUALITY.md` for the complete 4-layer analysis and suggested fix order.**

---

## Document status

- This doc — Phase 3 master design, source of truth. ALL WORKSTREAMS SHIPPED.
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — architecture reference, current.
- `MVP_PROGRESS (9).md` — living progress tracker. Replaces (8).
- `SUPABASE_SCHEMA.md` — DB schema reference, current (no schema changes in W2-W4).
- `HANDOFF_PHASE3_QUALITY.md` — NEW. Quality iteration handoff for next session.
- `CLAUDE.md` — project reference, updated for Phase 3 live state.
