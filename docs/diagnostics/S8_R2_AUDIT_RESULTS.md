# S8 Multi-Brand Ingestion Routing — Pre-work Audit

**Date:** 2026-04-28
**Workstream:** S8 Multi-Brand Ingestion Routing chore (commit c1)
**Branch:** `chore/s8-multi-brand-ingestion-routing`
**Predecessor:** Polish Sprint Pillar 1 parked at `cebfc46` on `feat/polish-sprint-pillar-1-critic-calibration` (unmerged, 6 commits ahead).

---

## Executive summary

Three pre-work questions resolved with one Rule-43-shaped surprise.

1. **brand_configs gap is large.** 5 of 32 unique brand_ids in the canonical 33-prefix table have rows in `brand_configs`. 27 are missing. This is operator-side work; the agent does not add brand_configs rows.

2. **The brief's "NP/ vs nordpilates/" R2 split does not exist.** Direct R2 listing returned 0 keys at any `NP/` prefix and 0 keys at the bare `nordpilates/` prefix. The actual R2 layout is `<resource_type>/<brand_id>/<uuid>` (e.g., `assets/nordpilates/...`, `segments/nordpilates/...`) and is already brand-id-keyed. **R2 migration is unnecessary; c2 should be skipped.**

3. **VPS `/ugc-ingest` does not have the silent-no-brand bug as a top-level case.** A POST with no `x-asset-meta` header and a filename like `test` returns 400 with a clear error. **However, a related silent-ingest issue exists** when filename has an underscore but the resulting prefix is not a known brand_id (e.g., `xyz_test.mp4` → brand_id='xyz' silently accepted because the endpoint does not validate that the parsed prefix matches `brand_configs`). This is the secondary bug the brief's c6 was anticipating; treat it as a real but contained risk.

---

## Method

```bash
# Pre-work probe scripts (scratch, deleted after this audit was written):
#   src/scripts/_s8-prework-probe.ts     — brand_configs diff, Supabase r2_key audit
#   src/scripts/_s8-r2-list-probe.ts     — direct R2 ListObjectsV2 audit, accurate segment count
#
# Plus a curl test against the production VPS endpoint.
```

```bash
# Curl probe of /ugc-ingest endpoint behavior on missing x-asset-meta
curl -X POST http://95.216.137.35:3000/ugc-ingest \
  -H "Content-Type: application/octet-stream" \
  --data-binary "test" -s --max-time 10
# → HTTP 400, body: {"error":"Missing brand_id in header and filename"}
```

Source code consulted: `src/index.ts` (`/ugc-ingest` handler, lines ~204–270).

---

## Finding 1 — brand_configs vs canonical 33-prefix table

| Status | Count | brand_ids |
|---|---|---|
| In `brand_configs` AND in prefix table | **5** | carnimeat, highdiet, ketoway, nodiet, nordpilates |
| In prefix table only (missing from brand_configs) | **27** | airdiet, brainway, cortisoldetox, cyclediet, effecto, flamediet, glpdiet, greendiet, harmonydiet, koiyoga, lastdiet, lastingchange, liverdetox, manifestationparadox, menletics, mindway, moongrade, nomorediet, nordastro, nordletics, nordyoga, novahealth, offdiet, raisingdog, taiyoga, walkingyoga, welcomebaby |
| In `brand_configs` only (no prefix mapping) | **0** | (none) |

The unique-brand-id count is 32 (33 prefix entries — `CL` and `CD` both route to `cyclediet`).

**Implications.**
- Files with prefixes for any of the 27 missing brands will resolve to a `brand_id` value that has no `brand_configs` row.
- The /ugc-ingest endpoint does NOT enforce that brand_id maps to a `brand_configs` row (verified by reading the handler — it only validates that `brandId` is a non-empty string).
- The `assets.brand_id` column has an "FK comment" in `SUPABASE_SCHEMA.md` but the actual FK is not enforced at the DB level — Supabase inserts will succeed for unknown brand_ids.
- Net effect: a `CM_xxx.mp4` upload TODAY would succeed against R2 + assets even though `carnimeat` has a brand_configs row, but a `BW_xxx.mp4` upload TODAY would also succeed and create an orphan-brand asset row pointing to brand_id=`brainway` which has no config.
- Downstream: the orphan-brand assets cannot be processed by the planning/render pipelines because `loadBrandPersona()` and `match_segments_v2` resolve brand metadata via `brand_configs`. The orphan rows would sit in the database, takeable up space but unrenderable.

