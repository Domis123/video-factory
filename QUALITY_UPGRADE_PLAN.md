# Video Quality Upgrade Plan

## Context

The pipeline works end-to-end but videos feel auto-generated. Before upgrading rendering quality, we need structural foundations: video type definitions per brand, richer source clip metadata, and a stocked music library. Quality upgrades then become parameterized per video type rather than universal.

**Key gaps identified:**
- `music_tracks` table is **completely empty** — no tracks loaded
- No video type matrix — all 30 brands use the same 3 templates with no structural differentiation
- No source clip metadata beyond Gemini tags (no color, motion, scene-cut data)
- No A/B performance tracking

---

## Phase 0: Video Type Matrix + Template Architecture

**Why first:** Everything downstream (pacing, transitions, energy curves, music) is parameterized by video type. Can't tune quality without defining what "good" looks like per type.

### 4 Video Types

| Video Type | Structure | Duration | Pacing | Music Energy | Brands |
|------------|-----------|----------|--------|-------------|--------|
| **workout-demo** | Hook → Exercise sequence (3-5 clips) → CTA | 30-45s | Fast cuts (1-3s), high energy | 7-9 | nordpilates, highdiet |
| **recipe-walkthrough** | Hook → Ingredients → Steps (2-4) → Final reveal → CTA | 40-60s | Medium holds (3-6s), steady build | 4-6 | ketoway, carnimeat |
| **tips-listicle** | Hook → Numbered tips (3-5) → CTA | 30-45s | Medium cuts (2-4s), rhythmic | 5-7 | all brands |
| **transformation** | Hook → Before footage → After reveal → CTA | 25-40s | Slow build → dramatic cut | 3→8 (arc) | nordpilates, nodiet, highdiet |

### Implementation

**New file:** `src/types/video-types.ts`
- Define `VideoType` enum and `VideoTypeConfig` interface with: segment structure, pacing profile (cuts/s range), energy curve (per-segment energy 1-10), transition preferences, typical duration range
- Export a `VIDEO_TYPE_CONFIGS` map

**New file:** `src/lib/video-type-selector.ts`
- Given `brand_id` + `idea_seed`, select the best video type
- Map brands to allowed video types in `brand_configs` (new field: `allowed_video_types: string[]`)

**Modified files:**
- `src/types/database.ts` — add `allowed_video_types` to `BrandConfig`, add `video_type` to `Job`
- `src/agents/prompts/creative-director.md` — replace generic template catalog with video type configs. Remove 5 unimplemented templates. The agent selects a video type first, THEN structures segments to match that type's pacing profile.
- `src/agents/creative-director.ts` — normalize `video_type` from response, validate against brand's allowed types

**New Remotion layouts (Phase 0B):**
- `src/templates/layouts/RecipeWalkthrough.tsx` — ingredient overlay → step-by-step with progress
- `src/templates/layouts/WorkoutDemo.tsx` — exercise name overlay, rep counter, fast transitions

**Modified:** `src/templates/Root.tsx` — register new compositions

---

## Phase 1: Ingestion Enrichment

**Why now:** Can't do color grading, intelligent clip sequencing, or visual flow without knowing source clip properties. This data feeds Phases 5 and 7.

**Modified file:** `src/workers/ingestion.ts` — add FFmpeg analysis alongside Gemini:

1. **Dominant color** — extract average color from sampled frames:
   ```
   ffmpeg -i clip.mp4 -vf "fps=1,scale=8:8" -frames:v 5 thumb_%d.png
   ```
   Average RGB values in Node.

2. **Motion intensity** — scene change frequency as proxy:
   ```
   ffmpeg -i clip.mp4 -vf "select='gt(scene,0.3)',metadata=mode=print" -f null -
   ```
   Count scene cuts / duration → low (<0.5/s) / medium / high (>1.5/s)

3. **Average brightness** — `signalstats` YAVG value

**New file:** `src/lib/clip-analysis.ts` — FFmpeg-based analysis functions

