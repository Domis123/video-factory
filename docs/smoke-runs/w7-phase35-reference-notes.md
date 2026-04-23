# W7 — Phase 3.5 Copywriter Reference Notes

**Authored:** 2026-04-23 (W7 pre-work, commit 1)
**Source reads:** `src/agents/copywriter.ts` (274 lines, Phase 3.5), `src/agents/prompts/copywriter.md` (Phase 3.5 prompt), 5 live `jobs.context_packet.copy_package` rows from Supabase (nordpilates, mixed statuses — `human_qa`, `brief_review`; no `delivered` rows for this brand yet).

Purpose: inventory what Phase 3.5 got right, what Part B inputs supersede, and what to drop. This file is the design anchor for W7 Commits 2-4 (schema, prompt, agent). If an implementation choice in W7 differs from Phase 3.5, the decision is logged here.

---

## Conventions to INHERIT verbatim

### Caption shape (three platform strings, distinct tone per platform)

Phase 3.5 pattern confirmed by Supabase samples:

- **TikTok**: short, emoji-bearing, often hashtag-as-hook at end. Examples pulled: 70-120 chars typical; one or two emojis; frequently ends `#wellness #pilates` or similar.
- **Instagram**: longer prose, paragraph breaks (`\n\n`), emoji-rich, wellness-adjacent vocabulary ("flow", "softness", "breathe", "queen energy"). Examples pulled: 200-500 chars, 1-3 paragraphs.
- **YouTube**: SEO-keyword-dense description format. Examples: `"morning pilates routine for beginners — gentle flow for..."` — reads as a discoverability-optimized description, not a hook.

W7 inherits: per-platform distinct voice (not the same string copy-pasted three times), paragraph formatting in IG, SEO-dense in YT.

### Hashtag conventions

Supabase samples showed **5 TikTok / 7 Instagram / 7 YouTube** per video, all lowercase, all `#prefix` regex-valid. Mix of brand-generic (`#pilates`, `#wellness`), trend-adjacent (`#fyp`, `#shorts`), and brand-specific (`#pilatesgirlie`, `#queenenergy`).

W7 inherits: the observed count range (3-15 is the W7 Zod bound; production Phase 3.5 lives around 5-7 per platform per video), the lowercase + `#` prefix regex, the mix of tiers (broad-trend + niche-brand).

### Voice register (nordpilates-specific, learned from 5 samples)

- **Emotional lexicon**: "gentle", "mindful", "queen energy", "flow", "softness", "breathe", "morning deserves this", "softness over soreness".
- **Emoji use**: frequent but not spammed — one to three per caption, clustered at end or as a paragraph-break marker (🌅, 🧘🏼‍♀️, ✨).
- **Never hard-sell**: no "BUY NOW", no "LIMITED TIME", no "click link in bio for discount". Even the CTA when present is soft ("save this flow", "follow for more gentle movement").
- **Rarely first-person** — observed consistent: the persona speaks to the viewer or about the practice, not autobiographically. Exception noted: one sample used `"I"` in a vulnerability-hook; Phase 3.5 did NOT police this per-video.

W7 inherits: the voice register entirely. BrandPersona.voice tenets (from W2) are the load-bearing input; this observed register is evidence that Phase 3.5 rendered that persona correctly, so the same prompt-injection pattern (full persona prose body) is the pattern W7 uses.

### Hook variants

Phase 3.5 emitted 2-3 `hook_variants[]` per video with a `{text, style}` shape. Styles observed across samples: `curiosity`, `challenge`, `fomo`, `comfort`, `vulnerability`, `surprise`, `inspiration`. A/B selection at render time (not by this agent).

W7 changes this to a **single** hook object (see DROP section) — variants move to an optional W9 concern if operator wants multi-variant A/B testing later. The styles vocabulary is still useful as a learning signal for hook_mechanism → text mapping but not as a schema field.

### Prompt structure (preserved patterns)

From `src/agents/prompts/copywriter.md` (~8.5KB):