**Recommendation: deferred, but tracked.** Operator decides whether to populate the 27 missing brand_configs rows now or defer until each brand goes "live" for ingestion. Either path is consistent with the chore — the BRAND_MAP routes 33 prefixes regardless of whether their target brand_id is configured. Adding brand_configs rows is an operator-by-operator decision (per-brand persona prose, allowed_color_treatments, voice config, etc.).

---

## Finding 2 — R2 prefix audit (the Rule 43 surprise)

The brief asked the agent to audit a presumed `NP/` vs `nordpilates/` split. **No such split exists.** Direct R2 ListObjectsV2 results across all candidate prefixes:

| R2 prefix | Total keys | Sample |
|---|---|---|
| `NP/` | **0** | — |
| `nordpilates/` (bare) | **0** | — |
| `assets/nordpilates/` | 298 | `assets/nordpilates/005d8bf3-…mov` |
| `parents/normalized/nordpilates/` | 298 | `parents/normalized/nordpilates/005d8bf3-…mp4` |
| `segments/nordpilates/` | 1,173 | `segments/nordpilates/000638e9-…mp4` |
| `keyframes/nordpilates/` | 1,173 | `keyframes/nordpilates/000638e9-…jpg` |
| `keyframe-grids/nordpilates/` | 1,172 | `keyframe-grids/nordpilates/000638e9-…jpg` |

Cross-checked from Supabase side: a paginated query over all 1,173 `asset_segments` rows for `brand_id='nordpilates'` returned 0 rows with `clip_r2_key` starting `NP/`. The Supabase row count matches the R2 segments-prefix count exactly (1,173).

**Why the brief was wrong about this.** The W5 clean-slate (2026-04-16) deleted all 53 pre-W5 nordpilates assets and the cascade-dropped 182 asset_segments rows. Whatever `NP/` keys may have existed before W5 are gone. Post-W5, all ingestion has used the brand-id-keyed `<resource_type>/<brand_id>/<uuid>` layout, codified in `src/lib/r2-storage.ts` and `src/lib/parent-normalizer.ts`. The brief's premise was based on an outdated mental model.

**One gap worth noting:** `keyframe-grids/nordpilates/` has 1,172 keys vs 1,173 segments — one missing. Likely an in-flight backfill or a single failure during keyframe-grid generation. Not a multi-brand-routing concern; flagging here only because the audit walked the prefixes anyway. Not in scope for this chore.

**Recommendation: SKIP c2 entirely.** No R2 migration is needed. The chore moves directly from c1 → c3 (workflow JSON).

---

## Finding 3 — `/ugc-ingest` endpoint behavior

The chore brief asked for the endpoint's behavior on missing `x-asset-meta`. Three sub-cases matter for the multi-brand-routing chore:

### 3a — Missing header AND missing filename underscore

```
Request:  POST /ugc-ingest, no x-asset-meta, body=raw bytes
Filename: implicit "clip-{ts}.mp4" (no underscore)
Result:   HTTP 400, {"error":"Missing brand_id in header and filename"}
Verdict:  ✓ correct rejection. No silent-no-brand bug here.
```

### 3b — Missing header BUT filename has known prefix (e.g., `NP_xxx.mp4`)

```
Code path: src/index.ts:254–261
1. meta.brand_id is empty → fallback to filename
2. underscoreIdx = 2; brandId = "np" (LOWERCASED via toLowerCase())
3. brandId is non-empty → skip the 400 guard
4. Insert assets with brand_id='np' — DOES NOT MATCH brand_configs.brand_id='nordpilates'
Result:    HTTP 200, asset row created with brand_id='np'
Verdict:   ✗ silent ingest with bad brand_id. The endpoint's filename fallback
           lowercases the prefix and does not look it up against the canonical
           prefix-to-brand-id map. After the S8 chore lands, n8n's BRAND_MAP
           (case-sensitive on uppercase prefixes) is the only routing layer
           that resolves "NP" → "nordpilates"; if a file ever reaches the
           VPS endpoint without S8 having translated the prefix (i.e., x-asset-meta
           is missing or malformed), the lowercase-prefix fallback fires and
           creates an orphan-brand row.
```

### 3c — Missing header AND filename has unknown prefix (e.g., `xyz_test.mp4`)

```
Code path: same as 3b
Result:    HTTP 200, asset row created with brand_id='xyz'
Verdict:   ✗ silent ingest into a non-existent brand. Same root cause as 3b.
```

**Why this matters for the chore.** With S8 fronting `/ugc-ingest`, the BRAND_MAP filter + Quarantine path catches files with unknown prefixes. The VPS endpoint never sees them.

