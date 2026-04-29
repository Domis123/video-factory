# Known Follow-ups

This document tracks known issues and deferred work that warrants action but is not blocking current workstreams. Each entry should include: status, failure pattern, what's been tried, what hasn't been tried, conditions for revisiting, and the state of affected data.

New entries go at the top. Resolved entries can be moved to a "Resolved" section at the bottom or removed entirely once the issue is closed.

---

## simple-pipeline-routine-prompt-iteration — Active (post-v1.1)

**Discovered:** 2026-04-29, c10 / Round 2 / Round 3 Gate A reviews.
**Pattern:** Routine overlay generator (`overlay-routine.ts` + `overlay-routine.md`) produces "soft instructor" register — examples from Round 3: "Your mindful 5-minute glute awakening", "Awaken your deep core strength", "A gentle awakening for your hips". Brief Q12 anchored on label-style ("5-min morning flow", "wake your hips up", "core routine that actually works") — terser, more feed-tap-shape. The current outputs are coherent and on-brand but are 1-2 register notches longer than the brief example shape.
**Workable today:** Round 3 didn't surface this as a blocker; Domis didn't flag routine overlays in c10 review (5/6 routine pass). Acceptable for v1 ship.
**Long-term fix:** prompt rewrite in the same shape as Round 2's overlay-meme.md rewrite (anchor register on the operator's idea seed, add anti-pattern list for soft-instructor phrasings, add label-style example block). Re-run the 6 routine seeds, A/B against current.
**Owner:** post-Simple-Pipeline-v1.1 (Cosmetic Polish) workstream if still relevant after the cosmetic fixes change the visual register of the renders.

---

## simple-pipeline-meme-prompt-iteration — Active (post-v1.1)

**Discovered:** 2026-04-29, Round 3 Gate A.
**Pattern:** Meme verbatim mode (Round 3 default for meme) is shipping; the generate path remains for memes where the operator wants paraphrase / longer text. The Round 2 prompt rewrite (`overlay-meme.md`) holds register against the c2 + Round 2 seeds. If operator starts using `Overlay Mode = generate` for meme idea seeds that are "topic-shaped" (e.g., "5 reasons to stretch") rather than "caption-shaped", the prompt may need iteration to produce caption-style output across that wider input distribution.
**Workable today:** verbatim default covers the majority case (operators usually write meme idea seeds in caption shape). Generate path produces meme-register output on caption-shaped seeds (Round 2 evidence).
**Long-term fix:** if operator-observed generate-path output drifts off-tone for topic-shaped seeds, iterate `overlay-meme.md` with example seeds covering the wider input distribution.
**Owner:** post-v1.1 if surfaces; may not need any work if verbatim remains the dominant meme path.

---

## simple-pipeline-non-portrait-source-letterbox — Active (low-medium priority)

**Discovered:** 2026-04-29, Round 2 Gate A visual review (R6 — "gentle stretches before bed").
**Pattern:** Pre_normalized parents are produced by `parent-normalizer.ts` with `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2` — non-portrait sources get LETTERBOXED (black bars top/bottom) into the 1080×1920 frame. Round 2 R6 used a horizontally-framed source clip and produced visible black bars in the final render. Render path inherits the bars since pass A `-c copy` trims the already-padded frame.
**Workable today:** operator avoids picking landscape source clips (manual filter at upload).
**Long-term fix (Simple Pipeline v1.1 or post-merge polish):** zoom-to-fill / smart-crop on non-portrait sources at parent-normalize OR render time. Center-crop is a 5-line ffmpeg change at parent-normalize; smart-crop (subject-aware) is bigger.
**Owner:** Simple Pipeline v1.1 or Polish Sprint adjacent workstream.

---

## simple-pipeline-overlay-mode-default-by-format — Resolved 2026-04-29

**Resolved by:** Round 3 commit (this branch).
**Discovered:** 2026-04-29, Round 2 Gate A debrief — meme overlay generator paraphrased seeds into weaker copy ("main character energy" → "your main character arc starts on the mat").
**Resolution:** added Sheet "Overlay Mode" column with `generate` / `verbatim` dropdown. Empty defaults by format: meme→`verbatim`, routine→`generate`. `verbatim` skips the Gemini call entirely and uses idea_seed as the overlay text directly. Plumbed through S1 JSON → /enqueue → BullMQ payload → orchestrator. Operator can override the default per-job.

---

## simple-pipeline-ugc-audio-mute-on-no-speech — Resolved 2026-04-29

**Resolved by:** Round 3 commit (this branch).
**Discovered:** 2026-04-29, Round 2 Gate A — some UGC has loud incidental audio (room noise, equipment hum, creator music) without speech that fights with our chosen music in the mix.
**Resolution:** render Pass D extends the c10 binary "has audio?" check with a silencedetect-based speech-pause heuristic. Computes silence_ratio = total_silence_below_-30dB_for_≥0.4s / total_video_duration. silence_ratio ≥ 0.15 (natural speech has 15-30% pauses) → keep UGC, sidechain duck music. silence_ratio < 0.15 (continuous audio) → mute UGC, music-only path (same branch as no-audio case). Threshold conservative — errs toward muting on edge cases.

