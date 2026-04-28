# Ingestion Naming Convention

All UGC files dropped in the UGC Drive folder must follow:

    <PREFIX>_<description>.<ext>

Where `<PREFIX>` is one of the canonical brand prefixes (table below). Files without a recognized prefix are routed to the **UGC Quarantine** Drive folder, with the rejection reason logged in the "Ingestion Log" tab of the Video Pipeline spreadsheet. Files with valid prefixes are uploaded to the VPS, normalized, segmented, and indexed under the corresponding `brand_id`.

The S8 ingestion workflow polls the UGC folder every 5 minutes.

---

## Canonical prefix table (33 entries, 32 unique brand_ids)

| Prefix | Brand ID                | Brand Name                |
|--------|-------------------------|---------------------------|
| EF     | effecto                 | Effecto                   |
| LC     | lastingchange           | Lasting Change            |
| WB     | welcomebaby             | Welcome Baby              |
| ND     | nodiet                  | No Diet                   |
| CL     | cyclediet               | Cycle Diet                |
| HD     | highdiet                | High Diet                 |
| LD     | lastdiet                | Last Diet                 |
| BW     | brainway                | Brainway                  |
| WY     | walkingyoga             | Walking.Yoga              |
| GD     | greendiet               | Green Diet                |
| NH     | novahealth              | Nova Health               |
| MG     | moongrade               | Moongrade                 |
| OD     | offdiet                 | Off Diet                  |
| AT     | airdiet                 | Air Diet                  |
| CM     | carnimeat               | Carnimeat                 |
| NY     | nordyoga                | Nord Yoga                 |
| NP     | nordpilates             | Nord Pilates              |
| CD     | cyclediet               | Cycle Diet (alt prefix to CL) |
| NM     | nomorediet              | No More Diet              |
| KD     | ketoway                 | Ketoway                   |
| HY     | harmonydiet             | Harmony Diet              |
| KY     | koiyoga                 | Koi Yoga                  |
| ML     | menletics               | Menletics                 |
| RD     | raisingdog              | Raising Dog               |
| MW     | mindway                 | Mindway                   |
| NA     | nordastro               | Nordastro                 |
| NL     | nordletics              | Nordletics                |
| MP     | manifestationparadox    | Manifestation Paradox     |
| GL     | glpdiet                 | GLP Diet                  |
| CX     | cortisoldetox           | Cortisol Detox            |
| TA     | taiyoga                 | Taiyoga                   |
| FD     | flamediet               | Flame Diet                |
| LX     | liverdetox              | Liverdetox                |

**Note on `CL` and `CD`.** Both route to `cyclediet`. Either prefix works. If the team converges on one, the other can be retired in a future cleanup (followup `s8-cl-cd-prefix-consolidation`).

---

## Examples

**Valid:**
- `NP_morning_routine_001.mp4` → routes to `nordpilates`
- `CM_steakreview003.mov` → routes to `carnimeat`
- `KD_breakfast_002.mp4` → routes to `ketoway`
- `EF_demo001.mp4` → routes to `effecto`

**Invalid (Quarantined):**
- `nordpilates_xxx.mp4` — full names not supported; use `NP_` prefix
- `morning_routine.mp4` — no prefix
- `np_xxx.mp4` — lowercase prefix not supported (canonical is uppercase only)
- `XX_xxx.mp4` — unknown prefix
- `xyz_test.mp4` — same; unknown prefix
- `noprefix.mp4` — no underscore at all

---

## What happens after ingestion

For a valid file (e.g., `NP_morning001.mp4`):

1. S8 polls Drive folder, sees the file.
2. Prep Metadata node parses the prefix: `NP` → `brand_id='nordpilates'`.
3. File is sent to the VPS `/ugc-ingest` endpoint with `x-asset-meta` header containing `{ filename, brand_id, description }`.
4. VPS streams the file to local disk, runs `preNormalizeParent()` (1080×1920 30fps H.264), uploads raw + normalized to R2, and triggers Gemini Pro segment analysis.
5. Asset row + sub-clip segment rows are written to Supabase. CLIP embeddings + keyframe grids are generated.
6. S8 moves the file to the Processed folder.
7. Total wall time per file: 40s–15min depending on source length.

For a Quarantined file:

1. S8 polls Drive folder, sees the file.
2. Prep Metadata flags it `skip: true` with a reason (`no_prefix_underscore` or `unknown_prefix:<value>`).
3. S8 moves the file to the **UGC Quarantine** Drive folder.
4. A row is appended to the "Ingestion Log" Sheet tab with timestamp, filename, reason, and Drive file ID.

---

## Troubleshooting

**A file landed in Quarantine.**

1. Check the "Ingestion Log" tab in the Video Pipeline spreadsheet for the file and its rejection reason.
2. Common reasons:
   - `no_prefix_underscore` — filename has no `_` after a 2-char prefix. Rename to `<PREFIX>_<description>.<ext>`.
   - `unknown_prefix:XX` — the 2-char prefix isn't in the canonical table. Either correct the prefix or, if you're adding a new brand, add the entry to the BRAND_MAP in S8 (operator action, requires n8n workflow update).
3. After renaming, move the file from the Quarantine folder back to the UGC drop folder. It will be picked up on the next S8 cycle (within 5 min).

**A file uploaded but I can't find it in the renderer pipeline.**

- Check that the brand has a row in `brand_configs`. If `brand_id='cyclediet'` (for example) is being ingested but `brand_configs` has no `cyclediet` row yet, the asset is stored but not yet renderable. Add the `brand_configs` row when committing to ingest + render for that brand.

**S8 cycle is slow / files sit in Drive a while.**

- S8 polls every 5 minutes, so a worst-case wait is 5 min before pickup. Total processing time per file is 40s–15min depending on source length. A long video may make subsequent files in the cycle wait while the VPS processes one at a time (the VPS has a single-flight ingest lock to prevent OOM).

**A file I uploaded to the brand's old per-brand folder didn't get ingested.**

- All UGC now drops into a SINGLE Drive folder. Per-brand folders are deprecated. Move the file to the unified UGC folder; it will be picked up on the next cycle.

---

## Future: subject identity in filename

A future filename convention may extend to:

    <PREFIX>_<SUBJECT_TAG>_<description>.<ext>

Where `SUBJECT_TAG` is an operator-chosen short identifier for the same person across multiple files (e.g., `sarah`, `lina`). This enables `subject_group_id` resolution at ingestion, which Part B's Coherence Critic can use to enforce subject-continuity across slots. Tracked as followup `s8-subject-group-tagging-future`. Not active in current S8.

---

*Updated 2026-04-28 with the S8 v2 multi-brand routing chore. Source-of-truth artifact: `n8n-workflows/S8_UGC_Ingest_v2.json`.*
