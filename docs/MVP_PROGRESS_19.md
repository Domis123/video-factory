# MVP Progress — Session 19

**Session date:** 2026-04-28
**Predecessor session:** Session 18 (W11-collapse, Rule 43 promotion, Polish Sprint scoped)
**Successor:** New chat handoff for Simple Pipeline implementation

---

## Session arc in one sentence

Polish Sprint Pillar 1 made it through c1-c4 (charter rewrite + stance-conditional Critic + Planner audit + harness scripts) before business pressure forced a pivot to a parallel Simple Pipeline shipping nordpilates videos this week, with one chore (S8 multi-brand ingestion routing) shipped along the way to unblock multi-brand ingestion across 33 brand prefixes.

---

## What shipped this session

### 1. Polish Sprint Pillar 1 commits c1-c4 (parked, unmerged)

Branch `feat/polish-sprint-pillar-1-critic-calibration` at HEAD `cebfc46`, 6 commits ahead of main, pushed to origin, intentionally not merged. Contents:

- **c1 (`6a02325`)** — Critic stance-conditional thresholds. Added outfit-exception clause for `mixed` stance (fires at `low` if outfits jarringly off-brand; otherwise silent). Sharpened prefer-same wording — explicit that `low` severity is the info-only channel (no schema change). W6.5 lineage documented in commit message: W6.5 (2026-04-23) shipped the bulk of the stance-conditional matrix; Pillar 1 added the outfit exception + the explicit info-only channel naming.
- **c2 (`b4d6b9c`)** — Critic charter rewrite. New `## Critic charter` section between Three-verdict model and Issue taxonomy. Hard / soft / info-only matrix:
  - Hard flags (slot_level revise, severity high): mechanical issues + stance violations under single-subject.
  - Soft flags (slot_level revise on egregious only, otherwise info): posture_drift, hook_weak (when underwhelming, not missing).
  - Info-only (`low` severity, no revise trigger): subject_discontinuity under prefer-same/mixed; aesthetic-clip-quality; cross-parent picks under non-single-subject stances.
  Refactored issue-taxonomy entries to cross-reference the charter classification. Split hook_weak into "completely missing → hard" vs "underwhelming → soft."
- **c3 (`417a5ee`)** — Planner subject_consistency audit (read-only diagnostic at `docs/diagnostics/POLISH_SPRINT_PILLAR_1_PLANNER_AUDIT.md`). All 3 nordpilates shadow_runs rows analyzed. Finding: Planner committed `single-subject` 3/3 across cb87d32c (fire hydrant deep dive), ff67fc55 (slow sunday stretching), cf104600 (3 small things that make pilates click). All three operator-judgment columns deliberately left as `[Domis review]` — agent doesn't pre-fill operator quality bar. Followup `pillar1-planner-overcommits-subject-consistency` deferred until operator fills in judgment column.
- **c4 (`cebfc46`)** — Replay + calibration seed harness scripts. `scripts/pillar1-critic-replay.ts` (replays new charter prompt against ff67fc55, cf104600, cb87d32c — regression check, expects all three to still escalate under preserved single-subject strictness). `scripts/pillar1-calibration-seeds.ts` (4 new shadow_runs spanning all 3 subject_consistency stances, sequential execution with cost guardrails: halt if single seed >$1.50, cumulative >$3.50, or 429s fire). Build clean, pushed.

c5 (running the harnesses + writing calibration report + Tier 1 verification artifact) was the next planned commit — never executed. Q1+Q2 from agent's c4 report locked for resumption: Q1 confirmed production VPS, path-A; Q2 confirmed path (a) leave 4 calibration jobs in `brief_review` post-termination (matches test-orchestrator T2 pattern).

### 2. S8 multi-brand ingestion routing chore (merged + deployed)

Branch `chore/s8-multi-brand-ingestion-routing` merged to main at SHA `f4ae06c`. Followup branch `chore/s8-v2-json-divergence-followup` merged at `98d85b5`. VPS deployed, service active since 2026-04-28 08:37:40 UTC.

