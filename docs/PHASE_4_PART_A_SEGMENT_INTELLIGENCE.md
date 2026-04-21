# Phase 4 Part A — Segment Intelligence

**Status:** In progress. W0a shipped, W0b.1 shipped, W0b.2 next.
**Success criterion:** Produce rich, structured, reliable segment metadata that every downstream stage (Planner, Visual Director, Coherence Critic, retrieval RPC) can depend on without second-guessing. "Perfect clips + metadata + semantics."
**Blocks:** Phase 4 Part B (Pipeline) — no downstream work ships until segment backfill completes.

---

## Why Part A exists

The previous iteration of Phase 4 jumped directly to multimodal pipeline work (keyframe grids for Director, Coherence Critic) without fixing the foundation it all builds on. Segment metadata quality determines the ceiling of everything downstream:

- **Planner** (text-only structural skeleton) queries `library_inventory` — aggregated from segment tags + body_regions. Weak tags → weak inventory → Planner designs around imagined content.
- **Match_segments_v2 RPC** retrieves candidates via pgvector embedding of `description` + tag filters. Weak descriptions → wrong candidates in the 18-candidate pool.
- **Visual Director** reads candidate descriptions alongside keyframe grids. Weak descriptions → less grounding for picks.
- **Coherence Critic** enforces subject continuity from structured subject fields. No structured subject → no continuity enforcement.

Fix the foundation first. Then rebuild the pipeline on it (Part B).

---

## Architecture

### Two-pass analysis

**Pass 1 — Boundary detection.**
- Input: full parent clip at 1 FPS (Gemini default)
- Output: array of `{start_s, end_s, segment_type, preliminary_notes}`
- Cheap. Identifies cut points and rough type classification.

**Pass 2 — Deep analysis.**
- Input: parent clip + `videoMetadata.start_offset/end_offset/fps=5` clipping to one segment
- Output: full `SegmentV2` object (see schema below)
- Expensive per call but cheap per frame. Re-analyzes only the 30-60 frames of one segment at 5 FPS for biomechanical detail, form assessment, subject descriptors, editorial hints, OCR.

**Why two passes:** single-pass at 1 FPS misses rep-level detail on fast movements. Single-pass at 5 FPS on the full parent wastes tokens on setup/transition moments. Two-pass spends compute where it matters.

### Per-parent batching (critical)

Upload parent clip to Gemini Files API **once**. Reuse the upload URI across Pass 1 + all Pass 2 calls. Delete once when parent's segments are all analyzed.

For a parent with 5 segments:
- **Naive (one upload per call):** 6 uploads + 6 waits-for-ACTIVE + 6 delete-file calls
- **Batched:** 1 upload + 1 wait + 6 generateContent calls + 1 delete

With ~20s per upload, batching saves ~100s per parent with 5 segments. Across 191 parents: ~5 hours saved.

### SDK usage

- **New code:** `@google/genai` (unified Gen AI SDK). This is Google's current recommended SDK, uses `responseSchema`, `responseMimeType`, `videoMetadata` natively.
- **Legacy code:** `@google/generative-ai@^0.24.1` (old SDK). Stays in place for existing ingestion/curator until post-W0d cleanup.
- **Don't mix.** New files import from `@google/genai`; existing files untouched.

---

## SegmentV2.1 Schema

**Location:** `src/agents/segment-analyzer-v2-schema.ts` (canonical Zod definition).

