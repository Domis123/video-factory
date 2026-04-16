# 📋 Handoff — Video Factory, Phase 3 W2 start

## Who you are talking to

Domis (Dominykas Auglys). Lithuanian, Vilnius. Operates a multi-brand digital business spanning health/wellness/fitness apps. You're his task curator and project manager. The agent on his VPS executes code; he's the debugger/tester pushing changes through.

Three-person loop: Domis is operator + tester. You write briefs and review work. The agent (separate Claude instance with VPS SSH access) executes code on the server.

## Project at a glance

Automated video production pipeline. UGC footage in → AI creative planning → branded short-form videos out (TikTok/IG/YT). Multiple brands (currently nordpilates active for Phase 3 testing, carnimeat next, plus highdiet/welcomebaby/nodiet/ketoway available).

Tech stack:
- n8n on Hetzner (46.224.56.174) — orchestrator
- VPS on Hetzner (95.216.137.35, CX32) — Node.js worker engine, Remotion, ffmpeg, whisper.cpp
- Supabase — Postgres + pgvector
- BullMQ + Upstash Redis (pay-as-you-go since 2026-04-16) — job queue
- Cloudflare R2 — media storage
- Claude Sonnet 4.6 — Creative Director (Phase 2 + Phase 3 dispatch) + Copywriter
- Gemini 3.1 Pro Preview — ingestion analyzer + Asset Curator V2 (FREE via company credits while available)
- CLIP self-hosted — segment embeddings via @xenova/transformers

GitHub: https://github.com/Domis123/video-factory (private)

## Where the project is RIGHT NOW

**Released to origin/main and tagged:**
- Phase 1 (ingestion overhaul) — tag `phase1-complete`
- Phase 2 (curator V2) — live in production
- Phase 2.5 (pre-trim segments at ingestion)
- Phase 2 cleanup — tag `phase2-complete`, commit `269ff99`
- Phase 3 W1 (Creative Director rewrite) — tag `phase3-w1-complete`, commit `df6a326`
- **Phase 3 W5 (clean-slate ingestion + pre-normalization) — tag `phase3-w5-complete`, commit `f1b8120`**

**Current state:** Phase 3 W1 + W5 shipped. ENABLE_PHASE_3_CD remains `false` in production — flag flip waits for W2/W3/W4. Phase 2 path still live for actual video renders. New ingestion path (W5) runs on every new /ugc-ingest — parent pre-normalized to 1080×1920 H.264 before segmentation.

**Content sprint running 2026-04-16+.** Operator is ingesting 50-100 nordpilates UGC clips through the new W5 pipeline. Library growing from clean-slate zero. Short clips (20-60s) ingest in 40-90s; long 4K clips (3-5 min) take 10-15 min. Expected total wall time: 3-6 hours.

**Next workstream:** **W2 — Asset Curator V2 update.** Read `aesthetic_guidance` (per-slot) + `creative_vision` (top-level) from Phase 3 briefs. Start after content sprint completes so W2 has real data to validate against. Estimated 1-2 agent sessions.

## Phase 3 status snapshot

| Workstream | Status | Estimated |
|---|---|---|
| W1 — Creative Director rewrite | ✅ SHIPPED 2026-04-15 | (took 6 sessions / 1 day) |
| W5 — Clean-slate ingestion + pre-normalization | ✅ SHIPPED 2026-04-16 | (took 5 sessions / 1 day) |
| W2 — Curator V2 update (read aesthetic_guidance + creative_vision) | ⏳ NEXT | 1-2 sessions |
| W3 — Copywriter update (per-slot overlay text) | ⏳ planned | 1-2 sessions |
| W4 — Remotion parameterized composition | ⏳ planned, largest | 4-6 sessions |

Three milestones:
- 3.1 (W1+W2+W3, behind feature flag) — partial, W1 done
- 3.2 (W5 independent) — ✅ done
- 3.3 (W4 + flag flip, first Phase 3 production video) — final

## W5 ship summary (so you understand what landed)

**Architecture pattern:** pre-normalization slots between raw R2 upload and `assets` INSERT in `src/workers/ingestion.ts`. Hard-required — throws on failure with best-effort orphan raw R2 cleanup. Downstream consumers (Gemini Pro segment analyzer, keyframe extractor, 720p scout trim) all read the normalized local path.

**New file:** `src/lib/parent-normalizer.ts` (74 lines) — `preNormalizeParent()`. Sibling to existing `buildNormalizeCommand` in `ffmpeg.ts` (kept for render-time). Settings: 1080×1920 30fps H.264 CRF 22 medium, AAC 128k 44.1k stereo, `-movflags +faststart`, `scale+pad+fps` filter chain.

