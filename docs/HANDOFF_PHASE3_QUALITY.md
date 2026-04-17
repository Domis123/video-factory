# Handoff — Video Factory, Phase 3 Quality Iteration

## Who you are talking to

Domis (Dominykas Auglys). Lithuanian, Vilnius. Operates a multi-brand digital business spanning health/wellness/fitness apps. You're his task curator and project manager. The agent on his VPS executes code; he's the debugger/tester pushing changes through.

Three-person loop: Domis is operator + tester. You write briefs and review work. The agent (separate Claude instance with VPS SSH access) executes code on the server.

## What happened in the session that just ended

**W2, W3, W4 all shipped in a single day.** Phase 3 is live. First Phase 3 video rendered end-to-end. Timeline:

1. W2 (Curator V2 update) — merged to main as `68441bc`
2. W3 (Copywriter update) — merged to main as `7e381e4`
3. W4 (Remotion parameterized composition) — merged to main as `d92d601`
4. Hotfix: transcriber crash on video-only clips — merged as `57791f6`
5. Hotfix: CTA white-on-white text — merged as `9b377ea` (pushed, needs merge + deploy)
6. `ENABLE_PHASE_3_CD` flipped to `true` on VPS
7. Two test jobs submitted. Second one rendered successfully:
   - Job `fe34b673-4257-4ee3-8f65-aab0a1efa490` — workout-demo, 5 slots, golden-hour color
   - Full pipeline: planning → brief_review → clip_prep → transcription → rendering → audio_mix → sync_check → platform_export → auto_qa
   - Three platform exports: TikTok (33.6MB), Instagram (15.1MB), YouTube (41.9MB)
   - Auto QA: PASSED

## Current state of the codebase

**On main (deployed to VPS):**
- All Phase 3 workstreams shipped (W1-W5)
- `ENABLE_PHASE_3_CD=true` on VPS
- Transcriber no-audio hotfix deployed
- CTA color fix **NOT yet deployed** — branch `hotfix/cta-overlay` pushed at `9b377ea`, needs merge from Mac + VPS redeploy

**Pending merge (do this first next session):**
```bash
cd ~/Documents/video-factory
git fetch origin
git checkout main
git merge --squash origin/hotfix/cta-overlay
git commit -m "fix(overlay): CTA text rendering - use brand cta_bg_color and cta_text_color"
git push origin main
# Then on VPS:
cd /home/video-factory && git pull origin main && npm run build && sudo systemctl restart video-factory
```

## Feature flag state

| Flag | Current | Notes |
|---|---|---|
| ENABLE_CURATOR_V2 | true | Live since 2026-04-13 |
| ENABLE_PHASE_3_CD | **true** | Flipped 2026-04-17 |
| ENABLE_BEAT_SYNC, ENABLE_COLOR_GRADING, ENABLE_MUSIC_SELECTION | true | |
| ENABLE_AUDIO_DUCKING, ENABLE_CRF18_ENCODING | true | |
| ENABLE_DYNAMIC_PACING | false | post-MVP |

## The primary problem to solve: clip selection quality

### What the operator observed

First Phase 3 render (workout-demo, "quick morning pilates stretch"):

1. **Cat-cow stretch slot** → selected clip shows woman preparing/positioning, not performing cat-cow
2. **Child's pose with reach slot** → selected clip shows a completely different exercise
3. **Seated spinal twist slot** → incorrect exercise shown
4. **CTA slot** → same clip as hook (talking-head reuse — thin pool)
5. **Hook clip** → good content but cut off at 4s before speaker finishes sentence
6. **CTA text** → white on white (fixed in hotfix, not yet deployed)

### Root cause analysis

The clip selection problem has **four distinct layers**. Each needs a different fix:

#### Layer 1: Exercise name → visual match gap (HIGHEST IMPACT)

**The problem:** The CD generates specific exercise names ("cat-cow stretch", "spinal twist", "child's pose with reach"). The Curator searches for clips matching these descriptions. But:

