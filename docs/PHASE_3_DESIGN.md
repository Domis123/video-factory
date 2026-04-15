# Phase 3 Design

**Status:** Locked, pre-implementation
**Last updated:** 2026-04-15
**Supersedes:** Phase 3 sketch in MVP_PROGRESS (6).md
**Foundation document:** All Phase 3 agent briefs reference this doc

---

## Goal

Eliminate the "every video feels the same" problem that surfaced after Phase 2 cleanup. The Phase 2 curator works correctly — it picks clips intentionally with reasoning. But every video still has the same structural shape, same color palette, same cut style, same vibe. That sameness comes from three sources:

- The Creative Director makes the same structural decisions for every video (fixed 5 slots, single template, no creative variation)
- The Remotion composition is hard-coded to one template with one set of visual choices
- There's no concept of "vibe" or "creative direction" beyond mood + energy_level

Phase 3 solves all three at once by giving the Creative Director open-ended creative freedom and rebuilding Remotion as a parameterized composition that renders whatever the CD describes.

## Success criterion

8 of 10 consecutive Phase 3 production videos pass operator approval (`jobs.review_decision = 'approve'`). Tracked in the existing approval workflow.

First test brand: nordpilates. Operator (Domis) will fix brand_config product/color drift before testing starts.

## Non-goals (explicitly deferred)

- **Throughput optimization** — parallel workers, queue tuning, render farms. Phase 4+.
- **Reference-guided generation** — system scrapes top-performing similar videos, analyzes them with Gemini, feeds insights to CD as inspiration. Phase 4. Big enough to be its own initiative.
- **Beat-locked music sync** — cuts land on music beats. Requires music ingestion to detect beat timestamps. Phase 4.
- **Per-slot music intensity ducking** — music volume varies per slot. Phase 3.5.
- **Sophisticated overlay timing** — beyond slot-start/full-duration. Phase 3.5.
- **W6: Brand Settings sheet sync** — operator edits brand tuning fields from a sheet, n8n syncs to Supabase. Deferred to Phase 3.5. Interim path: edit `brand_configs` in Supabase web UI directly.

---

## CD output schema (locked)

The Creative Director outputs the following structure on every brief generation. All fields required unless marked optional. Validated by Zod before downstream agents consume it.

