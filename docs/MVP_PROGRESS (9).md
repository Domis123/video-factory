# Video Factory — MVP Progress Tracker (9)

**Last updated:** 2026-04-17
**Supersedes:** MVP_PROGRESS (8).md
**Companion docs:** `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md`, `PHASE_3_DESIGN.md`, `SUPABASE_SCHEMA.md`, `CLAUDE.md`, `HANDOFF_PHASE3_QUALITY.md`

---

## Where we are right now

**Phase 3 is LIVE.** All five workstreams shipped (W1-W5). `ENABLE_PHASE_3_CD=true` on production VPS. First Phase 3 video rendered end-to-end on 2026-04-17 — a nordpilates workout-demo with golden-hour color treatment, 5 slots, exported to TikTok/Instagram/YouTube. Auto QA passed.

**Current focus: clip selection quality iteration.** First render exposed four quality layers: exercise name → visual match gap, talking-head segment scarcity, hook duration too short, Full Brief display garbled. See `HANDOFF_PHASE3_QUALITY.md` for detailed analysis and fix plan.

**Tags shipped:**
- `phase1-complete`
- `phase2-complete`
- `phase3-w1-complete` ✅ (2026-04-15)
- `phase3-w5-complete` ✅ (2026-04-16)
- W2/W3/W4 shipped to main without tags (2026-04-17)

**Commits on main (2026-04-17):**
- `68441bc` — feat(phase3-w2): wire creative_vision + aesthetic_guidance into Curator V2
- `7e381e4` — feat(phase3-w3): wire text_overlay constraints into Copywriter
- `d92d601` — feat(phase3-w4): parameterized Remotion composition with 18 transitions, Phase 3 overlays, and color treatments
- `57791f6` — fix(transcriber): handle video-only clips with no audio stream
- `9b377ea` — fix(overlay): CTA text rendering (on hotfix/cta-overlay, pending merge)

**Active feature flags in production:** ENABLE_CURATOR_V2=true, **ENABLE_PHASE_3_CD=true** (flipped 2026-04-17), ENABLE_BEAT_SYNC=true, ENABLE_COLOR_GRADING=true, ENABLE_MUSIC_SELECTION=true, ENABLE_AUDIO_DUCKING=true, ENABLE_CRF18_ENCODING=true.

---

## Phase 3 ship report — W2 + W3 + W4 (2026-04-17)

All three workstreams shipped in a single day session. Total new/modified: 20+ files, ~2600 lines added.

### W2 — Curator V2 Phase 3 wiring (commit `68441bc`)

| Component | File | Lines |
|---|---|---|
| BriefSlot type extension | `src/agents/curator-v2-retrieval.ts` | +1 |
| CuratorV2Brief type + prompt assembly | `src/agents/asset-curator-v2.ts` | +2 |
| Phase 3 dispatcher branch | `src/agents/asset-curator-dispatch.ts` | +49/-23 |
| Prompt rewrite (42→52 lines) | `src/agents/prompts/asset-curator-v2.md` | +22/-12 |
| Duplicate segment hard-filter | `src/agents/asset-curator-v2.ts` | ~5 lines in curateSlot |
| Smoke harness | `src/scripts/smoke-test-curator-phase3.ts` | +406 |

**Key design decisions:**
- `aesthetic_guidance` as separate prompt placeholder (not folded into slot_description)
- BriefSlot extended with optional fields (not discriminated union)
- CLIP retrieval query unchanged (aesthetic_guidance is Pro-only context, not retrieval augmentation)
- Discriminator: `'creative_direction' in input.brief` (structural check, same for W3/W4)
- Duplicate segment hard-filter: candidates from already-picked segment IDs removed before Pro sees them

**Smoke results:** 16/16 slots across 3 video types. Aesthetic overlap: avg 3-5 words/slot. Vision overlap: 10/16 slots. 0 Zod failures. 1 self-critique fire (expected — library gap). Dedup filter activated 8 times.

### W3 — Copywriter Phase 3 wiring (commit `7e381e4`)

| Component | File | Lines |
|---|---|---|
| Inline Phase 3 branch + user message format | `src/agents/copywriter.ts` | +149/-44 |
| Prompt update (74→107 lines) | `src/agents/prompts/copywriter.md` | +63/-10 |
| Smoke harness | `src/scripts/smoke-test-copywriter-phase3.ts` | +205 |

**Key design decisions:**
- Keep JSON dump pattern (no template substitution)
- Prepend structured context block before JSON blob (creative_vision + per-slot text_overlay constraints)
- Style priority: text_overlay.style → char_target → clip context → creative_vision
- Inline branching (no separate dispatcher file)
- Same discriminator as W2

**Smoke results:** 16/16 overlays within ±20% char_target. Style adherence confirmed (bold-center=punchy, label=terse, cta=actionable). 3 Claude calls, $0.12 total, 37.5s wall.

### W4 — Remotion parameterized composition (commit `d92d601`)