**Migration 007:** `assets.pre_normalized_r2_key TEXT` nullable. No default, no backfill (clean-slate drop makes backfill unnecessary).

**Clean-slate executed 2026-04-16:** 53 nordpilates assets + 182 asset_segments (cascade) + all R2 nordpilates prefixes + carnimeat test debris (from Step 2/3 validation runs).

**First production ingestion verified (Step 5):**
- `NP_concept_17.MOV`, 986 MB, 3400×1912 HEVC 60fps, 215.6s (3:36)
- Pre-normalize: 4:42 encode (CRF 22 medium), 986MB → 444MB (45% ratio)
- Gemini Pro Files API: 1:03 (12 segments validated)
- 12 segments × (keyframe + CLIP + 720p trim + R2 + DB): ~58s
- Total: ~14 min. Short 22.9MB/3.9s clip verified at 48s total.
- 12/12 asset_segments with `clip_r2_key` + `embedding` populated.

**Side fixes delivered during W5:**
- `/ugc-ingest` Content-Length cap raised 500MB → 2GB (commit `22e977e`). Old cap predated streaming rewrite; RAM is ~64KB regardless of upload size.
- Upstash Redis upgraded free → pay-as-you-go (hitting 543k/500k limit). Diagnosis: not a bug — keepAlive pings on 6 persistent connections account for ~518k/mo. Pay-as-you-go lands at ~$1.20/mo.
- n8n S8 `Send to VPS` timeout raised 10 min → 30 min (workflow-side). HTTP was closing before 3-5min 4K ingestions could complete; self-healed via dedup on next poll but confusing observability.

**Deferred from W5 (filed for Milestone 3.3 cleanup):**
- Legacy `analyzeClip` Gemini Flash call deletion (runs unconditionally, populates `assets` columns nothing reads)
- Async ingestion via BullMQ queue (replaces synchronous HTTP; addresses timeout root cause properly)
- `clip-analysis.ts` reading normalized parent instead of raw 4K (free speedup)

## Content sprint notes

**What the operator was doing at handoff time:** batch-dropping clips into the nordpilates Drive folder. S8 polls every 5 min. Each clip goes through the full W5 pipeline. Drive folders used as organizational batches for tracking "what got uploaded when."

**Observed during sprint start:**
- Clips classified by legacy Flash as various content types. Some are off-brand (a supermarket clip classified "lifestyle" ended up under nordpilates). Flagged for operator discipline — system doesn't block on content-brand mismatch.
- Short clips (20-60s) are dominant, completing end-to-end in <2 min.
- First clip (a low-motion yoga/pool 3:36 source) produced 12 segments with type distribution: 5 hold (avg q 8.0), 3 transition (5.3), 3 setup (5.0), 1 b-roll (7.0), **0 exercise**. Honest classification for that content — but flag for W2 validation: if sprint library skews heavily `hold`, Curator V2 type filters may have fewer `exercise` segments to pick from for workout-demo video types.

**Sprint completion check (for next session):** before starting W2, run:
```sql
SELECT count(*) FROM assets WHERE brand_id='nordpilates';
SELECT segment_type, count(*), round(avg(quality_score),1) AS avg_q
FROM asset_segments WHERE brand_id='nordpilates'
GROUP BY segment_type ORDER BY count(*) DESC;
```
Should see 50-100 assets, 200-1000+ segments, distribution across hold/exercise/transition/setup/b-roll.

## Phase 3 design intent (recurring patterns)

Read `docs/PHASE_3_DESIGN.md` for the full design. Recurring principles:

1. **Hybrid structured + free-text wherever LLMs and code both consume the data**
2. **Open creative range over predictability** (Domis consistently picks wider over narrower)
3. **Vibe as guidance, not constraint** (CD can push back when idea_seed contradicts)
4. **Brand consistency through small surface area** (logo + colors + caption font locked, everything else free)
5. **Polish features deferred** in favor of variety features

## Important nuances and lessons from prior sessions

### How Domis works

