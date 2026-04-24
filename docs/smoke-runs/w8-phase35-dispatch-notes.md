# W8 Pre-work — Phase 3.5 dispatch architecture + W8 integration notes

**Commit 1 of `feat/phase4-w8-orchestrator`.** Pre-work required before any W8 code lands.
Scope set by `docs/W8_ORCHESTRATOR_BRIEF.md` § "Gate A pre-work (required before any code)".

This document captures:
1. How Phase 3.5 dispatch works today (text diagram).
2. Exact integration point where W8 attaches (BullMQ planning worker).
3. Phase 3.5 invariants that W8 MUST NOT break.
4. Verification results on Remotion null-safety for `voiceover_script`.
5. Verification on `brand_configs.pipeline_version` column status.
6. `LibraryInventory` / `LibraryInventoryV2` type import path result (naming discrepancy flagged).
7. Conventions inherited from `asset-curator-dispatch.ts`.
8. Naming conflict scan for new W8 files.

---

## 1. Phase 3.5 dispatch architecture (today)

```
[n8n S1 workflow] polls Jobs sheet every 30s
      │
      ▼
[n8n creates jobs row in Supabase, status=queued]
      │
      ▼
[n8n HTTP POST /enqueue { queue: 'planning', jobId }]  →  VPS port 3000
      │
      ▼
[src/index.ts Express handler pushes to BullMQ queue 'planning']
      │
      ▼
[BullMQ planningWorker — concurrency: 1 (API rate limits)]
  src/index.ts:22-29
      │
      ▼
[await runPlanning(jobId)]        src/workers/pipeline.ts:42
      │  ├─ fetch job + brand_config from Supabase
      │  ├─ transition jobs.status: queued → planning  (atomic CAS)
      │  ├─ buildContextPacket(job, brand)             src/agents/context-packet.ts
      │  │    │
      │  │    ├─ generateBrief dispatcher              creative-director-dispatch.ts
      │  │    │    ├─ ENABLE_PHASE_3_CD=true → generateBriefPhase3 (Sonnet)
      │  │    │    └─ ENABLE_PHASE_3_CD=false → generateBriefPhase2 (Sonnet legacy)
      │  │    ├─ curateAssets dispatcher               asset-curator-dispatch.ts
      │  │    │    ├─ 'creative_direction' in brief → V2 (Gemini Pro)
      │  │    │    └─ else → V1 legacy (Sonnet)
      │  │    ├─ generateCopy (inline Phase 3 branch)  copywriter.ts
      │  │    ├─ select music track                    music-selector.ts
      │  │    └─ merge into immutable Context Packet
      │  │
      │  ├─ write full_brief text + context_packet jsonb to jobs row
      │  └─ transition jobs.status: planning → brief_review  (CAS)
      ▼
[worker returns]  BullMQ job completes  →  operator sees brief in Sheet
```

Error path inside `runPlanning`:
`planning → failed` (atomic CAS), error logged to job_events via transitionJob.

After approval (`brief_review → queued`), S2 workflow enqueues to `rendering` queue; `runRenderPipeline(jobId)` in `src/workers/pipeline.ts:125` drives clip_prep → transcription → rendering → audio_mix → sync_check → platform_export → auto_qa → human_qa.

---

## 2. W8 integration point

**Where:** BullMQ planning worker handler in `src/index.ts:22-29`.
**Pattern:** fire-and-forget dispatch **after** the awaited `runPlanning(jobId)`.

```ts
// src/index.ts  (current)
const planningWorker = createWorker(
  QUEUE_NAMES.planning,
  async (job: BullJob<{ jobId: string }>) => {
    console.log(`[worker:planning] Processing job ${job.data.jobId}`);
    await runPlanning(job.data.jobId);
  },
  { concurrency: 1 },
);
```

W8 modification (commit 10):

```ts
const planningWorker = createWorker(
  QUEUE_NAMES.planning,
  async (job: BullJob<{ jobId: string }>) => {
    console.log(`[worker:planning] Processing job ${job.data.jobId}`);
    await runPlanning(job.data.jobId);   // Phase 3.5: UNCHANGED

    // W8: fire-and-forget Part B shadow dispatch
    const flags = await computePipelineFlags(job.data.jobId);
    if (flags.runPartB) {
      runPipelineV2(job.data.jobId).catch((err) => {
        console.error(`[w8] Part B shadow failed for job ${job.data.jobId}:`, err);
        // Intentional: swallow. Phase 3.5 is source of truth during shadow.
      });
    }
  },
  { concurrency: 1 },
);
```

**Critical properties of the integration:**