| Component | File | Lines |
|---|---|---|
| Phase 3 types + resolver | `src/templates/types.ts`, `src/templates/resolve-phase3.ts` | +93 |
| Color treatments | `src/templates/color-treatments.ts` | +14 |
| Transitions (expanded to 18) | `src/templates/components/TransitionEffect.tsx` | +83 |
| Text overlay component | `src/templates/components/Phase3TextOverlay.tsx` | +238 |
| Main composition | `src/templates/layouts/Phase3Parameterized.tsx` | +143 |
| Root registration | `src/templates/Root.tsx` | +25 |
| Database types | `src/types/database.ts` | +21 |
| Renderer Phase 3 wiring | `src/workers/renderer.ts` | +84/-46 |
| Pipeline integration | `src/agents/context-packet.ts` | +129/-91 |
| Pipeline Phase 3 support | `src/workers/pipeline.ts` | +31/-22 |
| Remotion config | `remotion.config.ts` | +13 (NEW) |

**18 transitions implemented:**
- Phase 3 vocabulary: hard-cut, crossfade, slide, zoom, whip-pan, fade-from-black
- Kept from Phase 2: fade, slide-left, slide-up, wipe, beat-flash, beat-zoom
- New additions: slide-right, slide-down, blur-through, flash, glitch, fade-to-black
- Crossfade implemented as opacity interpolation on overlapping sequences (both clips visible)

**8 color treatments:** warm-vibrant, cool-muted, high-contrast, soft-pastel, moody-dark, natural, golden-hour, clean-bright. Implemented as CSS filter on root AbsoluteFill.

**6 text overlay styles:** bold-center, subtitle, label, cta, minimal, none. With 7-position grid and 5 animation types.

**Phase 3 throw removed from context-packet.ts.** Full Phase 3 pipeline now flows: CD → Curator → Copywriter → clip_prep → transcription → rendering → audio_mix → sync_check → platform_export → auto_qa.

### Hotfixes (2026-04-17)

**Transcriber no-audio (commit `57791f6`):** Video-only clips (no audio stream) crashed ffmpeg when extracting audio for whisper. Fix: ffprobe checks for audio streams first; if absent, returns empty transcription. Pre-existing bug surfaced by Phase 3 picking exercise clips that were filmed without microphone.