**Modified type:** `Asset` — add `dominant_color_hex`, `motion_intensity`, `avg_brightness`, `scene_cuts`

**Modified:** `src/agents/prompts/asset-curator.md` — instruct curator to use color/motion data for clip sequencing (color continuity, motion matching, shot variety)

---

## Phase 2: Beat-Synced Transitions

The single biggest perceptual quality win. Cuts on musical beats feel hand-edited.

**New file:** `src/lib/beat-detector.ts`
- Compute beat positions from `tempo_bpm`: `beat[i] = firstBeatOffset + (i * 60/bpm)`
- Detect first beat with FFmpeg silence detection
- Export `BeatMap` type + `snapToNearestBeat()` helper

**Modified files:**
- `src/types/database.ts` — add `BeatMap` type, add to `ContextPacket.music_selection`
- `src/templates/types.ts` — add `beatMap` to `TemplateProps`
- `src/templates/components/TransitionEffect.tsx` — accept `beatAlignedFrame`, add `beat-flash` and `beat-zoom` types
- All layouts — snap transition frames to nearest beat when available
- `src/workers/pipeline.ts` — pass beat map to renderer

Falls back to current fixed timing when no music is present.

---

## Phase 3: Dynamic Audio Ducking

Music dips under speech, rises in silent gaps. Professional audio mixing for zero cost.

**Modified file:** `src/lib/ffmpeg.ts` — replace `buildAudioMixCommand` with sidechain compressor:
```
[1:a]volume=0.30[music];
[0:a]agate=threshold=0.01:attack=5:release=50[gate];
[music][gate]sidechaincompress=threshold=0.02:ratio=6:attack=50:release=300[ducked];
[0:a][ducked]amix=inputs=2:duration=first[out]
```
Base volume 0.30 (ducking handles the rest). Attack 50ms, release 300ms for natural feel.

**Modified file:** `src/workers/audio-mixer.ts` — enable ducking, log config.

---

## Phase 4: Encoding Quality (CRF 18 + slow, NO 2-pass)

2-pass is wasteful for social media (platforms re-encode everything). CRF 18 + slow preset gives 90% of the quality gain.

**Modified file:** `src/lib/ffmpeg.ts`
- `buildNormalizeCommand`: CRF 23→18, preset medium→slow, audio 128k→192k
- `buildExportCommand`: CRF→18, preset→slow (single pass). Remove `-t 60` hard truncation.

**Time impact:** Clip prep ~2x slower, export ~1.5x slower. Total adds ~5-8 min.

---

## Phase 5: Color Grading (informed by Phase 1 data)

**Primary approach: brand LUT files.**

**New file:** `src/lib/color-grading.ts`
- Step 1: Auto-level per clip (normalize histogram to consistent baseline):
  ```
  colorlevels=rimin=0.04:gimin=0.04:bimin=0.04:rimax=0.96:gimax=0.96:bimax=0.96
  ```
- Step 2: Apply brand LUT if `brand_configs.color_lut_r2_key` is set:
  ```
  lut3d=brand_lut.cube
  ```
- Step 3: If no LUT, apply brand-appropriate preset based on `color_grade_preset` field (warm-vibrant, cool-clean, neutral, high-contrast)

**Modified files:**
- `src/workers/clip-prep.ts` — add grade step after normalize
- `src/types/database.ts` — add `color_grade_preset`, `color_lut_r2_key` to `BrandConfig`
- Uses Phase 1's `avg_brightness` and `dominant_color_hex` to adjust auto-leveling per clip

---

## Phase 6: Music Library Stocking + Selection

**Cold-start reality:** 0 tracks currently. Need minimum ~50 tracks before selection makes sense.

### Step 1: Stock the library
- Upload 50-100 licensed tracks to R2 under `music/`
- Add entries to `music_tracks` via Music Library sheet (S6 workflow handles Sheet→Supabase)
- Tag each: mood, genre, tempo_bpm, energy_level
- Target: minimum 8-10 tracks per mood (energetic, calm, upbeat, dramatic, minimal)