Updated S8 (UGC Ingest) workflow to support 33 brand prefixes via filename routing:
- BRAND_MAP replacement (33 prefixes mapped to brand_ids; full-name fallback dropped; legacy KW/KTO retired in favor of canonical KD for ketoway)
- Skip-handling fix (files with unknown prefixes route to Quarantine folder instead of being silently force-ingested)
- VPS endpoint hardening (`src/index.ts` c6: `/ugc-ingest` validates filename-fallback parsed brand_id against in-memory brand_configs cache; rejects unknown brand_ids with HTTP 400; cache loads lazily on first fallback request, fail-open on cache-load error)
- Documentation: `docs/INGESTION_NAMING.md` for operators; `docs/diagnostics/S8_R2_AUDIT_RESULTS.md` for the pre-work audit trail
- R2 prefix audit: confirmed no `NP/` rows exist (all nordpilates assets/asset_segments use `assets/nordpilates/` and `segments/nordpilates/` patterns); migration skipped as no-op

Brand_configs population deferred per-brand on commit-to-ingest basis. Followup `s8-brand-configs-lazy-population` filed.

### 3. S8 chore Gate A — operator-side fixes during smoke testing

The c3 v2 workflow JSON (`n8n-workflows/S8_UGC_Ingest_v2.json`) had three configuration bugs that only surfaced via end-to-end testing with real binary streams:

1. **Send to VPS body type**: c3 changed from v1's `Body Content Type: n8n Binary File` + `Input Data Field Name: data` to `Body Content Type: Raw` + `Body: {{ $binary.data }}`. The Raw + expression evaluation returns binary metadata reference, not actual bytes. VPS received 0-byte requests; ffprobe failed.
2. **IF Skip Filter binary detachment**: c3 inserted an IF node between Prep Metadata and Loop Over Items. n8n's IF node strips binary attachments. Even with body type fixed, valid items reaching Loop Over Items had no binary.
3. **No retry-on-failure**: VPS `/ugc-ingest` is single-threaded by design (rejects concurrent calls with HTTP 503). Without retry, files 2+ in a multi-file drop fail.

Operator (Domis) fixed all three in n8n directly during smoke testing:
- Restored Send to VPS to `n8n Binary File` body type with `inputDataFieldName: data`
- Replaced IF node with two parallel Code nodes from Download File: `Prep Metadata - Valid` (filters to valid prefix items, returns single array with binary attached) and `Prep Metadata - Skipped` (filters to invalid items, returns single array without binary). Multi-output return from a single Code node is not supported in n8n; two parallel Code nodes is the correct shape.
- Added retry-on-failure (3 tries, 60s wait) on Send to VPS

Followup `s8-v2-json-divergence-followup` filed at `fc061ff` (later merged at `98d85b5`). Working operator-side n8n state diverges from repo artifact `n8n-workflows/S8_UGC_Ingest_v2.json`. Agent should re-export from operator's n8n at next convenient session.

Smoke test passed end-to-end with one real video (`NP_realtest_001.mp4`, 40 MB / 22 sec). Pre-normalize completed in 17.4s; Gemini Pro Pass 1 segmentation in 51 sec; Pass 2 per-segment analysis ~200 sec/segment × 8 segments. Test was killed before Pass 2 completion since the file was an edited video unsuitable as a parent. Asset row deleted, R2 keys orphaned and left (cheap to leave; not referenced).

Gate A formally closed. v2 workflow active in n8n production. Operator can drop files with prefixes for any of the 33 brands; system routes correctly.

### 4. Pivot to Simple Pipeline with two products

Polish Sprint paused at c4 not because it failed but because business pressure prioritized shippable nordpilates videos this week over the Critic calibration work. Simple Pipeline framing emerged from operator description: "use only same parent, put one text overlay, cut long pieces of workout, simple cuts." Single-parent assembly with AI-generated overlay text. ffmpeg-based render. Operator-routable per-job from Sheet via Pipeline column.

Through Q&A iteration, the brief evolved into **two distinct products**:

- **Product 1 — Routine videos**: slot_count 2-5, parent-anchored, instructive overlay text style ("5-min morning flow", "wake your hips up"). Format=routine in Sheet.
- **Product 2 — Meme/vibe videos**: slot_count 1, single-segment, punchier overlay text style ("no thoughts, just stretching", "POV: you're trying"). Format=meme in Sheet.

Both products use the same Gemini Pro library-aware agent for segment selection. Routine path: agent emits N ranked segment_ids from one parent. Meme path: agent emits 1 segment_id from any parent (parent-first cooldown still applies; meme path picks the best-fit segment from a non-cooled-down parent).

Architectural consistency: one agent module serving both paths, output shape determined by Format input. Operator-confirmed cost-irrelevant for v1.

Brief draft pending — full v2 brief generated separately as `docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md`. New chat handoff captures the redirected scope.

---

## Decisions locked this session

### Polish Sprint Pillar 1 (parked but documented)

| Decision | Source |
|---|---|
| Stance-conditional thresholds, not flat severity loosening or info-only reclassification | Q3a (session 18 kickoff) |
| Critic charter rewrite in Pillar 1 scope | Q3b (session 18 kickoff) |
| Planner audit read-only, operator-judgment column held open | Pillar 1 c3 implementation |
| Calibration evidence: replay + 4 new seeds spanning 3 stances + cf104600 re-run | Q4 (session 18 kickoff) |
| Calibration seeds run against production VPS via path-A (insert jobs row + POST /enqueue) | c4 Q1 confirmation, this session |
| Calibration jobs left in brief_review post-termination (preserves shadow_runs evidence) | c4 Q2 confirmation, this session |

### S8 chore (shipped)

| Decision | Source |
|---|---|
| Filename prefix routing (not subfolder, not Sheet-driven) | 30+ brands ruled out subfolder |
| 33 brand prefixes per operator-canonical table | Operator-relayed |
| CL → cyclediet (corrected from earlier carnimeal draft) | Operator correction |
| Strict prefix-only matching (full-name fallback dropped) | Brief default |
| Files with unknown prefix → Quarantine folder | Brief default |
| R2 migration skipped (no NP/ rows exist; verified via audit) | Pre-work finding |
| Brand_configs lazy-population per-brand on commit-to-ingest | Q&A turn |
| VPS endpoint validation in-chore (c6) — strict scope, ~10 lines net | Operator-confirmed in-chore vs followup |
| Agent ships JSON in repo; operator imports via n8n web UI | Operator confirmed n8n-write access is operator-only |

### Simple Pipeline two-product (next workstream, brief drafted separately)

| Decision | Source |
|---|---|
| Two products: routine (slot_count 2-5) + meme (slot_count 1) | Operator pivot, this session |
| Sheet "Format" column: dropdown `meme` / `routine` for explicit routing | Q11 (b) |
| Sheet "Clips" column: 1-5 dropdown, default 3 if empty | Q2 (a) |
| Both paths use same Gemini Pro agent stage | Q16 (b) — operator override of my initial lean |
| Agent shape (Q13 a): single Match-Or-Match call, sees segment library descriptions, returns segment_id(s) + reasoning | Q13 (a) |
| Routine path: agent emits N ranked segment_ids from one parent (parent-first picker) | Q4 (a) preserved |
| Meme path: agent emits 1 segment_id from any parent | Two-product framing |
| Parent cooldown last 2 (existing simple pipeline brief) | Existing |
| Segment cooldown last 2 added | Q5 (b) |
| Meme path: segment cooldown only (parent cooldown implicit via segment uniqueness) | Q14 (b) |
| Two distinct overlay generation prompts: routine-flavored + meme-flavored | Q12 (b) |
| Same music selector + brand mood pool for both formats | Q15 |
| slot_count=1 uses full segment duration (no padding); slot_count>1 targets 30s | Q8 (a) |
| Cost ceiling: irrelevant for v1, can be more if needed | Q7 |
| Cooldown wins over fit-match (structural before heuristic) | Q10 (a) |
| Same overlay style regardless of slot count within routine path | Q6 (a) |

---

## What's parked

