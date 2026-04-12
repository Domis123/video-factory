# Agent Task Brief — Ingestion Overhaul (Week 2, Phase 1)

**Project:** video-factory
**Target branch:** `feat/sub-clip-segmentation`
**Estimated agent work:** 4–6 working sessions across 3 days
**Author:** orchestration assistant, 2026-04-12
**Owner:** Domis (will deploy each phase manually after agent push)

---

## TL;DR

The Asset Curator currently picks from ~54 lossy tag-summarised assets, can only "see" them through text, and has no way to choose between visually similar candidates. This caps quality at 5–6/10 no matter how good the prompts get. **We are rebuilding ingestion to produce sub-clip segments with rich Gemini Pro descriptions and CLIP embeddings, stored in a new `asset_segments` table that the curator queries semantically.**

This brief covers **only Phase 1: ingestion + database**. The curator overhaul (Phase 2) and renderer adjustments (Phase 3) are separate briefs that come after this lands.

**Non-negotiable:** the existing pipeline must keep working through the entire transition. Don't drop the `assets` table. Don't change the curator yet. Don't touch the renderer. This phase ends when sub-segments exist in the database alongside the current assets, with no behavioural change to video production.

---

## Current State (what works, do not break)

- `assets` table: 54 nordpilates rows, each = one ingested file with one Gemini Flash description, one tag list, one quality score.
- `POST /ugc-ingest` accepts a streamed video + `x-asset-meta` header, downscales >50MB clips to 720p for Gemini, calls Gemini Flash, writes one row to `assets`, uploads to R2.
- The Asset Curator queries `assets` and returns 5 picks per video. It works. Don't touch it in this phase.

---

## Goal of Phase 1

After this phase ships:

1. A new `asset_segments` table exists in Supabase with the schema below.
2. `pgvector` extension is enabled in Supabase.
3. A self-hosted CLIP embedding helper exists in `src/lib/clip-embed.ts` and can be called from any worker.
4. The `/ugc-ingest` endpoint produces both the legacy `assets` row **and** N new `asset_segments` rows per uploaded file.
5. A standalone backfill script re-processes the existing 54 nordpilates clips into segments without re-uploading source files.
6. The pipeline still produces videos exactly as before, because the curator hasn't been touched yet.

The Asset Curator will start using this data in Phase 2.

---

## Phase 1 Work Breakdown

### Step 1 — Enable pgvector + create `asset_segments` table

**Where:** Supabase SQL editor (Domis runs this manually, you produce the migration file at `src/scripts/migrations/001_asset_segments.sql`).

**Schema:**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE asset_segments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  brand_id              TEXT NOT NULL,
  segment_index         INT  NOT NULL,                    -- ordinal within parent
  start_s               NUMERIC(7,3) NOT NULL,            -- trim window start in source
  end_s                 NUMERIC(7,3) NOT NULL,            -- trim window end in source
  duration_s            NUMERIC(7,3) GENERATED ALWAYS AS (end_s - start_s) STORED,

  description           TEXT NOT NULL,                    -- one rich sentence
  visual_tags           TEXT[] NOT NULL DEFAULT '{}',     -- 5–10 tags
  best_used_as          TEXT[] NOT NULL DEFAULT '{}',     -- ['b-roll','demo','hook','transition','establishing']
  motion_intensity      INT  NOT NULL CHECK (motion_intensity BETWEEN 1 AND 10),
  recommended_duration_s NUMERIC(5,2),                    -- editor's hint, not enforced
  has_speech            BOOLEAN NOT NULL DEFAULT false,
  quality_score         INT  CHECK (quality_score BETWEEN 1 AND 10),

  keyframe_r2_key       TEXT,                             -- R2 path to extracted JPG
  embedding             VECTOR(512),                      -- CLIP ViT-B/32 = 512 dims

  ingestion_model       TEXT NOT NULL,                    -- e.g. 'gemini-2.5-pro'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(parent_asset_id, segment_index)
);

CREATE INDEX asset_segments_brand_idx       ON asset_segments(brand_id);
CREATE INDEX asset_segments_parent_idx      ON asset_segments(parent_asset_id);
CREATE INDEX asset_segments_embedding_idx
  ON asset_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Permissive RLS to match existing pattern
ALTER TABLE asset_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all on asset_segments" ON asset_segments
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

**Validation:**
- Run the migration in Supabase SQL editor.
- `SELECT * FROM pg_extension WHERE extname = 'vector';` returns one row.
- `\d asset_segments` shows the table.
- `INSERT` a dummy row with a random embedding to verify the type round-trips.