---

## simple-pipeline-routine-duration-target-hint — Resolved 2026-04-29

**Resolved by:** Round 3 commit (this branch).
**Discovered:** 2026-04-29, Round 2 Gate A — Routine 3 was 62s and felt suboptimal at slot_count=4; 2-3 segments would have flowed better.
**Resolution:** added soft duration target to `src/agents/prompts/match-or-match-routine.md` rule (3): "Target render duration is around 30 seconds … avoid renders longer than 50s unless the segments truly require it." Doesn't override Q8 contract (agent still picks 2-5 itself); it's a hint not a hard cap.

---

## simple-pipeline-editor-agent-workstream — Active (post-Simple-Pipeline-v1 ship)

**Status:** parked, will be briefed separately.
**Discovered:** 2026-04-29, c10 Gate A debrief.
**Pattern:** Match-Or-Match picks segments at the granularity recorded in `asset_segments` (start_s / end_s set by the v2 analyzer). The v2 analyzer's segment boundaries are coarse — sometimes a chosen segment includes a few seconds of pre-action setup or post-action cooldown that an editor would trim. An "Editor agent" sibling stage between Match-Or-Match and the render module would re-cut the picked segments at tighter boundaries (operator-named: "real version of slight-incision recutting").
**Use case:** routine path benefits most (multi-clip flow legibility); meme path also benefits (vibe-clip's own start/end matters more when it's the whole video).
**Owner:** Simple Pipeline v2 / Editor-agent workstream. Will brief separately after v1 ships clean.

---

## simple-pipeline-redis-rps-cap-needs-rate-limiting — Defensive mitigation in place

**Status:** mitigation deployed (BullMQ `limiter: { max: 500, duration: 1000 }` on simplePipelineWorker registration in `src/index.ts`). Filed informational, not active concern.
**Discovered:** 2026-04-28, c10 first-run cleanup-induced burst.
**Pattern:** Upstash Pay-as-you-go enforces 1000 commands/sec per DB. The c10 first-run hit `ERR max requests limit exceeded` mid-run. Same error string as the daily-cap variant; diagnostic miss initially attributed it to plan/daily limit, then to worker concurrency. Real cause: a cleanup script deleted Postgres rows for jobs still queued in BullMQ → simple_pipeline worker retry-bursted through 10 orphan jobs with "race condition" failures (status mismatch); each fail is fast (no I/O) so the worker churned ~1k Redis commands in <1 second. Per-render real command rate is healthy (c7 e2e ran 2 jobs clean at ~80s wall each well under the cap). Worker concurrency was already 1 from c7 — not the bottleneck.
**v1 mitigation:** BullMQ limiter caps simple_pipeline worker at 500 commands/sec, well under Upstash ceiling, gives headroom for housekeeping + harness bursts. Negligible perf impact at concurrency=1 (typical real activity ~30 cmd/sec per render).
**Operational note (not code):** drain BullMQ before deleting Postgres rows when aborting a harness mid-flight. Inverse order is safe (delete Postgres after BullMQ is empty) — wrong order causes the burst.
**Future revisit:** if multi-brand production saturates beyond 500/sec across all queues combined, raise limiter ceiling or distribute across multiple Upstash DBs. Phase 3.5/Part B planning + rendering workers don't have a limiter today; if they ever start hitting the cap, file individually and apply the same pattern.
**Owner:** revisit at multi-brand production scale (post-Polish-Sprint), or sooner if cap recurs in operator-observed runs.

---

## simple-pipeline-clip-rejection-manual-cleanup — Active (low priority)

**Discovered:** 2026-04-28, Simple Pipeline c1 starter aesthetic_description review.
**Pattern:** The nordpilates `aesthetic_description` deliberately keeps body composition guidance soft ("welcomingly across abilities") rather than encoding strict rules in the prompt. When an off-brand clip is structurally present in the library, Match-Or-Match may still pick it occasionally — the operator's recourse today is to manually delete the relevant `asset_segments` row + (optionally) the parent `assets` row + R2 keys. Workable at current 1-brand scale; becomes friction at multi-brand scale (33 brands, drop-in bar gets sloppier).
**Long-term fix:** Polish Sprint Pillar 5 (body composition ingestion filter at S8) auto-rejects clips before they become asset_segments rows. Pillar 5 stays deferred until Simple Pipeline ships and content cadence stabilizes; this followup tracks the manual-cleanup pattern as the interim mitigation.
**Owner:** Polish Sprint Pillar 5 when resumed; until then, Domis manual cleanup as needed.

---

## pillar1-planner-overcommits-subject-consistency — Active (deferred)

