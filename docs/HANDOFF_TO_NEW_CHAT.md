# Handoff to New Claude Chat

**Drafted:** 2026-04-28 at session-19 close
**Replaces:** prior `HANDOFF_TO_NEW_CHAT.md` from session-18 close
**Next workstream:** Simple Pipeline implementation (two products: routine + meme)

---

## Read order

Read these in order before answering operator. Don't skip; the documents reference each other and the strategic shape requires the full picture.

1. **This file** — orientation, current state, what's next, key context
2. **`docs/MVP_PROGRESS_19.md`** — historical record of session 19 (Polish Sprint pause + S8 chore + Simple Pipeline pivot)
3. **`docs/MVP_PROGRESS_18.md`** — prior session record (W11-collapse + Rule 43 promotion + Polish Sprint scoping)
4. **`docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md`** — load-bearing technical artifact for the next workstream
5. **`docs/CLAUDE.md`** — rules, especially Rule 43 (now 7 sightings); session 19 added two more
6. **`docs/PHASE_4_PART_B_PIPELINE.md`** — pipeline architecture (now includes Simple Pipeline as parallel sibling)
7. **`docs/followups.md`** — active and resolved followups (~23 active after session 19)
8. **`docs/VPS-SERVERS.md`** — infra ground truth, includes simple_pipeline queue addition
9. **`docs/INGESTION_NAMING.md`** — operator-facing naming convention reference (33 brand prefixes)
10. **`docs/diagnostics/W9_CALIBRATION_RUN_DIAGNOSTIC.md`** — primary evidence for parked Polish Sprint Pillar 1 (referenced by but not active for Simple Pipeline)

---

## Current state in 5 sentences

Polish Sprint Pillar 1 is parked at branch `feat/polish-sprint-pillar-1-critic-calibration`, HEAD `cebfc46`, 6 commits ahead of main, intentionally unmerged — pivoted away from mid-execution because business pressure forced shipping nordpilates videos this week instead of completing Critic calibration. The S8 multi-brand ingestion routing chore shipped successfully (main at `98d85b5` after followup merge), unblocking ingestion for 33 brand prefixes via filename routing through n8n. The next workstream is **Simple Pipeline implementation** — a parallel architecture serving two products (routine videos with 2-5 clips + meme/vibe videos with 1 clip) using a single Gemini Pro library-aware "Match-Or-Match" agent. Operator (Domis) is starting to ingest content for cyclediet / carnimeat / nodiet alongside existing nordpilates; Simple Pipeline goes live for nordpilates first, then per-brand as each crosses the readiness threshold (≥3 parents with ≥10 segments + brand_configs.aesthetic_description populated). Polish Sprint resumes after Simple Pipeline ships and operator content cadence stabilizes.

---

## Verification before proceeding

Run these queries before proposing anything substantive. Halt if anything diverges from expected.

```bash
# 1. Git state — main at session-19-close, Polish Sprint parked
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -10
# expected near top: 98d85b5 (followup merge), f4ae06c (S8 chore merge), recent c1-c6 of S8 chore

git branch -v
# expected: feat/polish-sprint-pillar-1-critic-calibration exists at cebfc46
# (6 commits ahead of main, unmerged)
```

```sql
-- 2. brand_configs state
SELECT brand_id,
       config->>'aesthetic_description' AS aesthetic_description,
       config->>'logo_r2_key' AS logo_r2_key
FROM brand_configs
ORDER BY brand_id;
-- expected: 5 brand_configs rows (carnimeat, highdiet, ketoway, nodiet, nordpilates)
-- nordpilates likely has aesthetic_description; others likely don't yet

-- 3. Per-brand ingestion progress (operator may have started ingesting overnight)
SELECT brand_id,
       COUNT(DISTINCT parent_asset_id) FILTER (WHERE parent_asset_id IS NOT NULL) AS parents,
       COUNT(*) AS segments
FROM asset_segments
WHERE brand_id IN ('nordpilates', 'cyclediet', 'carnimeat', 'nodiet')
GROUP BY brand_id;
-- expected: nordpilates ~1173 segments / ~30+ parents
-- cyclediet/carnimeat/nodiet variable; depends on operator overnight ingestion

-- 4. shadow_runs anchor rows still present
SELECT id, part_b_terminal_state, created_at FROM shadow_runs ORDER BY created_at ASC;
-- expected: cb87d32c (2026-04-26), ff67fc55 (2026-04-26), cf104600 (2026-04-27)
-- all failed_after_revise_budget

-- 5. jobs.pipeline_override clean
SELECT COUNT(*) FROM jobs WHERE pipeline_override IS NOT NULL;
-- expected: 0

-- 6. Music tracks
SELECT COUNT(*) FROM music_tracks WHERE active = true;
-- expected: handful of nordpilates-compatible tracks
```

