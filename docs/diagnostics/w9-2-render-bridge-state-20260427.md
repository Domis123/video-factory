# W9.2 Render-Bridge State — Diagnostic Note

**Date:** 2026-04-27
**Investigator:** Read-only walk of render path from BullMQ → renderer →
Remotion composition, plus shape comparison of `jobs.context_packet`
(Phase 3.5, what the renderer consumes today) vs
`shadow_runs.context_packet_v2` (Part B output today).
**Investigation script:** ad-hoc probe (not retained — single-purpose).
**Anchor evidence:** Phase 3.5 job `31f0ed09…` (`brief_review`,
2026-04-26) + Part B shadow row `ff67fc55-…` (W9.1 Gate A,
`failed_after_revise_budget`).

---

## 1. `src/orchestrator/render-prep.ts` — what it actually does

**File state:** 137 lines, 1 export `prepareContextForRender<T>(context: T)
: RenderPrepResult<T>`.

**It is a NULL-SAFETY GUARD. It is NOT a translator.**

Per the file's own docstring ("Pre-enqueue Remotion null-safety guard")
the function exists exclusively to handle the `copy.voiceover_script: null`
W7 placeholder before W10 widens the field to `z.string().nullable()`.
The body branches on three cases:

| Input shape | Behavior |
|---|---|
| `vo === null` | Return context unchanged + note `"voiceover_script === null (W7 placeholder); leaving as-is"` |
| `typeof vo === 'string'` | Trim/normalize whitespace; return context with the cleaned string + note |
| anything else | Throw (Rule 38: loud throw, no silent correct) |

The function is **generic** (`<T>`) and accepts a duck-typed
`PreparableContext { copy: CopyPackage; [key: string]: unknown }`. There
is **no defined `RenderReadyContext` type** anywhere in the codebase —
the function's output type is just `T`, the same shape that came in.
There is no field-by-field shape transformation, no key remapping, no
enrichment.

**Invocation count: 0.** Grep across `src/` returns zero call sites.
The export exists; nothing imports it. It was committed in W9 as a
placeholder for the W10 voiceover-widening seam, not as a real bridge.

---

## 2. Render worker invocation path

`src/index.ts:96-103` registers a BullMQ Worker on the `rendering`
queue:

```ts
new Worker('rendering', async (job: Job<{ jobId: string }>) => {
  await runRenderPipeline(job.data.jobId);
}, { connection: redis });
```

`runRenderPipeline` (`src/workers/pipeline.ts:144`) starts with:

```ts
const contextPacket = typedJob.context_packet;
```

The renderer reads **exclusively** from `jobs.context_packet`. It never
reads `shadow_runs`, never reads `shadow_runs.context_packet_v2`, never
calls `prepareContextForRender`.

`src/workers/renderer.ts` then discriminates Phase 2 vs Phase 3 by
`'creative_direction' in contextPacket.brief`, and on the Phase 3 path
assembles `Phase3TemplateProps` directly from the Phase 3.5
`ContextPacket` shape (lines 132-145). The `copyPackage` field passes
through the Phase 3.5 `CopyPackage` from `src/types/database.ts`
unchanged.

---

## 3. Remotion composition consumption shape

The composition `phase3-parameterized-v1` is registered in
`src/templates/Root.tsx`. Its prop type
(`src/templates/types.ts: Phase3TemplateProps`):

```ts
{
  brief: Phase3CreativeBrief;        // composition_id, creative_direction, segments, audio.music
  copyPackage: CopyPackage;          // ← Phase 3.5 shape from database.ts
  clipPaths: Record<number, string | string[]>;
  transcriptions: Record<number, WordTimestamp[]>;
  logoPath: string | null;
  musicPath: string | null;
  brandConfig: BrandConfig;          // ← full BrandConfig row
  beatMap?: { tempo_bpm, first_beat_offset_s, beat_positions, duration_s } | null;
}
```

