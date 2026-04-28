# Phase 4 Part B — Pipeline

**Status:** W1 through W8 shipped (2026-04-21 through 2026-04-24) + W6.5 tuning iteration shipped 2026-04-23. W1.5 Content Sprint 2 complete. Part B pipeline complete as runtime code, deployed and dormant. W9 Shadow Rollout is the next brief.
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
| W8 | Orchestrator | ✅ shipped 2026-04-24 | W3–W7 |
| W9 | Shadow mode rollout | ✅ shipped 2026-04-25 | W8 |
| W9.1 | Cost tracking wireup | ✅ shipped 2026-04-26 (single-gate) | W9 |
| Phase 1 calibration flip | ✅ live 2026-04-27 | W9.1 |
| **Production Polish Sprint** | 🟡 **paused mid-Pillar-1, c1-c4 parked at cebfc46** | Phase 1 calibration first real seed |
| Polish Sprint Pillar 1 | 🟡 paused at c4 (charter rewrite shipped, calibration seeds not run) | Production Polish Sprint |
| **S8 multi-brand ingestion routing** | ✅ shipped 2026-04-28 | (parallel chore, unblocks Simple Pipeline multi-brand) |
| **Simple Pipeline (next workstream)** | 🔴 **headline next workstream — two products** | S8 chore + brand_configs lazy population |
| Simple Pipeline — routine videos (slot_count 2-5) | 🔴 not started | Simple Pipeline brief |
| Simple Pipeline — meme videos (slot_count 1) | 🔴 not started | Simple Pipeline brief |
| W9.2 | Demo render bridge | 🔴 deferred behind Polish Sprint resumption | Polish Sprint |
| W10 | Audio generation | 🔴 deferred, post-cutover | First brand cutover |

**Estimated timeline (revised 2026-04-28):**
- W9 ✅ shipped (2026-04-25)
- W9.1 cost tracking ✅ shipped (2026-04-26)
- Phase 1 calibration flip ✅ live (2026-04-27)
- Polish Sprint Pillar 1 c1-c4 ✅ parked unmerged (2026-04-28, branch cebfc46)
- S8 multi-brand ingestion routing ✅ shipped (2026-04-28, main at f4ae06c → 98d85b5)
- **Simple Pipeline v1 (both products): ~3-4 days agent work, next workstream**
- First nordpilates Simple Pipeline video uploadable to TikTok: shortly after Simple Pipeline Gate A close
- Cyclediet/carnimeat/nodiet first videos: depends on ingestion velocity (operator-bound)
- **Polish Sprint resumption: post-Simple-Pipeline-ship, Pillar 1 c5 onwards**
- W9.2 Demo render bridge: ~1 week (after Polish Sprint resumption + completion)
- First Part B advanced-pipeline video on TikTok: post-W9.2 Gate A
- Phase 1 calibration steady-state: ramp PART_B_ROLLOUT_PERCENT down from 100 to 30 once Critic stops over-flagging (post-Pillar-1-resumption)
- Cutover decision: ≥30 verdicts on Q5d signals + operator confirmation
- W10 voice: post-first-cutover

Total to first Simple Pipeline nordpilates video on TikTok: realistically 4-7 days from today (2026-04-28).

Total to first Part B advanced-pipeline nordpilates video on TikTok: realistically 6-10 weeks from today (Polish Sprint resumption + completion + W9.2 + cutover decision).

The two timelines are decoupled: Simple Pipeline ships first, advanced pipeline follows. Operator can ship content via Simple Pipeline while advanced pipeline matures.

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

### W5 — Known architectural limits (observed 2026-04-27)

**Per-slot independent picking.** The Visual Director invokes per-slot picks via `Promise.all` — each slot's pick has no visibility into other slots' picks. When Planner commits `subject_consistency: single-subject` against a library where the most-represented parent has fewer segments than `slot_count`, the constraint is unfulfillable at the per-slot level. The Director picks the highest-similarity candidate per slot independently; this is deterministic given the candidate pool, so revise cycles produce near-identical re-picks.