- CLIP embeddings encode visual similarity from natural language — "cat-cow" as text doesn't map to a CLIP vector that represents what cat-cow looks like visually. CLIP was trained on image captions, not exercise terminology.
- Gemini Pro during curation sees segment metadata (description, tags, quality score) but NOT the actual video. It's making picks based on text descriptions, not visual verification.
- The library's segment descriptions (written by Gemini during ingestion) are generic: "woman doing core exercise on mat", "person stretching on yoga mat" — not "cat-cow stretch" or "child's pose."

**Potential fixes (in order of leverage):**

A. **CD prompt change — describe visuals, not exercise names.** Instead of "cat-cow stretch", the CD should write "hands-and-knees position, alternating between arching the back upward and dropping the belly downward." This gives CLIP and Gemini Pro much better signal to match against. Low code change, high impact. Modifies `src/agents/prompts/creative-director.md` only.

B. **Ingestion prompt enrichment — Gemini identifies specific exercises.** During segment analysis, prompt Gemini to label segments with specific exercise names when recognizable: "This segment shows a cat-cow stretch" vs "woman doing exercise." Enriches `asset_segments.description` and `asset_segments.tags`. Requires re-ingestion of the library (or a backfill script). Medium effort.

C. **Two-stage retrieval — CLIP rough filter + Gemini Pro visual verification.** After CLIP retrieval returns 15 candidates, have Gemini Pro actually watch the video clips (it already does this for the pick decision) but with an explicit instruction: "Does this clip show [exercise description]? If not, score 0." Already partially happening but the prompt doesn't emphasize exercise-specific matching.

D. **Curator prompt update — explicitly instruct against "preparation" clips.** Add to the curator prompt: "Reject clips that show only preparation/setup for an exercise. The clip must show the exercise being actively performed." Quick, targeted.

**Recommendation for next session:** Start with A (CD describes visuals) + D (curator rejects prep clips). These are prompt-only changes with zero code risk. Test with a new job. If still poor, add B (re-ingest with better descriptions).

#### Layer 2: Talking-head segment scarcity

**The problem:** Only ~6 talking-head segments in nordpilates library. Both hook and CTA slots request talking-head type. Dedup filter prevents exact reuse, but the pool is so thin that visually distinct picks aren't possible.

**Potential fixes:**

A. **More talking-head content.** Operator uploads face-to-camera clips. Simple but requires content production.

B. **CD prompt: allow CTA to use b-roll when talking-head pool is thin.** Fallback content_type for CTA slots. Medium prompt change.

C. **Curator: surface pool depth to Pro.** Tell Pro how many unique talking-head segments exist. If <5, Pro can recommend b-roll substitution.

**Recommendation:** A is the real fix. B is a good interim. C is nice-to-have.

#### Layer 3: Hook duration too short (4s for talking-head)

**The problem:** CD set `cut_duration_target_s: 4` for a hook with talking-head type and pacing: slow. 4 seconds is too short for someone to deliver a complete sentence.

**Fix:** One line in the CD prompt: "Hooks with content_type=talking-head must have cut_duration_target_s >= 7." Quick, surgical.

#### Layer 4: Full Brief display garbled ("SLOT undefined")

**The problem:** `formatFullBrief()` reads Phase 2 field names (`segment_id`, `duration_target`) which don't exist on Phase 3 segments. The actual brief data is correct — only the human-readable sheet display is garbled.

**Fix:** Update `formatFullBrief()` in `pipeline.ts` to handle Phase 3 segment shape (use `cut_duration_target_s`, slot index instead of `segment_id`). Cosmetic, not functional.

### Suggested fix order for next session

1. **Deploy CTA hotfix** (already coded, just merge + deploy)
2. **Layer 3: hook minimum duration** (1-line CD prompt fix)
3. **Layer 1A: CD describes visuals instead of exercise names** (prompt rewrite, moderate effort)
4. **Layer 1D: Curator rejects preparation clips** (prompt addition, small effort)
5. **Layer 4: formatFullBrief Phase 3 support** (cosmetic fix)
6. **Test with new job, different idea seed** (validate improvements)
7. **Layer 2B: CTA b-roll fallback** (if talking-head reuse is still an issue)

### What NOT to change (resist scope creep)

- No re-ingestion of the library (save for after prompt fixes are validated)
- No CLIP retrieval augmentation (deferred in W2, still deferred)
- No music library expansion (separate workstream)
- No async ingestion refactor (Milestone 3.3)
- No beat-locked music (Phase 4)

