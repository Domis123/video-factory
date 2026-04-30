# Handoff to New Claude Chat

**Drafted:** 2026-04-29 at session-20 close
**Replaces:** prior `HANDOFF_TO_NEW_CHAT.md` from session-19 close
**Next workstream:** Editor agent (smart-trim at segment boundaries for Simple Pipeline)

---

## Read order

Read these in order before answering operator. Don't skip; the documents reference each other and the strategic shape requires the full picture.

1. **This file** — orientation, current state, what's next, key context
2. **`SIMPLE_PIPELINE.md`** (project root) — production reference for Simple Pipeline v1.0 + v1.1. Architecture, two-product distinction, operator workflow, schema, render path, hard constraints. Load-bearing for understanding what's currently deployed.
3. **`docs/MVP_PROGRESS_20.md`** — historical record of session 20 (Simple Pipeline v1.0 build through three quality rounds, v1.1 cosmetic polish, three new Rule 43 sightings, abandoned S8 chore re-attempt)
4. **`docs/MVP_PROGRESS_19.md`** — prior session record (Polish Sprint pause, S8 multi-brand chore, Simple Pipeline two-product pivot)
5. **`docs/MVP_PROGRESS_18.md`** — earlier prior session record (W11-collapse, Rule 43 promotion to rule)
6. **`docs/CLAUDE.md`** — project rules, especially Rule 43 (now 10 sightings)
7. **`docs/PHASE_4_PART_B_PIPELINE.md`** — pipeline architecture; Simple Pipeline as parallel sibling with v1.0 + v1.1 noted as shipped
8. **`docs/followups.md`** — active and resolved followups (~28 active after session 20)
9. **`docs/VPS-SERVERS.md`** — infra ground truth, simple_pipeline queue active
10. **`docs/INGESTION_NAMING.md`** — operator naming convention reference

---

## Current state in 5 sentences

Simple Pipeline v1.0 and v1.1 are both merged to main and deployed to VPS — the second production pipeline (alongside Phase 3.5 + Part B) is code-complete and architecturally sound, with the v1.0 graininess fix preserved and v1.1 cosmetic polish (logo + overlay sizing + N-line wrap) finalized. Polish Sprint Pillar 1 remains parked at branch `feat/polish-sprint-pillar-1-critic-calibration` HEAD `cebfc46`, intentionally unmerged, deferred until Editor agent ships and operator content cadence stabilizes. The next workstream is **Editor agent** — smart-trim at segment boundaries, operator-flagged as core to making routine videos shippable to TikTok at volume; without it, hard cuts at segment boundaries produce some imperfect renders that operator must discard. Production verification of Simple Pipeline is still pending — first end-to-end Sheet-driven production render not yet exercised, deliberately deferred until Editor agent ships so first TikTok uploads are at full intended quality. Multi-brand activation (cyclediet, carnimeat, nodiet) is operator-paced; nordpilates is the only brand with content + aesthetic_description ready for Simple Pipeline production.

---

## Verification before proceeding

Run these queries before proposing anything substantive. Halt if anything diverges from expected.

```bash
# 1. Git state — main at session-20-close, Polish Sprint parked
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -10
# expected near top: v1.1 merge commit, v1.0 merge commit (cc973d0), recent docs touches

git branch -v
# expected: feat/polish-sprint-pillar-1-critic-calibration exists at cebfc46
# (6 commits ahead of main, unmerged)
# expected: feat/simple-pipeline and feat/simple-pipeline-v1-1 are DELETED from origin
```