**Non-negotiables:**
- Use `VECTOR(512)`, not 768. CLIP ViT-B/32 is 512-dim. If you switch to a different CLIP variant later, do a separate migration.
- Don't drop or alter the `assets` table.
- Don't add foreign keys to anything that doesn't already exist.

---

### Step 2 — Self-hosted CLIP embedder

**File:** `src/lib/clip-embed.ts`

**Approach:** use `@xenova/transformers` (HuggingFace's ONNX runtime for Node). It runs CLIP ViT-B/32 in pure JS, no Python sidecar, no GPU, ~1.2s per image on CX32. Install:

```bash
npm install @xenova/transformers
```

**API surface:**

```ts
export async function embedImage(buffer: Buffer): Promise<number[]>;  // 512 floats
export async function embedText(text: string): Promise<number[]>;     // 512 floats
```

Both functions cache the loaded model in module scope so the first call is slow (~5s model download on first run, cached to disk after) and subsequent calls are fast.

**Implementation notes:**
- Use `Xenova/clip-vit-base-patch32` model.
- Image input: pass a Sharp-resized 224×224 RGB buffer to the processor.
- L2-normalize the output vector before returning (so cosine similarity works as dot product).
- Surface a clear error if model load fails — don't silently fall back to zeros.

**Validation script:** `src/scripts/test-clip.ts`
- Embed the same text twice → cosine similarity should be 1.000.
- Embed two semantically related strings ("woman doing yoga" / "person on yoga mat") → similarity > 0.85.
- Embed a sample keyframe + matching text → similarity > 0.25 (CLIP cross-modal scores are lower than within-modality).
- Print all three results, exit 0 on success.

Run on the VPS: `npm run test:clip`

**Non-negotiables:**
- No OpenAI/Cohere/Voyage embedding APIs. Self-hosted only. Cost is zero, latency is acceptable, and we're not adding another vendor.
- Model files cached under `/home/video-factory/.cache/transformers/` — add to `.gitignore`.
- The embedder must not crash the Node process if the model file is corrupted; it should throw a typed error the caller can handle.

---

### Step 3 — Gemini Pro segment-list ingestion

**File to edit:** `src/lib/gemini.ts` (or create `src/lib/gemini-segments.ts` alongside it — your call, but keep the existing `analyzeClip()` function intact for backward compatibility).

**New function:**

```ts
export interface SegmentAnalysis {
  start_s: number;
  end_s: number;
  description: string;
  visual_tags: string[];
  best_used_as: string[];     // subset of ['b-roll','demo','hook','transition','establishing','talking-head']
  motion_intensity: number;   // 1–10
  recommended_duration_s: number;
  has_speech: boolean;
  quality_score: number;      // 1–10
}

export async function analyzeClipSegments(
  videoPath: string,
  durationSeconds: number,
  brandContext: string
): Promise<SegmentAnalysis[]>;
```

**Model:** `gemini-2.5-pro` (verify the exact ID against the @google/generative-ai SDK version installed; do not use Flash).

**Prompt** (store at `src/agents/prompts/segment-analyzer.md`, load with fs.readFileSync at startup):

```
You are a video editor cataloguing UGC footage for a short-form social
media production pipeline. You will receive ONE video clip and a brand
context.

Your job: identify every distinct visual segment where the shot, action,
or framing meaningfully changes, and describe each one as a reusable unit
that an editor could later drop into a finished video.

REQUIREMENTS:
- Aim for 3–10 segments per minute of source. Fewer if the video is one
  continuous shot. More if it's a fast-cut sequence.
- Each segment must be at least 2 seconds long. Never split a continuous
  action mid-motion (e.g. don't cut a single squat in half).
- Segments may not overlap. They must cover the source contiguously where
  possible — gaps are allowed only if footage between segments is unusable.
- For each segment, return:
  - start_s, end_s (numbers, decimal seconds, both > 0)
  - description: ONE rich sentence describing what is visually happening,
    the framing (close-up / medium / wide), the lighting/setting, and any
    notable detail an editor would care about
  - visual_tags: 5–10 single-word or hyphenated tags
  - best_used_as: pick 1–3 from ['b-roll','demo','hook','transition',
    'establishing','talking-head']. 'demo' = teaches a movement.
    'b-roll' = ambient cutaway. 'hook' = visually arresting opener.
    'transition' = brief connecting moment. 'establishing' = sets a scene.
    'talking-head' = person speaking to camera.
  - motion_intensity: 1 (static) to 10 (high motion)
  - recommended_duration_s: how long you'd actually USE this in a finished
    edit (often shorter than end_s − start_s)
  - has_speech: true if you can hear someone speaking words
  - quality_score: 1–10 based on framing, lighting, focus, and editability

BRAND CONTEXT (use this to tune which details matter):
{brandContext}

OUTPUT FORMAT: Return ONLY a JSON array of segment objects. No prose,
no markdown fences, no commentary. The first character of your response
must be `[` and the last must be `]`.
```

**Implementation notes:**
- Upload the video file to Gemini using the File API (not inline base64 — files >20MB will fail). The `@google/generative-ai` SDK has `fileManager.uploadFile()`.
- After upload, poll until `state === 'ACTIVE'` before sending the prompt.
- Pass `responseMimeType: 'application/json'` in `generationConfig` to force JSON output.
- Set `temperature: 0.2` for consistency.
- After parsing, validate every segment with a Zod schema. Drop segments that fail validation, log a warning, but don't fail the whole ingestion.
- Clamp `end_s` to `durationSeconds`.
- Sort by `start_s` ascending and re-assign `segment_index` sequentially.

**Cost note:** Gemini 2.5 Pro at ingestion is ~$0.05–0.10 per minute of video analysed. For 54 existing clips averaging 30s each, the backfill cost is ~$1–2 total. Going forward at 100 clips/month, ~$5/month. Document this in the architecture file (already updated).

**Validation:**
- `npm run test:segment-analyzer -- /path/to/sample.mov` prints the segment array.
- Manually inspect: do segments add up roughly to source duration? Do descriptions read like a real human editor wrote them? Are `best_used_as` tags varied (not all "b-roll")?

**Non-negotiables:**
- Don't pass `gemini-1.5-flash` or `gemini-1.5-pro`. Use 2.5 Pro.
- Don't fall back to Flash on Pro failure — fail loudly. Quality matters here, silent fallback hides regressions.
- Don't reuse the existing `analyzeClip()` function as a base. Build the segment version cleanly. The existing function stays intact for the legacy `assets` row write.

---

### Step 4 — Keyframe extraction + embedding

**File:** `src/lib/keyframe-extractor.ts`

**Function:**

```ts
export async function extractKeyframe(
  videoPath: string,
  timestampSeconds: number,
  outPath: string
): Promise<void>;
```

**Implementation:** ffmpeg single-frame extract at the midpoint of each segment:

```
ffmpeg -ss {midpoint} -i {videoPath} -vframes 1 -q:v 2 {outPath}
```

Use the segment midpoint, not the start, to avoid catching motion blur on cut boundaries.

**Then in the ingestion worker:**
1. For each segment from Gemini, extract keyframe to `/tmp/video-factory/keyframes/{uuid}.jpg`.
2. Read the file as a buffer.
3. Call `embedImage(buffer)` from the CLIP helper.
4. Upload the keyframe to R2 at `keyframes/{brand_id}/{segment_uuid}.jpg`.
5. Insert the segment row with both `keyframe_r2_key` and `embedding` populated.

**Non-negotiables:**
- Don't store keyframes locally on the VPS long-term. Upload to R2 and delete the temp file.
- Use `-q:v 2` (high quality JPG) — these get used for visual debugging.
- Embedding must be the L2-normalized 512-float vector from the CLIP helper, formatted as a Postgres `vector` literal: `'[0.123,0.456,...]'`. The `pg` driver does not auto-cast number arrays to vector.

---

### Step 5 — Wire it into `/ugc-ingest`

**File to edit:** `src/workers/ingestion.ts` (or wherever the current `/ugc-ingest` handler lives).

**New flow inside the existing handler, after the legacy `assets` row is written:**

```
1. Call analyzeClipSegments(localVideoPath, duration, brandContext)
2. For each returned segment:
     a. Extract keyframe at midpoint
     b. Embed keyframe with CLIP
     c. Upload keyframe to R2
     d. Insert asset_segments row
3. Log total segment count
4. Continue with the existing R2 upload + Drive move logic
```

**Critical:** wrap segment processing in a try/catch that logs errors but does NOT fail the ingestion. If segment analysis fails, the file still gets ingested as a legacy `assets` row and the operator can re-run segmentation later via the backfill script. We don't want to break ingestion of new clips because Gemini Pro had a bad day.

**Non-negotiables:**
- The legacy `assets` row write happens FIRST and is independent of segmentation.
- Segments use the `parent_asset_id` from that legacy row.
- Don't change the request/response format of `/ugc-ingest`. n8n S8 should keep working without modification.

---

### Step 6 — Backfill script for existing 54 clips

**File:** `src/scripts/backfill-segments.ts`

**Behaviour:**

```
1. Query all assets rows that don't yet have any asset_segments children.
2. For each:
     a. Download the source file from R2 to /tmp
     b. Run analyzeClipSegments + keyframe extract + CLIP embed
     c. Insert asset_segments rows
     d. Delete /tmp file
     e. Log progress: "[backfill] Processed N/54 clips, M segments created"
3. On any per-clip failure: log, skip, continue.
4. Print summary at end: total clips processed, total segments created,
   total skipped, total cost estimate.
```

**Run command:** `npm run backfill:segments`

**Idempotency:** the script must be safe to run twice. Step 1 above (filtering by absence of children) ensures this.

**Non-negotiables:**
- Process clips serially, not in parallel. Gemini Pro rate limits + memory budget on CX32.
- Sleep 2s between clips to be polite to the Gemini API.
- Print a per-clip cost estimate so Domis can sanity-check before the script finishes.

---

## Acceptance Criteria for Phase 1

Phase 1 is done when ALL of the following are true:

1. ✅ `pgvector` extension installed in Supabase.
2. ✅ `asset_segments` table exists with the exact schema above.
3. ✅ `npm run test:clip` passes all three checks (text-text identity, text-text similarity, text-image cross-modal).
4. ✅ `npm run test:segment-analyzer -- sample.mov` returns a sensible segment list with descriptions a human editor would recognize as accurate.
5. ✅ Uploading a NEW clip via S8 produces both a legacy `assets` row AND multiple `asset_segments` rows with embeddings populated.
6. ✅ `npm run backfill:segments` re-processes the existing 54 nordpilates clips and creates 150–500 segment rows total.
7. ✅ The next end-to-end video render still produces the same output it did before — Phase 1 must not change the video output. The curator is unchanged. This is the integration safety net.
8. ✅ A vector similarity test query returns sensible results:
   ```sql
   SELECT id, description, embedding <=> (
     SELECT embedding FROM asset_segments WHERE id = '<some-id>'
   ) AS distance
   FROM asset_segments
   ORDER BY distance ASC
   LIMIT 5;
   ```
   The top results should be visually/semantically similar to the query segment.

---

## Out of Scope for Phase 1 (don't do these yet)

- ❌ Changing the Asset Curator. That's Phase 2.
- ❌ Changing the Creative Director or adding the archetype field. That's Phase 2.
- ❌ Variable clip count in Remotion. That's Phase 3.
- ❌ Pre-normalizing clips at ingestion. Separate optimization, separate brief.
- ❌ Replacing Gemini Flash for the legacy `assets` row. Keep Flash there until we're sure Pro segments are good enough to fully retire the legacy field.
- ❌ Re-tagging existing assets rows. The legacy fields stay as they are.

---

## Deployment Sequence (Domis runs these)

1. Review the migration file the agent produces.
2. Run the migration in Supabase SQL editor.
3. `git pull && npm install && npm run build && systemctl restart video-factory`
4. `npm run test:clip` on the VPS.
5. `npm run test:segment-analyzer -- /home/video-factory/test-clip.mov`
6. Upload a new test clip via S8 manually, verify both legacy and segment rows appear.
7. `npm run backfill:segments` (will take ~30–60 min for 54 clips).
8. Run the vector similarity sanity query above.
9. Render one more video end-to-end. It should look identical to the previous run because the curator hasn't been touched.
10. If everything is green → Phase 1 complete. Move to Phase 2 brief.

---

## Estimated Cost Impact

| Item | One-time | Recurring |
|---|---|---|
| Supabase pgvector | $0 | $0 (free tier) |
| CLIP self-hosted | $0 | $0 |
| Gemini 2.5 Pro backfill (54 clips) | ~$2 | – |
| Gemini 2.5 Pro per new clip | – | ~$0.05–0.10 each |
| R2 keyframe storage | $0 | <$0.10/mo |
| **Phase 1 total** | **~$2** | **~$5/mo at 100 clips/mo** |

---

## Communication Protocol

- Agent commits to `feat/sub-clip-segmentation` branch, PR to `main` only after Domis confirms Step 7 of acceptance.
- Agent flags when SSH/VPS access is needed — Domis runs those commands.
- Agent does NOT write production environment variables. Domis edits `.env` manually.
- Each phase milestone (Steps 1–6) gets a separate commit with a clear message so we can bisect if anything regresses.

---

End of Phase 1 brief.