```typescript
interface CreativeBrief {
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
      | "whip-pan" | "fade-from-black";              // slot 0 defaults to fade-from-black

    internal_cut_style: "hold" | "hard-cuts" | "soft-cuts";

    text_overlay: {
      style: "bold-center" | "subtitle" | "label" | "cta" | "minimal" | "none";
      position:
        | "top-left" | "top-center" | "top-right"
        | "center"
        | "bottom-left" | "bottom-center" | "bottom-right";
      animation: "pop-in" | "slide-up" | "fade" | "type-on" | "none";
      char_target: number;                           // 10-60, default 30
      // text itself filled in by Copywriter, not CD
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

### Schema design principles

The schema bakes in five principles from the Phase 3 design session:

1. **Hybrid structured + free-text everywhere it matters.** Structured fields for code (Remotion needs numbers, validators need enums). Free-text fields for LLM nuance (creative_vision, aesthetic_guidance). Each does what the other can't.
2. **Open creative range over predictability.** 3-12 slot range, 8 color treatments, 6 transition_in vocabulary. Wider than strictly necessary because Phase 3 explicitly trades operational predictability for creative variety.
3. **Vibe as guidance, not constraint.** Operator vibe input is strong direction but CD can push back when idea_seed contradicts (Field 1 decision).
4. **Brand consistency through small surface area.** Logo, color palette restrictions, caption preset are brand-locked. Everything else is free-form per video. Brand identity protected, creative freedom preserved.
5. **Polish features deferred.** Beat-locked music, per-slot music intensity, overlay timing — all parked. Phase 3 fixes the variety problem first, polishes second.

---

## Workstreams

Phase 3 has five workstreams. W1-W4 form the rendering critical path. W5 is independent.

### W1 — Creative Director rewrite

**Files touched:**
- `src/agents/creative-director.ts` — output schema, Zod validation
- `src/agents/prompts/creative-director.md` — full prompt rewrite
- `src/agents/context-packet.ts` — minor flow updates if needed

**Prompt design philosophy:**
- CD reads brand_config, idea_seed, vibe (if provided), and a library overview (which segments exist, by content_type)
- CD writes the creative_vision paragraph FIRST, structured fields SECOND, segments THIRD. Each step builds on the prior — vision shapes the structural fields, which shape the per-slot decisions.
- Explicit instruction: when operator vibe contradicts idea_seed, prefer idea_seed but acknowledge the tension in creative_vision
- Provide three example briefs across the spectrum (1 cozy/calm, 1 punchy/high-energy, 1 instructional/measured) so CD has a sense of the range
- Schema constraints expressed in natural language with concrete examples, not raw JSON

**Validation:**
- Zod schema enforces all enums and array lengths
- `energy_per_slot.length === slot_count` enforced
- `color_treatment` must be in `brand_config.allowed_color_treatments`
- Slot 0 (`type: "hook"`) defaults `transition_in: "fade-from-black"` if CD picks something else

**Risk:** CD might generate incoherent briefs (creative_vision says "calm" but energy_per_slot is `[8,9,10,9,8]`). Mitigation: schema-aware corrective retry pattern from Phase 2 cleanup. If validation passes but coherence is bad in operator review, tighten the prompt and add validation rules iteratively.

**Estimated:** 2-3 agent sessions.

### W2 — Asset Curator V2 update

**Files touched:**
- `src/agents/asset-curator-v2.ts` — read new fields from segment object
- `src/agents/prompts/asset-curator-v2.md` — instruct Pro to consider creative_vision globally and aesthetic_guidance per-slot
- `src/agents/curator-v2-retrieval.ts` — possibly augment retrieval query with aesthetic_guidance terms

**Changes:**
- Curator already reads per-slot `clip_requirements`. Add `aesthetic_guidance` to the read.
- Curator receives `creative_vision` as a top-level prompt context block. Instructed to use as overall direction, while clip_requirements remain hard constraints.
- Variety preference (Phase 2) and corrective Zod retry (Phase 2 cleanup) stay as-is.

**Risk:** Pro might overweight creative_vision and ignore mood/quality constraints. Mitigation: prompt explicitly orders signals — hard requirements first, aesthetic guidance second, creative_vision third (as flavor).

**Estimated:** 1-2 agent sessions.

### W3 — Copywriter agent update

**Files touched:**
- `src/agents/copywriter.ts` — output overlay text per slot, in addition to existing hooks/captions/CTAs
- `src/agents/prompts/copywriter.md` — instructed to read creative_vision + per-slot text_overlay structure (style, position, char_target) + slot context (what's happening visually)

**Changes:**
- Copywriter currently produces hooks, captions, CTAs. Now also produces overlay text per slot.
- Each overlay respects the `char_target` set by CD.
- Each overlay informed by slot content (clip description), style hint (e.g. "label" → terse exercise name; "bold-center" → punchy statement), and global creative_vision (tone consistency).

**Risk:** Coordination between CD's structural decisions and Copywriter's text fills. Mitigation: Copywriter prompt explicitly references CD's per-slot constraints AND creative_vision. Validate by reviewing operator-facing briefs after generation.

**Estimated:** 1-2 agent sessions.

### W4 — Remotion parameterized composition

**Files touched:**
- `src/remotion/Composition.tsx` — full rewrite
- `src/remotion/colorTreatments.ts` — new file, defines the 8 LUTs/CSS filters
- `src/remotion/transitions.ts` — new file, implements all transition_in and internal_cut_style behaviors
- `src/remotion/SlotRenderer.tsx` — new file, renders a single slot per CD's specifications
- `src/remotion/OverlayRenderer.tsx` — handles overlay style/position/animation per CD spec
- `src/workers/render.ts` — passes the full brief into Remotion props instead of template-specific config

**Architecture:**
- One top-level `<Composition>` consumes the entire brief
- Iterates over `segments[]`, renders each via `<SlotRenderer brief={brief} segment={segment} index={i} />`
- `<SlotRenderer>` reads its segment's pacing, cut_duration_target_s, internal_cut_style, decides clip cut sequence
- `<OverlayRenderer>` reads segment.text_overlay, positions and animates the operator-visible text
- Color treatment applied as a top-level filter over the entire video using the chosen LUT
- Transitions applied at slot boundaries via `<Sequence>` overlap with the previous slot

**Variable slot count:** Composition computes total frame count from `segments.reduce((sum, s) => sum + s.cut_duration_target_s * fps, 0)`. No hardcoded slot count anywhere.

**Color treatments (initial CSS filter chain values, refine in W4):**
- `warm-vibrant`: `saturate(1.2) brightness(1.05) hue-rotate(-5deg)`
- `cool-muted`: `saturate(0.7) brightness(0.95) hue-rotate(15deg)`
- `high-contrast`: `saturate(1.1) contrast(1.3) brightness(0.95)`
- `soft-pastel`: `saturate(0.8) brightness(1.1) contrast(0.9)`
- `moody-dark`: `saturate(0.8) brightness(0.85) contrast(1.2)`
- `natural`: `saturate(1.0)` (effectively no-op)
- `golden-hour`: `saturate(1.15) brightness(1.05) sepia(0.15) hue-rotate(-10deg)`
- `clean-bright`: `saturate(0.95) brightness(1.15) contrast(1.05)`

These are starting points. LUT files would be more accurate but more work. CSS filters are good enough for v1 and ship faster. Operator can request adjustments after first production runs.

**Cut styles:**
- `hold` — single clip, no internal cuts, full duration
- `hard-cuts` — split clip into N internal cuts (N derived from energy_level), no transition between
- `soft-cuts` — split with crossfade transitions between internal cuts

**Transitions:**
- `hard-cut` — 0-frame transition, instant
- `crossfade` — 0.3-0.5s opacity blend
- `slide` — directional swipe (default direction; can be parameterized later)
- `zoom` — scale + fade combo
- `whip-pan` — fast horizontal motion blur (Remotion plugin or hand-rolled)
- `fade-from-black` — for slot 0 only, fade in from black

**Plugin policy:** OK to add npm dependencies like `@remotion/transitions` where they save significant implementation time. Hand-roll only when necessary.

**Risk:** Remotion is a deep system and parameterized composition is much more code than templated composition. Mitigation: ship W4 in two sub-stages — first a "minimal Remotion that handles the core (slot count, color treatment, hard-cut transitions, hold internal style)", then iterate to add the rest.

**Estimated:** 4-6 agent sessions. Largest workstream and biggest unknown.

### W5 — Clean-slate ingestion + pre-normalization

**Files touched:**
- `src/lib/segment-trimmer.ts` — extend to also output a 1080p normalized version of the parent clip
- `src/scripts/migrations/007_pre_normalized_clips.sql` — add column for pre-normalized clip references
- `src/workers/ingestion.ts` — call new pre-normalization step on every new ingestion

**Architecture:**
- On ingestion, parent clip downloaded
- ffmpeg pre-normalizes to 1080p H.264 with consistent settings (resolution, color profile, audio rate)
- Normalized version uploaded to R2 at `parents/normalized/{brand}/{asset_id}.mp4`
- Segment-trimmer runs against normalized version (instead of original)
- All `clip_r2_key` references in `asset_segments` point to segments cut from normalized parents
- Render-time clip prep (the slow 6-17 min step) becomes ~1 min because clips are already at render resolution

**Clean-slate scope:** The existing 182 nordpilates segments are dropped. Operator (or content sprint when unblocked) re-uploads new content through the new pipeline. No migration of existing content.

**Risk:** ffmpeg normalization is deterministic but slow (1-3 min per parent clip). Mitigation: one-time per-clip cost paid at ingestion (not per-render), so total compute is much lower than current per-render approach. At 50-100 new clips per content sprint, total normalization time is manageable in batches.

**Estimated:** 1-2 agent sessions.

---

## Milestones

Phase 3 ships in three milestones. Each is independently deployable and testable.

### Milestone 3.1 — CD + downstream agents (behind feature flag)

**Includes:** W1, W2, W3
**Deliverable:** Brief generation produces new-schema briefs. Old Remotion ignores the new schema and either renders the old way or skips rendering entirely (both behind flag).

**Feature flag state during 3.1:**
- `ENABLE_PHASE_3_CD=false` in production initially
- Flip to `true` once 3.1 stabilizes — but only in a staging-mode where briefs go through the new path while rendering is held back
- New briefs visible via `Full Brief` sheet column (Phase 2 cleanup pipe)
- Operator validates brief quality in the sheet WITHOUT rendering — checks creative_vision coherence, energy curve sanity, color treatment fit

**Why this approach (vs. render-during-3.1-with-old-Remotion):** During the design session, we considered rendering with old Remotion using new-schema briefs. Decided against because old Remotion can't honor the new fields and the resulting "ugly Phase 2 quality with new metadata" videos contaminate the validation signal — operator can't tell whether a bad video is bad CD or bad Remotion. Cleaner to validate CD via brief reading only.

**Testable:** Operator reviews 5 generated briefs in Full Brief column. Are creative_vision paragraphs coherent? Do energy_per_slot arrays make sense for the idea seed? Does color_treatment match brand?

**Estimated:** 4-7 agent sessions for W1+W2+W3 combined.

### Milestone 3.2 — Clean-slate ingestion (parallel, independent)

**Includes:** W5
**Deliverable:** New ingestion path that pre-normalizes parent clips. New uploads use new pipeline. Existing 182 segments dropped.

**Why ship independently:** Doesn't block W1-W4. Operator can start uploading new content (when content sprint unblocks) using the new pipeline, building library inventory in parallel with W4 development.

**Testable:** Upload one new clip, verify pre-normalization happens, verify segments table has new entries with `clip_r2_key` pointing at 1080p normalized sources. Verify render time on a Phase 2 video using a new segment is faster than render time on a Phase 2 video using legacy segments (only relevant temporarily — once Phase 3 ships, all segments will be Phase 3 ingested).

**Estimated:** 1-2 agent sessions.

### Milestone 3.3 — Remotion + production flip

**Includes:** W4 + final feature flag flips
**Deliverable:** Phase 3 videos rendered end-to-end. New parameterized composition replaces `hook-demo-cta` for jobs with `composition_id = "phase3-parameterized-v1"`. Old briefs with `composition_id = "hook-demo-cta"` can no longer be rendered (acceptable — Phase 3 is a clean break).

**Feature flag flip sequence:**
1. W4 deployed to production behind `ENABLE_PHASE_3_REMOTION=false`
2. Manual smoke test: trigger one job, verify it renders end-to-end without errors
3. Flip both `ENABLE_PHASE_3_CD=true` and `ENABLE_PHASE_3_REMOTION=true` together
4. First production Phase 3 video rendered
5. Operator rates and approves/rejects via existing review_decision flow
6. Validation against success criterion (8 of 10 approve) begins

**Testable:** Render 5 production videos with different vibes, color treatments, slot counts, cut styles. Each video should look visibly different from the others. Compare side-by-side against 5 Phase 2 videos for variety improvement.

**Estimated:** 4-6 agent sessions for W4. Plus operator validation time (5-10 days of running production briefs to hit the 10-video threshold for success criterion).

---

## Brand color palettes (initial values)

These get loaded into `brand_configs.allowed_color_treatments` when migration 006 runs. Operator can edit directly in Supabase web UI until W6 ships in Phase 3.5.

### nordpilates

```
allowed_color_treatments: ["warm-vibrant", "soft-pastel", "golden-hour", "natural", "cool-muted"]
```

5 treatments. Excludes `high-contrast`, `moody-dark`, `clean-bright` as off-brand for soft wellness positioning.

### carnimeat

```
allowed_color_treatments: ["high-contrast", "warm-vibrant", "moody-dark", "natural", "clean-bright"]
```

5 treatments. Excludes `cool-muted`, `soft-pastel`, `golden-hour` as too soft for the bold masculine positioning.

### Other brands (welcomebaby, nodiet)

Deferred. Will be set when those brands begin Phase 3 video production. Initial proposal in design plan above; refine based on actual brand identity at that time.

---

## Schema migrations

| # | Migration file | Purpose |
|---|---|---|
| 006 | `006_brand_configs_color_treatments.sql` | Add `allowed_color_treatments TEXT[]` to brand_configs. Backfill nordpilates and carnimeat with locked values above. |
| 007 | `007_pre_normalized_clips.sql` | Add `pre_normalized_r2_key TEXT` to assets table (W5) |

Migrations 008+ as needed during implementation. Migration runner from Phase 2 cleanup (`apply_migration_sql` RPC + `apply-migration.ts`) handles all without new infrastructure.

---

## Feature flag strategy

Phase 3 ships behind two feature flags:

- `ENABLE_PHASE_3_CD`: gates the new Creative Director output schema
- `ENABLE_PHASE_3_REMOTION`: gates the new Remotion parameterized composition

Both default `false` in production until Milestone 3.3 final flip. Flipped together to avoid intermediate ugly-render state.

Old code paths (Phase 2 CD prompt + `hook-demo-cta` Remotion template) preserved during rollout for instant rollback if Phase 3 video quality regresses.

After 8 of 10 consecutive Phase 3 approvals, old code paths can be removed in a Phase 3.5 cleanup commit.

---

## Operator workflow during Phase 3

### Editing brand_config (until W6 ships)

Worker logs into Supabase web UI → Tables → `brand_configs` → finds brand row → edits `allowed_color_treatments` array directly. Saves. Effective immediately on next CD generation.

This is a temporary workflow until W6 (Brand Settings sheet sync) ships in Phase 3.5. Documented here so operator knows the path during Phase 3.

### Setting per-video vibe

Worker adds new optional `Vibe` column to the Jobs sheet. Types free-text vibe per row, e.g. "gentle morning energy" or "punchy gym hype." S1 workflow needs minor update to pass Vibe through to Supabase as part of job creation. Specifically: S1's "Validate Brand & Build Payload" code node adds `vibe: ideaSeedClean.vibe` (or similar) to the supabaseBody object.

If Vibe column is empty, CD picks vibe autonomously based on idea_seed.

### Reviewing Phase 3 briefs

Same as today via the `Full Brief` sheet column. Phase 3 briefs will be richer (creative_vision paragraph, color_treatment, energy curve visible per slot). Format stays the same shape.

---

## Estimated total effort

- W1: 2-3 sessions
- W2: 1-2 sessions
- W3: 1-2 sessions
- W4: 4-6 sessions
- W5: 1-2 sessions

**Total: 9-15 agent sessions across 2-3 weeks.** Plus operator validation time post-3.3 to hit the 10-video success threshold.

Phase 3 is roughly 3x the size of Phase 2 cleanup.

---

## Open during Phase 3 (resolve as we go)

Items that don't block design but need decision during implementation:

- **Exact CSS filter values per color treatment** — initial values in W4 doc above, refine during W4 implementation based on actual rendered video appearance
- **Whip-pan transition implementation** — Remotion plugin (`@remotion/transitions` or community package) vs hand-rolled. Decide during W4.
- **CD prompt examples** — three example briefs (cozy, punchy, instructional) drafted during W1 implementation
- **Sheet `Vibe` column position** — add to existing Jobs sheet, pick column letter when ready (probably new column right after `Idea Seed`)
- **S1 workflow update** — small change to pass Vibe through to Supabase. Coordinate with W1.

---

## Document status

- This doc — Phase 3 master design, source of truth for all Phase 3 work
- `VIDEO_PIPELINE_ARCHITECTURE_v4_0.md` — architecture reference, points to this doc for Phase 3 specifics
- `MVP_PROGRESS (6).md` — living progress tracker, references this doc for current phase