- Iterative, small-step execution. Don't dump big briefs on the agent in one shot — break into testable pieces.
- Strong tester. Trust him to catch issues during validation.
- Pushes back thoughtfully. When he disagrees, hear him out — he reversed himself multiple times during both W1 and W5.
- Good at setting scope. When he says "defer to 3.3," respect it.
- Answers via `ask_user_input_v0` tool well. Use it for discrete-choice decisions. **Plain-text multiple-choice is also fine** — in the W5 session, tool rendering broke once, and plain A/B/C/D worked.
- One-command-at-a-time mode for high-stakes git operations. Do NOT batch git commands when there's any risk of state divergence.
- **From here on**: when making big changes or proposing architectural shifts, **ask as a question**, don't bake the decision into an agent brief. This is an explicit rule Domis gave mid-W5.
- Docs work: he does most docs himself on his laptop. Skip agent involvement for anything that doesn't touch the running service. Exception: the "sync docs to repo" pattern via a dedicated agent brief has worked cleanly twice now (`ea61805` for W1, follow-up for W5).
- Uses an SSH-bridged workflow; VPS can push branches to GitHub directly when laptop merge needed.
- **Hits zsh quote-prompt traps when copy-pasting multi-line shell commands.** Use heredocs (`<< 'EOF'`) for any command with embedded quotes/newlines. Don't paste comments inside shell blocks.
- **Occasionally pastes git commands from the wrong directory** (home instead of repo root) — `git status` before destructive operations is a reasonable guardrail.

### Communication norms

- Give agent briefs in fenced code blocks clearly marked "paste this to the agent."
- Give Domis instructions outside the box.
- Use the trust-the-summary protocol for agent reports. Don't ask for code paste unless something fails.
- Standing rule for the agent: "If uncommitted work exists on a feature branch and a deploy is needed, agent commits with a sensible message and proceeds. No need to ask."
- Agent never pushes to main, never merges to main, never tags. Domis does those from his laptop.
- **Exception:** agent can `git push origin <branch>` to GitHub for feature branches (VPS remote is configured with credentials). Used during W1 and W5 for laptop squash-merge handoff.

### Architectural decisions/lessons that matter

(Carry-over from prior sessions, plus W5 additions)

- **Pro malforms output ~10% of the time** — returns array `[]` instead of object `{}`. Zod corrective retry catches this. Phase 3 CD has the same protection.
- **n8n filter-by-empty-field requires writeback in the same step.** S1 ran a 30-second loop creating 23 duplicate jobs before this was diagnosed.
- **Google Sheets parses cells starting with `=` as formulas.** Workaround: prepend `'` apostrophe in n8n code node. Used for Full Brief column.
- **SECURITY DEFINER migration runner pattern** unblocks supabase-js DDL. `apply_migration_sql` RPC + `apply-migration.ts` script. Service-role only, hardened with `SET search_path = public, pg_temp`.
- **apply-migration.ts accepts filename only**, not full path. Prepends `src/scripts/migrations/` automatically. (Agent hit this in W5 Step 1 — CLAUDE.md example is misleading.)
- **BullMQ obliterate while a job is mid-flight** produces collateral noise (TransitionConflictError). Not data loss.
- **Squash-merge requires `git branch -D` (capital)** to delete source branch — git can't trace squashed commit back to original via parent pointers.
- **VPS-to-laptop branch transfer** via `git push origin <branch>` from VPS, then squash-merge from laptop. Simpler than git-fetch-over-ssh pattern.
- **Architecture Rule 22:** Always DROP FUNCTION IF EXISTS before CREATE OR REPLACE for return-type changes.
- **Architecture Rule 23:** Drop ivfflat indexes at small table sizes — stale centroids return empty cells until ~1000 rows. **Content sprint may push past 1000 rows — revisit index recreation post-sprint.**
- **Architecture Rule 24 (Phase 3):** Composition is parameterized, not template-instanced.
- **Architecture Rule 25 (Phase 3):** Brand consistency lives in small surface area.
- **Architecture Rule 26 (Phase 3):** Hybrid structured + free-text fields where LLMs and code both consume.
- **Architecture Rule 27 (Phase 3):** Defer polish features in favor of variety features.
- **Architecture Rule 28 (Phase 3):** Clean-slate ingestion when content sprint is incoming. **Applied successfully in W5.**
- **W1 lesson — DB constraints can mask prompt issues.** Check DB before iterating prompts when output looks suspiciously locked.
- **W1 lesson — example anchoring is real.** Restructure example order (most divergent first) for highest-leverage prompt fix.
- **W5 lesson — big changes come as questions, not baked into briefs.** Explicit rule from Domis.
- **W5 lesson — pre-flight sanity-check before destructive operations.** Part 1 of the clean-slate script was read-only counts; Part 2 waited for explicit go-ahead. Worth repeating for any similar destructive pattern in future.
- **W5 lesson — side fixes compound on ship days.** W5 surfaced the 2GB cap, Redis quota, and n8n timeout problems in rapid succession. Keep the main work flowing but don't blow past side issues — each was a real bug.
- **W5 lesson — short-circuit sibling functions when purposes diverge.** Don't parameterize a render-time function to also do ingestion-time work. Different concerns → different functions.
- **W5 lesson — synchronous HTTP for long work is an architecture smell** but shippable with a generous timeout. Filed the async BullMQ migration to Milestone 3.3 rather than blocking W5 on it.