Reads inside `Phase3Parameterized.tsx` and `resolve-phase3.ts`:

| Field | Used at |
|---|---|
| `brief.creative_direction.color_treatment` | `Phase3Parameterized.tsx:23` (CSS filter) |
| `brief.audio.music.volume_level` | `Phase3Parameterized.tsx:68` (`<Audio>` volume) |
| `brief.segments[i].cut_duration_target_s` | `resolve-phase3.ts` (slot durationFrames) |
| `brief.segments[i].transition_in` | `resolve-phase3.ts` (transition kind) |
| `brief.segments[i].text_overlay.{style,position,animation}` | `resolve-phase3.ts` (overlay binding) |
| `copyPackage.overlays.find((o) => o.segment_id === i)` | `resolve-phase3.ts:22` — **Phase 3.5 overlay shape** |
| `brandConfig.{font_family, primary_color, accent_color, cta_bg_color, cta_text_color}` | `Phase3Parameterized.tsx` |

The Remotion composition is **hardwired** to the Phase 3.5
`CopyPackage.overlays[]` array indexed by integer `segment_id`. Feeding
the W7 `per_slot[]` shape (string `slot_id` like `'slot-0'`, nested
`overlay.{type,text,start_time_s,end_time_s}`) without translation
would throw at `find(o => o.segment_id === i)` returning undefined for
every slot.

---

## 4. Shape inventory — `jobs.context_packet` (Phase 3.5)

Anchor row: job `31f0ed09…`, brand `nordpilates`, status
`brief_review`, 2026-04-26.

**Top-level keys (8):**
`brand_config, brief, clips, context_packet_id, copy, created_at,
music_selection, template_config`

### `brief` (Phase3CreativeBrief, 11 keys)
```
audio: {music, strategy}
brand_id, brief_id, caption_preset, idea_seed, vibe, video_type
composition_id            ← literal "phase3-parameterized-v1"
creative_direction: {slot_count, color_treatment, creative_vision, energy_per_slot[N], subject_consistency}
segments: array(N) of:
  {type, label, pacing, transition_in, internal_cut_style, cut_duration_target_s,
   text_overlay: {style, position, animation, char_target},
   clip_requirements: {mood, body_focus, has_speech, min_quality, content_type, visual_elements, aesthetic_guidance}}
total_duration_target
```

### `copy` (Phase 3.5 CopyPackage, 5 keys)
```
brief_id
captions:    {tiktok, youtube, instagram}     ← keyed by platform
hashtags:    {tiktok, youtube, instagram}     ← keyed by platform
hook_variants: array(3) of {text, style}      ← multi-variant
overlays: array(N) of:
  {segment_id: int, text, char_count, timing: {appear_s, duration_s}}
```

### `clips` (ClipSelectionList)
```
brief_id
clip_selections: array(N) of:
  {segment_id: int, asset_id, asset_segment_id, r2_key, trim: {start_s, end_s}, match_score, match_rationale}
```

### `music_selection`
```
{r2_key, track_id, volume_level}
```

### `brand_config`
30 fields including `font_family, primary_color, accent_color, cta_bg_color,
cta_text_color, logo_r2_key, watermark_r2_key, allowed_color_treatments,
caption_preset, …`.

---

## 5. Shape inventory — `shadow_runs.context_packet_v2` (Part B)

Anchor row: `ff67fc55-1fc1-472f-8ef6-aec36e87a9c1`, terminal
`failed_after_revise_budget`, W9.1 Gate A.

**Top-level keys (7):**
`copy, critic_verdict, failure_reason, picks, planner, revise_history,
terminal_state`

### `copy` (W7 CopyPackage, 8 keys)
```
captions:        {canonical, instagram, tiktok, youtube}   ← adds canonical
hashtags:        string[]                                  ← FLAT array
hook:            {text, delivery, mechanism_tie}           ← single object, no variants
cta_text:        string | null
per_slot: array(N) of:
  {slot_id: "slot-0" | "slot-1" | …,                       ← STRING id
   overlay: {type, text, start_time_s, end_time_s},        ← absolute times, type enum
   reasoning: string}
voiceover_script: null                                      ← W7 placeholder
metadata: {copywriter_version, temperature, retry_count}
cost_usd: number                                            ← W9.1 added
```

