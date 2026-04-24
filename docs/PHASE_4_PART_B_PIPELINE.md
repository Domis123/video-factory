# Phase 4 Part B — Pipeline

**Status:** W1 through W7 shipped (2026-04-21 through 2026-04-24) + W6.5 tuning iteration shipped 2026-04-23. W1.5 Content Sprint 2 complete. W8 Orchestrator is the next brief.
**Success criterion (revised 2026-04-21):** Replace the Phase 3.5 CD → Curator → Copywriter flow with a pipeline that produces **organic-plausible, retention-optimized short-form content with form diversity**, not "just" coherent videos. Auto-QA remains a necessary gate; organic-creator-plausibility on human review is the bar. Measured on nordpilates during shadow mode + ramp.
**Depends on:** Part A's SegmentV2.1 schema (complete) + W1 keyframe grids (complete).

---

## Why Part B exists

Phase 3.5 pipeline has three structural failure modes that better prompting can't fix:

1. **Creative Director invents exercises the library doesn't have.** Partial fix via `library_inventory` in Phase 3.5, but still relies on text-based exercise names rather than verified library structure.
2. **Curator selects clips that don't match intent.** pgvector retrieval + CLIP embedding midpoint keyframe + free-text description = blind selection. The curator sees "matching candidates" but can't see if they actually *show* what's claimed.
3. **Copywriter writes overlay text before clips are selected.** Words say "glute bridge" over a clip of someone getting into position. Zero enforcement of text-visual coherence.

Part A fixed the metadata. W1 fixed the visual-grounding tool (keyframe grids). Part B rebuilds the pipeline to exploit both:

- Planner sees **verified library inventory + nordpilates form/posture playbook**, commits to form + hook_mechanism
- Visual Director sees **actual keyframe grids** from candidates
- Copywriter runs **after selection**, with access to what's on screen
- Coherence Critic enforces **subject continuity + posture coherence**

---

## Architecture overview (revised 2026-04-21)

```
       Idea seed + brand_id
              │
              ▼
     ┌────────────────┐
     │  Planner       │  Gemini 3.1 Pro, text-only
     │                │  Input: idea seed, library_inventory,
     │                │         brand persona (incl. form×posture allowlist)
     │                │  Output: form_id + hook_mechanism +
     │                │         narrative_beat + slot structure
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Candidate      │  Supabase RPC (match_segments_v2)
     │ Retrieval      │  Input: slot spec (segment_type prefs, body_focus)
     │                │  Output: ~18 candidates per slot
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Visual         │  Gemini 3.1 Pro, multimodal
     │ Director       │  Input: candidates + keyframe grids
     │                │         (including posture restriction from brand)
     │                │  Output: final clip picks + in/out points
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Coherence      │  Gemini 3.1 Pro
     │ Critic         │  Input: storyboard + brand posture contract
     │                │  Output: approve / revise / reject
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │ Copywriter     │  Gemini 3.1 Pro
     │ (post-select)  │  Input: picks + form + hook_mechanism +
     │                │         brand persona
     │                │  Output: overlay text per slot
     │                │  [W10: + voiceover_script, if posture is P6]
     └────────┬───────┘
              │
              ▼
      [W10: Voice Generator, if VO posture]
              │
              ▼
        Remotion render
```

Key architectural decisions:

1. **Planner commits to form_id + hook_mechanism, not just archetype.** From `docs/w2-content-form-taxonomy.md`. Form is structural; hook_mechanism is load-bearing. Archetype enum (original spec) is replaced by form_id enum.
2. **Posture is restricted per brand, not per video.** Brand persona names allowed postures; Planner doesn't pick posture. Director + Copywriter execute within posture constraint.
3. **Planner does NOT name specific exercises.** Body focus only. Director picks actual clips — prevents CD-invented-exercise failure mode at the design level.

---

## Workstream sequence (revised 2026-04-21)

| W# | Workstream | Status | Depends on |
|----|------------|--------|-----------|
| W1 | Keyframe grids | ✅ shipped 2026-04-21 | Part A |
| W1.5 | Content Sprint 2 ingestion | 🟡 still in progress | W1 |
| W2 | Brand persona + form/posture playbook | ✅ shipped 2026-04-22 | W1.5 meaningfully complete |
| W3 | Planner (form + hook_mechanism + subject_consistency) | ✅ shipped 2026-04-22 | W2 |
| W4 | match_segments_v2 RPC | ✅ shipped 2026-04-22 | W3 |
| W5 | Visual Director (multimodal) | ✅ shipped 2026-04-22 | W1 + W4 |
| W6 | Coherence Critic | ✅ shipped 2026-04-23 | W5 |
| W6.5 | Planner subject stance + conditional Critic | ✅ shipped 2026-04-23 (tuning iteration) | W6 |
| W7 | Copywriter rebuild | ✅ shipped 2026-04-24 | W5 (parallel to W6) |
| W8 | Orchestrator | 🔴 not started | W3–W7 |
| W9 | Shadow mode rollout | 🔴 not started | W8 |
| **W10** | **Audio generation (NEW)** | 🔴 **not started, POST-shadow** | **W9 validation** |