```typescript
import { z } from 'zod';

// CRITICAL: Gemini 3.1 Pro responseSchema REJECTS NON-STRING ENUMS.
// Any field that seems like it should be numeric-categorical (count, 
// schema_version) MUST be z.enum with string values. Convert at consumer.

export const SegmentV2Schema = z.object({
  // === Timing ===
  start_s: z.number().min(0),
  end_s: z.number().positive(),

  // === Classification ===
  segment_type: z.enum([
    'setup', 'exercise', 'transition', 'hold',
    'cooldown', 'talking-head', 'b-roll', 'unusable',
  ]),

  // === Subject ===
  subject: z.object({
    present: z.boolean(),
    count: z.enum(['1', '2', '3+']),  // STRING enum per Gemini constraint
    primary: z.object({
      hair_color: z.enum([
        'blonde', 'brunette', 'black', 'red',
        'gray', 'other', 'unclear',
      ]),
      hair_style: z.enum([
        'loose', 'ponytail', 'bun', 'braid',
        'short', 'other', 'unclear',
      ]),
      top_color: z.string(),
      top_type: z.enum([
        'sports-bra', 'tank', 't-shirt',
        'long-sleeve', 'crop', 'hoodie', 'other',
      ]),
      bottom_color: z.string(),
      bottom_type: z.enum([
        'leggings', 'shorts', 'joggers', 'bare-legs', 'other',
      ]),
      build: z.enum([
        'slim', 'athletic', 'average',
        'curvy', 'muscular', 'unclear',
      ]),
    }).nullable(),
  }),

  // === Exercise (with confidence + form rating) ===
  exercise: z.object({
    name: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low', 'none']),
    body_regions: z.array(z.string()).max(5),
    form_cues_visible: z.array(z.string()).max(8),
    form_rating: z.enum([
      'excellent_controlled',
      'beginner_modified',      // legitimate modification, not deficiency
      'struggling_unsafe',
      'not_applicable',
    ]),
  }),

  // === Motion ===
  motion: z.object({
    velocity: z.enum(['static', 'slow', 'moderate', 'fast']),
    range: z.enum(['micro', 'small', 'medium', 'large']),
    tempo: z.enum(['steady', 'accelerating', 'decelerating', 'varied']),
    rep_count_visible: z.number().int().nullable(),
    movement_phase: z.enum([
      'setup', 'active-reps', 'hold', 'release', 'transition',
    ]),
  }),

  // === Framing ===
  framing: z.object({
    angle: z.enum([
      'front', 'side', 'three-quarter', 'overhead', 'low', 'back',
    ]),
    distance: z.enum(['close-up', 'medium', 'wide']),
    stability: z.enum(['locked', 'minor-drift', 'handheld-shaky']),
    subject_position: z.enum([
      'center', 'left-third', 'right-third', 'off-center',
    ]),
  }),

  // === Setting (with on-screen text) ===
  setting: z.object({
    location: z.enum(['studio', 'home', 'gym', 'outdoor', 'other']),
    lighting_quality: z.enum([
      'bright-natural', 'warm-indoor', 'cool-indoor', 'mixed', 'dim',
    ]),
    equipment_visible: z.array(z.string()).max(8),
    on_screen_text: z.string().nullable(),  // OCR of burned-in text
  }),

  // === Audio (renamed from 'speech'; adds audio_clarity) ===
  audio: z.object({
    has_speech: z.boolean(),
    transcript_snippet: z.string().max(100).nullable(),
    speech_intent: z.enum([
      'instruction', 'inspiration', 'narration', 'ambient', 'none',
    ]),
    audio_clarity: z.enum([
      'studio-clear',
      'clean-indoor',
      'echoey-room',
      'background-noise',
      'muted-or-unusable',
    ]),
  }),

  // === Quality ===
  quality: z.object({
    sharpness: z.number().int().min(1).max(5),
    lighting: z.number().int().min(1).max(5),
    subject_visibility: z.number().int().min(1).max(5),
    shakiness: z.number().int().min(1).max(5),     // 5 = most stable (inverted)
    overall: z.number().int().min(1).max(10),
  }),

  // === Editorial (enum suitabilities, not numeric scores — LLM clustering bias) ===
  editorial: z.object({
    best_in_point_s: z.number(),
    best_out_point_s: z.number(),
    unusable_intervals: z.array(z.object({
      start: z.number(),
      end: z.number(),
      reason: z.string(),
    })),
    hook_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
    demo_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
    transition_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
  }),

  // === Narrative + tags (for pgvector + existing retrieval compat) ===
  description: z.string().min(50).max(500),
  visual_tags: z.array(z.string()).min(8).max(15),
  recommended_duration_s: z.number().min(0),

  // === Versioning ===
  schema_version: z.literal('2'),  // STRING literal per Gemini constraint
});

export type SegmentV2 = z.infer<typeof SegmentV2Schema>;

// Pass 1 output (lightweight, for boundary detection only)
export const BoundariesPassSchema = z.array(z.object({
  start_s: z.number(),
  end_s: z.number(),
  segment_type: z.enum([
    'setup', 'exercise', 'transition', 'hold',
    'cooldown', 'talking-head', 'b-roll', 'unusable',
  ]),
  preliminary_notes: z.string().max(200),
}));
```