But two leak paths remain:
- **Manual curl / non-S8 ingestion** (e.g., a developer uploading directly): the lowercase-prefix fallback would silently accept and create orphan-brand rows.
- **n8n misconfiguration** (e.g., the meta.brand_id field is dropped or malformed in transit): same fallback fires; same orphan creation.

**Recommendation: this is the c6 work.** The brief offers c6 as optional. My read: it's worth doing since the fix is small (~10 lines added to the existing endpoint to validate `brandId` against `brand_configs.brand_id` before proceeding) and it closes a real gap. But it's a separate decision — operator may prefer to file as `s8-vps-endpoint-validation` followup and ship the chore without it. Either is defensible.

If we do c6, the right shape is:
- Look up the parsed brandId in `brand_configs`. If no row, return 400 with `{"error":"Unknown brand_id: <prefix>"}`.
- Reject if the underscore-fallback path produced a lowercase prefix that exactly matches one of the known prefixes when uppercased (e.g., `np_xxx.mp4` would now 400 with "use NP_ prefix, not np_" or simply 400 unknown).

The c6 fix should NOT introduce DB lookups in the hot path of every upload — cache the brand_configs.brand_id set at process start and refresh on a long interval (e.g., 5 min) or on a small-eviction LRU. The 5-brand → 33-brand expansion doesn't change the hot-path math meaningfully, but doing the lookup right matters for consistency with the existing read-mostly pattern in this file.

---

## Finding 4 — accurate `asset_segments` count

The Supabase default-row-limit (1,000) on the initial probe undercounted. Re-querying with `select('*', { count: 'exact', head: true })`:

```
asset_segments WHERE brand_id='nordpilates' total: 1,173
```

Matches R2 ground truth exactly (`segments/nordpilates/` = 1,173 keys). No drift between Supabase and R2 on the segment side.

This is the same count the Polish Sprint Pillar 1 pre-work check 5 produced (~1,173 segments, 99.91% v2 coverage, 1,172 with `segment_v2 IS NOT NULL`). Library state is unchanged since 2026-04-27; Sprint 2 ingestion has stabilized.

---

## Decisions needed from operator

| Decision | Default recommendation | Rationale |
|---|---|---|
| **R2 migration** | Skip — no migration needed | Direct R2 list shows 0 keys at `NP/` prefix; the brief's split premise doesn't hold against ground truth. The existing `<resource_type>/<brand_id>/<uuid>` layout is already correct. |
| **Add 27 missing brand_configs rows now or defer** | Defer | Operator decides per-brand when each goes "live." Chore ships the routing regardless. Files for non-configured brands will route through S8 and create orphan-brand asset rows; not harmful, just unrenderable until the brand_configs row is added. Add to followup `brand-configs-population-as-brands-go-live` if helpful. |
| **VPS endpoint silent-bad-brand bug fix in this chore (c6)** | Operator's call. Defensible either way: in-chore (c6, ~10 lines, closes the leak) OR followup (`s8-vps-endpoint-validation`, ship chore faster) | Pre-work confirmed the lowercase-prefix fallback exists and ingests with bad brand_id. n8n S8 + Quarantine fronts it for the production path; the leak only matters for non-S8 ingestion. Small fix; small risk; operator decides whether it belongs in this chore's scope. |

---

## What ships next

Pending operator decisions:
- **c2 R2 migration:** SKIP (recommended; awaiting confirm)
- **c3 workflow JSON:** PROCEED. Blocked on operator providing `QUARANTINE_FOLDER_ID`.
- **c4 `docs/INGESTION_NAMING.md`:** PROCEED.
- **c5 Gate A artifact + operator handoff:** PROCEED.
- **c6 VPS endpoint validation:** awaiting operator decision. If yes, +~30 minutes of agent work. If no, file as `s8-vps-endpoint-validation` followup.

---

## Strategic-shape note (Rule 43)

The R2 split finding is a Rule 43 reframe of a small shape. The brief's premise (audit `NP/` vs `nordpilates/` split) was tactically reasonable — it's the kind of thing that would have existed if the codebase had grown organically without the W5 clean-slate. But the W5 clean-slate erased the historical layout, and no `NP/` keys have been written since. The audit's value here is grounding the assumption against current data so the chore doesn't ship a no-op migration.

This is not a strategic redirect of the chore — the chore is still the right shape (filename-prefix routing for 33 brands). It's a scope reduction: c2 collapses to "skip, no migration needed" rather than "migrate N rows."