**Discovered:** 2026-04-28, Polish Sprint Pillar 1 c3 (audit at `docs/diagnostics/POLISH_SPRINT_PILLAR_1_PLANNER_AUDIT.md` on parked branch `feat/polish-sprint-pillar-1-critic-calibration`)
**Pattern:** All 3 nordpilates shadow_runs rows (cb87d32c, ff67fc55, cf104600) committed Planner stance `single-subject`. Agent cannot evaluate over-commit threshold without operator-judgment column filled in for each row.
**Pending:** Domis fills the [Domis review] column at Pillar 1 Tier 1 Gate A or earlier. Followup tripwire: 2+ rows showing operator-judgment "would NOT have wanted single-subject for this seed" → file Planner-prompt followup.
**Owner:** Domis (operator-judgment input); Polish Sprint Pillar 1 (when resumed)

---

## simple-pipeline-parent-vs-subject-identity — Active

**Discovered:** 2026-04-28, Simple Pipeline brief Q&A (operator-flagged)
**Pattern:** parent_asset_id reflects "which uploaded file the segment came from," not "which subject is in the video." If operator uploads 5 separate files of same person doing same workout (clips chunked before ingestion), Simple Pipeline parent picker treats them as 5 different parents. Cooldown of last 2 thinks they're different and produces visually-redundant videos despite cooldown working correctly per its own logic.
**Operator-named future fix:** filename-based subject tagging at ingestion. Convention `<PREFIX>_<SUBJECT_TAG>_<description>` lets S8 parse subject_tag and assign subject_group_id at ingestion. Not yet implemented.
**Acceptance for v1:** known limitation, operator-catchable at QA stage. Wastes ~$0.025 per redundant render. Acceptable for week-1 ship.
**Owner:** Simple Pipeline v2 workstream when redundancy becomes binding constraint, OR S8 enhancement when subject_tag filename convention adopted

---

## s8-cl-cd-prefix-consolidation — Active (low priority)

**Discovered:** 2026-04-28, S8 chore brief
**Pattern:** Both `CL` and `CD` prefixes route to brand_id `cyclediet`. Operator-provided table had both. Future cleanup may pick canonical prefix and retire the other. Not urgent.
**Owner:** Domis (operator decision)

---

## s8-subject-group-tagging-future — Active

**Discovered:** 2026-04-28, S8 chore + Simple Pipeline brief discussions
**Pattern:** Files of same subject (same person, same shoot, multiple uploaded files) currently treated as separate parents in `parent_asset_id`. Operator-named filename-tagging idea: extend filename convention to `<PREFIX>_<SUBJECT_TAG>_<description>` for subject_group_id resolution at ingestion. Not yet implemented.
**Owner:** future workstream when subject identity becomes binding constraint

---

## s8-quarantine-cleanup-policy — Active

**Discovered:** 2026-04-28, S8 chore brief
**Pattern:** Quarantined files accumulate in Drive folder indefinitely. No automated cleanup. Operator manually empties folder periodically.
**Owner:** Domis (operator process); automation as followup workstream when accumulation becomes problem

---

## s8-n8n-workflow-versioning — Active

**Discovered:** 2026-04-28, S8 chore brief
**Pattern:** n8n workflow state lives in n8n's database, not git. Repo artifact at `n8n-workflows/S8_UGC_Ingest_v2.json` is operator-imported; git commits don't sync to n8n production. Future automation: n8n CLI / API integration for workflow versioning. Not urgent.
**Owner:** future workstream

---

## docs-residue-cleanup-from-session-18 — Active

