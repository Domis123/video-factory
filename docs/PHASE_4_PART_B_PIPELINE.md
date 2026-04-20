# Phase 4 Part B — Pipeline

**Status:** Not started. Blocked by Part A (Segment Intelligence) completing backfill.
**Success criterion:** Replace the failing Phase 3.5 CD → Curator → Copywriter flow with a pipeline that produces coherent, on-library, subject-consistent short-form videos without manual review.
**Depends on:** Part A's SegmentV2.1 schema being backfilled across all existing segments, retrieval RPCs updated to use structured fields.

---

## Why Part B exists

Phase 3.5 pipeline has three structural failure modes that a better-prompted Claude can't fix:

1. **Creative Director invents exercises the library doesn't have.** Partial fix via `library_inventory` module in Phase 3.5, but still relies on text-based exercise names rather than verified library structure.
2. **Curator selects clips that don't match intent.** pgvector retrieval + CLIP embedding midpoint keyframe + free-text description = blind selection. The curator sees "matching candidates" but can't see if they actually *show* what's claimed.
3. **Copywriter writes overlay text before clips are selected.** Words say "glute bridge" over a clip of someone getting into position. Zero enforcement of text-visual coherence.

Part A fixes the underlying metadata. Part B rebuilds the pipeline to exploit it:

- Planner sees **verified library inventory** from structured `exercise.name` + `confidence` + `body_regions`
- Visual Director sees **actual keyframe grids** from candidates, not just text
- Copywriter runs **after selection**, with access to what's actually on screen
- Coherence Critic enforces **subject continuity** from structured `subject.primary` fields

---

## Architecture overview

```
                  ┌────────────────┐
                  │  Planner       │  Gemini 3.1 Pro
                  │  (structural   │  Input: idea seed, library_inventory
                  │   skeleton)    │  Output: brief (slot types, body_focus, energy)
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ Candidate      │  Supabase RPC (match_segments_v2)
                  │ Retrieval      │  Input: brief slots
                  │                │  Output: ~18 candidates/slot (pgvector + tag filter)
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ Visual         │  Gemini 3.1 Pro (multimodal)
                  │ Director       │  Input: candidates + keyframe grids
                  │                │  Output: final clip picks
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ Coherence      │  Gemini 3.1 Pro
                  │ Critic         │  Input: storyboard (slot → clip)
                  │                │  Output: approve / revise / reject
                  └────────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ Copywriter     │  Gemini 3.1 Pro
                  │ (post-select)  │  Input: final clips + descriptions
                  │                │  Output: overlay text per slot
                  └────────┬───────┘
                           │
                           ▼
                     Remotion render
```

Key architectural decision: **Planner does not name specific exercises.** It outputs a structural brief (slot count, slot types, body focus, energy curve, archetype, subject consistency mode). The Visual Director picks actual clips. This prevents the "CD invented glute-bridge-with-lifted-legs" failure mode at the design level, not just via prompt guardrails.

---

## Component specs

### W1 — Keyframe grid extraction

**Purpose:** Produce 12-frame 3×4 mosaic JPEGs per segment for the Visual Director to inspect.

**Deliverable:** `src/lib/keyframe-grid.ts` with function `buildKeyframeGrid(parentAssetR2Key, segmentStartS, segmentEndS): Promise<Buffer>`.

**Design:**
- FFmpeg extracts 12 evenly-spaced frames between `best_in_point_s` and `best_out_point_s` (NOT `start_s`/`end_s` — we use editorial-hint range)
- Frames arranged in 3×4 grid, downscaled to 1024×768 total
- JPEG quality 80, target file size ~200KB
- Uploaded to R2 at `keyframe-grids/{segment_id}.jpg` with 30-day lifecycle
- Cached — regenerate only if segment's editorial.best_in/out changes

**Cost:** ~$0.00 per grid (FFmpeg CPU on VPS, R2 storage negligible)

**When built:** After Part A backfill completes. Can be built in parallel with W2.

### W2 — Brand persona documents

**Purpose:** Give the Planner and Copywriter a concrete voice/aesthetic reference per brand.

**Deliverable:** `docs/brand-personas/{brand_id}.md` — one file per brand.

