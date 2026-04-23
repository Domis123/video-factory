# Known Follow-ups

This document tracks known issues and deferred work that warrants action but is not blocking current workstreams. Each entry should include: status, failure pattern, what's been tried, what hasn't been tried, conditions for revisiting, and the state of affected data.

New entries go at the top. Resolved entries can be moved to a "Resolved" section at the bottom or removed entirely once the issue is closed.

---

## w6-subject-discontinuity-prevalence-at-director — load-bearing observation for W9 design

**Status:** Active (informational, load-bearing for W9 design).
**Discovered:** 2026-04-23, W6 Gate A smoke.

**Pattern:** W6 Critic flagged `subject_discontinuity` on **3/3 real storyboards**. Root cause trace: Planner emits `subject_consistency: single-subject` + `subject_role: primary` on every slot; W4 returns ~78% same-parent candidates; W5 Director picks cross-parent ~29% per slot (observed W5 Gate A). Per-slot 29% compounds at storyboard level to ~80% probability of at least one cross-parent in a 5-slot primary-only video. W6 Critic correctly catches this. W8 orchestrator will trigger revise-loops at high rate on real nordpilates storyboards.

**Tried:** nothing — this is correct Critic behavior on real data.

**Not tried:** (a) tightening W5 prompt to require explicit justification for cross-parent on primary slots; (b) Critic severity tuning to downgrade `subject_discontinuity` to low when Director reasoning names a justification; (c) reducing Planner's default `subject_role=primary` assignment. All three declined at this stage — W5+W6 are shipped, orchestrator loop hasn't been tested yet.

**Revisit at W9 shadow mode.** Measurement criteria: (1) how often orchestrator revise-loop converges on `approve` vs exhausts retry budget; (2) if prohibitive exhaustion rate, which of (a)/(b)/(c) materially reduces `subject_discontinuity` without de-fanging other Critic checks. Do NOT tune W5 or W6 pre-shadow.

**Affected data:** none written. Pure architectural observation.

**Owner hint:** planning-chat (architecture call) → W9 shadow analysis.

---

## w5-duplicate-segment-across-slots-in-director — same segment_id picked for two adjacent body slots

**Status:** Active, deferred to W6 Coherence Critic.
**Discovered:** 2026-04-23, W5 Gate A smoke (storyboard 1: "morning pilates routine for hip mobility").

**Pattern:** Storyboard 1 picked segment_id `9f86f752-5a7a-44b1-8ac1-4ea4967fffe8` (parent `d46e70c4`) at in_point `259.00` for BOTH slot 3 (body, `body_focus=[hips]`, target 6.5s, trim 259.00→265.50) AND slot 4 (body, `body_focus=[hips]`, target 7s, trim 259.00→265.80). Same clip, 300ms duration delta between the two slots. Root cause: W5 `pickClipForSlot` calls are independent by design ("trust the pool, no cross-slot coordination" — brief decision), so two slots whose `narrative_beat` + `body_focus` + `subject_role` produce near-identical query embeddings retrieve near-identical candidate pools and independently pick whichever candidate ranks highest for each. Director's per-slot reasoning both cite subject continuity + hips focus — each call is defensible in isolation; the duplicate only shows up at the storyboard level. NOT a W5 bug, NOT a Gemini confabulation — it's a direct, known cost of the per-slot independence design.

**Tried:** nothing at W5 layer by design — adding cross-slot coordination to the Director would violate the per-slot-parallelizable contract W5 was built around, and would re-litigate a locked brief decision.

**Not tried (at W5):** per-slot post-processing to reject already-picked segment_ids, soft-penalty re-rank when a segment has been chosen by an earlier primary slot, rebuilding the candidate pool to exclude prior picks.

**Will be addressed at W6 Coherence Critic** as a mandatory verdict issue type (working name: `duplicate_segment_across_slots`). The Critic sees the full storyboard, has global context by construction, and is the correct layer to catch this. Planning chat already holds the hook for making this a required Critic verdict field.

**Revisit if:** (a) W6 ships and the Critic CAN'T reliably catch this in evaluation, OR (b) W9 shadow mode shows Critic rejection rate on this specific issue is prohibitively high (e.g. >30% of storyboards require a revise-loop cycle only because of this one issue), in which case moving some cheap dedup into the W5 Director as a late soft-filter becomes reasonable.

**Affected data:** none persistent — single W5 Gate A smoke run, outputs were validation artifacts not production records.

**Owner hint:** W6 Coherence Critic prompt author.

---

## w5-subject-role-all-primary-in-planner — Planner never emits subject_role='any'

**Status:** Active, not blocking.
**Discovered:** 2026-04-23, W5 Gate A smoke.

