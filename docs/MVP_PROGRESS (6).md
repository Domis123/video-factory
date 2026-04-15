# Video Factory — MVP Progress Tracker

**Last updated:** 2026-04-15

---

## Session 2026-04-15 — Phase 3 Planning Locked

### Headline

Phase 3 design session complete. CD output schema designed field-by-field over 12 decisions. Five workstreams locked, three milestones defined, both behind feature flags. Documentation grounded before any code begins.

**Source of truth:** `docs/PHASE_3_DESIGN.md` — read this before any Phase 3 work.

### What was decided

| Decision | Value |
|---|---|
| Vibe input format | Free-text tag, optional, operator-typed or CD-generated |
| Vibe interpretation | Loose guidance (CD can push back when idea_seed contradicts) |
| Brief structure | Hybrid: structured fields for code + creative_vision paragraph for LLM nuance |
| Slot count range | 3-12 (wider than originally planned, accepting slower planning for variety) |
| Energy curve | Per-slot energy_per_slot array, values 1-10 |
| Pacing per slot | Hybrid: enum (slow/medium/fast) + numeric cut_duration_target_s |
| Cut style | Two enums: transition_in (6 values) + internal_cut_style (3 values) |
| Beat-locked cuts | Deferred to Phase 4 |
| Overlay text owner | Copywriter (not CD) |
| Overlay style enum | 6 values including "minimal" and "none" |
| Overlay timing | Slot-start, full-duration only (sophistication deferred to 3.5) |
| Aesthetic guidance | Per-slot free-text field, no ingestion changes |
| Music selection | CD specifies constraints + optional pinned_track_id |
| Per-slot music intensity | Deferred to Phase 3.5 |
| Color treatments | 8 named treatments, brand-restricted via allowed_color_treatments |
| Brand config editability | Path C (critical fields in Supabase, tuning fields in sheet) — sheet sync (W6) deferred to Phase 3.5 |
| Clean-slate scope | Full re-ingest — drop existing 182 segments, start fresh |
| Test brand | nordpilates (operator to fix brand_config drift first) |
| Reference-guided generation | Deferred to Phase 4 — system scrapes top similar videos and uses as inspiration |

### Workstreams + milestones

- **W1** — Creative Director rewrite (2-3 sessions)
- **W2** — Asset Curator V2 prompt update (1-2 sessions)
- **W3** — Copywriter agent update, owns overlay text (1-2 sessions)
- **W4** — Remotion parameterized composition (4-6 sessions, biggest workstream)
- **W5** — Clean-slate ingestion + pre-normalization (1-2 sessions, independent)

- **Milestone 3.1** — W1+W2+W3 ship behind feature flag, brief validation via Full Brief column without rendering
- **Milestone 3.2** — W5 ships independently, new uploads use new pipeline
- **Milestone 3.3** — W4 ships, both feature flags flipped together, first Phase 3 production video

### Brand color palettes (initial, edit-in-Supabase until W6 ships)

- **nordpilates:** warm-vibrant, soft-pastel, golden-hour, natural, cool-muted
- **carnimeat:** high-contrast, warm-vibrant, moody-dark, natural, clean-bright
- **welcomebaby, nodiet:** TBD when those brands begin Phase 3 production

### Success criterion

8 of 10 consecutive Phase 3 production videos pass operator approval (`jobs.review_decision = 'approve'`).

### Total estimated effort

9-15 agent sessions across 2-3 weeks. Roughly 3x Phase 2 cleanup.

### What's next

W0 (this documentation) → operator review → W1 (CD rewrite) as first agent task.

### Lessons learned (additions to the running list)

58. **Field-by-field schema design with Q&A is slower upfront but produces better foundations.** 12 decisions in 30 minutes, every field has the operator's fingerprints on it. Cleanup phase later is much harder when the schema was drafted unilaterally.