Estimated timeline: W8 through W9 remaining in ~2 weeks. W10 adds ~1 week post-shadow.

---

## Component specs

### W1 — Keyframe grid extraction ✅ SHIPPED

See `docs/briefs/w1-keyframe-grids.md` (archived) and `src/lib/keyframe-grid.ts`. 4×3 portrait mosaic at 1024×1365, JPEG q80, EXIF metadata. R2 at `keyframe-grids/{brand_id}/{segment_id}.jpg`. Column `asset_segments.keyframe_grid_r2_key`.

### W1.5 — Content Sprint 2 ingestion 🟡 IN PROGRESS

**Purpose:** ~2x nordpilates library via Drive-triggered ingestion using the live v2 path.

**Deliverable:** populated `assets` + `asset_segments` rows with full v2 JSONB + keyframe grids.

**Mechanism:** entirely autonomous. Drive drop → S8 → VPS `/ugc-ingest` → ingestion worker (pre-normalize → Gemini v2 → keyframe grid → R2 + Supabase). No agent action; no brief needed.

**Gate:** post-ingestion inventory audit. Specifically:
- Row count stability (`SELECT COUNT(*) FROM assets WHERE brand_id='nordpilates'` stops climbing)
- `segment_type` distribution updated (especially talking-head count)
- `b-roll` lifestyle-vs-exercise-adjacent classification query
- Long-hold segment availability for Cinematic Slow-Cinema viability
- Same-exercise-name distribution for Single-Exercise Deep-Dive viability

**Unblocks:** W2 brief writing (so readiness flags in the form taxonomy are real numbers).

### W2 — Brand persona + form/posture playbook

**Purpose:** give Planner + Director + Critic + Copywriter a concrete voice/aesthetic contract per brand, backed by a form-taxonomy reference.

**Deliverable:**
- `docs/brand-personas/{brand_id}.md` — per-brand persona document (nordpilates first)
- `docs/w2-content-form-taxonomy.md` (already drafted, v1) — canonical form/posture playbook
- `src/agents/brand-persona.ts` — loader that reads the markdown persona + resolves form×posture allowlist into a structured schema for downstream agents
- Zod schema for BrandPersona including `voice_config: VoiceConfig | null`

**Persona doc format:**
- Brand identity (what they sell, who for)
- Creative references + anti-references
- **Form×Posture allowlist** (from the taxonomy doc, restricted to this brand)
- **Voice tenets** — warmth, directness, humor, expertise tone
- **Aesthetic tenets** — lighting preferences, pacing, color treatment restrictions
- **Content pillars** (education, aesthetic, relatable, inspiration — weighted)
- **Don't list** — explicit exclusions (sales framing, medical claims, etc.)
- **voice_config:** `null` at W2; populated at W10

**For nordpilates (first brand):** Domis drafts the initial persona doc (narrative voice + references + aesthetic feel). Planning chat refines + structures. Agent files.

**Voice-evaluation prep step (new):** during W2, Domis auditions 5-10 ElevenLabs voice samples reading a standardized test script. The chosen voice is recorded in persona doc as "W10 voice candidate" — NOT populated into `voice_config` at W2 (field stays `null`), just noted in persona prose. Saves evaluation time when W10 starts.

**Hard constraints:**
- Persona must NOT enable sales-pitch forms (Transformation Before/After, Client Testimonial with CTA, etc.)
- `voice_config` must start at `null` — field exists, value is null, value populated only at W10
- Form×Posture allowlist sourced from taxonomy doc; do not duplicate form definitions in persona doc (single source of truth)

**When built:** after W1.5 meaningfully complete.

### W3 — Planner

**Purpose:** produce a structural brief with form commitment and hook mechanism, from idea seed + library inventory + brand persona.

**Update 2026-04-23 (W6.5):** Planner now commits to `subject_consistency` per video based on idea-seed signals (first-person possessive / named-routine / authority framing → single-subject; aesthetic-compilation / trend / community language → mixed). Slot-level `subject_role` follows from the video-level stance. Prompt-only change; no schema modification.