**Format:** Short markdown doc (200-400 lines max) covering:
- Brand identity (what they sell, who for)
- Creative references (example creators, apps, videos — "aspire toward X, avoid Y")
- Voice tenets (warmth level, directness, humor, expertise tone)
- Aesthetic tenets (lighting preferences, pacing, color treatment)
- Archetypes that work for this brand
- Content pillars (education, aesthetic, relatable, inspiration — weighted per brand)
- Don't list

**For nordpilates (first brand):** Domis drafts the initial doc. I refine. Agent files.

**When built:** Any time before W3. Domis-authored content, so scheduled around Domis availability.

### W3 — Planner

**Purpose:** Produce a structural brief (no exercise names) from an idea seed + library inventory + brand persona.

**Deliverable:** `src/agents/planner-v2.ts` + `src/agents/prompts/planner-v2.md` + Zod schema.

**Input:**
- Idea seed (e.g., "3 core exercises for back pain relief")
- Brand persona (loaded from `docs/brand-personas/{brand_id}.md`)
- Library inventory (aggregated from SegmentV2 fields — counts of segments per body_region, form_rating, segment_type for this brand)

**Output (Zod-validated):**
```typescript
{
  creative_vision: string,              // one sentence
  archetype: 'transformation-story' | 'high-energy-listicle'
           | 'calm-instructional' | 'workout-demo'
           | 'tip-stack' | 'myth-buster' | 'before-after',
  subject_consistency: 'single-subject' | 'prefer-same' | 'mixed',
  slot_count: number,                   // 3-12
  slots: Array<{
    slot_index: number,
    slot_type: 'hook' | 'body' | 'cta',
    target_duration_s: number,
    energy: number,                     // 1-10
    body_focus: string[] | null,        // ['core', 'glutes'] if body slot
    segment_type_preferences: string[], // valid SegmentV2 segment_type values
    subject_role: 'primary' | 'any',
    narrative_beat: string,             // one short line describing what this slot SAYS
  }>,
  music_intent: 'calm-ambient' | 'upbeat-electronic'
              | 'motivational-cinematic' | 'warm-acoustic' | 'none',
}
```

**Key prompting rules:**
- Prompt must NOT name specific exercises. Body focus only (e.g., "glutes", "core") — not "glute bridge" or "dead bug".
- Archetype choice drives subject_consistency (transformation-story → single-subject, high-energy-listicle → mixed).
- slot_count must fit within 30s total at target_duration_s.
- narrative_beat is a direction for the Copywriter — not final text.

**Why Gemini (not Claude):** Part of the Gemini-everywhere consolidation. Accept that Gemini's strict JSON behavior needs re-tuning vs. prior Claude prompts. `responseSchema` enforces structure.

**When built:** After Part A backfill + W1 + brand personas for at least 1 brand (nordpilates).

### W4 — Candidate retrieval (`match_segments_v2` RPC)

**Purpose:** Given a slot definition from the Planner, return ~18 candidate segments from the library.

**Deliverable:** Supabase SQL function `match_segments_v2(brand_id text, slot_spec jsonb, limit int)`.

**IMPORTANT:** Column is `parent_asset_id` on `asset_segments`, NOT `asset_id`. This was incorrect in earlier design docs. Verified via Supabase query.

**Algorithm:**
1. Embed slot's narrative_beat + body_focus as query vector (use existing embedding model)
2. pgvector similarity search against `asset_segments.description` embedding, filtered by:
   - `brand_id = $brand_id`
   - `segment_type IN ($slot_spec.segment_type_preferences)`
   - `quality.overall >= 6` (JSONB query on segment_v2)
   - `segment_type != 'unusable'`
   - `segment_type != 'setup'` IF slot_type = 'body' AND body_focus is set (hard-filter from Phase 3.5)
3. For body_focus slots: boost score if `segment_v2->exercise->body_regions` overlaps with slot_spec.body_focus
4. For subject_consistency='single-subject' on subsequent body slots: filter to `parent_asset_id = {first_body_pick_parent}` if ≥3 same-parent candidates exist (Phase 3.5 pattern)
5. Return top-N with metadata for Visual Director consumption