**Pattern:** Across 3 W5 Gate A test storyboards (14 total slots spanning `routine_sequence` and `day_in_the_life` forms), the Planner emitted `subject_role='primary'` on **14/14** slots. The `day_in_the_life` storyboard — which has natural b-roll cutaway opportunities (setting establishing shots, space-prep shots, ambient inserts) — still got primary on every slot. The `subject_role='any'` enum value is effectively unused at current Planner prompt state. Consequence for W5: the Visual Director's parallel-fanout branch never fires, so `parallel_speedup_ratio` is always 1.0 and wall = sum of per-slot latency. Not a W5 bug — downstream W5 handled the 100%-primary case cleanly (sequential primary chain, subject-continuity warnings where warranted). Observation is about W3 Planner prompt behavior.

**Tried:** nothing. Not blocking on W5 Gate A — the Director's orchestration works for all-primary storyboards, just loses the parallelism speedup that `subject_role='any'` slots would unlock.

**Not tried:** (1) inspect Planner prompt (`src/agents/prompts/planner-v2.md`) for whether `subject_role='any'` is even described as an option distinct from `primary`; (2) add explicit prompt guidance that b-roll / setting / transition slots SHOULD use `subject_role='any'`; (3) add a smoke assertion that at least one non-primary slot appears on `day_in_the_life` forms.

**Revisit if:** (a) W9 shadow mode surfaces that primary-only storyboards feel monotonous (too much same-person continuity, not enough environmental variety), OR (b) W5 Director wall-time becomes a production bottleneck and parallelism recovery would help. Either condition is sufficient to justify Planner prompt tuning to emit `subject_role='any'` on appropriate slots.

**Affected data:** none. `subject_role` is a per-planning-run field; the current all-primary outputs are well-formed and downstream-consumable. Planner outputs cached in `context_packet_*.json` fixtures.

**Owner hint:** whoever tunes Planner prompt variety / W9 shadow-mode reviewer.

---

## w3-naive-singularization-es-words — text-normalize.ts drops trailing -s only

**Status:** Active, not blocking.
**Discovered:** 2026-04-22, W3 Gate A library inventory snapshot.

**Pattern:** `src/lib/text-normalize.ts` `normalizeToken()` trims only a trailing `-s` (with `-ss`/`-is`/`-us` exempted). Words ending in `-es` or `-ses` get incompletely singularized: `crunches` → `crunche`, `sunglasses` → `sunglasse`, `beverage cans` is fine because space-separated. Observed in nordpilates inventory snapshot (`top_exercises: crunche 10, bicycle crunche 8`; `equipment: sunglasse 6`). Downstream it means the Planner sees `crunche` in the top-exercise list, which reads wrong but doesn't affect form/hook decisions since these are informational-only summaries.

**Tried:** nothing — not blocking on W3. Decision document-trail only.

**Not tried:** (1) stemmer library (e.g., `natural`), (2) a hand-coded `-es` → `-e` rule with a stop-list for false positives (`glasses` → `glass` is already exempted by `-ss`; `classes` would hit the same), (3) leaving it alone and accepting the quirk.

**Revisit if:** the Director or Planner starts making bad decisions traceable to vocabulary aliasing between LLM-generated clip descriptions (plural) and Planner/Director vocabulary (singularized). Also if a brand ingests content with many `-es` plurals (veggies, cherries, berries for a food brand).

**Affected data:** any aggregator output from `text-normalize.ts`. In use by `library-inventory-v2.ts` for `equipment` + `top_exercises` fields.

**Owner hint:** whoever tunes Planner or Director retrieval quality.

---

## v1-curator-flash-nulls-if-emergency-rollback — post-Flash-removal rows break the V1 rollback path

**Status:** Active (informational)
**Discovered:** 2026-04-22, commit `99d661e` (Flash removal merged to main)

**Pattern:** After the Flash analyzeClip removal from the ingestion hot path, fresh `assets` rows get NULL for `content_type`, `mood`, `quality_score`, `has_speech`, `transcript_summary`, `visual_elements`, `usable_segments` (plus empty `tags` when filename has no description suffix). V1 asset-curator (`src/agents/asset-curator.ts`) reads all of those fields directly. It is unreachable in production because `ENABLE_CURATOR_V2=true` (live since 2026-04-13) routes every call to V2 in `asset-curator-dispatch.ts`. Old rows (pre-2026-04-22) still carry Flash-written values and would still work.

**Tried:** nothing — intentional. Flash was blocking v2 on 429; removal was the right fix. V1 was already on the emergency-only rollback path, not the production path.

**Not tried:** (1) restoring Flash temporarily in a retry-wrapped codepath, (2) teaching V1 to tolerate NULL Flash fields, (3) dropping the V1 codepath entirely (would close the rollback door). Declined — all three are work that only matters if the rollback button actually gets pressed.

**Revisit if:** anyone flips `ENABLE_CURATOR_V2=false` for emergency rollback. At that moment the decision is (a) restore Flash temporarily (quickest), (b) harden V1 against NULLs (correct but slower), or (c) accept that only pre-2026-04-22 assets are curatable until v2 is re-enabled.