**Operator-Critic calibration mismatch (4 sightings):** When this happens, Critic correctly flags `subject_discontinuity` at severity high; revise budget exhausts; job terminates `failed_after_revise_budget`. Sightings: W6 Gate A, W8 Tier 2 Seed B, W9.1 Gate A (forced-structural), W9 Phase 1 first real seed. **Reframed conclusion:** the architectural limit is real but the Critic threshold is the binding constraint, not the architecture. Phase 3.5's curator picks cross-parent on the same library and ships operator-acceptable output. Loosening Critic's `subject_discontinuity` threshold is the cheaper fix and is Polish Sprint pillar 1.

**Future-conditional architecture rebuild.** If Polish Sprint loosens Critic and the resulting Part B output reveals genuine cross-parent quality regression in production (e.g., outfits jarringly off-brand, identity changes mid-video that operators or audience flag), the Director architecture rebuild becomes a real workstream. Two viable shapes: (a) sequential picks anchored on slot 0's parent, (b) parent-locking at retrieval (W4 returns candidates pre-filtered to one parent when stance is single-subject). Estimated 5-7 days, two-gate brief if needed.

**Primary evidence:** `docs/diagnostics/W9_CALIBRATION_RUN_DIAGNOSTIC.md`

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

#### W8 update — Library inventory injection (shipped 2026-04-24)

Additive extension to W6 from W8's brief. Critic's agent signature gained a `libraryInventory: LibraryInventoryV2` parameter (same shape W3 Planner consumes). Critic prompt teaching expanded with two new sections:

- **Library inventory for your consideration** — explains how to read inventory data (segment-type distribution, body-region distribution, top exercise clusters, equipment distribution) when evaluating whether a form commitment is achievable.
- **`revise_scope` field** — teaches Critic to emit `slot_level` (issue is fixable by re-picking specific slots from the same candidate pool) vs `structural` (the underlying plan is wrong given the library; full re-plan needed).

`CriticVerdictSchema` gained `revise_scope: z.enum(['slot_level', 'structural']).default('slot_level')`. Default is benign — when verdict is `approve` or `reject`, the field is ignored by the orchestrator but emitted for schema conformance.

Cost impact: ~$0.01-0.02 additional per Critic call (library inventory payload). Annual at 150 videos/week × 50 weeks ≈ $110/year. Absorbed within ~$1/video operator budget.

Validation status: code shipped + Gate A semantic checks passed. Behavior validation — does Critic actually emit `structural` when library is sparse — is W9 shadow measurement (followup `w8-q5-signal-validation-not-exercised-in-gate-a`).

### W7 — Copywriter rebuild — largely unchanged, two additions

**Purpose:** write overlay text per slot after clips are picked.

**Deliverable:** `src/agents/copywriter-v2.ts`.

**Input:** final slot picks from Director + brief (form, hook_mechanism, narrative_beat) + brand persona.

**Output:** per-slot overlay text + timing.

**Additions this session:**
1. Copywriter receives `hook_mechanism` explicitly — delivers on it, not just writes to brief.
2. Copywriter output schema includes `voiceover_script: string | null` field. At W7, always null. Populated at W10.

**When built:** parallel to W5/W6.

**Shipped:** 2026-04-24 (merged at SHA 73ad155).

Pure function `writeCopyForStoryboard(picks, planner, persona, snapshots) → CopyPackage`. Single Gemini text-only call per video (option a; option b two-call escalation path documented in brief but not preemptively built). Produces per-slot overlay text + timing, hook, CTA, platform captions (canonical + 3 platform-trimmed), hashtags. `voiceover_script: z.null()` reserved for W10 widening.

**Overlay type enum authored at W7:** `label | cue | stamp | caption | count | none` with per-type validation rules. `label` requires picked clip's `exercise.name` non-null at confidence high/medium; `stamp` requires posture P4/P5; `count` requires `segment_type='exercise'`; `caption` soft budget max 2 per video; `cue`/`none` always valid.

**Pipeline-invariant CTA logic:** never hard-sell. Decision driven by `form_id + close-slot energy + narrative_beat`. NO per-brand `hard_sell_allowed` field — organic content is pipeline-level invariant, not brand-level config.

**Subject stance modulates voice + overlay density** at Copywriter prompt level. `single-subject` ≠ first-person — brand persona's "rarely first-person" tenet binds at brand level; stance modulates within.

### W8 — Orchestrator

**Shipped:** 2026-04-24 (merged at SHA 89c886f, deployed same day).

