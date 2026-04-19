# Handoff — Video Factory, Phase 3 Architecture Pivot

## Who you are talking to

Domis (Dominykas Auglys). Lithuanian, Vilnius. Operates a multi-brand digital business spanning health/wellness/fitness apps. You're his task curator and project manager. The agent on his VPS executes code; he's the debugger/tester pushing changes through.

Three-person loop: Domis is operator + tester. You write briefs and review work. The agent (separate Claude instance with VPS SSH access) executes code on the server.

## What happened in the session that just ended

### Prompt-level fixes shipped (2026-04-18)

Three prompt changes merged to main (`090bb07`):
1. **Hook duration minimum** — CD prompt enforces ≥7s for slow talking-head hooks, ≥5s for medium
2. **Visual descriptions** — CD prompt has CRITICAL block with examples showing exercise name → visual description conversion, plus updated Example 3 body slots
3. **Curator prep-clip rejection** — new criterion #2 "Active performance" in curator prompt requiring exercise clips to show active performance, not setup/positioning

### Segment analyzer deep rewrite shipped (2026-04-18)

Full rewrite of `segment-analyzer.md` (`0d9f55e`):
- 4 failure modes documented at top (prep vs exercise, segments too long, generic descriptions, no subject identity)
- Duration caps: exercise max 12s, hold max 15s, other max 20s
- Subject appearance mandatory: hair, clothing, build in every description
- Exercise naming required when identifiable
- Tags expanded: 10-15 per segment across 8 structured categories
- Movement phase tags: `phase:active-reps`, `phase:hold`, `phase:setup`, `phase:release`

### Full re-segmentation backfill completed (2026-04-18)

Backfill script extended with `--reprocess` mode and run on all 191 assets:
- **611 → 903 segments** (47% increase)
- Avg exercise segment duration dropped from ~25s to ~6s
- Subject appearance: present in 100% of new segments
- 0 failures, ~$12 Gemini credits, 170 minutes runtime
- Old R2 keyframes and clips cleaned up

### Test results: prompt fixes helped but didn't fix the core problem

**Test 1 (pre-backfill):** "3 pilates moves that open tight shoulders"
- Curator scores improved: Slot 0 scored 9/10 (was 4-5/10 in Phase 3 first render)
- Clips still didn't match exercise names in overlays
- Music mismatch persisted (Milkshake for gentle shoulder mobility)

**Test 2 (post-backfill, 5-job batch):**
- "fun pilates exercises" — rendered, QA PASSED, but exercises shown don't match overlay text
- Preparation clips still selected for exercise slots despite curator prompt fix
- CTA talking-head reuse still occurring
- CD still generating exercise names it can't verify exist in the library

### The core architectural problem identified

**The CD designs videos for a library it has never seen.** The current flow:

```
CD invents specific exercises → Curator searches for them → Library doesn't have them
→ Curator picks closest "exercise on mat" → Overlay says "Roll-ups" but clip shows glute bridges
→ Factually wrong video
```

No amount of prompt tuning fixes this. The architecture is backwards.

## The plan for the next session: Library-Aware Pipeline Rebuild

### The new architecture (Approach B — flip the flow)

**Current (broken):**
```
Idea seed → CD designs full brief with exercise names → Curator searches for named exercises
→ Copywriter writes text for CD's plan → Result: text doesn't match clips
```

**Proposed (library-aware):**
```
Idea seed → CD queries library inventory → CD designs structure + energy + body focus (NOT exercise names)
→ Curator picks best available clips for each slot by body region + energy
→ Copywriter writes overlay text AFTER clips are selected, describing what's actually on screen
→ Result: text always matches clips
```

### Key design decisions

1. **Library inventory as CD input (Approach A element).** Before the CD runs, query the segment library: "What exercises does nordpilates actually have? How many of each?" Build a concise inventory. Feed to CD as context. The CD designs videos using ONLY content that exists.

2. **CD sets structure, not specific exercises.** The CD outputs:
   - Video structure (hook → body slots → CTA)
   - Energy arc per slot
   - Body focus per slot ("upper body", "core", "lower body", "full body")
   - Vibe, color treatment, transitions
   - Content type per slot (exercise, talking-head, b-roll)
   - Duration targets
   - NOT specific exercise names (except for exercise-specific seeds like "show me a glute bridge tutorial")

3. **Curator picks freely within constraints.** Given body focus + energy + content type, curator selects the best-looking clips from what's available. No exercise-name matching. The curator's job becomes "find the best core exercise clip at energy 7" not "find a dead bug."

4. **Copywriter runs AFTER clip selection.** Copywriter receives the selected clips' descriptions and tags, then writes overlay text that describes what's actually on screen. "Glute Bridge Hold" appears as text only if the clip actually shows a glute bridge. No mismatch possible.

5. **Exercise-specific videos are still possible.** When the idea seed names specific exercises ("show me wall angels and thread the needle"), the CD checks the inventory. If those exercises exist → proceeds normally with exercise names. If they don't exist → substitutes available exercises and adjusts the seed, or tells the operator "missing content for this idea."

### What needs to change (scoped)