**CTA white-on-white (branch `hotfix/cta-overlay`, `9b377ea`):** Phase3TextOverlay CTA style used `accentColor` (#FFFFFF for nordpilates) as background with hardcoded white text. Fix: wires `brandConfig.cta_bg_color` and `cta_text_color` through the component chain. **Pending merge + deploy.**

---

## First Phase 3 video — quality assessment

**Job:** `fe34b673-4257-4ee3-8f65-aab0a1efa490`
**Brief:** workout-demo, 5 slots (hook + 3 body + CTA), 35s, golden-hour color, composition `phase3-parameterized-v1`
**Render time:** 584.8s (~10 min)
**Platform exports:** TikTok 33.6MB, Instagram 15.1MB, YouTube 41.9MB
**Auto QA:** PASSED

**Quality issues identified by operator:**

1. **Clip selection mismatch:** Cat-cow stretch slot shows preparation, not the exercise. Child's pose shows wrong exercise. Spinal twist is incorrect.
   - Root cause: CD generates exercise names, CLIP embeddings don't map exercise terminology to visual content well, Gemini segment descriptions are generic ("woman doing exercise on mat")
   - Fix path: CD should describe visual appearance instead of exercise names; ingestion should label specific exercises

2. **CTA white-on-white text:** Fixed in hotfix, pending deploy.

3. **Hook cut off at 4s:** Talking-head clip cut too short, speaker can't finish sentence.
   - Fix: CD prompt minimum duration for talking-head hooks (≥7s)

4. **Same clip at start and end:** Only ~6 talking-head segments in library. Dedup prevents exact reuse but pool is too thin for visual distinctness.
   - Fix: more talking-head content + CTA b-roll fallback

5. **Full Brief display garbled:** "SLOT undefined" because `formatFullBrief()` reads Phase 2 field names. Cosmetic.

**See `HANDOFF_PHASE3_QUALITY.md` for detailed fix plan with 4-layer analysis.**

---

## Content sprint results (2026-04-17)

**Final nordpilates library:**

| Segment type | Count | Avg quality |
|---|---|---|
| b-roll | 65 | 7.2 |
| exercise | 55 | 8.2 |
| setup | 47 | 6.1 |
| hold | 39 | 7.9 |
| transition | 35 | 6.0 |
| cooldown | 8 | 6.3 |
| unusable | 4 | 1.3 |
| **Total** | **253** | |

~100 parent assets. Sprint completed 2026-04-17. Exercise pool (55 @ 8.2) is healthy for workout-demo jobs. B-roll dominant (65) for tips-listicle/transformation. 4 unusable (~1.6% junk rate) — honest classification.

---

## Phase 3 milestone status

| Milestone | Status | Date |
|---|---|---|
| 3.1 — CD + downstream agents | ✅ COMPLETE | 2026-04-17 (W1+W2+W3) |
| 3.2 — Clean-slate ingestion | ✅ COMPLETE | 2026-04-16 (W5) |
| 3.3 — Remotion + production flip | ✅ COMPLETE | 2026-04-17 (W4 + flag flip) |

**Success criterion (8/10 consecutive approvals):** Not yet measured. First video passed auto QA but has quality issues. Clip selection improvements needed before measuring.

---

## Workstream delivery summary

| Workstream | Sessions | Ship date | Commit |
|---|---|---|---|
| W1 — Creative Director rewrite | 6 | 2026-04-15 | `df6a326` |
| W5 — Clean-slate ingestion | 5 | 2026-04-16 | `f1b8120` |
| W2 — Curator V2 Phase 3 | 2 | 2026-04-17 | `68441bc` |
| W3 — Copywriter Phase 3 | 1 | 2026-04-17 | `7e381e4` |
| W4 — Remotion composition | 1 | 2026-04-17 | `d92d601` |
| **Total** | **15 sessions** | **3 days** | |

---

## Active n8n workflows

| # | Workflow | Status | Notes |
|---|---|---|---|
| S1 | New Job | ✅ | 30s poll. **Pending: Vibe column passthrough.** |
| S2 | Brief Review | ✅ | 30s poll. |
| S3 | QA Decision | ⏸ | Needs v2 rebuild before first `delivered` |
| S4-S6 | Brand/Caption/Music Config | ⏸ | Deactivated |
| S7 | Music Ingest | ✅ | 5min poll |
| S8 | UGC Ingest | ✅ | 15min poll (was 5min). **Known issue: `queryString: ".mov"` filters out .mp4 — needs clearing. Skip items flow to Send to VPS causing binary error — needs IF filter.** |
| P1 | Job Status Push | ✅ | Webhook |
| P2 | Periodic Sync | ✅ | 5min |
| P3-P4 | Dashboard/Archive | ⏸ | Deactivated |

---

## Data inventory (2026-04-17)

- **~100 assets** (nordpilates, post-sprint)
- **253 asset_segments** (all with clip_r2_key + CLIP embedding, derived from 1080p normalized parents)
- 15 music_tracks (gap: no calm/ambient tracks for gentle content)
- 5 brand_configs (nordpilates active for Phase 3)
- ~8 jobs (includes 2 Phase 3 test jobs from 2026-04-17)

---

## Known issues (priority sorted)

| Priority | Issue | Status / target |
|---|---|---|
| **HIGH** | Clip selection doesn't match exercise names | CD visual description prompt fix (next session) |
| **HIGH** | Hook talking-head cut off at 4s | CD minimum duration rule (next session) |
| Medium | CTA white-on-white text | Fixed (hotfix/cta-overlay), pending merge + deploy |
| Medium | Full Brief display "SLOT undefined" | formatFullBrief Phase 3 support (cosmetic) |
| Medium | Music library no calm tracks | Need calm/ambient track uploads |
| Medium | Talking-head segment scarcity (~6 clips) | More face-to-camera content + CTA b-roll fallback |
| Medium | S8 workflow .mov-only filter + skip item crash | queryString clear + IF filter node |
| Medium | S3 QA Decision v1 has old bugs | Pending v2 rebuild |
| Medium | Legacy `analyzeClip` Gemini Flash runs unconditionally | Defer to cleanup |
| Low | Vibe column not wired (sheet → S1 → Supabase → CD) | Follow-up |
| Low | ENABLE_CURATOR_V2 reads from process.env (not env.ts) | Cleanup |
| Low | job_events null to_status on some error paths | Minor logging fix |
| Low | VPS package-lock.json drifts | Persistent friction |

---

## Cost tracking

| Component | Per video / per clip | Notes |
|---|---|---|
| Phase 3 CD (Sonnet) | ~$0.20-0.30 | Production path |
| Copywriter (Sonnet) | ~$0.10-0.15 | |
| Curator V2 (Gemini Pro) | $0 (credits) | ~5 slots × $0.04 if credits end |
| Ingestion (Gemini Pro) | $0 (credits) | ~$0.06/clip |
| **Real out-of-pocket** | **~$0.35-0.45/video** | Phase 3 path |
| Upstash Redis | ~$1.20/mo | Pay-as-you-go |
| R2 storage | ~$1-5/mo | Scales with library |

Infra: ~€15/mo (Hetzner VPS + n8n server) + ~$1.20/mo Redis + ~$1-5/mo R2. Total ≈ €18-22/mo.

---

## Document status

- This file (9) — current. Replaces (8).
- `VIDEO_PIPELINE_ARCHITECTURE_v5_1.md` — current (no W2-W4 architecture changes to document structure).
- `PHASE_3_DESIGN.md` — needs update: W2-W4 marked shipped, milestones complete.
- `SUPABASE_SCHEMA.md` — current (no schema changes in W2-W4).
- `CLAUDE.md` — needs update: Phase 3 live, ENABLE_PHASE_3_CD=true.
- `VPS-SERVERS.md` — current (minor: VPS path is /home/video-factory).
- `HANDOFF_PHASE3_QUALITY.md` — NEW. Quality iteration handoff for next session.
- Historical: (8), (7), v5.0, v4.0, HANDOFF_PHASE3_W2_START.md — archive, do not update.