```bash
# 7. VPS service active
ssh root@95.216.137.35 "systemctl status video-factory --no-pager | head -5"
# expected: active (running) since 2026-04-28 08:37:40 UTC (S8 chore deploy)

# 8. PART_B_ROLLOUT_PERCENT confirmed
ssh root@95.216.137.35 "grep PART_B_ROLLOUT_PERCENT /home/video-factory/.env"
# expected: PART_B_ROLLOUT_PERCENT=100 (from W9 Phase 1 calibration)
```

If anything diverges from expected, surface it before proceeding. Don't relitigate parked work; just confirm current state.

---

## Two products of Simple Pipeline (load-bearing distinction)

The Simple Pipeline brief covers two distinct products, not one parameterized product. They share infrastructure but serve different creative intents.

**Routine videos (Format=routine):**
- Slot count 2-5 (operator picks via Sheet "Clips" column, default 3)
- Anchored on one parent — agent picks parent first (cooldown of last 2 used per brand), then picks N segments within that parent
- Overlay text style: instructive, brand-anchored, label-style ("5-min morning flow", "core routine that actually works")
- Use case: workout routines, meditation sequences, multi-step demonstrations

**Meme/vibe videos (Format=meme):**
- Slot count 1 (forced; Sheet "Clips" column shows 1 but is informational)
- Single segment from any parent — agent picks best-fit segment from any parent (segment cooldown of last 2 used per brand)
- Overlay text style: punchy, conversational, hook-style ("no thoughts just stretching", "POV: you actually moved today")
- Use case: meme content, vibey juice videos, simple snackable moments

**Why two products:** operator-flagged that pure semantic search on segment descriptions won't work for meme idea seeds (which are often abstract, ironic, or oblique — "main character energy" doesn't map to any literal segment description). The agent stage handles this — it sees the library and reasons about vibe match, not just keyword match.

**Why same infrastructure:** both products use:
- Same BullMQ queue (`simple_pipeline`)
- Same worker
- Same orchestrator (with format branch)
- Same Match-Or-Match agent (different output shapes based on Format input)
- Same render path (ffmpeg)
- Same music selector
- Same logo / color grade / brand config logic

**Why operator override of my single-product framing matters:** my initial Simple Pipeline brief had single-product framing (slot_count parameterized 1-5 of the same product). Operator pushback during Q&A reframed as two distinct products. This is a Rule 43 sighting — Q&A caught the architectural fork before brief was committed. Filed as sighting 7 in CLAUDE.md.

---

## Match-Or-Match agent — load-bearing module

Single Gemini Pro call per render. Sees v2 segment descriptions for the brand (not raw videos). Picks segment(s) for the idea seed.

For routine path: agent picks parent first (excluding last 2 used), then picks N segments within that parent ordered to flow naturally.

For meme path: agent picks 1 segment from any parent (excluding last 2 segments used).

Cost: ~$0.01-0.02 per call.

The agent emits reasoning along with segment_ids. Reasoning gets stored for debugging when meme videos don't land. Don't strip reasoning from output schema; it's a future debugging surface.

Operator-confirmed both paths use the agent (Q16 = b). My initial lean was code-only routine path with agent-only on meme path; operator overrode with consistency-over-selective-complexity reasoning. Cost is irrelevant for v1.

---

## What's parked, what's deferred

**Parked (resumable when Simple Pipeline ships):**
- Polish Sprint Pillar 1 at `cebfc46` — Critic stance-conditional + charter rewrite + Planner audit + harness scripts shipped; calibration seeds NOT YET RUN. Resumption picks up at c5: run the 4-seed calibration harness, write CALIBRATION_REPORT.md, write Tier 1 verification artifact.
- Q1+Q2 from c4 close locked: production VPS path-A confirmed; calibration jobs left in `brief_review` post-termination (matches test-orchestrator T2 pattern).

**Deferred (not in scope of next workstream):**
- Polish Sprint Pillars 2-6 (music expansion, text safe zones, logo wiring, body composition filter, transitions library)
- W9.2 demo render bridge (waits for Polish Sprint completion)
- W10 voice generation (waits for first-brand cutover)
- W11 Director architecture rebuild (future-conditional only)
- Body composition filter ingestion (Polish Sprint Pillar 5 territory)
- Per-form text safe zones (Polish Sprint Pillar 3 territory)
- Logo wiring on advanced pipeline (Polish Sprint Pillar 4 — Simple Pipeline ships its own logo independently)

**Open followups requiring operator action:**
- `pillar1-planner-overcommits-subject-consistency` — Domis fills [Domis review] judgment columns in Pillar 1 audit when Polish Sprint resumes
- `s8-brand-configs-lazy-population` — operator activates brand_configs per brand on commit-to-ingest. Priority: nordpilates → cyclediet → carnimeat → nodiet
- `simple-pipeline-parent-vs-subject-identity` — known limitation; operator-catchable at QA; future fix via filename-tag convention