**Deliverable:** `src/agents/planner-v2.ts` + `src/agents/prompts/planner-v2.md` + Zod schema.

**Input:**
- Idea seed
- Brand persona (from W2 loader)
- Library inventory (aggregated from SegmentV2 fields — counts per body_region, form_rating, segment_type for this brand)

**Output (Zod-validated, updated from original Part B spec):**
```typescript
{
  creative_vision: string,                  // one sentence
  form_id: FormId,                          // from docs/w2-content-form-taxonomy.md
  hook_mechanism:
    'specific-pain-promise' | 'visual-pattern-interrupt'
    | 'opening-energy' | 'authority-claim'
    | 'confessional-vulnerability' | 'narrative-intrigue'
    | 'trend-recognition',
  audience_framing: string | null,          // for Targeted Microtutorial: e.g., "desk workers", "runners"
  subject_consistency: 'single-subject' | 'prefer-same' | 'mixed',
  slot_count: number,                       // form-specific range
  slots: Array<{
    slot_index: number,
    slot_role: 'hook' | 'body' | 'close',   // renamed from 'slot_type' to avoid collision with segment_type
    target_duration_s: number,
    energy: number,                          // 1-10
    body_focus: string[] | null,
    segment_type_preferences: string[],      // valid SegmentV2 segment_type values
    subject_role: 'primary' | 'any',
    narrative_beat: string,                  // what this slot SAYS (direction for Copywriter)
  }>,
  music_intent: 'calm-ambient' | 'upbeat-electronic'
              | 'motivational-cinematic' | 'warm-acoustic' | 'none',
  posture: AestheticPosture,                 // passed through from brand persona, NOT chosen by Planner
}
```

**Key prompting rules (updated):**
- Prompt must NOT name specific exercises (unchanged from original spec).
- Prompt must name a valid `form_id` from the taxonomy doc and a valid `hook_mechanism`. These two together determine slot_count range + pacing default.
- Prompt reads brand persona's Form×Posture allowlist; cannot emit a form the brand disallows.
- `posture` is passed through unchanged from brand persona — Planner does NOT pick posture.
- `narrative_beat` is a direction for Copywriter — not final text.
- slot_count must fit within 30s total at target_duration_s.

**Why Gemini:** stack unification. Accept prompt re-tuning cost. `responseSchema` enforces structure.

**When built:** after W2.

### W4 — Candidate retrieval (`match_segments_v2` RPC) — unchanged from original spec

(Spec unchanged. See earlier Part B doc for algorithm. Note: column is `parent_asset_id` not `asset_id`.)

### W5 — Visual Director — unchanged from original spec

(Spec unchanged. Input includes keyframe grids from W1.)

### W6 — Coherence Critic

**Purpose:** review full storyboard before render. Catches mistakes the per-slot Director missed.

**Deliverable:** `src/agents/coherence-critic.ts`.

**Input:** full storyboard — Planner brief + final clip picks + Copywriter overlays.

**Output:** verdict + issues (unchanged from original spec).

**New critical check (added this session):** posture coherence. If brand persona restricts posture to e.g., P1 + P5, and the storyboard's clip picks collectively read as P4 (fast-cut punchy), flag as `archetype-drift` or new `posture-drift` issue type.

**When built:** after W5. Shadow mode first.

#### W6.5 — Subject stance conditional check (shipped 2026-04-23)

Single-gate tuning iteration. The `subject_discontinuity` issue type in the Critic's taxonomy became conditional on `planner.subject_consistency`:
- `single-subject` → fires normally (severity per original spec)
- `prefer-same` → fires at `low` severity only, and only on genuine scatter (≥3 parents across primary slots)
- `mixed` → does not fire (mixed subjects are intended)

Addresses followup `w6-subject-discontinuity-prevalence-at-director`. Prompt-only change to both `planner-v2.md` and `coherence-critic.md`; `coherence-critic.ts` surface check confirmed `subject_consistency` already reachable as a flat template variable — no code change.

Validated via Planner seed 3 ("soft golden-hour pilates aesthetic, no teaching") flipping to `subject_consistency: mixed` + spot-check Critic invocation on a resulting 5-unique-parents storyboard correctly NOT firing `subject_discontinuity`.

### W7 — Copywriter rebuild — largely unchanged, two additions

**Purpose:** write overlay text per slot after clips are picked.

**Deliverable:** `src/agents/copywriter-v2.ts`.