```sql
-- 2. brand_configs state
SELECT brand_id,
       aesthetic_description IS NOT NULL AS has_aesthetic,
       logo_r2_key IS NOT NULL AS has_logo
FROM brand_configs
ORDER BY brand_id;
-- expected: 5 brand_configs rows (carnimeat, highdiet, ketoway, nodiet, nordpilates)
-- nordpilates: has_aesthetic=true, has_logo=true
-- others: has_aesthetic=false, has_logo varies

-- 3. Per-brand ingestion progress (operator may have started ingesting other brands)
SELECT brand_id,
       COUNT(DISTINCT parent_asset_id) AS distinct_parents,
       COUNT(*) AS total_segments,
       COUNT(*) FILTER (WHERE segment_v2 IS NOT NULL) AS v2_segments
FROM asset_segments
WHERE brand_id IN ('nordpilates', 'cyclediet', 'carnimeat', 'nodiet')
GROUP BY brand_id;
-- expected: nordpilates ~1174 segments, ~17 parents with ≥10 v2 segments
-- cyclediet/nodiet 0; carnimeat 1 segment (test ingestion only)

-- 4. Simple Pipeline schema confirmed present
SELECT to_regclass('simple_pipeline_render_history');
-- expected: simple_pipeline_render_history table exists

-- 5. Music tracks for nordpilates
SELECT mood, COUNT(*) FROM music_tracks GROUP BY mood;
-- expected: 15 tracks across 6 distinct moods (emotional, chill, hype, playful, aggressive, energetic)
-- (no `active` column on music_tracks; readiness endpoint counts all rows)

-- 6. shadow_runs anchor rows still present
SELECT id, part_b_terminal_state, created_at FROM shadow_runs ORDER BY created_at ASC;
-- expected: cb87d32c, ff67fc55, cf104600 — all failed_after_revise_budget
```

```bash
# 7. VPS service active
ssh root@95.216.137.35 "systemctl status video-factory --no-pager | head -5"
# expected: active (running) since recent v1.1 deploy

# 8. Simple Pipeline readiness endpoint live
ssh root@95.216.137.35 "curl -s 'http://localhost:3000/simple-pipeline/check-readiness?brand_id=nordpilates'"
# expected: {"ok":true}
ssh root@95.216.137.35 "curl -s 'http://localhost:3000/simple-pipeline/check-readiness?brand_id=cyclediet'"
# expected: {"ok":false,"reason":"missing_aesthetic_description"}
```

If anything diverges from expected, surface it before proceeding. Don't relitigate parked work; just confirm current state.

---

## Why Editor agent is the next workstream

Simple Pipeline ships hard cuts at segment boundaries. Operator review during Round 3 of v1.0 surfaced (consistently across v1.0 and v1.1 renders): some segments have preparation footage at the start, ending mid-action, or 1-2 seconds of unhelpful content at boundaries. The Match-Or-Match agent picks valid segments, but their boundaries are determined at ingestion (Pass 1 segment analysis) — not at render time, and not against the specific creative intent of the current job.

Operator-flagged as the highest-leverage remaining issue for routine videos specifically. Without it, the operator workflow is "over-generate ~6 idea seeds per actual target video, discard the 2-3 with bad boundaries." Editor agent would change that to "generate 3 idea seeds, ship 3 videos."

