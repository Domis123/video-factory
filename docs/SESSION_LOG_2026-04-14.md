# Session Log — 2026-04-14 (Phase 2 Cleanup)

## What shipped
- Released PR #1: Phase 1 + 2 + 2.5 + docs v3.9 to `origin/main` (merge commit `bd19edc`).
- Released squashed Phase 2 cleanup to `origin/main` (commit `269ff99`, tag `phase2-complete`).
- 11 files changed in cleanup: `retry-llm.ts`, Sonnet/Gemini wraps, Zod corrective retry, V2 prompt variety rule, `full_brief` column + migration runner, formatter, worker wiring.

## Cleanup commit contents
Squashed from 7 pre-merge commits on `chore/phase2-cleanup`:

1. `084d3b7` feat(retry): add withLLMRetry helper, wrap Sonnet call sites
   - `src/lib/retry-llm.ts` (new): duck-typed retry helper. Retries 429/502/503/504/529, Anthropic `overloaded_error`, Gemini `UNAVAILABLE`, network errors (ECONNRESET, socket hang up, etc.). Exponential backoff with full jitter, 4 attempts max, 30s budget.
   - `src/agents/creative-director.ts`, `src/agents/copywriter.ts`: wrapped raw `fetch()` + `!response.ok` + `.json()` in `withLLMRetry()`.
2. `cd5b531` feat(retry): wrap Gemini call sites with withLLMRetry
   - `src/agents/asset-curator-v2.ts`: picker (`curator-v2-pick`) and critique (`curator-v2-critique`) wrapped. `GoogleGenerativeAIResponseError` for `promptFeedback.blockReason` stays outside the retry lambda (content policy is not retryable).
   - `src/lib/gemini-segments.ts`: ingestion call (`ingestion-segments`) wrapped. Upload/polling/Zod parse stay outside.
3. `bc42408` feat(curator-v2): schema-aware corrective retry on Zod parse failure
   - `src/agents/asset-curator-v2.ts::callProPicker`: on first-attempt Zod failure, inject `parsed.error.issues` back into the prompt as a corrective instruction; single corrective attempt via `withLLMRetry` with label `${label}-corrective`; falls through to highest-quality fallback only if both attempts fail. Proven live: caught "Expected object received array" malformation on slot 2 of test job that would otherwise have been a silent fallback.
4. `18dd491` feat(curator-v2): add soft visual variety rule with explicit repetition signal
   - `src/agents/prompts/asset-curator-v2.md`: 4-bullet VISUAL VARIETY block inserted between `{previously_picked_parents}` and the CANDIDATES: block. Pro is instructed to state "Visual repetition: only similar candidates available — picked X because Y" when forced to duplicate. Gives operator early warning of library exhaustion without forcing quality downgrade.
5. `0129690` feat(db): add full_brief column to jobs + reusable migration runner
   - `src/scripts/migrations/004_add_full_brief_column.sql` (new): `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_brief TEXT`.
   - `src/scripts/apply-migration.ts` (new): reusable runner via supabase-js `rpc('apply_migration_sql', { query })`. Bootstrapped via one-time `SECURITY DEFINER` function in Supabase, `search_path = public, pg_temp`, `EXECUTE` granted only to `service_role`. Runner auto-verifies `ALTER TABLE ... ADD COLUMN` via `information_schema` with fallback to direct column probe if the schema isn't exposed to PostgREST.
6. `7c0d42c` feat(format-full-brief): operator-readable brief dump with FALLBACK detection
   - `src/lib/format-full-brief.ts` (new): human-readable dump of `context_packet` for sheet column G. Sections: SLOT headers with `type — label (duration, energy Y/10, pacing)` (label dedup when `label === type`), COPY (hook variants, captions with newline collapse + 200-char Instagram truncation, hashtags). META section deliberately omitted per review. 45k char cap. `⚠️ FALLBACK` prefix when `match_score < 0.5` or `match_rationale` starts with `"Fallback:"`.
