# Known Follow-ups

This document tracks known issues and deferred work that warrants action but is not blocking current workstreams. Each entry should include: status, failure pattern, what's been tried, what hasn't been tried, conditions for revisiting, and the state of affected data.

New entries go at the top. Resolved entries can be moved to a "Resolved" section at the bottom or removed entirely once the issue is closed.

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