- `runPlanning` is awaited first, transitions to `brief_review`, and the handler would historically return immediately after. Operator sees the Phase 3.5 brief in Sheet on Phase 3.5's normal cadence — W8 dispatch does not gate this path.
- `runPipelineV2` is NOT awaited. BullMQ considers the planning job complete when the handler resolves (immediately after Phase 3.5). Part B continues in the Node event loop.
- The `.catch()` is mandatory. An unhandled rejection on an unawaited promise would crash the process under Node's default unhandled-rejection behavior (depending on `--unhandled-rejections` flag). Explicit `.catch(log-only)` is the Phase 3.5 protection.
- `computePipelineFlags` reads env + brand + job state and returns the 3-tier composition result. Reads `process.env['PART_B_ROLLOUT_PERCENT']` live on every call, matching the live-flip convention from `asset-curator-dispatch.ts`.
- Concurrency stays at 1 (brief hard constraint: no BullMQ retuning). Part B fire-and-forget runs in-process alongside the next job's Phase 3.5 planning; acceptable because Part B's heavy steps are network-bound (Gemini / Sonnet) and its DB writes go to `shadow_runs`, not `jobs.context_packet`.

Alternative considered — a separate BullMQ queue `planning_shadow` for Part B — rejected because: (a) adds new queue to manage, (b) the 1-minute timing isolation isn't needed during shadow (failures are non-fatal), (c) in-process fire-and-forget keeps Phase 3.5 wall-time identical.

---

## 3. Phase 3.5 invariants W8 MUST NOT break

These are the invariants whose violation would cause Phase 3.5 production to regress. W8 has to protect all of them.

| Invariant | What would break it | W8 protection |
|---|---|---|
| `runPlanning` transitions `queued → planning → brief_review` atomically | Modifying `runPlanning` or its transition calls | W8 does not touch `runPlanning` or `pipeline.ts`. Rule 36 hard constraint #1. |
| Phase 3.5 brief is written to `jobs.context_packet` unchanged | W8 writing to `jobs.context_packet` | W8 writes to new `shadow_runs.context_packet_v2`, never to `jobs.context_packet`. |
| Operator sees brief in Sheet after Phase 3.5 completes (before Part B finishes) | Awaiting `runPipelineV2` instead of fire-and-forget | Fire-and-forget pattern is explicit in commit 10. |
| Phase 3.5 planning error path (`planning → failed`) surfaces the Phase 3.5 error | A Part B throw shadowing the Phase 3.5 error | `runPipelineV2(...).catch(log-only)` — Part B errors NEVER propagate to Phase 3.5 handler. |
| Render worker reads Phase 3.5 `context_packet` shape | Adding unexpected fields or nulls | W8 does not modify `context_packet`. Adds `pipeline_override` to `jobs` table but render worker doesn't read it. |
| BullMQ queue names and concurrency stable | Adding queues or re-tuning | W8 uses the existing `planning` queue; no new BullMQ queues; concurrency unchanged. |
| `brand_configs` existing columns unchanged | Migration 011 altering existing columns | Migration 011 is additive: ADD COLUMN `pipeline_version` with DEFAULT `'phase35'`. No ALTER on existing columns. |
| Service role key stays in use for worker DB writes | New code using anon key | `shadow-writer.ts` uses `supabaseAdmin` (service role). Matches existing worker pattern. |
| `brief_review` is the human handoff gate | W8 bypassing this gate | Part B revise-budget exhaustion routes to `brief_review` (same gate as rejection), with revise history in a new context field. Operator-facing contract unchanged. |
| Structured logging format stable for n8n P1 webhook | W8 emitting unexpected job_events | W8 emits new `event_type` values (`revise_slot_level_triggered` etc.) but keeps `from_status`/`to_status` populated per existing shape. P1 webhook is free to ignore unknown event types. |
| Atomic job-claim pattern via `.update(...).eq('status', fromStatus)` | Part B triggering a state transition that collides | Part B does NOT transition `jobs.status`. It writes to `shadow_runs` only. Phase 3.5 owns the `jobs.status` state machine. |

---

## 4. Remotion null-safety on `voiceover_script`

**Verification method:** `grep -rn 'voiceover_script' src/`.

**Result:** `voiceover_script` appears only in:

- `src/agents/prompts/copywriter-v2.md` — two mentions inside prompt text (instruction to emit `null`).
- `src/types/planner-output.ts:5` — comment.
- `src/types/copywriter-output.ts:12,69` — `z.null()` Zod schema placeholder (CopywriterOutput schema).
- `src/agents/copywriter-v2.ts:97,99,107,111,437,441` — Gemini responseSchema omission + post-parse null injection.