**When built:** After backfill completes (queries rely on `segment_v2` JSONB fields).

### W5 — Visual Director

**Purpose:** Pick final clips from candidates using multimodal evaluation.

**Deliverable:** `src/agents/visual-director.ts` + prompt + schema.

**Input per slot:**
- Slot spec from Planner
- ~18 candidates, each with:
  - Keyframe grid JPEG (from W1)
  - Segment description + structured metadata (SegmentV2)
  - Editorial hints (best_in/out_point_s, unusable_intervals)
- Already-picked segments for earlier slots (enables subject continuity check)

**Output:**
```typescript
{
  picked_segment_id: string,
  picked_parent_asset_id: string,     // for continuity tracking
  picked_in_s: number,                 // use editorial.best_in_point_s unless override justified
  picked_out_s: number,
  pick_rationale: string,              // one sentence, for debugging
  alternatives: Array<{segment_id: string, reason_rejected: string}>,
}
```

**Key prompting rules:**
- Reads keyframe grid PLUS description PLUS structured fields. Triangulates.
- Prefers editorial.best_in/out_point_s unless overlay text collision or continuity issue forces shift.
- Enforces single-subject when brief specifies.
- Must provide rationale — debuggable selection, not a black box.

**Cost:** ~$0.35/video on Gemini credits (12 slots × ~3K tokens input × $0.01/1K ≈ $0.36).

**When built:** After W1 + W4 + Part A backfill.

### W6 — Coherence Critic

**Purpose:** Review the full storyboard before render. Catches mistakes the per-slot Director missed.

**Deliverable:** `src/agents/coherence-critic.ts`.

**Input:** Full storyboard — Planner brief + final clip picks + Copywriter overlays (if available).

**Output:**
```typescript
{
  verdict: 'approve' | 'revise' | 'reject',
  issues: Array<{
    severity: 'critical' | 'major' | 'minor',
    slot_indices: number[],            // which slots are affected
    issue_type: 'subject-discontinuity' | 'pace-mismatch'
              | 'overlay-text-conflict' | 'on-screen-text-collision'
              | 'energy-curve-violation' | 'archetype-drift',
    description: string,
    suggested_fix: string | null,
  }>,
}
```

**Critical checks:**
- Subject continuity (if brief specifies single-subject, all body slots must share parent_asset_id or same structured subject descriptor)
- On-screen text collisions (if two adjacent slots have `setting.on_screen_text` populated with conflicting content)
- Overlay ↔ clip coherence (copywriter text matches what clip shows)
- Energy curve matches slot_by_slot energy from brief
- Archetype consistency (single-subject mode doesn't fit a high-energy-listicle etc.)

**When built:** After W5 ships. Can run shadow mode first (log issues without blocking render) before promoting to gate.

### W7 — Copywriter (post-selection)

**Purpose:** Write overlay text for each slot AFTER clips are picked.

**Deliverable:** `src/agents/copywriter-v2.ts`.

**Input:** Final slot picks from Director + brief + brand persona.

**Output:** Per-slot overlay text + timing.

**Key change from Phase 3.5:** runs POST-selection, not PRE. Sees what's on screen. Doesn't invent words that contradict visuals. If a clip's `setting.on_screen_text` already has "DAY 14", copywriter adapts (e.g., doesn't add conflicting day counter).

**When built:** Parallel to W5 or immediately after.

### W8 — Orchestrator

**Purpose:** Wire the above components into a job flow.

**Deliverable:** `src/workers/pipeline-v2.ts` — replaces current Phase 3.5 orchestration.

**Job flow:**
1. Job created in queue (idea seed + brand_id)
2. Pipeline-v2 picks it up
3. Load brand persona + library inventory
4. Call Planner → brief
5. For each slot: call retrieval RPC → Visual Director → picked clip
6. Call Copywriter with final picks → overlays
7. Call Coherence Critic → verdict
8. If revise: one revision pass. If reject: fail job with diagnostic.
9. If approve: hand to Remotion render pipeline (unchanged from Phase 3.5)

**Shadow mode:** New pipeline runs alongside Phase 3.5 for same job. Outputs diff report. No production traffic on v2 until diff report is clean.