59. **Hybrid structured + free-text wins repeatedly for LLM-driven systems.** Pattern: structured fields for code to act on deterministically, free-text fields for downstream LLM agents to read for nuance. Field 2 (creative_vision + structured fields), Field 5 (pacing enum + numeric), Field 8 (clip_requirements enums + aesthetic_guidance text) all converged on this pattern independently.

60. **Defer polish features aggressively in design phase.** Beat-locked music, per-slot music intensity, overlay timing all parked for later. Phase 3 stays focused on the "every video feels the same" problem and resists scope creep.

61. **Clean-slate ingestion is the operator-preferred path when content sprint is incoming.** Migrating existing data to a new pipeline is rarely worth the engineering cost when fresh content is about to land anyway.

62. **Brand consistency is best protected through small surface area — logo + colors + caption font locked, everything else free-form.** Resist the urge to template the entire video. Templates produce sameness, which is exactly what Phase 3 is trying to eliminate.

---

## Session 2026-04-14 — Phase 2 Cleanup Shipped

**What shipped**
- PR #1 (Phase 1+2+2.5 + docs v3.9) released to `origin/main` at `bd19edc`.
- Squashed Phase 2 cleanup released to `origin/main` at `269ff99`, tag `phase2-complete` pushed.

**Cleanup contents (one squash, 7 pre-merge commits)**
- `retry-llm.ts` helper + wrap 4 LLM call sites (Sonnet CD, Sonnet Copywriter, Gemini Pro curator pick+critique, Gemini Pro ingestion).
- Zod corrective retry in curator V2 picker — catches malformed Pro JSON that would have been silent fallbacks.
- V2 prompt: 4-bullet soft visual-variety rule with explicit repetition signal for operator.
- `jobs.full_brief TEXT` column + reusable `apply-migration.ts` runner (via `apply_migration_sql` RPC bootstrap).
- `format-full-brief.ts` formatter (label dedup, energy+pacing in headers, IG 200-char truncate, FALLBACK prefix, 45k cap).
- Worker wiring in `pipeline.ts` + `context-packet.ts`: auto-populate `full_brief` on planning completion, try/catch so formatter bugs can't fail planning.

**Side quests**
- S1 runaway loop (23 dup jobs); planning queue drained via untracked `drain-planning-queue.ts`.
- Bootstrapped Supabase DDL path via `apply_migration_sql` RPC (SECURITY DEFINER, service_role only).
- Migration 005 return-type fix codified as Arch Rule 22 (DROP + CREATE + NOTIFY, no CREATE OR REPLACE).
- Sheet cell escape via leading apostrophe in S2 code node.
- Branch-to-origin workaround: VPS lacks GH creds → laptop pulls via `git fetch ssh://…/home/video-factory`, pushes from there.

**Production validation**
- Test job `10e7612b` ran full new code path at 10:58 UTC; `full_brief` populated + synced to sheet column G.
- Zod corrective retry fired on slot 1, recovered, q=9 pick.
- Wall time ~4 min, matches 4.4-min Phase 2.5 baseline.
- Backfilled `full_brief` for 5 pre-Step-7 jobs (2862–3450 chars each).

**Residual**
- Cosmetic apostrophe prefix visible in Sheet cell.
- `feat/sub-clip-segmentation` preserved on origin as Phase 1 reference.
- Supabase anon key hardcoded in n8n export (accepted risk).
- VPS still GH-credless; pushes go via laptop.

**Next**
- Phase 3: CD archetype + variable slot count + Remotion template variants + pre-normalization at ingestion.
- Content sprint: 15–20 more ab/core UGC (waiting on head of creatives).

See `docs/SESSION_LOG_2026-04-14.md` for full narrative.

---

## ⚠️ Phase 2 Shipped, First Production Video Rated 4-5/10

**Shipped overnight 2026-04-13 → morning 2026-04-14:**