### Step 2: Selection logic
**New file:** `src/lib/music-selector.ts`
- Query by mood match + energy_level range for the video type
- **Weighted random** — weight = `1 / (used_count + 1)` so fresh tracks preferred but with variety
- Ensure `duration_seconds >= total_duration_target`

**Modified:** `src/agents/context-packet.ts` — call selector, populate `music_selection`

---

## Phase 7: Richer Briefs + Dynamic Pacing (coupled)

**Modified file:** `src/agents/prompts/creative-director.md`
- Reference video type configs from Phase 0 (pacing profile, energy curve, transition prefs)
- Require per-segment `energy_level` (1-10) following the video type's energy arc
- Require `pacing` per segment (slow/medium/fast → maps to clip hold duration)

**New file:** `src/lib/template-config-builder.ts`
- Reads brief energy curve + beat map → computes per-segment transition timing, animation speeds
- Populates `template_config` (currently always `{}`)

**Modified types:** `BriefSegment` — add `energy_level`, `pacing`
**Modified:** `src/agents/context-packet.ts` — call builder after agents run
**Modified:** All layouts — read `template_config` for dynamic values instead of hardcoded

---

## Phase 8: Trending Audio (pilot on 2-3 brands only)

Manual curation process, not automated scraping. Scoped to avoid licensing landmines.

**New table:** `trending_sounds` — id, platform, name, r2_key, tempo_bpm, mood, expires_at, added_by
**Process:** Worker adds 5-10 trending sounds/week via Sheets tab or direct upload
**Modified:** `context-packet.ts` — check trending sounds first (if matching mood + not expired), fall back to licensed library
**Scope:** Pilot on nordpilates, highdiet only

---

## Deferred

### Quality Director Agent
Cut for now. Add only after manually reviewing 50+ outputs and building a concrete taxonomy of failure modes. The existing deterministic QA checks in `qa-checker.ts` (duration, audio, sync, resolution, black frames, aspect ratio) are sufficient for now.

### A/B Performance Tracking
Add a `performance_metrics` table later: `job_id`, `platform`, `views`, `watch_time_avg`, `engagement_rate`, `video_type`, `template_id`, `music_mood`. Use to validate which phases actually moved the needle.

---

## Time Budget (45s video, 5 clips, CX32 — 4 vCPU, 8GB RAM)

> Numbers below were originally estimated against CX22 (2 vCPU, 4GB). Re-measure on CX32 after the first end-to-end render — clip prep and Remotion render should drop notably with 2× the cores.

| Step | Current | After All Phases |
|------|---------|-----------------|
| AI agents (3) | ~30s | ~45s (richer prompts) |
| Clip prep (5 clips, slow + color grade) | ~5 min | ~18 min |
| Transcription | ~2 min | ~2 min |
| Beat detection | 0 | ~5s |
| Template config build | 0 | ~1s |
| Remotion render | ~5 min | ~8 min |
| Audio mix (ducking) | ~30s | ~1 min |
| Export (3 platforms, CRF 18 slow) | ~3 min | ~5 min |
| **Total** | **~16 min** | **~35 min** |

Within the 60-minute budget with headroom for retries.

---

## Implementation Order

| Order | Phase | Depends On |
|-------|-------|-----------|
| 1 | Phase 0: Video type matrix + new templates | Nothing |
| 2 | Phase 1: Ingestion enrichment | Nothing |
| 3 | Phase 2: Beat-synced transitions | Music in library |
| 4 | Phase 3: Audio ducking | Nothing |
| 5 | Phase 4: Encoding upgrade | Nothing |
| 6 | Phase 6: Music library stocking + selection | Tracks uploaded |
| 7 | Phase 5: Color grading | Phase 1 data |
| 8 | Phase 7: Richer briefs + dynamic pacing | Phase 0 types |
| 9 | Phase 8: Trending audio pilot | Phase 6 working |

## Verification

- `npm run build` after each phase
- Render test video per video type, compare before/after
- QA checker validates output specs
- Manual review of first 50 outputs before scaling