- **Polish Sprint Pillar 1** at branch `feat/polish-sprint-pillar-1-critic-calibration`, HEAD `cebfc46`, 6 commits ahead of main, unmerged. Q1+Q2 answers locked in audit + c4 commit message. Resumption picks up at c5: run the calibration harness scripts, write `docs/diagnostics/POLISH_SPRINT_PILLAR_1_CALIBRATION_REPORT.md`, write Tier 1 verification artifact.
- **Polish Sprint Pillars 2-6** untouched. Pillar 2 (music expansion), 3 (per-form text safe zones), 4 (logo wiring), 5 (body composition filter), 6 (transitions library). Tier 2 + Tier 3 not started.
- **W9.2 demo render bridge** still deferred behind Polish Sprint completion.
- **W10 voice generation** still parked behind first-brand cutover.
- **W11 Director architecture rebuild** still future-conditional (only resurrects if Polish Sprint reveals cross-parent quality regression).

## What's deferred / followups

Closed this session:
- `r2-orphaned-NP-keys-cleanup` — auto-closed (no NP/ keys exist per audit)
- `s8-vps-endpoint-validation` — resolved by c6 in S8 chore
- `w8-q5-signal-validation-not-exercised-in-gate-a` — already resolved in session 18
- `w8-phase-3-5-unaffected-check-via-worker-harness` — already resolved in session 18
- `w9-cost-tracking-unwired` — already resolved by W9.1 in session 18

Active followups added this session:
- `pillar1-planner-overcommits-subject-consistency` — file pending operator filling [Domis review] judgment columns in Pillar 1 audit
- `s8-brand-configs-lazy-population` — operator activates brand_configs per brand on commit-to-ingest. Priority: nordpilates → cyclediet → carnimeat → nodiet
- `s8-v2-json-divergence-followup` — repo artifact diverges from operator's working n8n state on three specific configurations (Send to VPS body type, parallel Code nodes vs IF node, retry-on-failure)
- `s8-cl-cd-prefix-consolidation` — both CL and CD route to cyclediet; future cleanup may pick canonical
- `s8-subject-group-tagging-future` — extension to `<PREFIX>_<SUBJECT_TAG>_<description>` for subject identity resolution at ingestion (operator-named filename-tagging idea)
- `s8-quarantine-cleanup-policy` — when do quarantined files get permanently deleted
- `s8-n8n-workflow-versioning` — n8n state lives in n8n's database, not git; future automation
- `simple-pipeline-parent-vs-subject-identity` — multiple files of same shoot uploaded as separate parents currently treated as different parents; future fix via filename-tag convention or AI subject grouping at ingestion

Followups still open from prior sessions (no change):
- `w8-slot-level-revise-thrashing-without-convergence` — reframed; deferred behind Polish Sprint Pillar 1
- `w8-nordpilates-revise-exhaustion-rate-tier-2-baseline` — reframed; deferred behind Pillar 1
- `w9-cutover-sample-threshold-tuning`, `w9-feels-organic-veto-threshold-calibration`, `w9-tag-set-coverage`, `w9-revise-budget-widen-evidence`, `w9-q5-signal-prompt-tuning-evidence`, `w9-cost-aggregate-threshold-tuning`, `w9-dual-run-to-part-b-only-implementation`, `w9-verify-worker-dispatch-baseline-stale` — all deferred behind cutover decision
- `claude-api-limit-watchitem` — currently fine; raised by operator on 2026-04-27, sufficient for sprint-and-Tier-1-calibration scale
- `w9-q8c-structural-classification-not-exercised` — Polish Sprint Pillar 1 may resolve incidentally

## Most instructive observation from this session

The c3 S8 workflow JSON failure is a Rule 43 case in miniature.

The agent shipped a workflow JSON that looked structurally correct on review (right nodes, right connections, right expressions). The bugs only surfaced when operator ran it end-to-end with real binary streams. Three issues in one node configuration, all silently wrong, all visible only in execution.

The fix wasn't to defend the JSON; it was to recognize that the v1 working configuration encoded operational knowledge (binary streaming via `n8n Binary File` mode, retry-on-failure for the single-threaded VPS guard) that wasn't documented anywhere visible to the agent. v2's "cleaner" expression-based configuration looked simpler but lost the operational knowledge.