| Component | Change | Effort |
|---|---|---|
| New: Library inventory query | RPC or function that returns exercise counts by body region, segment type, subject appearance | Small |
| `creative-director.md` | Major rewrite: receives inventory, outputs body-focus slots instead of exercise names | Large |
| `context-packet.ts` | Inject library inventory before CD call; pass selected clip descriptions to copywriter | Medium |
| `asset-curator-v2.md` | Update to match on body focus + energy instead of exercise name descriptions | Medium |
| `asset-curator-dispatch.ts` | Update slot description assembly for new brief shape | Small |
| `copywriter.md` | Major rewrite: receives selected clip descriptions, writes text to match actual content | Large |
| `copywriter.ts` | Pass clip selection results to copywriter call | Medium |
| Brief Zod schema | Update segment shape: `body_focus` replaces exercise-specific `aesthetic_guidance` | Medium |
| `formatFullBrief()` | Fix Phase 3 display (Layer 4 from original handoff — still broken) | Small |

### What stays the same

- Remotion composition (Phase3Parameterized) — no changes
- Rendering, audio mix, sync check, platform export — no changes
- Segment analyzer prompt — just shipped, working well
- Ingestion pipeline — working, new prompt already live for new assets
- CLIP embeddings from keyframe images — unchanged
- n8n workflows (S1, S2, S8, P1, P2) — unchanged
- Music selection — separate issue (library gap, not architecture)
- Supabase schema — no changes needed
- R2 storage — no changes

## Current state of the codebase

**On main (deployed to VPS):**
- All Phase 3 workstreams shipped (W1-W5)
- `ENABLE_PHASE_3_CD=true` on VPS
- CTA color hotfix deployed
- Prompt fixes deployed (hook duration, visual descriptions, curator prep-clip rejection)
- Segment analyzer deep rewrite deployed
- Backfill reprocess mode deployed
- Full re-segmentation complete (903 segments)

**Latest commit on main:** Check with `git log --oneline -5`

**Feature flags:** Same as HANDOFF_PHASE3_QUALITY.md (all Phase 3 flags true, ENABLE_DYNAMIC_PACING=false)

## Known issues (priority sorted)

| Priority | Issue | Status |
|---|---|---|
| **CRITICAL** | CD designs for exercises it can't verify exist | Architecture pivot needed (this session's goal) |
| **CRITICAL** | Copywriter writes text before clips selected → text/clip mismatch | Architecture pivot (copywriter runs after curator) |
| **HIGH** | Preparation clips still selected for exercise slots | Curator prompt says reject them; may need stronger enforcement |
| **HIGH** | Music library has no calm/ambient tracks | Library gap, not code |
| Medium | CTA talking-head reuse (only ~6 talking-head segments) | More content + b-roll fallback |
| Medium | Full Brief display "SLOT undefined" | formatFullBrief Phase 3 support (cosmetic) |
| Medium | S8 workflow .mov-only filter + skip item crash | queryString clear + IF filter |
| Medium | S1/S2 n8n workflows not reliably polling | Investigate — 3 queued jobs didn't get picked up |
| Medium | CD refuses non-workout idea seeds | Prompt issue — defaults to workout-demo for everything |
| Low | Vibe column not wired (sheet → S1 → Supabase → CD) | Follow-up |
| Low | Legacy `analyzeClip` Gemini Flash runs unconditionally | Cleanup |

## Data inventory (2026-04-18)

- **191 assets** (nordpilates, post-sprint + backfill)
- **903 asset_segments** (all with clip_r2_key + CLIP embedding, freshly re-segmented)
  - Avg segment duration: ~6s for exercise, ~8s for hold
  - Subject appearance tracked in 100% of segments
  - Exercise names identified where recognizable
  - Movement phase tagged on all exercise/hold segments
- 15 music_tracks (gap: no calm/ambient tracks)
- 5 brand_configs (nordpilates active)
- ~10 jobs (includes 5 test jobs from 2026-04-18)

## Files to attach to the next chat

- This handoff doc (`HANDOFF_PHASE3_ARCHITECTURE_PIVOT.md`)
- `CLAUDE.md` (latest)
- `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`
- `docs/PHASE_3_DESIGN.md`
- `docs/SUPABASE_SCHEMA.md`
- Current prompts:
  - `src/agents/prompts/creative-director.md`
  - `src/agents/prompts/asset-curator-v2.md`
  - `src/agents/prompts/segment-analyzer.md`
  - `src/agents/prompts/copywriter.md`
- `src/agents/context-packet.ts` (pipeline orchestration — needs modification)
- `src/agents/asset-curator-dispatch.ts` (slot description assembly)
- `src/agents/copywriter.ts` (copywriter call — needs clip data injection)
- n8n workflow JSONs (S1, S2) — for debugging the polling issue
- `MVP_PROGRESS (10).md` (companion doc, updated below)

## How to start the next session

1. Read this handoff and the MVP Progress doc
2. Understand the architecture pivot: library-aware CD + post-selection copywriting
3. Design the library inventory query (what data does the CD need to see?)
4. Plan the CD prompt rewrite (structure + body focus, not exercise names)
5. Plan the copywriter flow change (receives clip descriptions after selection)
6. Break into workstreams with testable milestones
7. Ship the smallest testable change first (probably: inventory query + CD receiving it)

## Tone and pacing

Same as always: warm, direct, professional. Get to the point. Use buttons for discrete choices. Big changes come as questions. Break work into testable steps. Agent briefs in fenced code blocks.

VPS path is `/home/video-factory`.
n8n instance: separate server, managed by Domis.