### Schema rationale (key decisions)

- **Enums over numeric scores** for categorical judgments. LLMs cluster numeric scores around 7-8; enums map tokens to visual features more reliably.
- **`form_rating` acknowledges modifications as legitimate.** `beginner_modified` is valid form for that body, not a deficit. This is content gold for authentic/relatable brand pillars.
- **`editorial.best_in/out_point_s`** is the highest-leverage field — lets downstream trim to the best 3-5 seconds of a 12-second segment.
- **Subject descriptors are structured, not embedded in description.** Enables exact matching for subject continuity ("same brunette across slots 1-3").
- **`on_screen_text` prevents overlay collisions.** If a UGC creator burned "DAY 14" in, the Director knows to not overlay conflicting text.
- **`audio_clarity` drives music-ducking decisions** downstream. 5-tier enum because most UGC falls in the middle.
- **`description` kept as narrative** for pgvector embedding. Generated FROM the structured fields to ensure consistency.
- **`visual_tags` kept for current retrieval RPC compat.** Migration of queries to structured JSONB fields happens in Part B.
- **`schema_version: '2'`** enables dual-schema period during backfill (v1 rows + v2 rows coexist until cutover).

---

## Pass 1 prompt (`src/agents/prompts/segment-analyzer-v2-pass1.md`)

```
You are a video editor scanning UGC fitness footage for SEGMENT BOUNDARIES.
Input: ONE parent clip at 1 FPS. Output: array of cut points with type + 
preliminary observation. You are NOT producing final metadata — a second 
pass re-analyzes each segment at higher FPS with the full schema.

WHEN TO CUT — segment boundaries occur when ANY of:
  - exercise or movement changes
  - body position changes (supine/prone/kneeling/standing)
  - side or limb switches (left leg → right leg = NEW segment)
  - rep tempo or intensity changes
  - camera framing shifts
  - subject performing vs resting/adjusting

DURATION LIMITS:
  - Exercise segments: MAX 12 seconds (split longer continuous exercises
    at natural rep boundaries)
  - Hold segments: MAX 15 seconds
  - All other types: MAX 20 seconds
  - Minimum for all: 1.5 seconds

SEGMENT TYPES:
  setup | exercise | transition | hold | cooldown | talking-head | b-roll | unusable

For each segment, output:
  - start_s (0.1s precision)
  - end_s (0.1s precision, > start_s)
  - segment_type
  - preliminary_notes (max 200 chars): one-line hint for pass 2

BRAND CONTEXT: {brandContext}

OUTPUT: JSON array. No prose. No code fences.
```

---

## Pass 2 prompt (`src/agents/prompts/segment-analyzer-v2-pass2.md`)

Must include:
1. **Failure-modes preamble** (prevent the four known failure patterns: prep-mistaken-for-exercise, subject-identity-missing, generic-descriptions, wrong-editorial-hints)
2. **Chain-of-Thought reasoning steps** (Temporal → Spatial → Biomechanical → Auditory → Visual Text) before filling fields
3. **Field-level rules** for each enum (what distinguishes `excellent_controlled` from `beginner_modified`, etc.)
4. **Pass 1 context injection** (`{pass1_segment_type}`, `{pass1_notes}`, `{start_s}`, `{end_s}`, `{duration_s}`)
5. **Hard constraints** — crucially including:
   > If `audio.has_speech` is true, `audio.transcript_snippet` MUST NOT be null. Extract the first 100 characters of intelligible speech.