- Text Overlay Style Guide up top (with examples per style)
- CRITICAL STYLE RULE block (only `label` names what's on screen)
- Priority Order explicit: style → char_target → selected clips → clip context → creative_vision
- Full brief JSON appended after structured context

W7 inherits: the top-of-prompt rule block pattern (W7 uses "Pipeline Invariant" + "Anti-homogenization preamble" instead, but the shape — a prominent, bolded, non-negotiable block at the top — is the inherited pattern).

### Anthropic-side parse reliability

Phase 3.5 uses `text.match(/\{[\s\S]*\}/)` for Claude response extraction. This is a Claude-specific necessity (Sonnet returns prose wrapping JSON). W7 switches to Gemini + `responseSchema: application/json` — so the regex extraction goes away, but the **pattern of defensive parsing + retry on parse-fail** is the inherited pattern (via `stripSchemaBounds()` + `withLLMRetry` wrapper + parse-fail retriable matcher).

### `withLLMRetry` wrapper

Phase 3.5 wraps the Claude call in `withLLMRetry({ label: 'copywriter' })`. W7 does the same with its own label — the retry pattern (429/502/503/504/529/network) is identical; the retry-fail signal (Zod pass + semantic throw = NO retry) is net-new in W7 per Rule 38.

---

## Conventions to EXTEND

### Overlay shape — the biggest divergence

**Phase 3.5** per-overlay shape:

```ts
{
  segment_id: number;              // 0-indexed slot pointer
  text?: string;                    // if no sub_overlays
  char_count?: number;              // redundant but present
  timing?: { appear_s: number; duration_s: number };
  sub_overlays?: Array<{            // mutually exclusive with text
    text: string;
    char_count: number;
    timing: { appear_s: number; duration_s: number };
  }>;
}
```

Overlay STYLE (visual/typographic) is carried in `brief.segments[i].text_overlay.style` — one of `bold-center | subtitle | label | cta | minimal | none`. The Copywriter reads the style but does NOT emit it on the overlay output (style is owned by the Creative Director's brief; Copywriter writes the text that fits the style).

**W7** shape (per brief §Outputs):

```ts
{
  slot_id: string;                  // string, not number (matches W5 StoryboardPicks)
  overlay: {
    type: OverlayType;              // 'label' | 'cue' | 'stamp' | 'caption' | 'count' | 'none'
    text: string | null;            // null iff type === 'none'
    start_time_s: number;
    end_time_s: number;              // both bounded by slot.target_duration_s
  };
  reasoning: string;                // 10-300 chars, Copywriter explains the pick
}
```

Key extensions:
1. **`type` now lives on the overlay**, owned by Copywriter (not Creative Director). The enum values are W7-native (`label | cue | stamp | caption | count | none`) and their semantics differ from Phase 3.5's style enum (`bold-center | subtitle | label | cta | minimal | none`). Mapping is NOT one-to-one:
   - `label` retained (names the exercise; strictest semantic validation)
   - `cta` folded into top-level `cta_text: string | null` (single CTA per video, not per-slot)
   - `bold-center | subtitle | minimal` collapsed into `caption` (narrative text, prose)
   - `cue | stamp | count` are **net-new** (instructional prompt, high-contrast emphasis, rep counter)
   - `none` retained verbatim
2. **`slot_id` is a string**, not a zero-indexed number. Matches W5 StoryboardPicks which keys slots by string slot_id from Planner output.
3. **Timing split** into `start_time_s` + `end_time_s`, both bounded by slot duration. Phase 3.5 used `{appear_s, duration_s}` (relative to video start, with duration = full slot). W7 allows overlays to be **sub-ranges** within a slot, giving the Copywriter freedom to draw a label at 0.5-2.0s of a 3-second slot instead of full slot duration.
4. **`reasoning` is now required per-slot**. Phase 3.5 had no per-slot reasoning; Copywriter acted as a text generator with opaque judgment. W7 forces the agent to name the pick basis in 10-300 chars — aligns with W5 Director's per-pick reasoning pattern.
5. **No `char_count` field** — redundant with `text.length`, so dropped (see DROP section).
6. **No `sub_overlays` nesting** — W7 collapses to single overlay per slot (see DROP section).

### Hook object

**Phase 3.5**: `hook_variants: Array<{text, style}>` — 2-3 items.

**W7**: single `hook` object:

```ts
{
  text: string;              // 1-120 chars
  delivery: 'overlay' | 'spoken' | 'both';
  mechanism_tie: string;     // 10-200 chars, explains how text executes planner.hook_mechanism
}
```

Extensions:
1. `delivery` enum is net-new. Phase 3.5 assumed all hooks were overlay-text (no voice layer). W7's `spoken`/`both` values are forward-compat with W10 (voice generation).
2. `mechanism_tie` field forces Copywriter to name the Planner→hook connection. Semantic validation check #4 uses this: if `delivery` includes spoken, `mechanism_tie` must reference voice/narration; if overlay-only, hook text must be ≤60 chars.

### CTA as top-level field

**Phase 3.5**: CTA was one of the overlay styles (`cta` style on the close-slot overlay). Text generated per-overlay.

**W7**: `cta_text: string | null` at the TOP level of CopyPackage. Decision driven by `form_id + close-slot energy + narrative_beat`, NOT persona (organic-content invariant lives pipeline-wide). Extensions:
1. Promoted from per-slot overlay to top-level single field — reflects the architectural truth that CTAs are video-level concerns, not slot-level concerns.
2. Nullable — `aesthetic-ambient` form or energy-descending close-slot can produce null CTA. Phase 3.5 had no mechanism for "no CTA this video"; W7 does.
3. Never hard-sell is a **prompt-level constraint** (Rule 38 enforced by semantic validation), not a per-brand toggle. Rule locked in brief §Decision 7.

### Captions — add canonical + keep platforms

**Phase 3.5**: `captions: { tiktok: string, instagram: string, youtube: string }` — 3 platform-specific strings, no canonical.

**W7**: add `canonical` as the fourth field. Total shape:

```ts
{
  canonical: string;    // 1-300 chars, the truthful thesis; not rendered
  tiktok: string;       // max 150
  instagram: string;    // max 2200
  youtube: string;      // max 5000
}
```

Extension rationale (from brief §Decision 5): per-platform trims are creative decisions (TikTok hashtag-as-hook-at-end, YT description appended). Canonical is the agent's committed thesis that each platform variant riffs on. Keeps the three platform trims from drifting into three unrelated captions.

### Segment snapshot input

**Phase 3.5**: selectedClipDescriptions: (string | null)[] — an array of description strings from `asset_segments.description`. Indexed by slot. Added in the architecture pivot (`fd63a35`) to let Copywriter match overlay text to visible content.

**W7**: full `segment_snapshots: Map<UUID, SegmentSnapshot>` keyed by picked segment_id. Extends beyond just description text to:
- `exercise.name` + `confidence` (drives `label` overlay validation)
- `setting.on_screen_text` (drives OSR collision check — Tier 3 synthetic guards this)
- `setting.location` + `setting.equipment_visible` (scene context for narrative/caption)
- `posture` (P1-P5 per Rule 41 — drives `stamp` overlay validation: requires P4/P5)
- `segment_type` (drives `count` overlay validation: requires segment_type='exercise')
- `body_focus` (scene detail)

**W6's `CandidateMetadataSnapshot` already includes `on_screen_text`** — verified via read of `src/agents/coherence-critic.ts`. The brief says "reuse Critic's snapshot shape, extend with on_screen_text" but the extension is already done. W7 reuses W6's snapshot directly via `fetchSnapshots(segmentIds)` (exported helper) — no new snapshot builder file needed.

### Metadata block

**Phase 3.5**: no metadata on the copy_package — just the content fields.

**W7**: adds `metadata: { copywriter_version: 'w7-v1', temperature: number, retry_count: number }`. Pattern from W5/W6 (reported retry count for observability).

### Voiceover script reservation

**Phase 3.5**: no voiceover field.

**W7**: `voiceover_script: z.null()` — reserved. W10 widens to `z.string() | z.null()`. Inline comment on the Zod schema names the widening.

---

## Conventions to DROP

### `char_count` field

Phase 3.5 emitted `char_count` on every overlay. This was redundant with `text.length` (Phase 3.5's `normalizeCopy` even computed it as a fallback when absent from the model response).

**W7 drops this field.** Callers compute `text?.length ?? 0` if needed. Zod has `min(1)` on hook text and `max(150/2200/5000)` on captions — the typechecking is the length enforcement.

### `sub_overlays` nested array

Phase 3.5 allowed a slot to carry 1+N overlays as a `sub_overlays` array. Rarely used in production samples (~1 of 5 rows observed) and complicates validation (per-sub timing, per-sub type, etc.).

**W7 drops this.** One overlay per slot. If a video needs multiple text appearances on a single clip, that's evidence the clip should be split into two slots at Planner level — not stitched together at Copywriter level. Aligns with W3's form-commitment principle (slot count is a Planner decision).

### `hook_variants` array (replaced by single hook)

Phase 3.5 emitted 2-3 hook_variants with different styles for A/B testing. Observed in samples; unclear if production actually switches between variants at render time or always picks the first.

**W7 drops the array.** Single `hook` object per video. Rationale:
- Brief kickoff decision: W7 is post-select, single-write; not A/B.
- The Planner has already committed to a `hook_mechanism` — the Copywriter's job is to execute that mechanism, not explore three directions.
- If A/B testing matters later, it's a W9 measurement concern (run two shadow videos with different seeds, not one video with two variants).

### Per-platform hashtag split (`tiktok[] + ig[] + yt[]`)

Phase 3.5 emitted hashtags as `{tiktok: string[], instagram: string[], youtube: string[]}` — three separate arrays.

**W7 drops the per-platform split.** Single `hashtags: z.array(string).min(3).max(15)` array. Rationale:
- Brief §Outputs specifies a single flat array (not per-platform).
- Platform-specific hashtag ordering/filtering is a render-time concern (take first 5 for TikTok, all for IG/YT caption body) — Copywriter shouldn't triplicate the same tags into three arrays.
- Zod regex `#[a-zA-Z0-9_]+` enforces the format; semantic validation check #6 enforces no-duplicates.

### Zod-less normalization

Phase 3.5's `normalizeCopy(raw, briefId)` in `copywriter.ts` does defensive field extraction + type coercion on unvalidated raw Claude output. No Zod.

**W7 drops this.** `CopyPackageSchema.parse(raw)` is the contract. Raw model output either conforms to the schema (possibly via one parse-retry on Zod failure — W5/W6 pattern) or the agent throws. No silent normalization; no `String(ov.text ?? '')` fallbacks that hide model mistakes.

Rationale: Rule 38 — validation throws loud, never silent-corrects. `normalizeCopy` is exactly the anti-pattern Rule 38 was written against.

### Anthropic/Claude SDK

Phase 3.5 uses `fetch('https://api.anthropic.com/v1/messages', ...)` with Claude Sonnet.

**W7 drops the Claude dependency.** Uses `@google/genai` + Gemini 3.1 Pro Preview per Rule 34 (new code uses `@google/genai`; never mix SDKs). Phase 3.5's Anthropic code stays untouched.

### Structured "ACTUAL SELECTED CLIPS" context block

Phase 3.5's `buildPhase3UserMessage` builds a plain-text structured block with "ACTUAL SELECTED CLIPS (write text that matches these)" listing descriptions per slot.

**W7 drops this block shape** but keeps the **intent**. W7 injects the segment_snapshot per slot as a richer structure (name + confidence + on_screen_text + location + equipment + posture + body_focus) — not just a description string. The prompt teaches the Copywriter to read each snapshot field for its purpose (e.g., on_screen_text is an OSR-collision check input, not a descriptive input).

---

## Implementation lessons noted (not dropped, not inherited — observed)

1. **The prompt is readFileSync'd at module load in Phase 3.5.** W7 does the same. Hot-reload under `tsx` works; production `npm run build` inlines via readFile — but the markdown file still needs to ship. Reinforced in CLAUDE.md's "Important Technical Notes" about segment analyzer prompt.

2. **Phase 3.5 had no test script for Copywriter.** `test-copywriter.ts` in W7 is net-new (no naming conflict). This is the first smoke artifact for Copywriter.

3. **Phase 3.5's Phase 2 vs Phase 3 discriminator** (`'creative_direction' in input.brief`) is the inherited pattern for consuming dispatched briefs, but W7 takes a different input shape entirely (PlannerOutput, not Phase3CreativeBrief) — the discriminator doesn't carry over.

4. **Mock mode fallback (`generateMockCopy`)** in Phase 3.5 triggers when `ANTHROPIC_API_KEY` is unset. W7 does NOT port this pattern — Gate A smoke runs end-to-end against live Gemini. Missing key = hard fail. If a future W8 orchestration needs mock mode, it's a W8 concern.

---

## Summary inventory

| Phase 3.5 field | W7 treatment | Where |
|---|---|---|
| `segment_id: number` | Renamed + retyped → `slot_id: string` | Extend |
| overlay `text + char_count` | Drop char_count, keep text (nullable when type=none) | Drop |
| overlay `timing.{appear_s, duration_s}` | Split → `start_time_s + end_time_s` | Extend |
| overlay STYLE (via brief) | Moved to overlay `type` owned by Copywriter, new enum | Extend |
| `sub_overlays[]` | Drop — 1 overlay per slot | Drop |
| `hook_variants[]` | Collapse → single `hook` object + `delivery` + `mechanism_tie` | Extend |
| CTA in overlay style | Promote → top-level `cta_text: string \| null` | Extend |
| `captions.{tiktok, ig, yt}` | Keep + add `canonical` | Extend (additive) |
| `hashtags.{tiktok, ig, yt}` | Collapse → single `hashtags[]` | Drop split |
| (none) | Add `reasoning` per slot | Extend |
| (none) | Add `metadata` block | Extend |
| (none) | Add `voiceover_script: z.null()` reserved for W10 | Extend |
| Claude SDK | Swap → Gemini via `@google/genai` (Rule 34) | Drop |
| `normalizeCopy` helper | Drop — Zod parses or throws (Rule 38) | Drop |
| `generateMockCopy` mock mode | Drop for W7 — Gate A is live-only | Drop |
| Voice register (observed in prod) | Inherit as-is — persona prose body drives it | Inherit |
| Per-platform caption distinctness | Inherit | Inherit |
| Hashtag counts 5-7 per video | Inherit (W7 bound is 3-15, production lands lower) | Inherit |
| Prompt top-of-file rule block | Inherit as pattern (W7's version is Pipeline Invariant + Anti-homogenization) | Inherit |
| Full persona prose injection | Inherit | Inherit |
| `withLLMRetry` retry wrapper | Inherit | Inherit |
| Defensive parse-retry on LLM variance | Inherit (widened matcher from W5) | Inherit |

---

## Decisions that are now locked for commits 2-4

1. Types file (`src/types/copywriter-output.ts`) uses the brief §Outputs Zod schema verbatim; no divergence from the shape there.
2. Prompt file (`src/agents/prompts/copywriter-v2.md`) ships the 12 sections in the brief's §Prompt design in that order.
3. Agent file (`src/agents/copywriter-v2.ts`) uses `@google/genai` + Gemini 3.1 Pro Preview, temperature 0.5, responseSchema = `stripSchemaBounds(CopyPackageSchema)`, max output tokens 4000.
4. Seven semantic validation checks are **separate functions** with distinct error class names — the W8 orchestrator needs to distinguish retriable (LLM variance) from non-retriable (prompt bug).
5. Snapshot builder: reuse `fetchSnapshots(segmentIds)` from `src/agents/coherence-critic.ts` (already exported). No new snapshot file.
6. Gate A smoke script re-runs Planner + Director + Critic(W6) chain inline (per-seed) because no disk-cached W3/W4/W5 artifacts exist. Acceptable given Gemini company credits (CLAUDE.md).

---

*End of reference notes. Commit 2 next: CopyPackage schema + overlay type enum.*