**Discovered:** 2026-04-27 during Polish Sprint pre-work
**Pattern:** Local agent sandbox at sprint kickoff had ~12 deleted-but-unstaged tracked files + ~21 untracked files, residue from incomplete cleanup work in session-18-close-rule-43 or earlier. Stashed at `stash@{0}` with message `pre-polish-sprint-residue-2026-04-27`. Includes:
 - planned root→docs/ moves never committed (`GIT_WORKFLOW.md`)
 - planned version bumps (`VIDEO_PIPELINE_ARCHITECTURE` v5_1 → v6)
 - planned `MVP_PROGRESS_11.md`, `PHASE_4_ADDENDUM.md`
 - `W8_ORCHESTRATOR_BRIEF.md` (should already be in repo per W8 ship)
 - `PENDING_CLAUDE_RESTRUCTURE.patch` (incomplete CLAUDE.md restructure)
 - 6 src/scripts/* (`w9-prework-*`, `w0d/`, `diagnose-cost-evidence.ts`, `probe-live-jobs.ts`, `verify-phase35-post-w8.ts`)

The one load-bearing file in the residue (`docs/diagnostics/w9-2-render-bridge-state-20260427.md`, referenced by `W9_CALIBRATION_RUN_DIAGNOSTIC.md`) was pulled out and committed on `chore/restore-w9-2-render-bridge-diagnostic`. Everything else stays in stash.

**Action:** operator reviews `stash@{0}` contents at convenience, decides per-file what gets committed, what gets dropped. Not Polish Sprint scope. Stash persists on agent sandbox — operator should pull it down to laptop if sandbox is ephemeral.

**Owner:** Domis, post-sprint

---

## s8-v2-json-divergence-followup — Active

**Discovered:** 2026-04-28 during Gate A smoke testing
**Pattern:** c3 of `chore/s8-multi-brand-ingestion-routing` shipped `n8n-workflows/S8_UGC_Ingest_v2.json` that diverges from the working operator-side configuration in three places:

1. **Send to VPS body:** JSON has `Body Content Type: Raw + Body: {{ $binary.data }}`. In n8n expression mode, `$binary.data` evaluates to the binary metadata reference object (`{ mimeType, fileType, ... }`), not the actual bytes. VPS received 0-byte requests; ffprobe failed with "exit 1" on empty file. Working config is `Body Content Type: n8n Binary File` + `inputDataFieldName=data` (no Body field, no Content-Type field).
2. **Skip Filter routing:** the IF node downstream of Prep Metadata strips binary attachments from items passing through it. Working config replaces the IF node with two parallel Code nodes from Download File:
   - "Prep Metadata - Valid" → filters to recognized prefixes, returns array WITH binary attached, feeds Send to VPS path
   - "Prep Metadata - Skipped" → filters to skip:true items, returns array without binary, feeds Quarantine + Log path

   Multi-output return from a single Code node (`return [validResults, skippedResults]`) was tried first; n8n rejected with "Code doesn't return items properly. Please return an array of objects."
3. **Send to VPS retry:** not in JSON. VPS `/ugc-ingest` is single-threaded by design (returns 503 when an ingestion is already in progress). For multi-file drops, files 2-N fail without retry. Working config adds `Retry On Fail = true, Max Tries = 3, Wait Between Tries = 60s` on the Send to VPS node.

**Action:** agent re-exports working v2 from operator's n8n at next convenient session, updates the repo artifact at `n8n-workflows/S8_UGC_Ingest_v2.json`. Not blocking; n8n production state is correct, the divergence is purely between repo artifact and the live workflow.

**Brief-process observation (operator-flagged 2026-04-28):** the c3 JSON looked structurally correct in code review — correct nodes, correct connections, correct expressions. The bugs only surfaced via end-to-end testing against real binary streams. Future briefs that involve n8n workflow updates should require operator runs a real-file smoke test before Gate A closes, not just "JSON is committed and importable." Filed as observation; not a blocker; informs the Simple Pipeline brief if it touches n8n.

**Owner:** agent (next session touching n8n workflows OR Simple Pipeline brief execution if it touches S8)

---

## s8-brand-configs-lazy-population — Active

**Discovered:** 2026-04-28 during S8 multi-brand ingestion routing chore pre-work
**Pattern:** The 33-prefix BRAND_MAP routes to 32 unique `brand_id` values. Only 5 (carnimeat, highdiet, ketoway, nodiet, nordpilates) have `brand_configs` rows; 27 brands have no config (airdiet, brainway, cortisoldetox, cyclediet, effecto, flamediet, glpdiet, greendiet, harmonydiet, koiyoga, lastdiet, lastingchange, liverdetox, manifestationparadox, menletics, mindway, moongrade, nomorediet, nordastro, nordletics, nordyoga, novahealth, offdiet, raisingdog, taiyoga, walkingyoga, welcomebaby).
**Operator decision (2026-04-28):** lazy population — add a `brand_configs` row for a brand only when committing to ingest + render for it. Files for non-configured brands routed through S8 (with `x-asset-meta` set by S8's BRAND_MAP) will ingest successfully and create `assets` rows with `brand_id` matching the prefix's brand value, even if `brand_configs` has no row for that brand_id; those rows accumulate as inert until the brand_configs row is added. The c6 fix tightens only the filename-fallback path (when `x-asset-meta` is missing); files reaching VPS without `x-asset-meta` but with a prefix-shaped filename will now 400 instead of silently creating orphan-brand rows. Net: S8-routed ingestion is permissive; non-S8-routed ingestion is restrictive.
**Operator-named priority order for first ingestion wave (2026-04-28):** nordpilates (live) → cyclediet → carnimeat → nodiet.
**Action:** operator adds `brand_configs` rows on commit-to-ingest. No agent action needed; reference this followup if drift between BRAND_MAP and brand_configs surfaces in production.
**Owner:** Domis, on per-brand commit-to-ingest

---

## w9-q8c-structural-classification-not-exercised — Active

**Discovered:** 2026-04-27, W9 Gate A Tier 2 forced-structural seed
**Pattern:** Critic verbalizes structural issues in verdict prose ("single-subject deep dive, but Slot 3 switches to a different parent asset and outfit") but emits `revise_scope: slot_level` instead of `structural`. Recognition without classification mapping.
**Evidence:** shadow_runs row cb87d32c-53d2-49d1-aeb9-2e362091fbcb
**Owner:** Polish Sprint pillar 1 (Critic calibration). May resolve incidentally if calibration changes also tighten classification mapping.

---

## w9-music-library-needs-expansion — Active

**Discovered:** 2026-04-27, operator observation from first real render
**Pattern:** Music selection feels limited; same fallback tracks recur. Today's job fell back to "Gigi Perez Sailor Song" through emotional → meditative cascade.
**Surface:** S7 ingestion workflow + music_tracks table + brand-allowed mood/energy combinations in brand_configs
**Owner:** Polish Sprint pillar 2

---

## w9-render-text-placement-suboptimal — Active

**Discovered:** 2026-04-27, operator observation from first real render
**Pattern:** Overlay positioning in Remotion composition doesn't sit cleanly against visual content in some compositions.
**Surface:** Remotion composition + caption_preset config in brand_configs
**Owner:** Polish Sprint pillar 3

---

## w9-brand-logo-not-rendering — Active

**Discovered:** 2026-04-27, operator observation from first real render
**Pattern:** nordpilates.json has `logo_r2_key` populated but operator reports no logo on shipped video. Either render template doesn't read the field, or watermark_position/opacity defaults are wrong, or the field isn't wired.
**Surface:** Remotion composition + brand_config wiring path
**Owner:** Polish Sprint pillar 4 (likely small fix)

---

## w9-ingestion-needs-body-composition-filter — Active

**Discovered:** 2026-04-27, operator-required brand standard
**Pattern:** No ingestion-level filter for body composition; off-brand fit clips pass through. Operator standard: "never use overweight people in our videos."
**Frame:** "off-brand fit" classifier, not body-shape value judgment in prompts
**Surface:** S7 ingestion workflow + asset_segments analysis at ingest time
**Owner:** Polish Sprint pillar 5 (most ethically delicate; framing matters in implementation)

---

## w9-transitions-library-too-animated — Active

**Discovered:** 2026-04-27, operator observation from first real render
**Pattern:** Current transition library includes long animations that don't fit the soft-aesthetic-cinema register. Operator wants simple clean cuts as default + minimal subtle transitions only; no long animations.
**Surface:** Transition definitions in render template / Remotion composition
**Owner:** Polish Sprint pillar 6

---

## w9-color-grade-needs-per-posture-presets — Active

**Discovered:** 2026-04-27, operator observation
**Pattern:** Current `warm-vibrant` LUT does its job but doesn't fully nail the soft-pastel nordpilates aesthetic across all postures.
**Surface:** Color-grade preset config in brand_configs + Remotion composition
**Owner:** Polish Sprint (sub-scope of pillar 3 or its own pillar — sprint brief decides)

---

## w9-demo-render-bridge-deferred-behind-polish-sprint — Active

**Discovered:** 2026-04-27, render-bridge diagnostic
**Pattern:** Part B's shadow_runs.context_packet_v2 cannot reach the renderer. `prepareContextForRender` is a null-safety stub, not a translator. Render worker reads jobs.context_packet exclusively (never shadow_runs). Remotion composition is hardwired to Phase 3.5 CopyPackage shape. Multiple required fields missing from context_packet_v2: composition_id, creative_direction.color_treatment, clips[].r2_key/trim, music_selection, brand_config, brief.audio.music, brief.segments[].text_overlay/transition_in/cut_duration_target_s.
**Sized:** MEDIUM-leaning-LARGE workstream
**Files touched:** src/orchestrator/render-prep.ts (rewrite as translator), src/orchestrator/orchestrator-v2.ts (enrich context_packet_v2), src/workers/pipeline.ts (route Part B jobs), new src/orchestrator/music-selector-partb.ts or shared helper, possibly src/types/orchestrator-state.ts extensions
**Estimated commits:** 4-6
**Owner:** Future workstream after Polish Sprint stabilizes Critic verdicts and renders look right
**Diagnostic note:** docs/diagnostics/w9-2-render-bridge-state-20260427.md

---

## claude-api-limit-watchitem — Active (low watch)

**Discovered:** 2026-04-27, W9 Phase 1 calibration first real-seed run
**Pattern:** Anthropic Claude API limit hit during W9 Phase 1 calibration. Operator raised limit; sufficient for sprint scale.
**Update 2026-04-28:** Polish Sprint Pillar 1 c1-c4 shipped without exhausting limit. Pillar 1 c5 (calibration seeds, would have used 4× ~Sonnet × 2 = ~8× standard usage) deferred behind Polish Sprint pause. Simple Pipeline doesn't use Sonnet (Gemini Pro only) so doesn't compound this. Anthropic limit currently in low-watch state — sufficient for foreseeable workload.
**Revisit if:** dual-run mode runs at scale + Polish Sprint resumes + per-brand Pillar 1 calibration runs propagate.
**Owner:** Polish Sprint resumption (when relevant)

---

## w9-verify-worker-dispatch-baseline-stale — Tier 1 script header quotes pre-W8 memory baseline

**Status:** Active, cosmetic.
**Discovered:** 2026-04-26, W9 Gate A Tier 1.

**Pattern:** `src/scripts/verify-worker-dispatch.ts` header comment instructs the operator to confirm "Worker memory baseline: ~210MB ± 50MB" as part of Tier 1 evidence. Actual VPS reading at W9 Gate A Tier 1 was ~501MB idle and peaked at ~562MB during the shadow run (post-W8 deploy + Part B agent code loaded). The ~210MB figure was the W8 deploy-time baseline before sustained Part B agent loading. Future operators reading this script header in isolation could misread normal idle memory as a regression.

**Tried:** the Tier 1 artifact at `docs/smoke-runs/w9-pre-flip-verification-20260424.txt` records the corrected reading inline.

**Not tried:** updating the script header comment.

**Revisit:** next time a W9-related script gets touched, fix the header comment to "Worker memory baseline: ~500-560MB on idle/peak, post-W8" with a note that the original ~210MB figure was W8-deploy-time only.

**Affected data:** none — cosmetic.

**Owner hint:** unowned, sweep-during-next-touch.

---

## w8-nordpilates-revise-exhaustion-rate-tier-2-baseline — Active (REFRAMED 2026-04-27)

**Original baseline (W8 Tier 2):** 2-of-3 nordpilates seeds exhausted revise budget.
**Updated baseline (W9.1 + W9 Phase 1):** 4-of-4 real-seed Part B runs terminate `failed_after_revise_budget`.

**Reframed:** This is not "calibration tells us what natural distribution looks like" anymore. 4-of-4 is the steady-state behavior of the current Critic threshold against the current library. The signal stable enough that we can act on it.

**Reframed action:** Rather than widening revise budget from 2 to 3 (the original consideration), the action is loosening Critic's subject_discontinuity threshold. Widening budget without loosening Critic still produces 5-of-5 cycle exhaustions deterministically.

**Owner:** Polish Sprint pillar 1

---

## w8-slot-level-revise-thrashing-without-convergence — Active (REFRAMED 2026-04-27)

**Pattern:** Director picks 5 different parent assets on single-subject Planner commitments; Critic flags subject_discontinuity at severity high; revise instructions sent; Director re-picks ~5 different parents again (deterministic given same candidate pool, only 1 slot changes per cycle); revise budget exhausts.

**Sightings:** 4 total
- W6 Gate A
- W8 Tier 2 Seed B
- W9.1 Gate A (forced-structural seed) — shadow_runs ff67fc55-1fc1-472f-8ef6-aec36e87a9c1
- W9 Phase 1 first real seed — shadow_runs cf104600-5a05-436a-932e-a2473a50dc4a

**Prior reading (2026-04-23 to 2026-04-27 morning):** Director architecture limit. Per-slot parallel picks can't honor cross-slot continuity. Implied fix: W11 Director Architecture Rebuild (sequential picks anchored on slot 0's parent OR parent-locking at retrieval).

**Reframed reading (2026-04-27 post-operator-pushback):** Critic calibration mismatch, not architecture. Phase 3.5 picks cross-parent on the same library and ships operator-acceptable output weekly. Critic's `subject_discontinuity` threshold is over-strict relative to operator's quality criterion. Director architecture isn't the binding constraint right now.

**Owner:** Polish Sprint pillar 1 (Critic calibration). Director architecture rebuild deferred as future-conditional workstream — only resurrects if Polish Sprint output reveals genuine quality regression after looser Critic threshold.

**Primary evidence document:** docs/diagnostics/w9-2-render-bridge-state-20260427.md and W9_CALIBRATION_RUN_DIAGNOSTIC.md

---

## w8-copywriter-parse-fragility-seed-c — Copywriter-v2 parse failure despite W7 commit 9 fix

**Status:** Active, informational.
**Discovered:** 2026-04-24, W8 Gate A Tier 2 Seed C.

**Pattern:** Copywriter-v2 failed with "Unexpected end of JSON input" on Seed C (bulgarian split squat deep dive) despite W7 commit 2597f7f's maxOutputTokens 8000 + aggressive bounds strip. Pattern resembles gemini-3.1-pro-preview-stability-with-rich-response-schemas followup — Copywriter's deep-dive form may push prompt payload closer to token budget than other forms, or structured-output stability degrades intermittently.

**Tried:** nothing at W8 — separate concern from W8 scope.

**Not tried:** (a) further maxOutputTokens bump, (b) prompt payload trimming for deep-dive form, (c) model-fallback retry policy (linked to gemini-3.1-pro-preview-stability followup).

**Revisit:** W9 shadow. If production shows Copywriter parse exhaustion >2% on any form type, investigate. Linked to gemini-3.1-pro-preview-stability followup; solution may be shared (model-fallback or payload trim).

**Affected data:** shadow_runs rows where Copywriter failed will have terminal_state=failed_agent_error; check part_b_failure_reason field in shadow for parse exhaustion attribution.

**Owner hint:** W9 shadow analyst.

---

## w8-job-events-to-status-varchar-30-ceiling — Part B event names required translation map vs naive prefix

**Status:** Active, cosmetic code simplification.
**Discovered:** 2026-04-24, W8 post-Gate-A fix commit 9b83f56.

**Pattern:** job_events.to_status is varchar(30). 7 of 20 TransitionEventType enum values overflow when prefixed with "partb_" (e.g. partb_snapshot_building_started = 31 chars). Resolution at W8: DB_EVENT_NAMES translation map mapping each enum value to a ≤30-char string. Works correctly but adds indirection; future state additions must also fit in 30 chars after translation.

**Tried:** translation map (shipped in W8 commit 9b83f56).

**Not tried:** migration 012 widening to_status to varchar(64) + collapsing translation map to a simple prefix concat. Cosmetic refactor; no correctness benefit.

**Revisit:** when W10 or later adds new Part B transitions, if any overflow forces awkward translation, schedule migration 012. Non-urgent.

**Affected data:** none. Translation map is deterministic; event rows are queryable by to_status prefix partb_.

**Owner hint:** whoever adds new Part B transition types.

---

## w7-slot0-homogenization-metric-treats-none-as-collision — test-harness false failure

**Status:** Active (test-harness tuning, not prompt iteration).
**Discovered:** 2026-04-24, W7 Gate A smoke (both pre-fix and post-fix runs).

**Pattern:** Gate A's `tier_1_slot0_homogenization` metric signatures the first 8 chars of `per_slot[0].overlay.text`. When `hook.delivery='overlay'`, the hook renders separately on slot 0 and the prompt correctly sets `per_slot[0].overlay.type='none', text=null` — the harness signatures this as `__NULL__`. Across 5 seeds that picked `overlay` delivery 3 times (narrative-intrigue, visual-pattern-interrupt, authority-claim), the `__NULL__` signature collides with itself and trips the ≥4 distinct threshold. The seeds are behaving correctly; the metric is wrong about what to count.

**Tried:** two rounds of prompt hardening (commit 9965138, commit 2597f7f). Both left the metric FAIL because the failure is not prompt-side.

**Not tried:** (a) exclude `__NULL__` signatures from the distinct count; (b) signature `(type, text_prefix)` tuple instead of text-only; (c) replace the metric with a downstream check that only fires when 4+ seeds emit non-null slot-0 text that all collapses to one cluster.

**Revisit at W8 Orchestrator design** when Gate A assertions are re-examined for orchestrator-loop relevance. Low priority — overall Tier 1 pass rate (5/5 on final smoke) is the load-bearing signal.

**Affected data:** none. Smoke-run artifact only.

**Owner hint:** W8 brief author.

---

## w7-parse-retry-headroom-in-production — max 3 attempts may be tight under real traffic

**Status:** Active (production-monitoring flag).
**Discovered:** 2026-04-24, W7 Gate A smoke (second run, commit 465ae1e).

**Pattern:** W7 Copywriter allows up to 3 total attempts per call (1 initial + 2 retries, per brief §Retry). On the second Gate A smoke, 2/5 seeds exhausted all 3 attempts with JSON parse malformation (unterminated strings / unquoted property names). Root cause was upstream: aggressive Zod bounds in the responseSchema appeared to destabilize Gemini 3.1 Pro Preview's JSON emission on rich schemas. Fixed in commit 2597f7f by stripping additional bounds — after fix, final smoke saw 0 parse retries across 5 seeds. But the retry headroom under the old config was visibly thin: 2 of 5 seeds hit the cap, meaning production traffic at 10-30 jobs/day could surface the same pattern whenever Gemini's emission stability drifts.

**Tried:** parameter-layer mitigation (commit 2597f7f) — maxOutputTokens 4000→8000, stripAggressiveBounds() for hashtags regex + min/max on reasoning/captions/hook fields. Final smoke 5/5 pass with retry_count=0.

**Not tried:** (a) bumping retry ceiling from 2→3 (4 total attempts) — brief-locked value, would require a protocol-amendment conversation; (b) per-attempt temperature escalation (0.5 → 0.4 → 0.3) to coax more deterministic emission on the retry path; (c) surfacing parse-retry counts as a W8 Orchestrator telemetry metric so production drift is visible.

**Revisit if:** production telemetry (once W8 ships) shows parse-retry rate >5% sustained across a week, OR a single job exhausts 3 attempts and surfaces as a hard failure to the operator. Either condition justifies revisiting (a) or (b).

**Affected data:** none. Smoke-run artifact only.

**Owner hint:** W8 Orchestrator author (telemetry hook) → W7 prompt author if retry escalation lands.

---

## w7-stripAggressiveBounds-kept-distinct-from-stripSchemaBounds — deliberate two-helper pattern

**Status:** Active (architectural note, no action pending).
**Discovered:** 2026-04-24, W7 param-only tuning (commit 2597f7f).

**Pattern:** W3/W5/W6 use a global defensive `stripSchemaBounds()` helper that strips common bounds (min/max on numbers, minLength/maxLength on strings) from Zod→JSON-Schema output before handing to Gemini. W7 added a second helper, `stripAggressiveBounds()`, that targets specific paths (hashtags regex, reasoning/captions/hook.text/hook.mechanism_tie bounds) rather than walking the whole tree. The two helpers were deliberately kept distinct:
- `stripSchemaBounds` (used by W3/W5/W6/W7): general blast radius, safe across all agents.
- `stripAggressiveBounds` (W7 only): path-targeted, strips bounds that `stripSchemaBounds` intentionally leaves in place on other agents (e.g., hashtag regex is a real format constraint that W3/W5/W6 don't use).

Combining into one global helper would risk destabilizing W3/W5/W6 responseSchemas where the preserved bounds are load-bearing. The trade-off is that any future agent that adopts hashtag-style regex constraints will need to duplicate the aggressive path-targeted stripping.

**Tried:** the two-helper split itself (commit 2597f7f). Verified W3/W5/W6 unchanged behavior by inspecting imports (none touch `stripAggressiveBounds`).

**Not tried:** (a) extracting a shared `schemaStripRegistry` where each agent opts into specific strip rules by path; (b) collapsing back to one helper with config flags.

**Revisit if:** a second cross-agent Gemini-stability fix surfaces that needs path-targeted stripping — at that point, (a) becomes the right refactor. Until then, two-helper is the smaller surface.

**Affected data:** none. Code-structure note.

**Owner hint:** whoever owns the next agent that hits schema-richness parse instability.

---

## gemini-3.1-pro-preview-stability-with-rich-response-schemas — model-level observation

**Status:** Active (monitor, non-actionable at app layer).
**Discovered:** 2026-04-24, W7 Gate A smoke iterations.

**Pattern:** Gemini 3.1 Pro Preview occasionally emits malformed JSON (unterminated strings, unquoted property names) when the responseSchema is large + has many bounded fields (min/max/regex). W7's schema is the richest Part B agent has emitted (per_slot array of overlay objects + hook object + captions object + hashtags array + metadata). Before the W7 fixes, parse malformation rate was ~40% (2/5 seeds exhausted 3 attempts). After stripping aggressive bounds (commit 2597f7f), rate dropped to 0% on the final Gate A. This is a model-level stability sensitivity that the W3/W5/W6 agents avoided via smaller schemas; W7 hit it first because CopyPackage is denser.

**Tried:** (a) schema-layer mitigations — `omitVoiceoverScriptForGemini()` (commit 2ea6431), `stripSchemaBounds()` (pre-existing), `stripAggressiveBounds()` (commit 2597f7f); (b) parameter bump — maxOutputTokens 4000→8000.

**Not tried:** (a) switching W7 to a different Gemini tier (2.5 Pro stable, 3.1 Flash) to compare stability vs quality; (b) splitting W7 into two Gemini calls (hook/captions + per-slot overlays) — named in W7 brief §Escalation as option (b), unused because the param-only fix resolved it.

**Revisit if:** production parse-retry rate climbs above 5% sustained (suggests Gemini stability drifted), OR a future Part B agent (W8 Orchestrator synthesis calls? W10 voice-script emitter?) emits an equally rich schema and hits the same pattern. At that point the option to split calls, swap models, or graduate `stripAggressiveBounds` to a shared registry all become relevant.

**Affected data:** none. Schema-stability observation.

**Owner hint:** W8 Orchestrator author (telemetry on parse-retry counts across agents) → model-selection call if drift is sustained.

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

---

## r2-orphaned-NP-keys-cleanup — RESOLVED 2026-04-28

**Resolved by:** S8 chore pre-work audit (commit 30b0549) confirmed no `NP/`-prefixed R2 keys exist for nordpilates. All assets use `assets/nordpilates/` and `segments/nordpilates/` patterns. The W5 clean-slate (2026-04-16) erased any historical `NP/` keys; post-W5 ingestion has used the brand-id-keyed `<resource_type>/<brand_id>/<uuid>` layout consistently. No migration needed.

---

## s8-vps-endpoint-validation — RESOLVED 2026-04-28

**Resolved by:** S8 chore c6 (commit 9b4a2ce, merged in main f4ae06c). VPS `/ugc-ingest` endpoint now validates filename-fallback parsed brand_id against in-memory brand_configs Set cache. Cache loads lazily on first fallback request; fail-open on cache-load error. Rejects with HTTP 400 if parsed brand_id doesn't match any brand_configs.brand_id.

---

## w8-q5-signal-validation-not-exercised-in-gate-a — RESOLVED 2026-04-27

**Resolved by:** W9 Q8c synthetic forced-structural seed at Gate A Tier 2 (commit at 005f9cb).
**Active synthetic seed exercised the code path. Critic emitted `slot_level` (not `structural`) on the test run; revise budget exhausted as designed.**
**Successor followup:** `w9-q8c-structural-classification-not-exercised` — captures the observation that Critic verbalizes structural issues in prose but emits slot_level classification. Polish Sprint pillar 1 may resolve this incidentally.

---

## w8-phase-3-5-unaffected-check-via-worker-harness — RESOLVED 2026-04-27

**Resolved by:** W9 Tier 1 verify-worker-dispatch.ts at Gate A (commit at 005f9cb).
**Worker-harness verified Phase 3.5 dispatch unaffected: 4/4 invariants held — brand stayed phase35, no partb_* events on phase35 brand, shadow_runs delta=0, dispatcher emitted exact "Part B not routed" log line.**

---

## w9-cost-tracking-unwired — RESOLVED 2026-04-27

**Resolved by:** W9.1 single-gate fix at 940c75a.
**Cost path now wired emit→accumulate→persist. Q5d cost signal alive.**
**Per-agent baseline established (forced-structural seed):** planner $0.0114, picks $0.1566, critic $0.0123, copy $0.0152.
**Total per shadow run baseline:** ~$0.55-0.56 (forced-structural seed including 2 revise loops).