The transcript constraint is the W0b.2 fix for a regression in W0b.1 where CoT preamble diverted attention from transcription.

---

## Code structure

```
src/
  agents/
    segment-analyzer-v2-schema.ts     # Zod schema (SegmentV2, BoundariesPass)
    gemini-segments-v2.ts             # single-pass analyzer (W0a)
    gemini-segments-v2-batch.ts       # per-parent batched analyzer (W0b.3)
    prompts/
      segment-analyzer-v2-pass1.md    # boundary detection
      segment-analyzer-v2-pass2.md    # deep analysis
  lib/
    retry-llm.ts                      # existing withLLMRetry wrapper
  scripts/
    prototype-segment-v2.ts           # W0a test harness (3 segments)
    validate-pass1-boundaries.ts      # W0b.2 diff tool vs v1
    smoke-parent-v2.ts                # W0b.3 end-to-end per-parent
    migrations/
      008_segment_v2_sidecar.sql      # ADD COLUMN segment_v2 JSONB
```

### Canonical new-SDK call pattern

```typescript
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Upload parent ONCE
const file = await ai.files.upload({
  file: localPath,
  config: { mimeType: 'video/mp4' },
});

// Poll for ACTIVE state (existing pattern)
await waitForActive(file.name);

// Per-segment Pass 2 call (reuses upload)
const response = await ai.models.generateContent({
  model: process.env.GEMINI_INGESTION_MODEL!,  // 'gemini-3.1-pro-preview'
  contents: [{
    role: 'user',
    parts: [
      {
        fileData: { fileUri: file.uri, mimeType: file.mimeType },
        videoMetadata: {
          startOffset: `${segment.start_s}s`,
          endOffset: `${segment.end_s}s`,
          fps: 5,
        },
      },
      { text: pass2PromptFilled },  // text AFTER video (best practice)
    ],
  }],
  config: {
    responseMimeType: 'application/json',
    responseSchema: zodToJsonSchema(SegmentV2Schema, {
      name: 'SegmentV2',
      $refStrategy: 'none',  // Gemini rejects $ref-heavy schemas
    }),
    temperature: 0.3,
  },
});

const parsed = SegmentV2Schema.parse(JSON.parse(response.text!));

// Delete ONCE after all segments processed
await ai.files.delete({ name: file.name });
```

---

## Sub-workstreams (W0a through W0d)

### W0a — Prototype (SHIPPED, commit afde783)
- Schema defined, Pass 2 analyzer built, prototype run on 3 test segments
- Results: all 3 Zod-clean, rich metadata, editor-usable cut hints
- Wall time: 27-42s/segment

### W0b — Integration prep (IN PROGRESS)
- **W0b.1 DONE** (commit 0a024f0): Schema v2.1 deltas applied (`form_rating` refined, `on_screen_text` added, `speech` → `audio` rename + `audio_clarity`). Prototype re-run. Zod-clean. Wall time 27-102s/segment.
- **W0b.2 NEXT**: Pass 1 boundary validation on 3 parents + transcript regression fix.
- **W0b.3 PENDING W0b.2 APPROVAL**: Per-parent batching + end-to-end smoke on 1 parent. Migration 008 created but not applied.

### W0c — Production integration (NOT STARTED)
- Apply migration 008 (segment_v2 JSONB sidecar column)
- Feature flag `ENABLE_SEGMENT_V2=false` (default) in ingestion worker
- Integrate `analyzeParentEndToEndV2()` into `workers/ingestion.ts` behind the flag
- Backfill script with:
  - Progress checkpointing (resumable after crash/restart)
  - Partial-failure recovery (skip rows that fail, log, continue)
  - 4-way parallel parent processing
  - Dry-run mode for testing without DB writes