**NOT referenced in:**
- `src/templates/*.tsx` (Remotion compositions)
- `src/workers/renderer.ts` (render worker)
- Any Remotion composition registry entry

**Conclusion:** Remotion never reads `voiceover_script` today. The field is a W7-placed placeholder reserved for W10 voice wiring. No null-crash risk.

**Implication for W8 commit 9 (`render-prep.ts`):** the pre-enqueue guard is trivially satisfied today — nothing downstream of `prepareContextForRender` reads the field. The guard still ships defensively so that:
(a) if W10 wires voiceover and introduces a read path, the guard is in place and only needs its branch filled in;
(b) the test coverage in Tier 3 synthetic case #4 verifies the guard's contract (null-in → null-preserving-out) independent of downstream consumers.

The guard's implementation will be pass-through (preserve `null`) with a comment citing this pre-work verification. No field omission, no `""` injection, no schema mutation.

---

## 5. `brand_configs.pipeline_version` column status

**Verification method:**
- `docs/SUPABASE_SCHEMA.md` ⚠️ brand_configs section (dated 2026-04-20) lists 26 columns; `pipeline_version` is NOT among them.
- Source-side grep `pipeline_version|pipeline_override|part_b|shadow_runs` across `src/` → zero matches.
- Migrations directory `src/scripts/migrations/*.sql` → highest is `010_match_segments_v2.sql`; no migration touching `pipeline_version`.

**Conclusion:** `brand_configs.pipeline_version` does not exist. Migration 011 (commit 2) adds it.

Likewise `jobs.pipeline_override` does not exist — same migration adds it alongside `shadow_runs` table.

**Live-query verification deferred to migration apply time.** The Supabase CLI `supabase db push` / `apply-migration.ts` will surface a conflict if either column does exist unexpectedly. Source-based verification is high-confidence given the triple signal (schema doc + zero source refs + zero migration mentions), and the apply step is the final safety net.

**Migration 011 specifics (deferred to commit 2):**
```sql
ALTER TABLE brand_configs
  ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'phase35'
  CHECK (pipeline_version IN ('phase35', 'part_b_shadow', 'part_b_primary'));

ALTER TABLE jobs
  ADD COLUMN pipeline_override TEXT DEFAULT NULL;

CREATE TABLE shadow_runs ( ... );  -- per brief § shadow_runs table
```

All three ALTER + CREATE are additive. Rollback-safe: dropping the new columns and table does not affect Phase 3.5 code paths (W8-only readers).

---

## 6. `LibraryInventoryV2` type import path — naming discrepancy flagged

**Expected by brief:** `LibraryInventoryV2` type, imported into the Critic's `reviewStoryboard` signature.

**Actual state:**
- File: `src/agents/library-inventory-v2.ts` exists (W3, for Planner).
- File exports `getLibraryInventory(brandId: string): Promise<LibraryInventory>`.
- Type `LibraryInventory` is defined in `src/types/library-inventory.ts` via `z.infer<typeof LibraryInventorySchema>` — NOT named `LibraryInventoryV2`.
- There is also a sibling `src/agents/library-inventory.ts` (Phase 3.5 CD inventory) with a different shape.

**Decision:** in W8's Critic-signature change (commit 4), import from `src/types/library-inventory.ts` as:

```ts
import type { LibraryInventory } from '../types/library-inventory.js';
```

and use `LibraryInventory` as the parameter type. The `V2` suffix in the file name refers to the fact that this is the Planner-facing inventory (v2 segment-schema aware), not that the type itself is versioned.

This is NOT an escalation-triggering finding. The brief's `LibraryInventoryV2` reference is a nomenclature mismatch, not an extraction complexity. No "non-trivial extraction needed" — the type is a single clean import.

---

## 7. Conventions inherited from `asset-curator-dispatch.ts`

W8's `feature-flags.ts` (commit 6) inherits these patterns:

| Pattern | Source | W8 usage |
|---|---|---|
| **Live env reads, not cached.** `process.env['FLAG']` read on every dispatch call. | `asset-curator-dispatch.ts:L?` — `const useV2 = process.env['ENABLE_CURATOR_V2'] === 'true';` | `feature-flags.ts` reads `process.env['PART_B_ROLLOUT_PERCENT']` on every `computePipelineFlags` call. Enables live flag flips without process restart (for W9 ramp). |
| **Discriminator as structural check, not flag-based.** Phase 3 vs Phase 2 brief distinguished by `'creative_direction' in input.brief`, NOT by an env flag alone. | `asset-curator-dispatch.ts` | W8 reads `brand_configs.pipeline_version` from DB as the structural discriminator per job. Env var is the rollout percentage only — the eligibility check is DB-sourced. |
| **Dispatcher returns a discriminated union.** Downstream code must handle both branches. | Dispatch functions return phase-tagged results. | `computePipelineFlags` returns `{ runPartB: boolean; dualRun: boolean; reason: string }` — structural fields, not a boolean. Caller explicitly branches. |
| **Widened interface pattern for type compatibility.** `SegmentLike` widened so both phases' types satisfy it. | `asset-curator-dispatch.ts` | W8's state machine types (`src/types/orchestrator-state.ts`) use discriminated unions for state transitions; no widening needed here, but same "explicit shape, no any" discipline. |
| **Env var naming: `ENABLE_X=true` for booleans.** | `ENABLE_PHASE_3_CD`, `ENABLE_CURATOR_V2` | W8 does NOT use `ENABLE_PART_B` — rollout is a percentage (0-100), not a boolean. Env var name: `PART_B_ROLLOUT_PERCENT`. This is an extension of the convention, not a break. |
| **Config flags default OFF.** Architecture Rule 10. | All flags OFF by default. | `brand_configs.pipeline_version` default `'phase35'`. `jobs.pipeline_override` default NULL. `PART_B_ROLLOUT_PERCENT` default 0 (absent = 0). All three default to "Phase 3.5 only". |

Anti-pattern NOT inherited: caching flag results in module-scope. W9 will flip flags live in production; module-scope caching would require process restart. Live read is non-negotiable.

---

## 8. Naming-conflict scan for new W8 files

Brief requires naming-conflict guard at branch-start.

| New file | Conflict check | Result |
|---|---|---|
| `src/orchestrator/orchestrator-v2.ts` | `ls src/orchestrator/` | Directory does not exist. Clean. |
| `src/orchestrator/state-machine.ts` | same | Clean. |
| `src/orchestrator/feature-flags.ts` | same + `grep -r feature-flags src/` | Directory new. No existing `feature-flags.ts`. Clean. |
| `src/orchestrator/shadow-writer.ts` | same | Clean. |
| `src/orchestrator/revise-loop.ts` | same | Clean. |
| `src/orchestrator/render-prep.ts` | same | Clean. |
| `src/types/orchestrator-state.ts` | `ls src/types/orchestrator*` | No existing file. Clean. |
| `src/lib/segment-snapshot.ts` | `ls src/lib/segment-snapshot*` | No existing file. Clean. |
| `src/scripts/test-orchestrator.ts` | `ls src/scripts/test-orchestrator*` | No existing file. Clean. |
| `supabase/migrations/011_shadow_runs.sql` | `ls src/scripts/migrations/011*` | No existing 011. Migrations 001-010 present; 011 is next. Clean. |
| `docs/smoke-runs/w8-phase35-dispatch-notes.md` | this file | First W8 smoke-run doc. Clean. |
| `docs/smoke-runs/w8-gate-a-YYYYMMDD.txt` | n/a (post-smoke) | Date-suffixed; no conflict. |

**Migration file path note:** brief specifies `supabase/migrations/011_shadow_runs.sql` but existing convention in this repo is `src/scripts/migrations/NNN_*.sql` (applied via `src/scripts/apply-migration.ts`). Migration 011 will land at `src/scripts/migrations/011_shadow_runs.sql` to match existing convention, not a new `supabase/migrations/` directory. The brief text is a minor inconsistency, not a spec change.

---

## 9. Risk notes + escalation triggers NOT tripped

Checked against the brief's escalation list; none triggered in pre-work:

- ✅ Phase 3.5 dispatch pattern matches brief description — no hidden routing.
- ✅ Remotion has NO voiceover_script handling → null guard is trivial.
- ✅ `LibraryInventory` type is a single clean import; no extraction needed.
- ✅ Migration 011 columns don't pre-exist; additive migration is the right shape.
- ✅ Critic prompt token budget check deferred to commit 4 (library inventory payload known ~1-2K tokens per brief); will measure during Tier 2 Gate A.
- ✅ No merge conflicts anticipated on W2-W7 files — W8 only extends W6 (`critic-v2.ts` + prompt + `critic-verdict.ts`) and refactors W7 (`copywriter-v2.ts`) shapes, does not re-architect.

One minor discrepancy flagged (§6, §8 migration path) — neither rises to escalation.

---

## Summary

Pre-work complete. Branch creation is safe. Commit sequence can proceed as planned. Integration point confirmed as `src/index.ts` planning worker, fire-and-forget post-`runPlanning`. Phase 3.5 protected by three layers: (a) W8 code does not touch Phase 3.5 files, (b) `.catch()` on unawaited Part B promise, (c) Part B writes to `shadow_runs` only, never to `jobs.context_packet`.