---

## Operator interaction patterns to watch for

These are operator behavior patterns observed across sessions 17-19. Honor them.

**Strategic-shaped pushback during tactical work** (Rule 43 trigger):
- "the video wasn't bad" / "success looks different to me than to you"
- "maybe we should have chosen X then?"
- "this might be our downfall"
- "I don't think we should change our plan that much"

When these appear, **pause tactical work, reframe from upstream surface, don't tactically defend.** Filed as Rule 43 in CLAUDE.md with 7 sightings as evidence.

**Decision signals:**
- Short replies to multi-question Q&A — trust earned, decisions made, proceed
- "I dont care" / "I dont think so" — stop optimizing this, move on
- "explain simpler" — reset on jargon
- "lets keep the original plan" — strategic preservation; proposed change may misframe the problem
- Strategic pushback during tactical work — pause, reframe, do NOT defend

**Brief drafting workflow:**
1. Planning chat (you) drafts kickoff Q&A first (~10-12 questions)
2. Operator answers (often terse, often strategic-shaped)
3. Planning chat drafts brief
4. Operator reviews + filed at `docs/briefs/`
5. Planning chat writes agent kickoff message
6. Operator relays to Claude Code agent (separate conversation, terminal-based execution)
7. Agent executes through Gate A, reports back via operator relay
8. Planning chat reviews + decides hold-or-merge
9. Agent merges + deploys + reports
10. Planning chat writes post-merge docs touch directive
11. Agent commits, then move to next workstream

**Agent execution context:** Claude Code in operator's local terminal with full VPS SSH access + Supabase access + repo access. Operator copy-pastes between planning chat and Claude Code. Agent has no n8n write access — that's operator-side only.

**Brief structure pattern that works:**
```
TL;DR
Decisions locked from kickoff Q&A
Scope (in/out)
Pre-work
[Implementation sections per pillar/component]
Files (create/modify/don't-touch)
Gate A tier design
Hard constraints
Non-goals
Followups (open hooks)
Commit sequence
Rollback
Prerequisites
Success criterion
```

---

## Anti-patterns to avoid

- **Don't tactically defend in-flight commits when operator surfaces strategic concerns.** Rule 43 has 7 sightings as evidence; this is well-established.
- **Don't relitigate Polish Sprint Pillar 1 decisions.** Branch is parked; resumption picks up where it left off; don't re-scope Pillar 1 unless Simple Pipeline reveals it should change.
- **Don't ship n8n workflow changes via JSON in repo without operator-side smoke testing.** S8 chore taught this lesson (3 configuration bugs only surfaced via end-to-end binary stream testing). Future briefs touching n8n workflow JSONs should require operator runs a real-file end-to-end test before Gate A closes.
- **Don't bundle Simple Pipeline scope into Polish Sprint scope or vice versa.** They're separate workstreams in separate codepaths. Polish Sprint Pillar 4 (logo wiring on advanced pipeline) ≠ Simple Pipeline logo overlay. Polish Sprint Pillar 3 (text safe zones on advanced pipeline) ≠ Simple Pipeline overlay placement. Two separate concerns.
- **Don't promise faster than 4-7 days for first Simple Pipeline nordpilates video.** Brief is 3-4 days agent work + Gate A + operator-side imports + per-brand population for additional brands. Timeline is operator-realistic.
- **Don't promise faster than 6-10 weeks for first Part B advanced-pipeline video.** That requires Polish Sprint resumption + completion + W9.2 + cutover decision. Two pipelines on different timelines.

---

## What's likely to come up in conversation

**"How do we ship videos for cyclediet/carnimeat/nodiet today?"**
Answer: those brands need ingestion (operator drops content via S8) AND brand_configs.aesthetic_description populated AND ≥3 parents with ≥10 segments. Once those gates are met, Simple Pipeline can render for them. Per-brand operator action.

**"Why didn't Polish Sprint just continue?"**
Answer: business pressure for shippable content this week. Polish Sprint timeline was 4-8 weeks; that runway didn't fit. Simple Pipeline is the parallel architecture serving the timeline; Polish Sprint resumes after.

**"Should we just delete the Polish Sprint branch?"**
No. Branch parking is intentional. c1-c4 work is good (charter rewrite, stance-conditional thresholds, audit, harness scripts). Resumption is mechanical. Branch parks cleanly at `cebfc46`.

**"Why two products in Simple Pipeline?"**
Answer: routine videos and meme videos have different creative intents. Operator surfaced this fork during Q&A. Brief is structured to ship both from one infrastructure but with different orchestration paths. Q16 (b) — both paths use the agent, by operator override of my initial code-only-routine lean.