### `planner` (PlannerOutput)
```
form_id, posture, slot_count, music_intent, hook_mechanism,
creative_vision, audience_framing, subject_consistency, cost_usd
slots: array(N) of:
  {slot_index, slot_role, subject_role, narrative_beat,
   target_duration_s, energy, body_focus, segment_type_preferences}
```

### `picks` (StoryboardPicks)
```
total_latency_ms, parallel_speedup_ratio, cost_usd
picks: array(N) of:
  {slot_index, picked_segment_id, parent_asset_id,
   in_point_s, out_point_s, duration_s,
   similarity, was_relaxed_match, same_parent_as_primary,
   reasoning, latency_ms, cost_usd}
```

### `critic_verdict`, `revise_history`, `terminal_state`, `failure_reason`
Diagnostic-only — not consumable by the renderer.

---

## 6. Delta map — what's missing or wrong-shaped

### A. Present in Phase 3.5 `jobs.context_packet`, ABSENT from `context_packet_v2`

**Renderer-blocking absences:**

| Phase 3.5 field | Why renderer needs it |
|---|---|
| `brief.composition_id` | `selectComposition({ id: composition_id })` — the literal `'phase3-parameterized-v1'` is the Remotion composition handle |
| `brief.creative_direction.color_treatment` | CSS filter pipeline in `Phase3Parameterized.tsx:23` |
| `brief.audio.music.{volume_level, …}` | `<Audio>` volume in `Phase3Parameterized.tsx:68` |
| `brief.segments[i].text_overlay.{style, position, animation, char_target}` | overlay rendering bindings in `resolve-phase3.ts` |
| `brief.segments[i].transition_in` | transition kind for `<TransitionEffect>` |
| `brief.segments[i].cut_duration_target_s` | per-slot durationFrames |
| `brief.segments[i].internal_cut_style`, `pacing`, `type`, `label` | layout, pacing markers |
| `brief.{video_type, vibe, brand_id, brief_id, caption_preset, idea_seed, total_duration_target}` | downstream metadata, QA, exporter |
| `clips.clip_selections[i].r2_key` | `downloadClips` in `renderer.ts` — **no r2_key, no playback** |
| `clips.clip_selections[i].trim: {start_s, end_s}` | ffmpeg trim parameters |
| `clips.clip_selections[i].asset_id` | parent-asset lookup for transcriptions |
| `clips.clip_selections[i].asset_segment_id` | (currently consumed by copywriter, not renderer) |
| `music_selection.{r2_key, track_id, volume_level}` | music download + playback |
| `brand_config` (full 30-field row) | colors, fonts, logo path, watermark, caption preset |
| `template_config` | (empty in anchor row but type-required) |
| `context_packet_id` | identifier for traceability |

**Bridge implication:** the orchestrator currently emits a "lean
observability blob" — Part B has no concept of r2_key, no music
selection step, no composition_id literal, no brand_config fetch.
Either the translator enriches at write time or context_packet_v2
itself must be widened.

### B. Structural shape mismatches (HARD-breaking, not just absences)