**Affected data:** all `assets` rows inserted on/after 2026-04-22 on main. Old rows unaffected.

**Owner hint:** anyone touching the `ENABLE_CURATOR_V2` flag.

---

## part-a-classification-noise-spotcheck — W1 Gate B visual audit surfaced isolated segment_type mismatches

**Status:** Active, not blocking.
**Discovered:** 2026-04-21 (W1 Gate B, n=5 spot-check).

**Pattern:** 1 of 5 smoke mosaics showed segment_type mismatch against visual ground truth (`transition` label on what looks like a hold/exercise plank-with-leg-lift). Sample too small to estimate library error rate. Not blocking — Part B is pivoting to treat segment taxonomy as fixed and solving creative variance upstream (W2/W3 redesign).

**Tried:** n=5 visual spot-check via W1 grids.

**Not tried:** Larger audit. Deferred — only relevant if W2/W3 ship and nordpilates output quality implicates retrieval filtering.

**Revisit if:** W5 Visual Director consistently rejects candidates from a specific segment_type at abnormal rates, suggesting the type filter is mis-bucketing content.

**Affected data:** up to 720 v2 segments (nordpilates). Known mismatch: segment_id 0dbfbc89-4e94-484e-9a59-9e0cba6bcc84 (labeled `transition`, visual evidence suggests `exercise` or `hold`).

**Owner hint:** unowned until W5 signal.

---

## w1-raw-fallback-crop — `increase,crop` will center-crop landscape source to a narrow vertical strip

**Status:** Deferred
**Discovered:** 2026-04-21, W1 Gate A smoke

**Pattern:** `buildKeyframeGrid()` uses `scale=256:455:force_original_aspect_ratio=increase,crop=256:455` to compose mosaic tiles. For 9:16 pre-normalized parents (production path since W5), the crop is sub-pixel and the tile matches the source content edge-to-edge. If the fallback to `assets.r2_key` (raw, pre-W5) ever fires on non-portrait source (e.g. 16:9 landscape phone footage sideways-held), the filter would center-crop the landscape frame to a narrow vertical strip, discarding most of the content width.

**Tried:** nothing — this is a forward-looking concern, not an observed failure. Post-W5 production data is 100% 9:16, and the original scale+pad approach in the brief failed outright on the rounding issue (see Gate A report).

**Not tried:** aspect-aware branching (detect landscape-input → letterbox with black bars instead of center-crop) — avoided to keep W1 scope narrow. Would need to probe parent resolution before picking the filter graph.

**Revisit if:** (1) the raw-fallback path (`pre_normalized_r2_key IS NULL`) fires on a production segment; (2) a new brand onboards with non-portrait UGC; (3) a grid renders as a narrow vertical strip and Visual Director quality suffers.

**Affected data:** none observed. All 720 v2 segments currently have 9:16 parents via `pre_normalized_r2_key`.

**Owner hint:** planning-chat (architecture call) → agent

---

## part-a-test-segment-uuid-drift — Part A doc references pre-W0d segment UUIDs that no longer exist

**Status:** Active (docs-only)
**Discovered:** 2026-04-21, W1 Gate A smoke

**Pattern:** `docs/PHASE_4_PART_A_SEGMENT_INTELLIGENCE.md` §Test segments lists three approved UUIDs (`f9788090-…`, `03c60575-…`, `f36d686b-…`) for W0a/W0b validation runs. W0d's destroy-and-rebuild re-segmentation dropped those rows; the live v2 library (720 rows as of 2026-04-21) does not contain any of them. Any post-W0d agent or operator following that section as a reference will hit "segment not found" errors.

**Tried:** W1 Commit B adds a one-line warning callout under §Test segments pointing readers to query the live v2 library for current UUIDs. Minimal, sufficient.

**Not tried:** picking three replacement UUIDs and freezing them in the doc — declined, since W0d's rebuild pattern may recur (Part B W-later re-analysis), and hard-coding UUIDs just re-creates the drift.

**Revisit if:** Part A doc gets a larger edit pass and someone wants to rewrite §Test segments end-to-end; otherwise leave as-is.

**Affected data:** documentation only. No code, DB, or R2 impact.

**Owner hint:** manual (docs-only)

---

*(Entries above added during W1 Gate B, 2026-04-21.)*

---

## Template (for future entries)

```markdown
## <short-identifier> — <one-line description>

**Status:** <Active / Investigating / Deferred>
**Discovered:** <date, stage>

**Pattern:** <observed failure or issue pattern>

**Tried:** <approaches attempted, with outcomes>

**Not tried:** <approaches declined, with rationale>

**Revisit if:** <conditions under which this should be looked at again>

**Affected data:** <what rows, files, or state is impacted>

**Owner hint:** <planning-chat / agent / manual / unowned>
```

---

## Resolved

*(Entries moved here once closed, with a "resolved on <date>" note. Optional — can just remove entries instead.)*