**"Can the Simple Pipeline use multiple parents?"**
v1: no, single-parent only for routine; cross-parent only for meme (one segment from any parent — no concatenation). Multi-parent routine cuts is a v2 followup if v1 output stales.

**"What if cyclediet's library is sparse?"**
Per-brand readiness check at S1 blocks routing to Simple Pipeline if brand has fewer than 3 parents with ≥10 segments OR no aesthetic_description. Sheet status shows reason. Operator ingests more content; readiness check passes; jobs route normally.

**"Why ffmpeg instead of Remotion for Simple Pipeline?"**
Advanced pipeline's render bridge (W9.2) is tangled — Remotion composition is hardwired to Phase 3.5 CopyPackage shape, prepareContextForRender is a null-safety stub. Simple Pipeline avoids that by using ffmpeg directly. Cleaner separation.

**"What about subject identity (multiple files of same shoot)?"**
Known limitation. Filed as `simple-pipeline-parent-vs-subject-identity`. v1 acceptance: operator-catchable at QA; ~$0.025 wasted per redundant render. Future fix: filename-based subject tagging via `<PREFIX>_<SUBJECT_TAG>_<description>` convention; not in v1 scope.

---

## Conversation flow with operator

After reading docs + running verifications, propose next steps in this shape:

1. State your understanding of current state (Polish Sprint parked, S8 chore complete, Simple Pipeline next)
2. Ask if anything has changed since session 19 close (operator may have ingested overnight; brand_configs may have been populated; etc.)
3. Confirm Simple Pipeline brief is the load-bearing artifact and review key decisions
4. Draft Simple Pipeline kickoff Q&A if any new questions emerge from current-state changes
5. Wait for operator answers before drafting agent kickoff message

Don't draft agent kickoff message before confirming current state + brief shape.

---

## Brand priority for first-week ship

Per operator-named priority (2026-04-28):

1. **nordpilates** — already has library, brand_configs, music. Simple Pipeline ships first for this brand.
2. **cyclediet** — operator-named priority for first multi-brand expansion. Description: menstrual helper diet and exercises.
3. **carnimeat** — second multi-brand expansion. Description: carnivore diet and exercises.
4. **nodiet** — third multi-brand expansion. Description: mediterranean diet.

Other 28 brands: deferred. Activated on commit-to-ingest basis. No urgency.

For each priority brand, operator action sequence:
1. Drop content via S8 (with correct prefix: `NP_`, `CL_`, `CM_`, `ND_`)
2. Wait for ingestion to populate ≥3 parents with ≥10 segments (depends on file sizes; ~5-30 minutes per file via Gemini Pro Pass 2)
3. Populate brand_configs row with aesthetic_description (operator-written, brand-voice)
4. Test Simple Pipeline render (drop test idea seed in Sheet)
5. Approve in QA flow → upload to TikTok / Reels / YouTube Shorts manually

---

## Cost trajectory (informational)

Current monthly spend: ~$22-26/month (VPS + n8n + AI APIs + R2)

Post-Simple-Pipeline-ship projection: ~$25-32/month
- Simple Pipeline at ~$0.025/video × 50-80 videos/week
- Multi-brand ingestion compute (more files going through Pass 1 + Pass 2 Gemini analysis)

Anthropic API limit raised by operator on 2026-04-27. Current state: low-watch. Simple Pipeline doesn't use Sonnet (Gemini Pro only) so doesn't compound. Polish Sprint Pillar 1 c5 (calibration seeds) deferred behind pause; doesn't currently consume.

---

## Questions for operator at session start

1. Has any brand library state changed overnight? (cyclediet/carnimeat/nodiet ingestion progress; brand_configs.aesthetic_description population; etc.)
2. Is Polish Sprint resumption still post-Simple-Pipeline, or has priority shifted?
3. Are there any new constraints on Simple Pipeline (cost, timeline, scope) that emerged after session 19 close?
4. Is the Simple Pipeline brief at `docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md` still the canonical artifact, or has operator iterated on it?

Don't propose anything substantive until these answers land.

---

## Standing by

Read the docs in order. Run the verifications. Then ask operator the questions above.

Once current state is confirmed + brief is canonical, the next step is drafting the agent kickoff message for Simple Pipeline implementation. Brief is fully scoped; agent should be able to start c1 immediately after kickoff lands.

Standard agent reporting format applies: terse table fill-in + commit SHAs + verification snippets + ending with "Merge to main and deploy, or hold?" Same pattern as W7/W8/W9/Polish-Sprint-Pillar-1.

---

*Handoff doc drafted 2026-04-28 at session-19 close. Replaces session-18 version. Filed at `docs/HANDOFF_TO_NEW_CHAT.md`.*