**When built:** After W3-W7 all ship.

### W9 — Shadow mode rollout

**Purpose:** De-risk cutover.

**Plan:**
1. For 1 week: every Phase 3.5 job also runs Pipeline v2 in shadow. Both produce context_packets; shadow v2 outputs stored but not rendered. Daily diff report: slot selections, overlay text, coherence verdicts.
2. For 2nd week: 10% of production jobs run on v2 (rendered + shipped). A/B metrics: viewer retention, scroll-through rate.
3. Week 3+: if v2 beats Phase 3.5 on retention, ramp to 100%.

---

## Cost & latency projections (steady-state per video)

| Stage | Tokens/calls | Cost (Gemini credits) | Wall time |
|---|---|---|---|
| Planner | 1 call, ~5K tokens | $0.05 | 8s |
| Retrieval (×12 slots) | 12 pgvector queries | $0.00 | 3s total |
| Visual Director (×12 slots) | 12 calls × ~4K tokens | $0.36 | 45s total (parallel-able) |
| Copywriter | 1 call, ~3K tokens | $0.03 | 6s |
| Coherence Critic | 1 call, ~6K tokens | $0.05 | 10s |
| **Total LLM cost** | **~$0.50/video** | | ~75s total |
| Remotion render | CPU only | $0.00 | ~60s |

**Production target:** $0.50/video all-in during credits period. Post-credits, monitor and reassess.

---

## Risks & open questions

### Risks

| Risk | Mitigation |
|---|---|
| Gemini prompt re-tuning effort for Planner is underestimated | Allocate 1-2 iteration sessions on W3; keep Claude Planner as fallback if Gemini can't hit strictness bar |
| Keyframe grids miss key moments | Use `best_in/out_point_s` as range, not full segment — grids are from the "money shot" window |
| Visual Director over-indexes on grid vs description | Prompt carefully: grid for visual content, description for context/intent |
| Coherence Critic false positives block good videos | Shadow mode first; tune thresholds before making it blocking |
| match_segments_v2 JSONB queries are slow | Benchmark on real backfilled data; add GIN indexes on `segment_v2->exercise->body_regions` etc. if needed |
| Subject continuity fails when library is thin per-brand | Fallback threshold (≥3 same-parent candidates) + log gaps for library expansion |

### Open questions (decide during Part B planning)

1. **Should Planner see keyframe grids?** Currently proposed as text-only. If segment metadata alone isn't enough for narrative structuring, we could feed Planner a sample of keyframe grids from candidate segments. Cost/benefit TBD.
2. **Should Copywriter see keyframe grids?** Maybe for visual-text-coherence enforcement. Same cost/benefit question.
3. **Should Coherence Critic be multi-turn with Director?** Current design is one-shot critique. Could be "Director proposes → Critic critiques → Director revises" loop. Adds latency + cost; might not be needed.
4. **Feature flag strategy for v2 pipeline.** `ENABLE_PIPELINE_V2_SHADOW` vs `ENABLE_PIPELINE_V2_PROD` — two flags or one with states?

---

## Prerequisites checklist (before W3 starts)

- [ ] Part A complete: all segments have `segment_v2` populated
- [ ] W1 shipped: keyframe grids generated for all backfilled segments
- [ ] W2 shipped: nordpilates brand persona doc in repo
- [ ] W4 prototyped: match_segments_v2 RPC returns sensible candidates on test brief
- [ ] Phase 4 Part B doc (this doc) reviewed + approved by Domis
- [ ] Feature flag plan decided

---

## What "done" looks like for Part B

- [ ] Pipeline v2 running in shadow mode for ≥1 week
- [ ] Shadow diffs show v2 picks are at least as good as Phase 3.5 on ≥80% of jobs
- [ ] A/B test on 10% traffic shows retention delta of 0% or positive
- [ ] v2 ramp to 100% traffic, Phase 3.5 code path deprecated
- [ ] Phase 3.5 orchestrator + prompts deleted
- [ ] Library_inventory + body_focus code migrated from Phase 3.5 string-tag matching to v2 structured-field matching

When Part B is done: Video Factory produces retention-optimized organic short-form content across 30 brands without per-video human review. That's the whole point of the project.