7. `d3818f1` feat(planning): write formatted full_brief to jobs on planning completion
   - `src/workers/pipeline.ts::processPlanningJob` and `src/agents/context-packet.ts::planJob`: compute `formatFullBrief(contextPacket)` inside try/catch right after `buildContextPacket()` returns, add `full_brief` to the update payload. Catch swallows formatter errors to `"(format failed: ...)"` string so a brief-dump bug can never fail planning.

## Side quests resolved
- **S1 runaway loop**: n8n S1 filter misfired every 30s on a sticky cell, created 23 duplicate jobs (not 14 as initially estimated) for idea seed `"pilates execises for booty"`. S1 was deactivated, planning queue obliterated via `src/scripts/drain-planning-queue.ts` (untracked one-off).
- **BullMQ drain pattern**: `drain-planning-queue.ts` uses `createQueue(QUEUE_NAMES.planning)` from `src/config/redis.ts` + `queue.obliterate({ force: true })`. Kept untracked for future reuse.
- **Migration runner bootstrap**: Supabase's hosted PostgREST can't execute arbitrary DDL. Bootstrapped `apply_migration_sql(query text)` RPC (SECURITY DEFINER, restricted search_path, service_role-only EXECUTE). All future DDL now goes through `npx tsx src/scripts/apply-migration.ts <filename>`.
- **Migration 005 DROP FUNCTION fix**: `CREATE OR REPLACE FUNCTION` silently ignores return-type changes. Fix committed pre-session as `f229fe2`: DROP first, then CREATE, then `NOTIFY pgrst, 'reload schema'`. Codified as Architecture Rule 22 in CLAUDE.md.
- **Google Sheets apostrophe escape in n8n code node**: leading `'` forces Sheets to treat the cell as literal text, preventing long `full_brief` strings from being interpreted as formulas/dates. Applied in S2's Sheet write step.
- **VPS → laptop branch transfer via git over SSH**: VPS lacks GitHub HTTPS creds, so `git push origin` from VPS fails. Workaround used today: push `chore/phase2-cleanup` fails → laptop pulls directly via `git fetch ssh://root@95.216.137.35/home/video-factory chore/phase2-cleanup` → laptop pushes to GitHub. Pattern now documented for future branch work.

## Production validation
- Test job `10e7612b-2a8f-4f68-ba19-1601c9a01d76` ("easy workouts for fit body") ran through the full new code path end-to-end at 10:58 UTC. `full_brief` auto-populated in DB and synced to sheet column G.
- Zod corrective retry fired on slot 1, caught "Expected object received array" Pro malformation, succeeded on retry, picked q=9 segment.
- No `[retry-llm]` noise — Anthropic and Gemini both healthy during the test window.
- Wall time ~4 min, matches prior V2 baseline (4.4 min from the Phase 2.5 benchmarks).
- Backfilled `full_brief` for the 5 pre-Step-7 jobs: `d74679d2`, `c70d18cf`, `246a45c7`, `a6988dbd`, `c83c31dc`. All populated successfully, lengths 2862–3450 chars.

## Known residual issues
- Google Sheets displays first few chars of Full Brief as raw text due to the leading apostrophe escape. Cosmetic, not functional.
- `feat/sub-clip-segmentation` branch still on origin as historical Phase 1 reference. Not blocking anything — preserved intentionally.
- Supabase anon key is hardcoded in n8n workflow exports and was pasted in today's session logs. Known risk, accepted, not rotating.
- VPS still lacks GitHub credentials. Branches and commits that need to reach origin go laptop-mediated (via `ssh://` pull or bundle).

## What's next
- Phase 3 planning: Creative Director archetype (`calm-instructional`, `high-energy-listicle`, `transformation-story`, `tip-stack`, `before-after`, `myth-buster`), variable `slot_count` (3–8), per-slot `cut_style`/`duration_target_s`/`energy_level`; 2–3 Remotion template variants per video type; pre-normalization at ingestion to drop clip prep from 6–17 min → ~1 min. Target 7+/10 sustained.
- Content ingestion sprint: 15–20 more nordpilates ab/core UGC clips to break the library content ceiling surfaced by the first V2 production video. Waiting on head of creatives.