### W0d — Backfill execution (NOT STARTED)
- Pause S8 ingestion workflow for clean cutover (all-or-nothing)
- Run backfill overnight
- Target: ~903 existing segments in ~2-4 hours with 4-way parallel
- Validate output: 100% `segment_v2` populated, all Zod-clean, no nulls in required fields
- Cutover: update retrieval RPCs to prefer `segment_v2` fields when present, fall back to v1 otherwise
- Re-enable S8; new ingestion uses V2 path going forward

---

## Test segments (approved for W0a/W0b use)

- **Exercise:** `f9788090-f755-4bf1-afd1-6272df9fe225` — spider plank right leg, blonde ponytail, outdoor beach, 4.5s
- **Hold:** `03c60575-5b59-45e1-b69e-e5c2aa70c38d` — forearm plank, blonde ponytail, outdoor patio, 7s
- **Talking-head:** `f36d686b-9afc-47cf-a067-67edf59321ac` — blonde loose hair, blue tank, home kitchen, 5s

These cover: canonical Pilates move + static hold + non-exercise code path + likely-speech clip. All 3 have parent assets with `pre_normalized_r2_key` populated.

> ⚠️ **UUID drift (2026-04-21):** the three UUIDs above predate W0d's destroy-and-rebuild re-segmentation. They no longer exist in `asset_segments`. For post-W0d test runs, query the live v2 library (`SELECT id FROM asset_segments WHERE segment_v2 IS NOT NULL AND segment_type = '<type>' LIMIT 1`) and pick a current segment. See `docs/followups.md#part-a-test-segment-uuid-drift`.

---

## Cost & latency projections

### Per-segment (Pass 2 only, no upload amortization)
- W0a single-pass average: 33s wall time
- W0b.1 with v2.1 schema: 27-102s wall time (high variance from Files API polling)

### Per-parent batched (Pass 1 + all Pass 2 + 1 upload + 1 delete)
- Estimate: 5-6 min per average parent (4.7 segments avg)
- 191 parents × 5.5 min = ~17 hours serial
- With 4-way parallel parents: ~4.5 hours

**W0b.3 smoke script must report real per-parent timing** — estimate above is preliminary.

### Cost (Gemini 3.1 Pro Preview)
- Gemini credits cover current workload
- Token cost: ~300 tokens/sec of video at default resolution, 100/sec at low resolution
- At 5 FPS for a 10s segment = 50 frames × 258 tokens = ~13K tokens per segment Pass 2
- Full backfill estimated < 100M tokens total — within available credits

---

## Known risks & mitigations

| Risk | Mitigation |
|---|---|
| Gemini returns invalid JSON despite `responseSchema` | Zod parse at consumer; retry 2x with `withLLMRetry` |
| Files API upload fails intermittently | Log, retry, fail segment (not parent) if retries exhaust |
| Pass 1 produces boundaries worse than v1 | W0b.2 gate — don't proceed to backfill if Pass 1 is worse |
| Backfill interrupts mid-run | W0c: checkpoint after every parent, resumable |
| Mixed schema period breaks queries | Dual-read pattern: prefer segment_v2 if present, fall back to v1 fields |
| Credits run out mid-backfill | Pause, reassess; single largest cost is backfill itself, production ingestion is lower volume |
| Schema field turns out to be unreliable post-backfill | Migration 009+ can alter JSONB without re-backfilling all rows |

---

## Success criteria (what "done" looks like)

Part A is complete when:

- [ ] All 903+ existing segments have `segment_v2` populated with Zod-clean v2.1 JSON
- [ ] All new ingested segments produce v2.1 output via two-pass analyzer
- [ ] Wall time per parent stays under 10 minutes in practice (4-way parallel backfill completes overnight)
- [ ] Retrieval RPCs prefer v2 structured fields where present
- [ ] Feature flag `ENABLE_SEGMENT_V2=true` is the default; v1 path is deprecated
- [ ] Part B work (Planner, Director, Critic, Copywriter) can be confidently written against v2 schema assumptions

At that point: Part B starts.