### Stale/broken stuff to be aware of

- Supabase anon key is hardcoded in n8n workflow JSONs. Domis declined to rotate. Anon-only blast radius, accepted risk. Don't bring it up.
- Upstash tokens also leaked in chat history. Domis declined to rotate pre-production.
- feat/curator-v2, feat/sub-clip-segmentation, feat/phase3-w1-cd, feat/phase3-w5-ingestion branches — all deleted after their merges.
- First V2 production video (d74679d2...) was rated 4-5/10 on 2026-04-14. That's what triggered Phase 2 cleanup + Phase 3 design. Don't think it's a regression to fix.
- ENABLE_CURATOR_V2 reads from `process.env['ENABLE_CURATOR_V2']` directly (legacy pattern); Phase 3 CD uses the cleaner `env.ENABLE_PHASE_3_CD` from `src/config/env.ts`. Inconsistency filed for Milestone 3.3 cleanup.
- **Legacy `analyzeClip` Gemini Flash** runs unconditionally on every ingestion. Populates `assets` legacy columns that nothing reads. Adds 3-5 min per clip at ingestion (mostly Flash + its own internal 720p downscale). Filed for Milestone 3.3.
- **Sheet still lacks Vibe column.** Filed for follow-up; S1 needs a small update to pipe it through.

## Validation jobs in DB (pre-sprint)

- `d74679d2-3c62-4e10-8e03-6da774b55dc1` — 2026-04-14 first V2 video (4-5/10)
- `c83c31dc-3093-469e-9953-43c857d680a0` — Phase 2 cleanup validation job, video_type=null (pre-W1 bug)
- `10e7612b-2a8f-4f68-ba19-1601c9a01d76` — full_brief auto-populated

## Validation ingestions in DB (post-W5)

- `22dba651-c4a9-4a51-a97a-9fa95cf3a208` — first W5 production ingestion (NP_concept_17.MOV, 2026-04-16, 12 segments). Use as canonical example of a successful post-W5 ingestion.
- Plus whatever accrued during content sprint.

## Current sheet structure

Jobs sheet at https://docs.google.com/spreadsheets/d/1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78/edit#gid=1226329851

Columns: A=Row Status, B=Job ID, C=Brand, D=Idea Seed, E=Status, F=Brief Summary, G=Full Brief (with apostrophe escape), H=Hook Text, I=Preview URL, J=Auto QA, K=Review Decision, L=Rejection Notes, M=QA Decision, N=QA Issues.

**For Phase 3 (deferred from W1):** a new column Vibe needs adding (probably right after Idea Seed at column E, shifting everything else by one). S1 workflow needs updating to pass Vibe through to Supabase. Not done yet.

## n8n workflows currently active

S1 New Job (30s poll) — pending Vibe column passthrough
S2 Brief Review (30s poll)
S3 QA Decision (⏸ needs v2)
S4-S6 deactivated
S7 Music Ingest (5min poll)
S8 UGC Ingest — 5min poll, 30-min `Send to VPS` timeout (raised 2026-04-16)
P1 Job Status Push (webhook)
P2 Periodic Sync (5min, apostrophe escape)
P3-P4 deactivated

## Feature flag state

| Flag | Current | Notes |
|---|---|---|
| ENABLE_CURATOR_V2 | true | Live since 2026-04-13 |
| **ENABLE_PHASE_3_CD** | **false** | W1 shipped, flag stays off until W2/W3/W4 land |
| ENABLE_PHASE_3_REMOTION | (not yet defined) | Will be added at W4 |
| ENABLE_BEAT_SYNC, ENABLE_COLOR_GRADING, ENABLE_MUSIC_SELECTION | true | |
| ENABLE_AUDIO_DUCKING, ENABLE_CRF18_ENCODING | true | |
| ENABLE_DYNAMIC_PACING | false | post-MVP |

## What W2 actually entails

When Domis says "let's start W2," the agent brief should:

1. **Step 0 (read-only inspection):** Open `src/agents/asset-curator-v2.ts`, `src/agents/prompts/asset-curator-v2.md`, `src/agents/curator-v2-retrieval.ts`. Report current Curator V2 flow, which brief fields it currently reads from each slot, how retrieval is assembled, where Pro prompt is built.
2. **Step 1 (prompt update):** `asset-curator-v2.md` modified to surface `creative_vision` as top-level context block at the start and `aesthetic_guidance` per-slot inline with existing `clip_requirements`. Explicit prompt ordering: hard requirements first (type, quality, mood, has_speech), aesthetic_guidance second (flavor), creative_vision third (global tone). No breaking changes to existing Phase 2 input format.
3. **Step 2 (input dispatching):** `asset-curator-v2.ts` reads from the slot object's new fields (from Phase 3 brief) while falling back gracefully if fields absent (Phase 2 brief path). Discriminated union on brief type.
4. **Step 3 (retrieval augmentation — optional):** Consider whether `aesthetic_guidance` keywords should augment the CLIP retrieval query embedding or stay as Pro-only context. Lean: Pro-only for W2, measure, add to retrieval later if needed.
5. **Step 4 (test):** Smoke harness (new or extend `test-curator-v2.ts`) runs Phase 3 briefs through updated Curator V2 and reports pick quality + reasoning traces. Since ENABLE_PHASE_3_CD is false, this is a dev-only smoke test — not through the live pipeline.
6. **Step 5 (validation):** Operator reads 5-10 Pro reasoning traces and confirms `aesthetic_guidance` and `creative_vision` are being honored. Not a metric, a vibe check.

Don't try to do all steps in one agent brief. Iterative — same protocol as W1 and W5.

After W2 ships, W3 (Copywriter per-slot overlay) is the next workstream.

## Decision points still open (to resolve as work progresses)

- Vibe sheet column position (probably right after Idea Seed; ~30min S1 update). Consider doing during or after W2 since W2 is short.
- W3 prompt: Copywriter overlay text read order — CD's text_overlay.style first, or slot clip description first?
- W4 plugin policy: `@remotion/transitions` vs hand-rolled for whip-pan and friends.
- W4 LUT files vs CSS filters for color treatments (CSS filters starting point; refine if needed).
- ENABLE_CURATOR_V2 migration to env.ts pattern (Milestone 3.3 cleanup).
- VIDEO_TYPE_CONFIGS slim + selectVideoType deletion (Milestone 3.3 when Phase 2 path dies).
- Legacy analyzeClip Gemini Flash deletion (Milestone 3.3).
- Async ingestion via BullMQ (Milestone 3.3).

## What's NOT in Phase 3 scope (resist scope creep)

- Beat-locked music sync (Phase 4)
- Per-slot music intensity ducking (Phase 3.5)
- Sophisticated overlay timing (Phase 3.5)
- W6 Brand Settings sheet sync (Phase 3.5 — interim path is editing brand_configs in Supabase web UI)
- Reference-guided generation / scraping similar videos (Phase 4)
- Throughput optimization (Phase 4+)

## Files to attach to the next chat

Domis will paste these files for context:
- `CLAUDE.md` (latest, post-W5)
- `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`
- `docs/PHASE_3_DESIGN.md` (latest, W1 + W5 marked shipped)
- `docs/SUPABASE_SCHEMA.md` (latest, migrations 006 + 007 applied)
- `docs/MVP_PROGRESS (8).md`
- `docs/VPS-SERVERS.md`
- This handoff doc

Plus n8n workflow JSONs as relevant. Plus the current Phase 3 curator-v2 prompt file if Domis wants to walk through it in the chat.

## Tone and pacing for next session

- Warm, direct, professional. Domis is sharp and respects efficiency.
- Don't pad — get to the point.
- Use buttons (`ask_user_input_v0`) for discrete-choice decisions when the tool is working. If it breaks, fall back to plain-text A/B/C/D.
- **For big changes or architectural proposals, ask as explicit questions** — do not bake them into briefs. Domis gave this rule mid-W5.
- When recommending, lead with the recommendation + brief reason, then offer alternatives.
- Acknowledge when he overrules you and proceed with his choice.
- Flag risks honestly — he respects honesty over deference.
- For shell command sequences, prefer heredocs over multi-line quoted strings. Domis hits zsh quote-prompt traps when pasting comments inside shell blocks.

## How to start the next chat

The next chat will likely begin with Domis pasting these handoff docs. Your first action should be:

1. Acknowledge context received, no need to re-summarize
2. Check with Domis whether content sprint has completed (ask for the row counts from the Sprint completion check SQL above) before proposing W2 start.
3. If sprint is done, send the W2 Step 0 inspect brief (read-only, agent reports back).
4. If sprint is mid-flight, offer to either wait or start Step 0 in parallel (Step 0 is read-only and doesn't conflict).
5. If he says something else, listen and respond to what he actually asked.

Don't dump a 2000-word welcome message at him.