**Open architectural questions for Editor agent kickoff Q&A** (this is the next chat's job):

1. **Agent vs heuristic.** Real Editor agent (Gemini Pro call ffprobing each picked segment, reasoning about visual content + cut boundaries, deciding tighter `start_s`/`end_s`) vs deterministic heuristic (drop first/last 0.3s of any segment >2s). Operator pre-flagged "real version" preference, but worth confirming after seeing v1.1 production-deployed since some scope may have shifted.

2. **Latency budget per render.** Real Editor adds ~$0.01-0.02 + ~20s per render. Acceptable trade-off?

3. **Scope.** Just incision cuts (refine boundaries on agent-picked segments)? Or also re-rank segments after seeing real footage? Or full creative judgment (overrule Match-Or-Match if footage doesn't match prompt intent)?

4. **Where in orchestrator flow.** Between Match-Or-Match and Pass A? Or between Pass A and Pass B (after segment trim, before concat)?

5. **Output schema.** `{segment_id, refined_start_s, refined_end_s, reasoning}` per picked segment? What if Editor wants to drop a segment entirely?

6. **Failure handling.** If Editor call fails or returns invalid output, fall back to original Match-Or-Match boundaries (current behavior)?

These are real product questions; deserve a fresh kickoff Q&A, not a tail-end addition to session 20.

---

## Anti-patterns to avoid

- **Don't skip the verification queries.** Several state assumptions in the docs may have drifted between session-20 close and the new chat opening (operator may have ingested overnight, populated brand_configs for new brand, run a first production render, etc.).
- **Don't tactically defend in-flight commits when operator surfaces strategic concerns.** Rule 43 has 10 sightings as evidence; this is well-established.
- **Don't relitigate Simple Pipeline architecture.** It's deployed and working. Editor agent is the next layer; don't propose v2 of Simple Pipeline as scope for the new workstream.
- **Don't paste large multi-line JSON into chat.** Session 20 had two failures on this (S8 chore re-attempt). Use a different transport: gist, paste-bin, scp to VPS, or minified single-line.
- **Don't ship n8n workflow changes via JSON in repo without operator-side smoke testing.** Session 19's S8 chore lesson holds.
- **Don't bundle Editor agent scope with Polish Sprint scope.** Polish Sprint stays parked. Editor agent is its own workstream against Simple Pipeline; doesn't touch advanced pipeline.
- **Don't promise faster than 3 days for Editor agent.** Real Editor (agent-driven) is a new agent stage with its own prompts, cost, latency, schema, and Gate A bar. Treat as a real workstream, not a hotfix.
- **Don't promise first Simple Pipeline TikTok upload faster than Editor + ~1 day operator integration.** Operator wants Editor before TikTok-volume usage.

---

## What's likely to come up in conversation

**"Is Simple Pipeline production-ready?"**
Code-wise yes — merged, deployed, all Gate A passes done. Production-verified no — first Sheet-driven end-to-end render not yet exercised. Operator deliberately holding TikTok volume until Editor agent ships.

**"Why didn't operator just ship v1.1 to TikTok?"**
Hard cuts at segment boundaries produce some imperfect renders. Operator's choice: ship Editor agent first, then start TikTok volume with full quality. Costs ~3 days; saves the credibility hit of bad-boundary renders going public.

**"What about cyclediet/carnimeat/nodiet?"**
Operator hasn't ingested for them yet. Ingestion is operator-paced. Once a brand has ≥3 parents with ≥10 v2-analyzed segments + populated aesthetic_description + ≥5 music tracks, Simple Pipeline auto-routes for it. No agent work needed for new brand activation beyond the standard per-brand draft-and-revise pattern documented in `SIMPLE_PIPELINE.md`.

**"Should we re-attempt the S8 chore?"**
Not via chat-paste. The followup stays open; pick up next time operator touches n8n web UI for unrelated work. Use scp or gist transport, not chat-paste.

**"Should we resume Polish Sprint now?"**
No. Editor agent first. Polish Sprint resumes when Simple Pipeline is in TikTok production at steady cadence and operator has time for the 4-8 week Polish Sprint timeline.

**"What's the verbatim mode default doing?"**
For meme renders, the operator's idea seed is used as overlay text directly (no Gemini paraphrase). Was a Round 3 fix because Gemini was paraphrasing already-meme-shaped seeds into instructor-voice. For routine renders, default is generate (Gemini produces the overlay from voice_guidelines + idea seed). Operator can override per job in the Sheet's Overlay Mode column.

---

## Operator interaction patterns (preserved from prior handoffs, still active)

These are operator behavior patterns observed across sessions 17-20. Honor them.

**Strategic-shaped pushback during tactical work** (Rule 43 trigger):
- "the video wasn't bad" / "success looks different to me than to you"
- "maybe we should have chosen X then?"
- "this might be our downfall"
- "I don't think we should change our plan that much"
- "no, doesn't fit" (during iteration review — strategic-shaped, not just tactical)

When these appear, **pause tactical work, reframe from upstream surface, don't tactically defend.** Filed as Rule 43 in CLAUDE.md with 10 sightings as evidence.

**Decision signals:**
- Short replies to multi-question Q&A — trust earned, decisions made, proceed
- "I dont care" / "I dont think so" — stop optimizing this, move on
- "explain simpler" — reset on jargon
- "lets keep the original plan" — strategic preservation
- Strategic pushback during tactical work — pause, reframe, do NOT defend

**Brief drafting workflow:**
1. Planning chat (you) drafts kickoff Q&A first (~5-10 questions)
2. Operator answers (often terse, often strategic-shaped)
3. Planning chat drafts brief
4. Operator reviews + filed at `docs/briefs/`
5. Planning chat writes agent kickoff message
6. Operator relays to Claude Code agent (separate conversation, terminal-based execution)
7. Agent executes through Gate A, reports back via operator relay
8. Planning chat reviews + decides hold-or-merge
9. Operator merges per GIT_WORKFLOW.md (operator action only — agent never merges to main)
10. Operator deploys to VPS
11. Planning chat writes post-merge docs touch directive
12. Agent commits, then move to next workstream

**Agent execution context:** Claude Code in operator's local terminal with full VPS SSH access + Supabase access + repo access. Operator copy-pastes between planning chat and Claude Code. Agent has no n8n write access — that's operator-side only.

**Agent message format:** wrap relay-ready agent messages in start/end markers (`========== BEGIN AGENT MESSAGE ==========` / `========== END AGENT MESSAGE ==========`) so operator can clearly see what to copy.

**Three-role split:**
- Operator (Domis): tester, overseer, n8n workflow manager. Owns Sheet column setup, brand_configs population, R2 file uploads, n8n imports, merge to main, VPS deploy.
- Planning chat (this conversation): planner. Drafts questions, briefs, agent kickoff messages.
- Agent: executioner. Owns repo (except merges), commits, branches, code, tests, schema migrations, VPS service code.

---

## Brand priority (unchanged from session 19)

Per operator-named priority:

1. **nordpilates** — has library (1174 segments, 17 parents ≥10 v2), aesthetic_description, logo, music. Simple Pipeline ready for production.
2. **cyclediet** — operator-named priority for first multi-brand expansion. Description: menstrual helper diet and exercises.
3. **carnimeat** — second multi-brand expansion. Description: carnivore diet and exercises.
4. **nodiet** — third multi-brand expansion. Description: mediterranean diet.

Other 28 brands: deferred. Activated on commit-to-ingest basis.

For each priority brand, operator action sequence (per `SIMPLE_PIPELINE.md` Per-brand activation):
1. Drop content via S8 (with correct prefix: `NP_`, `CL_`, `CM_`, `ND_`)
2. Wait for ingestion to populate ≥3 parents with ≥10 v2-analyzed segments
3. Agent drafts starter aesthetic_description; operator revises
4. Operator places logo at `brands/<brand_id>/logo.png` in R2
5. Confirm music_tracks readiness (≥5 active across ≥2 moods)
6. Test Simple Pipeline render
7. Approve in QA flow → manual upload to TikTok / Reels / YouTube Shorts

---

## Cost trajectory (informational)

Current monthly spend: ~$25-32/month projected post-Simple-Pipeline-ship.

Simple Pipeline cost: ~$0.015-0.025/video (down from ~$0.025 due to verbatim mode skipping Gemini call for memes).

Anthropic API limit: low-watch (raised by operator 2026-04-27, still sufficient for foreseeable workload). Simple Pipeline doesn't use Sonnet (Gemini Pro only) so doesn't compound.

Editor agent will add ~$0.01-0.02 + ~20s per render if shipped as real-agent version. Cost-irrelevant for v1.

---

## Questions for operator at session start

1. Has any brand library state changed since session-20 close? (cyclediet/carnimeat/nodiet ingestion progress; brand_configs.aesthetic_description population; etc.)
2. Has a first end-to-end production Simple Pipeline render been exercised since deploy? If yes, any findings to surface before Editor agent kickoff?
3. Is Editor agent still the next workstream, or has priority shifted (e.g., business pressure for Polish Sprint resumption, multi-brand expansion, advanced pipeline cutover)?
4. Any new constraints on Editor agent scope (cost, latency, timeline) that emerged after session-20 close?

Don't propose anything substantive until these answers land.

---

## Standing by

Read the docs in order. Run the verifications. Then ask operator the questions above.

Once current state is confirmed, the next step is drafting the **Editor agent kickoff Q&A** — 6-8 questions covering agent-vs-heuristic shape, cost/latency budget, orchestrator placement, output schema, failure handling, and Gate A verification approach.

After Q&A answers land, Editor agent brief gets drafted, operator reviews, agent kickoff message goes out to Claude Code agent. Standard workflow from there.

---

*Handoff doc drafted 2026-04-29 at session-20 close. Replaces session-19 version. Filed at `docs/HANDOFF_TO_NEW_CHAT.md`.*