- ✅ Phase 2 (Asset Curator V2) merged to main, `ENABLE_CURATOR_V2=true` live
- ✅ Phase 2.5 (pre-trim segments at ingestion) shipped, 4.1× curator speedup verified
- ✅ First production V2 video rendered end-to-end (job `d74679d2-3c62-4e10-8e03-6da774b55dc1`)
- ⚠️ **Final video rated 4-5/10** by operator

V2 architecture is working as designed. The 4-5 rating is not a V2 failure — it's V2 surfacing **three other bottlenecks** that were previously hidden behind the V1 curator's noise. Diagnosis below.

---

## Diagnosis from First V2 Video

### What worked

- V2 dispatcher routed correctly through `context-packet.ts`
- V2 retrieval returned 15 candidates per slot via `match_segments` RPC (no zero-result issues post-ivfflat-drop)
- Pre-trim FAST PATH engaged on every candidate (no SLOW PATH fallbacks)
- All 5 slots returned non-placeholder picks
- Pro reasoning strings present and coherent
- Hook (slot 0) and closer (slot 4) genuinely good
- End-to-end render: planning ~5 min + render + export = ~16 min total

### What didn't work

| Problem | Layer | Fix scope |
|---|---|---|
| Two slots picked nearly the same clip | V2 prompt | Cleanup commit (small) |
| The duplicated clip wasn't even strong ab content | Library content gap | Content sprint (no code) |
| All videos use the same transition style | Remotion template | Phase 3 (medium) |
| Same ~3 exercises appearing across multiple test runs | Library content gap | Content sprint |
| Different briefs produce structurally identical videos | Creative Director monotony | Phase 3 (large) |
| "Videos lack soul and identity" | Creative Director + Remotion combined | Phase 3 |

### Critical insight

**The library only contains ~3-6 truly ab-focused segments** out of 23 total exercise segments. Pro literally cannot pick clips that don't exist. The 10/10 oblique pick we saw repeatedly in tests is *the one good oblique clip in the library* — there's only one of it. Any "abs burner" video will hit this same content ceiling until more workout UGC is ingested.

Phase 2 made this ceiling visible. It was always there, but V1's random text-tag picking masked it because V1 was the bigger problem.

---

## Overall Status

| Day/Week | Plan | Status |
|---|---|---|
| 1-6 (Apr 9-12) | Foundation through Day 6 polish | ✅ DONE |
| Week 2 Phase 1 (Apr 13 AM) | Ingestion overhaul: Pro + CLIP + asset_segments | ✅ DONE |
| Week 2 Phase 2 (Apr 13 PM) | Curator overhaul: vector retrieval + native video picking | ✅ DONE |
| Week 2 Phase 2.5 (Apr 13 PM) | Pre-trim segments at ingestion for runtime speedup | ✅ DONE |
| Week 2 Phase 2 production validation (Apr 14 AM) | First V2 video rendered + rated | ✅ DONE (4-5/10) |
| **Week 2 Cleanup (today)** | **Retry helper, prompt fixes, brief summary in sheet** | ⏳ NEXT |
| Week 2-3 Content sprint | Ingest more nordpilates workout UGC, target ab/core gaps | ⏳ PLANNED |
| Week 3 Phase 3 | Creative Director archetype + variable slots + Remotion variants + pre-normalization | ⏳ PLANNED |
| Week 4 | Second brand (ketoway) + stabilization | ⏳ PLANNED |

---

## Phase 2 + 2.5 Final Validation Metrics

### Test environment (test:curator-v2, isolated)

| Metric | Result |
|---|---|
| Wall time | 261s (4.4 min, down from 1072s in first Phase 2 commit) |
| All 5 slots ≥7/10 | ✅ |
| Slot 1 oblique pick | 10/10 (reproduced 3× across runs) |
| Unique parents | 5/5 |
| FAST PATH on every candidate | ✅ |
| Cleanup leaks | 0 |

### Production environment (real video render)