**Input:** final slot picks from Director + brief (form, hook_mechanism, narrative_beat) + brand persona.

**Output:** per-slot overlay text + timing.

**Additions this session:**
1. Copywriter receives `hook_mechanism` explicitly — delivers on it, not just writes to brief.
2. Copywriter output schema includes `voiceover_script: string | null` field. At W7, always null. Populated at W10.

**When built:** parallel to W5/W6.

### W8 — Orchestrator — unchanged from original spec

### W9 — Shadow mode rollout — unchanged from original spec

### W10 — Audio generation (NEW, added 2026-04-21)

**Purpose:** enable voiceover-led content for forms currently text-only. Unlocks ~30% of form taxonomy gated by talking-head scarcity.

**Deliverable:**
- `src/agents/voice-generator.ts` — ElevenLabs (or equivalent) integration
- `src/agents/prompts/voiceover-script.md` — Copywriter extension generating audio-rhythm scripts distinct from visual overlay text
- `src/workers/audio-mix.ts` — layered audio: UGC + music + VO with ducking
- Posture P6 (Voice-Over-Led) promoted from "deferred" to active in taxonomy doc
- `VoiceConfig` schema populated in brand personas

**Scope:**
- ElevenLabs API integration (voice-id per brand from persona's chosen voice candidate)
- Copywriter generates parallel `voiceover_script` when form×posture = VO-compatible
- Audio-mix worker layers VO on top of ducked music, alongside UGC audio
- Ethical guardrails: persona can forbid VO on first-person-confessional forms (e.g., original What-I-Wish-I-Knew — would be dishonest since there's no "I")

**Cost:** ElevenLabs Creator tier (~$22/mo) + overage for 150 videos/week at ~30 words/video = ~$30/mo steady state.

**Forms unlocked:**
- Teacher-Cue Drop (#15) — VO narrates the cue over exercise demo
- Myth-Buster (#6) — VO explains the correction
- Single-Exercise Deep-Dive (#8) — VO gives the cue callouts
- Hook-Rev-Tip (#13) — VO delivers the tip
- Others tbd during W10 calibration

**Forms still NOT unlocked by W10:**
- Reaction (#10) — requires visible reaction face
- Progress-Montage (#11) — requires temporal metadata, separate issue
- What-I-Wish-I-Knew — ethical concern (AI voice on confessional is dishonest framing)

**When built:** AFTER W9 shadow mode proves W2–W7 foundation works on nordpilates. Not before.

---

## Cost & latency projections (revised)

| Stage | Cost | Wall time |
|---|---|---|
| Planner | $0.05 | 8s |
| Retrieval (×N slots) | $0.00 | 3s total |
| Visual Director (×N slots, parallel) | $0.30-0.40 | 30-45s |
| Copywriter | $0.03 | 6s |
| Coherence Critic | $0.05 | 10s |
| **Total LLM cost (W2-W9)** | **~$0.50/video** | ~75s |
| W10 voice generation (when shipped) | +$0.02 | +5s |
| Remotion render | $0.00 | ~60s |

Production target: $0.50/video all-in during credits period (W2-W9). $0.52/video steady state with W10.

**Actual session cost tracking (2026-04-22 + 2026-04-23):** ~$4 total in Gemini usage across all test-script smokes (W3 iterations + W4 no-LLM + W5 multimodal + W6 Critic + W6.5 revalidation). Production projection unchanged: $0.50/video all-in through W9, $0.52 with W10.

---

## Risks & open questions (updated)

### Risks

| Risk | Mitigation |
|---|---|
| Gemini prompt tuning effort for Planner underestimated | Allocate 1-2 iteration sessions on W3; keep Claude fallback available if needed |
| Keyframe grids miss key moments | Already mitigated — use `best_in/out_point_s` range |
| Visual Director over-indexes on grid vs description | Prompt carefully: grid for visual, description for intent |
| Coherence Critic false positives block good videos | Shadow mode first; tune thresholds |
| match_segments_v2 JSONB queries slow | Benchmark on real backfilled data; add GIN indexes if needed |
| Subject continuity fails when library is thin per-brand | Fallback threshold (≥3 same-parent candidates) + log gaps |
| **Content Sprint 2 doesn't meaningfully relieve talking-head bottleneck** | Accept the current library limits through Part B; W10 provides alternative path via VO |
| **Form×Posture allowlist encoded in persona drifts from taxonomy doc** | Single source of truth — persona references taxonomy doc by form_id, doesn't redefine |
| **W10 voice choice for nordpilates feels wrong post-ship** | Voice-evaluation during W2 with Domis; fast rollback by flipping brand voice_config and re-rendering |
| **Subject-stance prompt tuning drifts across future brand onboardings** | Rule 40 + Rule 41 patterns apply: stance-signal heuristics live in Planner prompt, not per-persona prose. Nordpilates persona default-preference framing is the template for new brands. |
| **W6 Critic note-length overflow on complex storyboards** | W6.5 added explicit `≤300 chars` guidance per note with "cite one mismatch, don't narrate every slot" rule. Observable improvement: latency dropped, max length reduced. Revisit if shadow mode shows re-occurrence. |

### Open questions

1. **Should Planner see keyframe grids?** Text-only currently. Open — may test multimodal Planner in a W3 variant.
2. **Should Copywriter see keyframe grids?** Maybe for visual-text-coherence enforcement. Same cost/benefit question.
3. **Multi-turn Critic-Director loop?** Current design is one-shot. Could be "propose → critique → revise" loop. Adds latency; might not be needed.
4. **Feature flag strategy:** `ENABLE_PIPELINE_V2_SHADOW` vs `ENABLE_PIPELINE_V2_PROD` — two flags or one with states?
5. **NEW: W10 voice per brand or per persona?** One voice per brand (nordpilates = voice A, Nordletics = voice B), or per persona-within-brand (nordpilates P5 = teacher voice, nordpilates P1 = softer voice)? Lean toward one per brand for simplicity.
6. **Should W8 orchestrator retry Director with tighter subject-continuity prompt constraints on `subject_discontinuity` revise verdicts, or re-plan from scratch?** W6.5 reduces false-positive rate by filtering which storyboards get flagged; doesn't change what orchestrator does when a real continuity break IS flagged. Two paths: (a) orchestrator re-invokes W5 with a stronger same-parent constraint on just the flagged slots; (b) orchestrator escalates to Planner re-plan if Director's initial pick-set has continuity issues. Decision pending W8 brief.

---

## Prerequisites checklist

- [x] Part A complete
- [x] W1 shipped (keyframe grids)
- [ ] W1.5 meaningfully complete (Content Sprint 2 still ingesting; inventory refreshed once in this session to partial, final pass pending ingestion stabilization)
- [x] W2 shipped (persona + form/posture playbook loaded into codebase)
- [x] W3 shipped (Planner)
- [x] W4 shipped (retrieval RPC)
- [x] W5 shipped (Visual Director)
- [x] W6 shipped (Coherence Critic)
- [x] W6.5 shipped (subject stance tuning)
- [x] W7 shipped (Copywriter) — W7 shipped 2026-04-24
- [ ] W8 shipped (Orchestrator)
- [ ] Feature flag plan decided (deferred to W8 brief)
- [ ] Voice-evaluation session held (prep for W10, non-blocking for W2-W9)

---

## What "done" looks like for Part B

- [ ] Pipeline v2 (W2-W9) running in shadow mode ≥1 week (W2-W6 + W6.5 shipped; W7-W9 remaining)
- [ ] Shadow diffs show v2 picks at least as good as Phase 3.5 on ≥80% of jobs
- [ ] A/B test on 10% traffic: retention delta 0% or positive
- [ ] Human review of 30 random v2 outputs: ≥8/10 rated "could plausibly be a real creator's organic post"
- [ ] Form diversity across 50 outputs: ≥6 distinct form_ids used (not all Routine-Sequence slop)
- [ ] v2 ramp to 100%, Phase 3.5 deprecated
- [ ] Phase 3.5 code path removed
- [ ] W10 shipped (audio generation) — post-Part-B success criterion

When Part B is done: Video Factory produces retention-optimized organic short-form content on nordpilates that passes both automated QA and human organic-plausibility review, with form diversity measurable across the output library. That's the whole point.

---

*Revised 2026-04-21 evening. Adds W1.5 + W10, updates W2 + W3 scopes for form/posture two-axis model and hook_mechanism first-class concept, updates success criterion from auto-QA-pass-rate to organic-plausibility-plus-form-diversity.*

*Revised 2026-04-23 evening. Updated for W1-W6 shipped + W6.5 tuning iteration. Added subject-stance architectural note to W3. Added W6.5 subsection to W6. Prerequisites checklist marked through W6.5 complete. Risks updated. Next brief: W7 Copywriter.*

*Revised 2026-04-24. Copywriter shipped. Part B creative agents all complete (Planner → Retrieval → Director → Critic → Copywriter). Next brief: W8 Orchestrator.*