State machine over the pipeline (not a DAG executor): QUEUED → PLANNING → RETRIEVING → DIRECTING → SNAPSHOT_BUILDING → PARALLEL_FANOUT → (branch on Critic verdict). Sequential spine + parallel tail.

**Three-tier feature flag composition:**
- Tier 1: `brand_configs.pipeline_version` (`phase35` | `part_b_shadow` | `part_b_primary`)
- Tier 2: `jobs.pipeline_override` (per-job override; values `force`/`part_b` or `skip`/`phase35` or NULL)
- Tier 3: `PART_B_ROLLOUT_PERCENT` env var (deterministic per-job hash)

Composition logic in `src/orchestrator/feature-flags.ts`. All three default to off; merging W8 was a no-op for production traffic.

**shadow_runs table** stores Part B output during shadow; never touches `jobs.context_packet` (Phase 3.5's). Migration 011 added `shadow_runs` + `brand_configs.pipeline_version` + `jobs.pipeline_override`.

**Revise-loop:** soft cap 2 cycles. `slot_level` → orchestrator surgical re-invokes Director on flagged slots. `structural` → orchestrator triggers full re-plan (Planner → Retrieval → Director). Budget exhaustion → escalates to human at `brief_review` with full revise history.

**Fire-and-forget dispatch from BullMQ planning worker.** Part B errors NEVER propagate to Phase 3.5's flow. The `.catch()` boundary is at the dispatch site; internal Part B calls throw normally per Rule 38.

**Pre-builds segment snapshots once per job** at SNAPSHOT_BUILDING state, passes to Critic + Copywriter (saves one Supabase round-trip vs each agent fetching independently). Required minor W7 refactor — `buildSegmentSnapshots` extracted to `src/lib/segment-snapshot.ts` shared lib.

**job_events observability:** `partb_*`-prefixed event types via `DB_EVENT_NAMES` translation map (varchar(30) ceiling on `to_status` column required map vs naive prefix concat). Per-state-transition + per-retry-exhaustion granularity per Q8.

**Validation:** Gate A 28/28 cases (10 mocked state machine + 15 synthetic + 3 real E2E). Tier 2 surfaced two informational signals — none of three real seeds completed without escalation, signal that nordpilates' early shadow will see heavy operator escalation load (followup tracked).

### W9 — Shadow mode rollout — unchanged from original spec

### Production Polish Sprint — PAUSED MID-PILLAR-1 (2026-04-28)

**Status:** Pillar 1 c1-c4 shipped to feat branch, parked unmerged. Pillars 2-6 untouched.

**Why paused:** Business pressure for shippable nordpilates videos this week shifted priority to Simple Pipeline parallel architecture. Polish Sprint stays parked until Simple Pipeline ships and operator content cadence stabilizes.

**Resumption point:** Polish Sprint Pillar 1 c5 (running calibration harness scripts, writing CALIBRATION_REPORT.md, writing Tier 1 verification artifact). Branch `feat/polish-sprint-pillar-1-critic-calibration` at HEAD `cebfc46`, 6 commits ahead of main, pushed to origin. Q1+Q2 answers locked from c4 close: production VPS path-A confirmed; calibration jobs left in `brief_review` post-termination.

**Unchanged from session 18 brief:**
- Pillar order remains 1 → 2 → 4 → 3 → 6 → 5 with three Gate A tiers
- Critic charter rewrite + stance-conditional thresholds shipped on parked branch (c1-c2)
- Planner audit shipped (c3); operator-judgment column [Domis review] held open
- 4 calibration seeds harness shipped (c4); seeds not yet run

**What changed from session 18 brief:**
- Pillar 4 (logo wiring) is no longer Polish Sprint's first render-output workstream because Simple Pipeline ships its own logo overlay independently. Pillar 4 still belongs to Polish Sprint scope (advanced pipeline logo wiring) but isn't blocking first shippable video.
- Pillar 2 (music expansion) is harness work that becomes useful for both Simple Pipeline and advanced pipeline. Operator may sequence music ingestion via the bulk-ingest harness (when shipped) concurrent with Polish Sprint resumption.

**When this resumes:** Once Simple Pipeline v1 ships and operator has nordpilates videos uploadable to TikTok, Polish Sprint reactivates with Pillar 1 c5 as the next commit. Estimated 1-2 weeks elapsed time before resumption depending on Simple Pipeline ship + operator content cadence.

### Simple Pipeline — parallel architecture (two products)

**Status:** brief drafted, agent not yet kicked off. Filed at `docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md`.

**Purpose:** Ship uploadable nordpilates (and other-brand) videos this week despite Polish Sprint timeline being 4-8 weeks. Sibling pipeline to Phase 3.5 / Part B; not a replacement, not a modification.

**Architectural separation:**
- New BullMQ queue `simple_pipeline` (separate from existing planning, rendering, ingestion, export queues)
- New worker `src/workers/simple-pipeline.ts`
- New orchestrator `src/orchestrator/simple-pipeline-orchestrator.ts`
- ffmpeg-based render path (avoids Remotion + render bridge gap that W9.2 addresses)
- No Critic, no Director, no Planner — single Gemini Pro library-aware agent serves both products
- Reuses existing music_tracks selection, brand_configs, asset_segments retrieval

**Two products from one infrastructure:**

| Product | Sheet `Format` value | Slot count | Picker output | Overlay style |
|---|---|---|---|---|
| Routine videos | `routine` | 2-5 (Sheet `Clips` column, default 3) | Agent emits N ranked segment_ids from one parent (parent-first picker, cooldown of 2) | Routine prompt — instructive, brand-anchored, label-style |
| Meme videos | `meme` | 1 (implicit) | Agent emits 1 segment_id from any parent (segment-first picker, segment cooldown of 2) | Meme prompt — punchy, conversational, hook-style |

Both products use the same Gemini Pro library-aware "Match-Or-Match" agent that sees v2 segment descriptions (not raw videos) for the brand and picks the best-fit segment(s) for the idea seed. Single Gemini call per render. Output shape determined by Format input.

**Cooldown logic:**
- Routine: parent cooldown last 2 + segment cooldown last 2 (per brand)
- Meme: segment cooldown last 2 only (parent cooldown implicit via segment uniqueness when slot_count=1)

**Operator routing:**
- Sheet "Pipeline" column: dropdown `simple` / `advanced`. Empty defaults to `advanced`. Existing.
- Sheet "Format" column (NEW): dropdown `meme` / `routine` for simple pipeline jobs. Determines orchestrator branch.
- Sheet "Clips" column (NEW): dropdown 1-5 for slot_count. Mostly informational for meme (always 1); operator-controlled for routine (default 3).

**Per-brand readiness gating:**
- S1 routes to simple_pipeline queue only if brand has (a) ≥3 parents with ≥10 segments AND (b) brand_configs.aesthetic_description populated
- If either missing, S1 sets jobs.status = `simple_pipeline_blocked` with reason in Sheet status

**Why this is parked behind S8 chore:** S8 multi-brand routing was shipped first to enable cyclediet / carnimeat / nodiet ingestion. Simple Pipeline can't serve those brands until they have library content. S8 + lazy brand_configs population is the unblock path.

**Why this stays separate from Polish Sprint:**
- Polish Sprint reframes Critic for advanced pipeline quality bar. Simple Pipeline doesn't use Critic at all.
- Polish Sprint Pillar 4 (logo wiring), Pillar 3 (text safe zones), Pillar 6 (transitions) are advanced-pipeline render concerns. Simple Pipeline ffmpeg render path is independent.
- Polish Sprint Pillar 5 (body composition filter) eventually applies to both pipelines via S7 ingestion, but not Tier 1 scope.
- Polish Sprint Pillar 1 (Critic stance-conditional + charter rewrite) — the parked work — is purely Critic-shaped; doesn't touch Simple Pipeline at all.

**Future-conditional work that re-emerges if Simple Pipeline output isn't enough:**
- Director architecture rebuild (W11) — only if Simple Pipeline output reveals a creative-direction gap that Polish Sprint Pillar 1 looser thresholds can't fix on the advanced pipeline
- Multi-parent simple pipeline cuts — currently single-parent only; multi-parent is a Simple Pipeline v2 if v1 output gets stale across many videos
- Simple Pipeline render-bridge integration with W9.2 — only if Simple Pipeline's ffmpeg-based render needs to talk to the same render bridge surface as Part B; not currently the case

**Estimated timeline:**
- Simple Pipeline v1 (both products, single brand `nordpilates`): ~3-4 days agent work after S8 chore + brand_configs lazy population for nordpilates
- First real shippable nordpilates video: shortly after Gate A close
- Multi-brand expansion: per-brand operator action (drop content + populate brand_configs.aesthetic_description) — operator-time-bound, not agent-time-bound
- Cyclediet/carnimeat/nodiet first videos: depends on ingestion velocity; realistically end of week 1 or early week 2 post-Simple-Pipeline-ship

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

## Cost & latency projections (revised 2026-04-28)

### Phase 3.5 (production, all brands)

| Stage | Cost | Wall time |
|---|---|---|
| Creative Director (Sonnet) | $0.05-0.08 | 30s |
| Asset Curator V2 (Gemini Pro × parallel slots) | $0.05-0.10 | 90-180s |
| Copywriter (Sonnet) | $0.05-0.08 | 20s |
| Music selection | $0 | <1s |
| Render (Remotion) | $0 | 60-90s |
| **Phase 3.5 total** | **~$0.10-0.20/video** | ~240-300s |

### Part B (shadow mode on nordpilates)

| Stage | Cost | Wall time |
|---|---|---|
| Planner (Gemini Pro) | $0.05 | 8s |
| Retrieval (×N slots) | $0 | 3s total |
| Visual Director (×N slots, parallel) | $0.30-0.40 | 30-45s |
| Copywriter (Gemini Pro) | $0.03 | 6s |
| Coherence Critic (Gemini Pro) | $0.05 | 10s |
| **Part B happy-path** | **~$0.45-0.55/video** | ~75s |
| Revise loop (×2 max) | +$0.10-0.15 per cycle | +30s per cycle |
| **Part B with full revise** | **~$0.55-0.85/video** | ~135s |

### Simple Pipeline (both products)

| Stage | Cost | Wall time |
|---|---|---|
| Match-Or-Match agent (Gemini Pro) | ~$0.01-0.02 | 8-12s |
| Overlay generator (Gemini Pro, routine or meme prompt) | ~$0.005 | 5s |
| Music selection | $0 | <1s |
| Render (ffmpeg) | $0 | 30-60s |
| **Simple Pipeline total** | **~$0.015-0.025/video** | ~50-90s |

### Dual-run mode (current state for nordpilates: phase35 + part_b)

| Combination | Cost | Wall time |
|---|---|---|
| **Phase 3.5 + Part B per nordpilates job** | **~$0.55-1.05/video** | ~480s wall (parallel) |

Once Simple Pipeline ships, operator can route nordpilates jobs to:
- `advanced` pipeline (Phase 3.5 + dual-run Part B if `pipeline_version='part_b_shadow'`)
- `simple` pipeline (single Match-Or-Match agent, no Critic, no Director)

**Operator cost ceiling:** $1/video accepted, even higher if necessary. Current state well within ceiling. Simple Pipeline at ~$0.025/video provides massive headroom; can raise if needed for higher-quality agent calls.

**Watch item:** dual-run mode (Phase 3.5 + Part B simultaneously) doubles Sonnet API consumption per nordpilates job. Anthropic limit raised by operator on 2026-04-27; sufficient for sprint scale. Logged as `claude-api-limit-watchitem`. Simple Pipeline doesn't use Sonnet (Gemini Pro only) so it doesn't compound this.

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
- [x] W7 shipped (Copywriter; merged 2026-04-24)
- [x] W8 shipped (Orchestrator; merged + deployed 2026-04-24)
- [ ] W9 shipped (Shadow rollout) — NEXT BRIEF
- [ ] W10 shipped (Voice generation) — post-shadow
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

*Revised 2026-04-24 (second revision). W8 Orchestrator shipped + deployed. Part B pipeline exists as runtime code end-to-end; dormant until and flipped to pipeline_version='part_b_shadow'. Next brief: W9 Shadow rollout (operates the flags W8 built).*

*Revised 2026-04-24 evening (session close). W7 Copywriter + W8 Orchestrator both shipped this session; Part B pipeline now exists as runtime code end-to-end. W8 was the first runtime-changing merge; Phase 3.5 verified unaffected via post-deploy test job. Q5 architectural flip during W8 brief drafting (Critic gets library inventory injected for signal-based revise_scope routing) was the session's load-bearing decision. Next brief: W9 Shadow Rollout — operates the flags W8 built, ramps Part B from 0% to first-brand-cutover.*