| Metric | Result |
|---|---|
| Job ID | d74679d2-3c62-4e10-8e03-6da774b55dc1 |
| Brand | nordpilates |
| Idea seed | "5 minute pilates abs burner for busy moms" |
| Template | hook-demo-cta, 35s, 5 segments |
| Planning wall time | ~5 min (CD + V2 curator + Copywriter + music + context packet) |
| Total wall time | ~16 min (planning + render + export) |
| Final rating | **4-5/10** |
| Hook quality | Good |
| Body quality | Repetitive, weak ab content |
| Closer quality | Good |
| Same-clip duplication | 2 slots picked visually similar segments |
| Variety preference engaged | Yes (5/5 unique parents) but visual similarity not caught |

---

## Cleanup Commit (queued, today)

The session built up a small list of focused fixes that should ship in one commit before any Phase 3 work begins:

1. **`src/lib/retry-llm.ts`** — centralized retry helper for all LLM calls
   - Retry on: 429, 502, 503, 504, 529, network errors, Anthropic `overloaded_error` body type
   - Exponential backoff with jitter: 1s → 2s → 4s → 8s, max 4 attempts, max 30s total
   - Apply to: `creative-director.ts`, `asset-curator.ts` (V1), `copywriter.ts`, `gemini-segments.ts`, `asset-curator-v2.ts`
   - **Why critical:** Last night the worker lost 6 jobs to a single Anthropic 529 surge because no retry existed at the LLM call layer. Same failure will happen on Pro 503s during V2 inference.

2. **Schema-aware Zod retry** for V2 picker output
   - Currently blind retries on Zod failures, hits same error
   - Fix: send schema error back to Pro in corrective prompt OR fall back to highest-quality candidate without retry

3. **V2 prompt update** — `asset-curator-v2.md`
   - Add "each pick must use a different segment_id than ALL previous picks (not just different parent)"
   - Add "avoid picks that visually duplicate previous picks (same exercise from different angle, same body position, same lighting)"

4. **Brief summary visible in sheet**
   - Currently the sheet only shows job ID + status + template summary
   - The actual brief (segment IDs, Pro reasoning, trim windows) lives only in Supabase JSONB
   - Fix: S2 workflow change to flatten brief into a `brief_summary` text column with format like `SLOT N (role): segment XXX | description | score | "reasoning"` per line

5. **Tag `phase2-complete`** — push from operator's laptop (VPS lacks GitHub credentials)

**Estimated total:** 200-300 lines, ~45 min agent time + manual sheet workflow change.

---

## Phase 3 (Week 3 priority, biggest quality unlock)

Phase 3 is the architectural work that gives videos identity. Three pieces:

### 3a. Creative Director archetype + variable slots

Add to CD output:
- `archetype` field: `calm-instructional`, `high-energy-listicle`, `transformation-story`, `tip-stack`, `before-after`, `myth-buster`
- `energy_curve`: `build`, `peak-fade`, `steady`, `alternating`
- `slot_count`: 3-8 (currently fixed at 5)
- Per-slot `cut_style`, `duration_target_s`, `energy_level`

CD picks based on idea seed semantics. Examples:
- "5 mistakes that hurt your back" → tip-stack, 6 slots, alternating energy
- "morning flow for stiff backs" → calm-instructional, 4 slots, steady
- "5 min abs burner" → high-energy-listicle, 7 slots, build
- "30-day transformation" → before-after, 5 slots, peak-fade

### 3b. Remotion template variants

For each video type, author 2-3 template variants differing in:
- Cut patterns (rapid cuts vs slow holds)
- Overlay positioning and animation
- Color grading presets per archetype
- Music sync intensity

Templates live as separate Remotion compositions, CD picks by name.

### 3c. Pre-normalization at ingestion (the unglamorous part)

Pre-normalize parent clips to 1080p at upload time. Drops clip prep from 6-17 min to ~1 min by eliminating per-render encoding. Same architectural pattern as Phase 2.5 — pay once at ingestion, save every render after.

