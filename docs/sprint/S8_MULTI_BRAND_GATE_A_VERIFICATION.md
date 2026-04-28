# S8 Multi-Brand Ingestion Routing — Gate A Verification

**Date:** 2026-04-28
**Workstream:** S8 Multi-Brand Ingestion Routing chore
**Branch:** `chore/s8-multi-brand-ingestion-routing`
**Brief:** `docs/briefs/CHORE_S8_MULTI_BRAND_INGESTION_BRIEF_v2.md`
**Polish Sprint context:** Pillar 1 parked at `cebfc46` on `feat/polish-sprint-pillar-1-critic-calibration` (unmerged, 6 commits ahead) — resumes after this chore + Simple Pipeline ship.

---

## Agent-side verification (closed)

| Check | Method | Result |
|---|---|---|
| Pre-work audit complete | `docs/diagnostics/S8_R2_AUDIT_RESULTS.md` | ✓ Present; 27 missing brand_configs rows enumerated; 0 `NP/` R2 keys verified via direct ListObjectsV2 + paginated Supabase query. |
| R2 migration (no-op decision) | Audit doc Finding 2 + Decisions confirmed section | ✓ Skipped per operator decision; verification trail preserved. |
| Updated S8 JSON committed | `n8n-workflows/S8_UGC_Ingest_v2.json` | ✓ JSON parses cleanly; 33 prefix entries; 32 unique brand_ids; IF skip filter wired (true → Quarantine, false → VPS). |
| BRAND_MAP correctness | `node` JSON parse + entry count | ✓ 33 entries, 32 unique brand_ids (CL + CD both → cyclediet); no full-name fallback; no lowercased keys. |
| IF + Quarantine + Log nodes present | JSON inspection | ✓ Skip Filter (`n8n-nodes-base.if`, typeVersion 2), Move to Quarantine (Drive move to `1kTfzVzeyUms-rYSLSh9f7IPk_MlaN5Hi`), Log Quarantine (Sheets append to "Ingestion Log" tab). |
| `INGESTION_NAMING.md` written | File at `docs/INGESTION_NAMING.md` | ✓ Present; 33-prefix table, valid/invalid examples, post-ingestion walkthrough, troubleshooting. |
| VPS endpoint validation (c6) | `src/index.ts` /ugc-ingest patch | _will be filled in at c6 commit_ |

---

## Operator-side action checklist (open)

These steps run AFTER the chore is merged and deployed to the agent's branch. Order matters where noted.

### 1. Pre-flight setup (before importing the workflow)

- [ ] **Confirm Quarantine folder exists.** Already done. Folder ID embedded in v2 workflow: `1kTfzVzeyUms-rYSLSh9f7IPk_MlaN5Hi` (`https://drive.google.com/drive/folders/1kTfzVzeyUms-rYSLSh9f7IPk_MlaN5Hi`).
- [ ] **Verify the unified UGC source folder.** v2 workflow uses `1n0-vMRq0ckgAugGxUlOtY9e942ARpCyZ` (the existing nordpilates folder, repurposed as multi-brand). If a different folder is preferred, update the `Download UGC Folder Files` node's `fileId` post-import.
- [ ] **Verify the Processed folder.** v2 workflow uses `1IMQwMD902e2ps7UYZnz1RQhRs3ZEUIhN` (existing nordpilates Processed). Same — update post-import if a different folder is preferred.
- [ ] **Create the "Ingestion Log" tab** in the Video Pipeline spreadsheet (`1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`).
  - Columns (left to right): `Timestamp`, `Filename`, `Reason`, `Drive File ID`
  - The first row is the header; the workflow appends below it.

### 2. Import the v2 workflow

- [ ] **Back up the existing S8.** In the n8n web UI, open the existing S8 workflow → Save as → name it `S8 v1 (backup pre-multi-brand)`. Or export-to-JSON and save the file locally.
- [ ] **Import v2.** Open `n8n-workflows/S8_UGC_Ingest_v2.json` (from this branch / merged main). Use n8n's "Import from File" feature. Verify:
  - Service-account credential (`Flemingo service acc`, ID `AIqzMYUXoQjud7IW`) is auto-attached. If not, manually attach it on the Drive + Sheets nodes.
  - Schedule trigger interval = 5 minutes.
  - Send to VPS URL points at `http://95.216.137.35:3000/ugc-ingest`.
- [ ] **Disable the old S8.** In n8n, deactivate the v1 S8 workflow.
- [ ] **Activate v2.** Toggle the v2 workflow to active.

### 3. Smoke tests (operator drops files; agent + operator inspect Drive + Sheet + Supabase)