Brief-process lesson: future briefs touching n8n workflow JSONs should require an operator-runs-a-real-file smoke test before Gate A closes. Don't trust JSON correctness without binary-stream validation.

This is filed in followups but worth surfacing as a session-19 process improvement: the brief artifact and the operator's working n8n state are two different sources of truth. Drift between them is a real problem class.

## Rule 43 sightings count

This session contributes one new sighting and one near-sighting:

**New sighting:** Polish Sprint pause itself. Operator pushback wasn't strategic-shaped doubt during execution-phase work — it was business-pressure-shaped redirection. Different from the Rule 43 cases in session 18, but the architectural response is the same: pause tactical work in flight, reframe from upstream surface, don't tactically defend the in-flight commits.

**Near-sighting:** the moment in c4 where I (planning chat) was about to draft the Simple Pipeline brief with single-product framing, and operator's "1 segment vibey videos vs longer routine videos" framing surfaced a real product fork I had narrowed away. Caught it through Q&A; brief redrafted to two products. Without that catch, brief would have shipped with single-product scope and the meme path would have surfaced as a "scope creep" later. Q&A caught it before brief drafted; that's Rule 43 prevention via question quality.

Total sightings now ~7 (5 from Rule 43 promotion + W11 collapse + this session's pause).

---

## Session close: what next chat picks up

Next chat handoff covers Simple Pipeline implementation as the next workstream. Polish Sprint stays parked. S8 chore complete.

Read order for next chat:

1. `docs/HANDOFF_TO_NEW_CHAT.md` — orientation, current state, key context (regenerated this session, replaces session-18 version)
2. `docs/MVP_PROGRESS_19.md` — this file, historical record
3. `docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md` — load-bearing technical artifact for the Simple Pipeline workstream
4. `docs/PHASE_4_PART_B_PIPELINE.md` — current pipeline architecture, parked Pillar 1, simple pipeline added as parallel
5. `docs/CLAUDE.md` — rules, especially Rule 43 (5 sightings → 7 sightings)
6. `docs/followups.md` — active and resolved followups
7. `docs/VPS-SERVERS.md` — infra ground truth, simple_pipeline queue addition
8. `docs/INGESTION_NAMING.md` — operator-facing naming convention reference

Verification queries for next chat pre-work:

```sql
-- 1. Confirm main + Polish Sprint branch state
-- expected: main at 98d85b5 (followup merge); Polish Sprint at cebfc46

-- 2. brand_configs and ingestion state
SELECT brand_id FROM brand_configs ORDER BY brand_id;
-- expected: 5 brands (carnimeat, highdiet, ketoway, nodiet, nordpilates)

-- 3. Check ingestion progress for cyclediet, carnimeat, nodiet (operator may have ingested overnight)
SELECT brand_id, COUNT(*) AS segments
FROM asset_segments
WHERE brand_id IN ('nordpilates', 'cyclediet', 'carnimeat', 'nodiet')
GROUP BY brand_id;
-- expected: nordpilates ~1173 segments; others variable based on operator overnight ingestion

-- 4. Confirm simple_pipeline queue not yet registered (next workstream)
-- VPS startup log should show: ingestion, planning, rendering, export only
-- Once simple pipeline ships, simple_pipeline appears too.

-- 5. shadow_runs anchor rows still present
SELECT id, part_b_terminal_state, created_at FROM shadow_runs ORDER BY created_at ASC;
-- expected: cb87d32c, ff67fc55, cf104600 — all failed_after_revise_budget

-- 6. jobs.pipeline_override clean
SELECT COUNT(*) FROM jobs WHERE pipeline_override IS NOT NULL;
-- expected: 0
```

---

*MVP Progress Session 19 — drafted 2026-04-28 at session close. Captures Polish Sprint Pillar 1 c1-c4 parking + S8 multi-brand chore shipping + Simple Pipeline two-product pivot + new chat handoff orientation. Filed at `docs/MVP_PROGRESS_19.md`.*