| Field | Phase 3.5 shape | W7 shape | Bridge transform required |
|---|---|---|---|
| `copy.overlays` vs `copy.per_slot` | `[{segment_id: int, text, char_count, timing: {appear_s, duration_s}}]` | `[{slot_id: "slot-0", overlay: {type, text, start_time_s, end_time_s}, reasoning}]` | Map `slot_id` ↔ integer index; flatten nested `overlay`; convert absolute `start/end_time_s` to relative `appear_s/duration_s`; drop `type` enum or repurpose; drop `reasoning`; recompute `char_count` |
| `copy.hook_variants` vs `copy.hook` | `[{text, style}]` × 3 variants | `{text, delivery, mechanism_tie}` × 1 | Wrap single hook into single-element array, drop `delivery` + `mechanism_tie`, fabricate or omit `style` |
| `copy.hashtags` | `{tiktok, youtube, instagram}` keyed by platform | `string[]` flat array | Distribute flat list across platforms (or duplicate same list across all three keys) |
| `copy.captions` | `{tiktok, youtube, instagram}` | `{canonical, tiktok, instagram, youtube}` | Drop `canonical` or use it as the fallback for missing platforms |
| `brief` (root) | full `Phase3CreativeBrief` with `composition_id, creative_direction, segments[].text_overlay/transition_in/clip_requirements, audio.music` | `PlannerOutput` with `form_id, posture, slots[].{narrative_beat, target_duration_s, energy, body_focus, …}` | Substantial: synthesize composition_id literal; translate planner.slots → brief.segments; merge in copy's per_slot timing into segment text_overlay; choose color_treatment (currently absent from Part B); fetch + attach audio.music |
| Pick-side r2_key | `clip_selections[].r2_key` | Picks have `parent_asset_id` + `in_point_s/out_point_s`, no r2_key | Look up `assets.pre_normalized_r2_key` (or `asset_segments.clip_r2_key`) by `parent_asset_id` / `picked_segment_id` |

### C. Present in `context_packet_v2`, absent from Phase 3.5 (non-blocking)

`critic_verdict, revise_history, terminal_state, failure_reason,
planner.{form_id, posture, music_intent, audience_framing, hook_mechanism},
picks.picks[].{similarity, was_relaxed_match, same_parent_as_primary,
latency_ms, reasoning}` — these are diagnostic / observability fields
the renderer would ignore. Translator can drop or carry under a
sidecar key.

---

## 7. Bridge gap assessment — **MEDIUM, leaning toward LARGE**

The optimistic read: `prepareContextForRender` is unwired, the renderer
never tries to consume `context_packet_v2`, and Phase 3.5 still owns
`jobs.context_packet`. So nothing is currently broken — Part B writes
shadow blobs, Phase 3.5 writes the real packet, renderer reads the
Phase 3.5 packet. The flag flip from Phase 3.5 → Part B is what hits
the bridge.

The pessimistic read: the bridge is not 50 lines of pass-through. It
is:

1. **A real translator function** that round-trips W7 `CopyPackage` →
   Phase 3.5 `CopyPackage`, including the `per_slot` ↔ `overlays` slot-id
   ↔ integer remap, hook flattening, hashtag distribution, captions
   merge, and absolute → relative timing conversion. (~80–150 lines)

2. **Enriched context emission inside Part B.** Either
   `orchestrator-v2.ts` widens `contextPacketV2` to carry `r2_key`,
   `asset_id`, `trim`, `composition_id`, `color_treatment`,
   `music_selection`, `brand_config` — OR the translator does the
   enrichment at render-prep time by hitting Supabase + the music
   selector. The first option is cleaner; the second decouples shadow
   write from renderer. Either way, ~100–250 lines of new code plus a
   music-selection step Part B doesn't currently have.

3. **A music-selection step in Part B.** Phase 3.5 picks music
   inside `context-packet.ts` between curator and copywriter. Part B's
   orchestrator has no music selector call. Either lift the existing
   selector into the orchestrator or run it in the translator. Adds a
   step that currently does not exist.

4. **A write path** that lands the translated Phase 3.5 packet into
   `jobs.context_packet` so the existing renderer (untouched) can
   consume it, OR a new render path that reads from
   `shadow_runs.context_packet_v2` and translates inline. Cleanest is
   the former (no renderer touch, single source of truth).

5. **End-to-end smoke** through the full bridge — the only way to
   discover translator bugs is to render a real Part B job and watch
   the output frame by frame.