**Total Phase 3 estimated effort:** 3-4 agent sessions over 4-5 days. Biggest unknown is Remotion template authoring (creative work, not engineering).

---

## Quality Targets (revised post first V2 video)

| Stage | Target | Actual | Status |
|---|---|---|---|
| Day 4 (first video) | Floor exists | 6/10 | ✅ |
| Day 5 (polish fixes) | All bugs gone | 5-6/10 | ✅ |
| Phase 1 (ingestion overhaul) | Data layer ready | 182 segments, CLIP clean | ✅ |
| Phase 2 (curator overhaul) | Curator gets eyes | Test 9-10/10 isolated | ✅ |
| Phase 2.5 (pre-trim) | <5 min curator wall time | 4.4 min | ✅ |
| **Phase 2 production validation** | **First V2 video 7+/10** | **4-5/10** | ⚠️ |
| Cleanup commit | Production stability | Pending | ⏳ |
| Content sprint (ab UGC) | Library has 15+ exercise segments | 3-6 currently | ⏳ |
| **Phase 3 (CD archetype + Remotion variants + pre-norm)** | **Videos with soul, 7+/10 sustained** | 🎯 | ⏳ |
| Week 4+ (2nd brand) | Scale without regression | 🎯 | ⏳ |

The 7+/10 target shifts from "Phase 2 alone" to "Phase 2 + content sprint + Phase 3 combined." V2 alone cannot hit 7+ on the current library because the content ceiling is the binding constraint, not the picker.

---

## Infrastructure (unchanged from yesterday)

| Service | Host | Status | Cost/mo |
|---|---|---|---|
| n8n | 46.224.56.174 | ✅ | ~€4.50 |
| VPS | 95.216.137.35 (CX32 8GB) | ✅ | ~€8.50 |
| Supabase | Free tier (pgvector) | ✅ | $0 |
| Upstash Redis | Free tier | ✅ | $0 |
| R2 | 53 clips + 182 keyframes + 182 pre-trimmed segments (355 MB) + music + logos + renders | ✅ | ~$1.02 |
| Claude Sonnet API | CD + Copywriter | ✅ | ~$0.25/video |
| Gemini API (3.1 Pro Preview) | Ingestion + Curator V2 | ✅ | ~$0.06/clip + ~$0.20/video |
| CLIP self-hosted | `@xenova/transformers` | ✅ | $0 |

---

## Workflows

| # | Name | Version | Active | Notes |
|---|---|---|---|---|
| S1 | New Job | v2 final | ✅ | |
| S2 | Brief Review | v2 final | ✅ | **Needs `brief_summary` column added in cleanup commit** |
| S3 | QA Decision | v1 | ⏸ | Still needs v2 rebuild before first `delivered` |
| S7 | Music Ingest | v2 | ✅ | |
| S8 | UGC Ingest | v1 | Manual | Backend writes pre-trimmed clips + segments |
| P2 | Periodic Sync | v2 | ✅ | Confirmed working (had brief delay during first V2 render) |

---

## Data State

| Table | Rows | Notes |
|---|---|---|
| assets | 53 nordpilates | 1 black-screen clip deleted in Phase 1 |
| asset_segments | 182 nordpilates | All have `clip_r2_key` populated. 8 segment types. CLIP embeddings. No ivfflat index. |
| music_tracks | 15 | Tagged with mood + energy_level (audience-suitability score TBD) |
| brand_configs | 3 | Complete |
| jobs | 3+ | Including first successful V2 production render |

---

## Feature Flags (current)