| # | Test | Expected behavior | Result |
|---|---|---|---|
| 7a | Drop `NP_test_001.mp4` (any small video; valid prefix) | Routes to Send-to-VPS path. Asset row in `assets` with `brand_id='nordpilates'`. File moves to Processed. NO Quarantine log entry. | _operator fills in_ |
| 7b | Drop `xyz_test_001.mp4` (unknown prefix) | Routes to Quarantine path. File moves to Quarantine folder. Log row appended to "Ingestion Log" with `Reason='unknown_prefix:xyz'`. NO asset row. | _operator fills in_ |
| 7c | Drop `nordpilates_test_001.mp4` (full-name; previously valid, no longer supported) | Routes to Quarantine. Log row with `Reason='unknown_prefix:nordpilates'`. NO asset row. This is the deliberate regression — full-name fallback is removed in v2. | _operator fills in_ |
| 7d | Drop `CM_test_001.mp4` (carnimeat — has brand_configs row) | Routes to Send-to-VPS. Asset row with `brand_id='carnimeat'`. File moves to Processed. | _operator fills in_ |
| 7e | Drop `KD_test_001.mp4` (ketoway — has brand_configs row) | Same shape as 7d but `brand_id='ketoway'`. | _operator fills in_ |
| 7f (optional) | Drop `CL_test_001.mp4` (cyclediet — NO brand_configs row yet) | Routes to Send-to-VPS. Asset row created with `brand_id='cyclediet'` even though `brand_configs` has no such row (per Decision 2 — lazy population, S8-routed ingestion is permissive). The asset is inert until `brand_configs` row is added. | _operator fills in_ |
| 7g (optional) | `curl -X POST http://95.216.137.35:3000/ugc-ingest -d 'test'` (no headers) | HTTP 400 `{"error":"Missing brand_id in header and filename"}`. Tests the existing endpoint guard, unchanged by c6. | _operator fills in_ |
| 7h (optional, post-c6) | `curl …` with filename `xyz_test.mp4` and no `x-asset-meta` (simulating non-S8 ingestion of an unknown prefix) | HTTP 400 unknown brand_id. Tests c6's filename-fallback validation. Pre-c6 this would silently 200. | _operator fills in_ |

7a–7e are the brief's required test plan. 7f–7h are optional but informative.

### 4. After tests pass

- [ ] Operator reports test results in chat.
- [ ] Agent runs the merge sequence (`git checkout main && git pull && git merge --no-ff chore/... && git push origin main && delete remote branch`). No VPS deploy needed unless c6 is included (in which case `npm install && npm run build && systemctl restart video-factory` per standard).
- [ ] Add a memory note for the next session that the unified UGC folder is now serving multiple brands (operator may rename the existing nordpilates folder to a brand-agnostic label, e.g., "UGC Drop").

---

## Rollback (if Gate A fails)

### Option A — n8n only (workflow is broken; v1 still works)

1. Operator deactivates v2 in n8n web UI.
2. Operator reactivates the v1 backup.
3. Files in Quarantine remain there until reviewed.
4. Agent investigates v2 JSON; ships v3 with fix.

### Option B — full revert

1. Agent reverts the chore merge:
   ```bash
   git checkout main
   git pull origin main
   git revert -m 1 <chore-merge-sha>
   git push origin main
   ```
2. Operator deactivates v2 + reactivates v1 in n8n (the JSON file revert removes the artifact, but v2 stays in n8n's database until operator deactivates).
3. If c6 was included, the VPS revert needs `git pull && npm install && npm run build && systemctl restart video-factory` to roll back the `/ugc-ingest` endpoint to its pre-chore behavior.
4. R2 was untouched (c2 was a no-op); no R2 rollback needed.

---

## Followups created or referenced by this chore

| ID | Status | Notes |
|---|---|---|
| `s8-brand-configs-lazy-population` | Active | Filed during c2. Operator activates `brand_configs` per brand on commit-to-ingest. Priority order: nordpilates (live) → cyclediet → carnimeat → nodiet. |
| `s8-cl-cd-prefix-consolidation` | Tracked in brief | Both `CL` and `CD` route to `cyclediet`. Future cleanup picks one canonical and retires the other. |
| `s8-vps-endpoint-validation` | Resolved by c6 (this chore) | Was named for in-chore vs followup decision; operator chose in-chore fix. |
| `s8-subject-group-tagging-future` | Tracked in brief | `<PREFIX>_<SUBJECT_TAG>_<description>` extension for subject-group resolution at ingestion. Out of scope for this chore. |
| `s8-quarantine-cleanup-policy` | Tracked in brief | When do quarantined files get permanently deleted? Currently they accumulate. |
| `r2-orphaned-NP-keys-cleanup` | Closed automatically | No `NP/` keys exist; nothing to clean up. |
| `s8-n8n-workflow-versioning` | Tracked in brief | n8n's actual state lives in n8n's database; this chore commits a JSON artifact but doesn't automate sync. |

---

## Final commit summary

| Commit | SHA | Scope |
|---|---|---|
| c1 | `30b0549` | pre-work audit + R2 prefix decision (audit doc) |
| c2 | `effd245` | R2 migration skipped (audit doc updated with verification trail + brand priority context); `s8-brand-configs-lazy-population` filed |
| c3 | `a1f8970` | updated S8 workflow JSON (`n8n-workflows/S8_UGC_Ingest_v2.json`) |
| c4 | `a900d9c` | `docs/INGESTION_NAMING.md` operator reference |
| c5 | _this commit_ | Gate A artifact + operator handoff (this file) |
| c6 | _next commit_ | VPS endpoint validation hardening (filename-fallback brand_id check) |

---

*Awaiting operator's post-import smoke-test results before merge.*