This is a workstream, not a one-commit fix. Calling it "small" would
require `prepareContextForRender` already being a translator, the two
`CopyPackage` shapes being structurally compatible, and Part B already
emitting r2_keys / music / brand. None of those is true.

---

## 8. Files a render-bridge workstream would touch

**Definite:**

| File | Reason |
|---|---|
| `src/orchestrator/render-prep.ts` | Replace null-safety guard with real translator (W7 → Phase 3.5 ContextPacket). The voiceover null-safety logic stays as a sub-step. |
| `src/orchestrator/orchestrator-v2.ts` | Either enrich `contextPacketV2` to include r2_keys / music / brand_config / composition_id, OR add a post-orchestrator enrichment hook before shadow write. |
| `src/workers/pipeline.ts` (or new `src/workers/pipeline-partb.ts`) | Route Part B jobs to write the translated Phase 3.5 packet into `jobs.context_packet` so the renderer can consume it unchanged. |

**Likely:**

| File | Reason |
|---|---|
| New: `src/orchestrator/music-selector-partb.ts` (or extend existing) | Part B currently has no music selection step; needed for `audio.music` + `music_selection.r2_key`. |
| `src/agents/context-packet.ts` | If music selector is shared, refactor entry point so both Phase 3.5 and Part B can call it; otherwise no touch. |
| `src/types/orchestrator-state.ts` | Possibly extend `OrchestratorContext` with `clipR2Keys`, `musicSelection`, `brandConfig` accumulators if enrichment lives in the orchestrator. |

**Possible (depending on translator strategy):**

| File | Reason |
|---|---|
| `src/templates/resolve-phase3.ts` | If translator targets Phase 3.5 `CopyPackage.overlays[]`, no touch. If we instead teach the resolver to consume W7 `per_slot[]`, this changes — but that path makes the Remotion side a Part-B-aware consumer, which I'd avoid. |
| `src/workers/renderer.ts` | No touch if the translated packet is dropped into `jobs.context_packet`. Touch only if we route Part B jobs to a separate renderer. |
| `docs/PHASE_4_PART_B_PIPELINE.md` + `docs/HANDOFF_TO_NEW_CHAT.md` | Update bridge state once shipped. |

---

## 9. Estimated commit count

**4–6 commits**, single-gate-ineligible (this is a real code change with
new control flow + new dependencies, not a prompt iteration — Rule 42
exclusion applies; standard two-gate brief).

| # | Commit | Risk |
|---|---|---|
| 1 | `src/orchestrator/render-prep.ts` rewrite — real W7→Phase 3.5 translator (CopyPackage shape transform, hook flatten, hashtag distribute, captions merge, timing convert). Pure function, fully unit-testable. | Low — pure transform, write tests against fixture pairs |
| 2 | Music-selection step lift into Part B orchestrator (or shared helper). New code path; need to wire ctx accumulator. | Medium — touches orchestrator state machine |
| 3 | Enrich `contextPacketV2` write (or add post-orchestrator enrichment) to attach r2_keys + brand_config + composition_id. | Medium — schema-additive on shadow blob, but new Supabase reads in the orchestrator |
| 4 | Pipeline routing: Part B jobs persist translated Phase 3.5 packet into `jobs.context_packet` and enqueue render. | Medium — touches render dispatch; needs feature flag |
| 5 | End-to-end smoke (Gate A): submit one synthetic seed, run all the way through render, eyeball output. | High signal — first time the bridge runs in real life |
| 6 | Followup-resolution + docs (`HANDOFF`, `PHASE_4_PART_B_PIPELINE`, `MVP_PROGRESS`, optional remove-`prepareContextForRender`-stub-export). | Trivial |

The (5) smoke is where the calibration cost lives. Translator unit tests
against captured fixture pairs (`shadow_runs.context_packet_v2` ↔
`jobs.context_packet` from same-seed pre-W9.1 runs) catch ~80% of
shape bugs without burning Sonnet/Gemini credits.