## Additional bugs/issues noticed during the session

### S8 UGC Ingest workflow issues
- `queryString: ".mov"` on List UGC Files node filters out .mp4 files — needs clearing to empty string
- Skip items (no brand prefix) flow to Send to VPS and crash with "binary file 'data' not found" — needs IF node filter
- Schedule named "Every 5min" but set to 15-min interval
- **Status: none fixed yet.** Operator renamed files with `NP_` prefix as workaround. S8 robustness fix is filed for later.

### Env cleanup
- Branch `chore/env-gemini-cleanup` already merged to main
- VPS production uses `gemini-3.1-pro-preview` for ingestion/curator
- Local dev fallbacks cleaned to `gemini-2.5-pro`
- No model family change (staying on current models)

### Music selection mismatch
- Morning pilates stretch (calm, gentle) got "Rock That Body" by Black Eyed Peas and "oooshxt!" by Samara Cyn
- Music selector picks closest energy match from 15-track library but doesn't have calm/gentle options
- **Not a code bug — library gap.** Need calm/ambient tracks added to `music_tracks`.

### Vibe column still missing from Sheet
- Filed in W1, still not done
- S1 workflow needs update to pass Vibe through
- Low priority until CD prompt variety improvements land

## Files to attach to the next chat

- This handoff doc
- `CLAUDE.md` (latest)
- `docs/VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`
- `docs/PHASE_3_DESIGN.md`
- `docs/SUPABASE_SCHEMA.md`
- Current CD prompt: `src/agents/prompts/creative-director.md`
- Current Curator prompt: `src/agents/prompts/asset-curator-v2.md`
- n8n workflow JSONs as relevant

## Architectural context for the clip selection fix

### How the current flow works

1. **CD** generates a brief with per-slot `clip_requirements`:
   - `content_type: ["exercise"]` — what segment type to filter on
   - `mood: "gentle"` — text-matched against segment descriptions
   - `visual_elements: ["mat work", "floor exercise"]` — also text-matched
   - `aesthetic_guidance: "soft morning light, close-up of movement"` — Phase 3 addition, flows to Pro prompt

2. **Curator dispatch** assembles a `slot.description` string by flattening the above into natural language

3. **CLIP retrieval** embeds `slot.description` → 512-dim vector, queries `match_segments` RPC → returns 15 candidates by cosine distance

4. **Gemini Pro picker** receives the 15 candidates (with their metadata: segment_type, description, tags, quality_score, editor_use) + the slot requirements + aesthetic_guidance + creative_vision. Picks the best match.

### Where it breaks

Step 1: CD writes "cat-cow stretch" — specific exercise name
Step 2: Dispatcher flattens to "exercise segment showing cat-cow stretch, mood: gentle"
Step 3: CLIP encodes this as a vector. "Cat-cow stretch" doesn't have a strong visual embedding because CLIP doesn't know yoga terminology well.
Step 4: Candidates returned are generic "exercise on mat" segments. Pro picks the best text match but doesn't see the actual video.

### The fix path

Step 1 (fix): CD writes "hands and knees position, alternating between arching back upward and dropping belly down" — visual description
Step 2: Same flattening, but now the description is visually grounded
Step 3: CLIP embedding for "arching back, hands and knees" maps better to visual content
Step 4: Pro gets better candidates and can make better picks based on description similarity

This doesn't require any code changes to the retrieval or curator system — it's purely a prompt improvement in how the CD describes what it wants.

## How to start the next session

1. Merge CTA hotfix if not done
2. Deploy to VPS
3. Ask Domis if he's reviewed the first video (he may have notes beyond what's captured here)
4. Start with the hook duration fix (Layer 3, quickest win)
5. Then the CD visual description prompt change (Layer 1A, highest impact)
6. Run a test job with a DIFFERENT idea seed to validate

## Tone and pacing

Same as always: warm, direct, professional. Get to the point. Use buttons for discrete choices. Big changes come as questions. Break work into testable steps. Agent briefs in fenced code blocks.

VPS path is `/home/video-factory` (not `~/video-factory` from root — discovered during deploy).