| Flag | Current | Notes |
|---|---|---|
| ENABLE_COLOR_GRADING | true ✅ | Day 6 |
| ENABLE_BEAT_SYNC | true ✅ | Day 6 |
| ENABLE_MUSIC_SELECTION | true ✅ | Day 6 |
| ENABLE_DYNAMIC_PACING | false | Phase 3 |
| ENABLE_AUDIO_DUCKING | true ✅ | Day 4 |
| ENABLE_CRF18_ENCODING | true ✅ | Day 4 |
| **ENABLE_CURATOR_V2** | **true** ✅ | **Live in production since 2026-04-13 13:46 UTC** |
| GEMINI_INGESTION_MODEL | `gemini-3.1-pro-preview` | Pin |
| GEMINI_CURATOR_MODEL | (unset, defaults to ingestion model) | Correct |

---

## Lessons (Phase 2 + 2.5 + first production validation)

41. **The ivfflat index was the silent killer.** Stale centroids routed text queries into empty cells. Sequential scan beats approximate index until ~1000 rows. Drop and recreate when row count justifies it.

42. **CREATE OR REPLACE FUNCTION lies for return-type changes.** Always DROP + CREATE + NOTIFY pgrst for pgvector RPC migrations that touch return signature.

43. **Debug vector retrieval with JS ground truth before assuming the database is wrong.** Hand-compute cosine over all rows in JavaScript. Cheap at MVP scale, conclusive evidence about whether the data, the index, or the client is at fault.

44. **Pre-trim at ingestion is the right architecture for "expensive per-clip transform on small windows of large files."** Pay once at ingestion, save every render after. Same pattern will apply to Phase 3 pre-normalization.

45. **Google Pro Preview 503s are real and need retry logic.** Multiple observed during the session. Anthropic 529s also observed and lost 6 jobs. Retry helper is non-negotiable.

46. **Parent file caching is a 10× less impactful optimization than pre-trim.** Tried caching first because it was lower-risk. Caching cut downloads but ffmpeg encoding still dominated. Pre-trim removed both costs simultaneously. Sometimes the safer incremental fix is the wrong place to spend time when a bigger architectural move is within reach.

47. **Zod validation failures on structured output need schema-aware retry, not blind retry.** Send the schema error back to the model in a corrective prompt, or accept the failure and fall back without retrying.

48. **The first production V2 video taught us that fixing the curator alone doesn't fix the videos.** V2 worked correctly. The 4-5 rating came from three other layers (content gap, template monotony, Creative Director monotony) that V1 had been hiding. Lesson: when one bottleneck dominates, fixing it reveals the next one. Phase 2 was necessary but not sufficient.

49. **The Creative Director needs to be smarter, not duplicated.** Operator's first instinct after seeing the 4-5 rating was "we need two creative directors." The real fix is making the existing one make more decisions: archetype, energy curve, slot count, per-slot cut styles. Adding a second agent would just average two monotonies together.

50. **Library content is a real constraint and "content problem, not pipeline problem" is a real category.** Phase 2 cannot pick clips that don't exist. Until nordpilates has 15+ ab-focused segments, every abs video will reuse the same 3-6 clips and feel repetitive. This is operator work, not agent work.

---

## Active Blockers

None for code work. **Cleanup commit is the next action.**

Production V2 is live and stable. The 4-5/10 rating is a quality observation, not a production blocker. V2 is strictly better than V1 — don't roll back.

**Pending work (in priority order):**
1. Cleanup commit (retry helper + V2 prompt fix + brief summary + Zod retry + tag)
2. Content ingestion sprint for nordpilates ab/core UGC
3. Phase 3 design and execution (Creative Director archetype + Remotion variants + pre-normalization)

---

## Document Status

- `MVP_PROGRESS.md` — this file (post first V2 video rating)
- `VIDEO_PIPELINE_ARCHITECTURE_v3_8.md` — current architecture reference
- `SESSION_HANDOFF_2026-04-14.md` — handoff notes for next agent
- `PHASE_2_CURATOR_BRIEF.md` — historical (Phase 2 fully implemented)
- `INGESTION_OVERHAUL_AGENT_BRIEF.md` — historical (Phase 1)
- `HANDOFF.md` — Day 4 context, historical
