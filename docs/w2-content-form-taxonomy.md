# W2 Content-Form Taxonomy (v1)

**Status:** Finalized pending post-Content-Sprint-2 library audit.
**Supersedes:** `w2-content-form-taxonomy-draft.md` (v0).
**Canonical home after commit:** `docs/w2-content-form-taxonomy.md`
**Authored:** 2026-04-21
**For:** referenced by W2 brief, consumed by Planner (W3), Visual Director (W5), Coherence Critic (W6), Copywriter (W7), and eventually Voice Generator (W10).

---

## Two-axis model

A video's identity is captured by two semi-independent dimensions:

**FORM — structural shape.** What is the video made of? How many clips? What's the flow? Where's the hook? What are the functional roles of each segment? Committed to by the Planner per video.

**AESTHETIC POSTURE — tonal/visual framing.** How does the video feel? This is restricted per-brand in brand persona. Within an allowed posture, Director + Copywriter execute the Form.

A single Form can be produced across multiple Postures. Forms and postures are **separately extensible**: add a new form without re-auditing postures, add a new posture without re-auditing forms. Brand config restricts the posture mix; form availability is global.

Planner output commits to: `form_id`, `hook_mechanism`, `narrative_beat`, slot structure, music intent, subject consistency mode. Brand persona restricts posture and governs the voice/aesthetic envelope Director + Copywriter operate inside.

---

## Hook mechanism as first-class concept

Every form has a **hook mechanism** — the specific reason viewers keep watching past the first 1.5 seconds. Not the hook's words; the hook's *why*. The Planner names the hook_mechanism alongside the form, and the Copywriter executes against it.

Hook mechanisms observed across the 16 forms below cluster into ~7 types:

- **specific-pain-promise** — "3 moves for desk neck." Names the viewer's problem in the first line.
- **visual-pattern-interrupt** — cuts against feed-fatigue. Slow where everything else is fast, silent where everything else is loud, or a single striking frame.
- **opening-energy** — first 1-2 clips deliver kinetic momentum that carries through.
- **authority-claim** — "most people do this wrong." Triggers the anxiety of being the person doing it wrong.
- **confessional-vulnerability** — "I wish someone had told me this." Reads as real because the stakes are personal.
- **narrative-intrigue** — "day in my life" or "progress over 12 weeks." Viewer stays to see where it goes.
- **trend-recognition** — audio or format the viewer already knows. Participation in a cultural moment.

The Planner picks both form and hook_mechanism. They're coupled but not identical — "Body-Part Microtutorial" typically uses specific-pain-promise but could use authority-claim. The Copywriter's job is to deliver on whichever hook_mechanism was specified.

---

## FORMS (v1 — 16 entries)

Legend:
- **Slot count / pacing / dominant segment_types / overlay posture** — form mechanics
- **Library readiness (nordpilates, pre-Sprint-2):** ✅ ready / ⚠️ partial / 🔴 blocked — WILL BE REFRESHED post-Sprint-2
- **Hook mechanism** — the why
- **Reference** — creator/trend pattern

### 1. Targeted Microtutorial ("3 moves for X")

- **What it IS:** hook identifying an audience or complaint → 3 numbered exercises → soft close. Audience framing is a variable: body-part complaint ("desk neck," "tight hips"), audience tag ("runners," "new moms," "over 40"), or lifestyle context ("busy mornings"). Structure is the same.
- **Slot count:** 5–7
- **Pacing:** smooth-to-mid
- **Dominant segment_types:** `exercise` heavy + 1 `talking-head` or `setup` for hook
- **Overlay posture:** label-heavy (exercise names, optional rep counts)
- **Library readiness:** ✅ strong — 477 exercise segments, 13 body regions covered with core/glutes/legs/shoulders heavily represented (518/333/256/235)
- **Hook mechanism:** specific-pain-promise (default) or authority-claim (for "over 40" / trainer-figure variants)
- **Feels organic because:** the specificity of the promise. A real teacher addresses a specific audience with a specific problem.
- **Reference:** SocialMon "3 exercises for..." + "Pilates for..." formats, documented as consistently high-save formats.
- **Note:** this entry absorbed former form #17 (For-Specific-Audience). The variable is `audience_framing: string` passed from Planner to Copywriter.

### 2. Fast-Cut Montage

- **What it IS:** 6–12 micro-clips of a single session, rapid cuts synced to music, minimal or zero text
- **Slot count:** 8–12
- **Pacing:** punchy (dedicated punchy form)
- **Dominant segment_types:** `exercise`, `hold`, occasional `transition`
- **Overlay posture:** silent or single-text-card intro
- **Library readiness:** ✅ abundant. Director (W5, shipped) enforces clip-to-clip visual continuity; Critic (W6, shipped) flags posture drift.
- **Hook mechanism:** opening-energy — first 2 clips do the work
- **Feels organic because:** energy compound. Music drives the edit. Viewer is carried, not instructed.
- **Reference:** Wall Pilates teasers; Spotify Wrapped "Pink Pilates Princess" auto-generated reels.

### 3. Cinematic Slow-Cinema

- **What it IS:** one long continuous clip (15–45s) of a single movement, minimal cuts, often an unusual angle
- **Slot count:** 1–2
- **Pacing:** smooth (deepest smoothness)
- **Dominant segment_types:** one long `exercise` or `hold`, editorial window near-full
- **Overlay posture:** silent or one poetic line
- **Library readiness:** ✅ viable — 271 segments ≥10s (hold/exercise). Part A's 12s exercise cap + 15s hold cap still binds, but the library has enough long-form material for single-shot form. Director (W5) picks via editorial.best_in/out_point_s from this pool.
- **Hook mechanism:** visual-pattern-interrupt — slow where feed is fast
- **Feels organic because:** the form trusts the viewer. Pattern-breaking in a fast-cut-dominated feed.
- **Reference:** Align.app long-form; Move With Nicole extended demos. Your "cinematic pilates" reference.

### 4. Day-in-the-Life

- **What it IS:** 6–10 vignette clips covering a morning routine — stretching, matcha, outfit, commute, workout, post-workout — chronologically with minimal text
- **Slot count:** 6–10
- **Pacing:** smooth
- **Dominant segment_types:** mixed — needs lifestyle `b-roll` (non-workout) + `exercise` for the workout section
- **Overlay posture:** sparse — time-of-day label or nothing
- **Library readiness:** ✅ viable — 122 b-roll segments split roughly evenly: 60 lifestyle_likely (home/outdoor/other with no equipment visible) + 71 exercise_adjacent_likely (studio/gym or with equipment). The 60 lifestyle-b-roll pool supports the non-workout vignettes characteristic of this form. Subject-stance commitment (W6.5) now correctly matches: day-in-the-life reads as `single-subject` by the Planner's idea-signal heuristic.
- **Hook mechanism:** narrative-intrigue — viewer stays to see the day unfold
- **Feels organic because:** doesn't sell, just exists. Relief in a feed full of CTAs.
- **Reference:** SocialMon "day in the life"; Pilates-Girl aesthetic tribe canonical form.

### 5. Routine-Sequence

- **What it IS:** same subject doing a named sequence ("my Monday core routine," "evening wind-down"), 4–8 exercises, fixed order, slightly more instructional than Fast-Cut Montage
- **Slot count:** 5–9
- **Pacing:** mid
- **Dominant segment_types:** `exercise` + `hold`, single subject (`subject_consistency: single-subject`)
- **Overlay posture:** label-heavy
- **Library readiness:** ✅ — single-subject filter + exercise dominance is what Phase 3.5 optimized for
- **Hook mechanism:** narrative-intrigue (the "named sequence" framing) or specific-pain-promise ("evening wind-down for tight hips")
- **Feels organic because:** "this is what I actually do." Named sequences imply a life, a schedule, a person.
- **Reference:** "pilates girl routine"; morning routine genre broadly.

### 6. Myth-Buster / Mistake-Correction

- **What it IS:** hook ("most people do X wrong") → wrong demonstration → right demonstration → brief correction
- **Slot count:** 3–5
- **Pacing:** mid
- **Dominant segment_types:** paired `exercise` (wrong + right variants), ideally `talking-head` for explanation
- **Overlay posture:** label-heavy + high-contrast text ("WRONG" / "RIGHT" stamps)
- **Library readiness:** ⚠️ — talking-head count dropped to 7 post-Sprint-2 (was 8 pre-Sprint-2 — one reclassification). Still blocks talking-head-heavy form variants; minimal-form (2-3 clips + strong text overlay) remains viable. W10 voice generation unlocks the full form.
- **Hook mechanism:** authority-claim — "you might be doing this wrong" triggers the anxiety
- **Feels organic because:** the correction feels generous. Educational without being boring.
- **Reference:** SocialMon "mistakes to avoid" format.

### 7. Before-vs-Better (alignment/form)

- **What it IS:** split-screen or sequential showing misalignment then correct positioning — not transformation, just form comparison
- **Slot count:** 2–4
- **Pacing:** smooth
- **Dominant segment_types:** paired `exercise` or `hold` showing form variation
- **Overlay posture:** label-heavy + labels ("before" / "better")
- **Library readiness:** ⚠️ — similar constraints to Myth-Buster
- **Hook mechanism:** authority-claim or specific-pain-promise
- **Feels organic because:** visual, immediately useful, highly saveable
- **Reference:** SocialMon "before vs better alignment."

### 8. Single-Exercise Deep-Dive

- **What it IS:** one exercise from multiple angles/phases with cue overlays — close-up of hand position, side view of spine, wide view of full body
- **Slot count:** 3–5 (same exercise, different angles)
- **Pacing:** smooth
- **Dominant segment_types:** multiple `exercise`/`hold` segments sharing a move name, or one long exercise with sub-windows
- **Overlay posture:** label-heavy (cue callouts: "SHOULDERS DOWN", "NEUTRAL SPINE")
- **Library readiness:** ✅ viable for top exercises — post-normalization, 13 exercises have ≥6 same-name segments (donkey kick 31, glute bridge 25, side lying leg lift 24, bird dog 12, wall chest stretch 12, and more at 6-8 each). Planner can commit to this form when the idea seed targets any of those 13. Text normalization helper (from W3) correctly merges variant strings ("glute bridge" + "glute-bridge" + "Glute Bridge" → 25).
- **Hook mechanism:** authority-claim — teacher-expertise framing
- **Feels organic because:** only a real teacher thinks to separate hand position from spine alignment. Specificity reads as expertise.
- **Reference:** SocialMon "pose of the week breakdown"; Move With Nicole pattern.

### 9. Running-Joke / Meme-Remix

- **What it IS:** 1–3 clips wrapped in a viral audio/format, reinterpreted for Pilates. Short, punchy, joke lives in audio/caption.
- **Slot count:** 1–3
- **Pacing:** punchy
- **Dominant segment_types:** any — often `talking-head`, `b-roll` reaction, or single `exercise` punchline
- **Overlay posture:** sparse; trending-audio-led
- **Library readiness:** ⚠️ — trend-dependent, library has raw material but trend-mapping happens outside v2 pipeline (human supplies the trend context in idea seed)
- **Hook mechanism:** trend-recognition
- **Feels organic because:** participation in a cultural moment. Shows the brand is "online."
- **Reference:** "running joke or trend about pilates" from your list.

### 10. Reaction Format

- **What it IS:** creator reacts to another Pilates clip or common mistake-in-the-wild
- **Slot count:** 2–4
- **Pacing:** mid-to-punchy
- **Dominant segment_types:** `talking-head` heavy
- **Overlay posture:** label-heavy (quoted captions, reaction labels)
- **Library readiness:** 🔴 — 7 talking-head segments (down 1 post-Sprint-2); reaction is talking-head-heavy. Blocked pending content expansion OR W10 voice generation providing an alternative. Also copyright question on reacted-to content.
- **Hook mechanism:** authority-claim or trend-recognition (depending on reacted-to content)
- **Feels organic because:** conversational, engages with broader discourse
- **Reference:** SocialMon "reaction content."
- **Status:** INCLUDED IN TAXONOMY BUT NOT SHIPPABLE in current library state.

### 11. Progress-Montage

- **What it IS:** chronological clips of same subject doing same exercise over weeks/months. NOT transformation-sale — progression, growth.
- **Slot count:** 4–8
- **Pacing:** smooth
- **Dominant segment_types:** `exercise` or `hold`, same-exercise-name, same-subject
- **Overlay posture:** sparse — dates, "Week 1" / "Week 12" labels
- **Library readiness:** 🔴 — requires temporal metadata Part A doesn't capture. Out of scope for current library.
- **Hook mechanism:** narrative-intrigue — "did she actually improve?"
- **Feels organic because:** hard to fake. "I did the work over time" is the most credible wellness framing.
- **Reference:** SocialMon "progress montage."
- **Status:** DEFERRED — needs metadata layer extension beyond Part A.

### 12. Beginner-Follow-Along (30–45s mini-class)

- **What it IS:** short follow-along, no props needed, single subject front-on, real-time walk-through of a 30–45s sequence
- **Slot count:** 1–3 (often one extended clip)
- **Pacing:** smooth
- **Dominant segment_types:** long `exercise` or `hold` segments, consistent front-on framing
- **Overlay posture:** label-heavy (exercise names as they change)
- **Library readiness:** ✅ viable — 271 segments ≥10s in hold/exercise pool provide the base material. Director (W5, shipped) can reassemble multiple same-parent segments via subject-continuity boost (W4 retuned boost 0.02 + W5 sequential primary-slot hint chain). Same-parent concentration observed in current library supports this.
- **Hook mechanism:** specific-pain-promise — "30-second follow-along for X"
- **Feels organic because:** utility. Viewer can do it right now. Maximum save signal.
- **Reference:** SocialMon "beginner-friendly follow-along mini class."

### 13. Hook-Rev-Tip (single-tip with reveal)

- **What it IS:** hook ("the one cue that changed my plank") → 1–2 clips illustrating → tip delivered in overlay. Fast, single idea.
- **Slot count:** 2–4
- **Pacing:** punchy
- **Dominant segment_types:** `exercise` or `hold` for illustration
- **Overlay posture:** label-heavy (the tip IS the overlay)
- **Library readiness:** ✅ — abundant exercise clips; "one cue" is a Copywriter concern
- **Hook mechanism:** authority-claim — "THE one cue"
- **Feels organic because:** respects viewer time. Single idea, delivered, done.
- **Reference:** SocialMon "instructor cue of the day."

### 14. Aesthetic-Ambient (pure mood)

- **What it IS:** 4–8 beauty shots — light through window on reformer, hand on mat, grip sock on floor, steam from matcha — no instruction, no full exercise demo. Atmosphere.
- **Slot count:** 4–8
- **Pacing:** smooth, single-tempo music
- **Dominant segment_types:** `b-roll` heavy (lifestyle specifically), `setting`-rich
- **Overlay posture:** silent or single evocative word ("softness," "ritual")
- **Library readiness:** ✅ viable — 60 lifestyle_likely b-roll segments + long-hold exercise material. Core form for Pink-Pilates-Princess aesthetic tribe. Subject-stance commitment (W6.5) correctly identifies aesthetic-ambient ideas as `mixed` when idea seed signals "aesthetic / vibes / compilation / no teaching" — validated in session via seed 3 canary.
- **Hook mechanism:** visual-pattern-interrupt
- **Feels organic because:** pure visual pleasure, no sell-intent. Closest form to Domis's "pleasurable to watch, not selling" north-star.
- **Reference:** Pink Pilates Princess canonical aesthetic; align.app lean.

### 15. Teacher-Cue Drop

- **What it IS:** instructor delivers one technical cue in voiceover or text, demo'd across 1–2 clips. Authority voice. Dense, saveable.
- **Slot count:** 2–3
- **Pacing:** mid
- **Dominant segment_types:** `talking-head` + `exercise` demo
- **Overlay posture:** label-heavy (text-only until W10 voice generation)
- **Library readiness:** 🔴 — talking-head-gated (7 segments, down 1 post-Sprint-2). W10 voice generation is the unlock path; post-Sprint-2 ingestion didn't relieve the bottleneck materially.
- **Hook mechanism:** authority-claim
- **Feels organic because:** reads as a real teacher, not a brand
- **Reference:** "Ask a Pilates teacher" condensed to Reel length.
- **Status:** LIMITED in current library; expands significantly when W10 ships.

### 16. Equipment/Prop Spotlight

- **What it IS:** one piece of kit (magic circle, resistance band, wall, blocks) shown in 3–5 quick uses
- **Slot count:** 4–6
- **Pacing:** mid
- **Dominant segment_types:** `exercise` with `setting.equipment_visible` populated
- **Overlay posture:** label-heavy (move names + prop label)
- **Library readiness:** ✅ viable — post-normalization equipment distribution shows clear top-N: mat (634 — the default surface), yoga mat (147), mirror (57), wall (46), plus specific props: pilates ring (14), dumbbell (13), reformer (6). Text normalization merged variants ("mat" + "yoga mat" + "yoga-mat" cluster; "dumbbell" + "dumbbells" merged). Planner can commit to this form when idea seed targets any of the 10+ top equipment items.
- **Hook mechanism:** specific-pain-promise — "what to do with that magic circle you bought"
- **Feels organic because:** addresses a real home-practitioner problem. Utility reads as organic.
- **Reference:** SocialMon "equipment spotlight."

---

## Forms considered and dropped

- **Transformation Before/After** — anti-nordpilates per Betterme-paid-ads anti-reference + "not selling" bar
- **Challenge / Protocol teaser** — drifts into sales/promotional; reopen if program-style campaigns become part of nordpilates strategy
- **Client Testimonial** — no real-client UGC in library; fabrication is ethically wrong
- **Milestone Celebration** — studio-specific, nordpilates is product brand not studio
- **Tutorial Carousel (static images)** — feed post format, not Reel; out of scope for Video Factory
- **Studio Tour** — not applicable to nordpilates
- **What-I-Wish-I-Knew** — dropped from the draft's 18 into the considered-and-dropped list. It's a Talking-Head-gated form that functionally overlaps with Teacher-Cue Drop (#15). Collapsed to avoid taxonomy bloat.

---

## AESTHETIC POSTURES (v1 — 5 entries)

A brand persona allows a subset of these postures. Director + Copywriter execute within whichever is active.

### P1 — Soft Pastel Wellness-Girl (Princess-adjacent)

- **Visual:** warm-pastel or soft-pastel color treatment, natural or bright-natural lighting, single subject in coordinated athleisure, cozy-but-composed
- **Overlay voice:** delicate serif or clean sans-serif, warm tones, gentle
- **Pacing lean:** smooth
- **Subject continuity:** strongly preferred single-subject
- **Music lean:** calm-ambient or warm-acoustic
- **Anti-reference:** harsh high-contrast, industrial lighting, shouty overlay text
- **Brand fit:** nordpilates anchor posture

### P2 — Editorial Slow-Cinema

- **Visual:** high-contrast OR natural, locked-off camera, unusual angles, cinematic framing, moody color treatment allowed
- **Overlay voice:** minimal; poetic; often silent
- **Pacing lean:** smooth (deepest)
- **Subject continuity:** single-subject strongly preferred
- **Music lean:** motivational-cinematic, ambient, or none
- **Anti-reference:** label overlays, fast cuts, chatty voice
- **Brand fit:** nordpilates minor use — cinematic-slow-cinema, aesthetic-ambient

### P3 — Raw Handheld / First-Person

- **Visual:** no color grade or minimal, shaky/handheld allowed, natural imperfect lighting
- **Overlay voice:** casual, lowercase, conversational
- **Pacing lean:** mid
- **Subject continuity:** any
- **Music lean:** minimal or trending-audio
- **Anti-reference:** anything that reads as produced
- **Brand fit:** nordpilates NO. Included for other brands.

### P4 — Pop-Meme Punchy

- **Visual:** high-contrast or clean-bright, trend-audio driven, heavy text overlays
- **Overlay voice:** punchy, jokey, emoji-adjacent
- **Pacing lean:** punchy
- **Subject continuity:** any
- **Music lean:** trending-audio, upbeat-electronic
- **Anti-reference:** silence, slow fades, long holds
- **Brand fit:** nordpilates sparingly — specifically Running-Joke/Meme-Remix

### P5 — Clean Instructional (Teacher-Present)

- **Visual:** natural or clean-bright, well-lit, front-on or side, subject is teacher-figure
- **Overlay voice:** authoritative, clear sans-serif, explicit cue language
- **Pacing lean:** mid
- **Subject continuity:** single-subject required
- **Music lean:** calm-ambient or none
- **Anti-reference:** casual voice, ambient-only, non-cue overlays
- **Brand fit:** nordpilates core functional posture

### Deferred: P6 — Voice-Over-Led

Reserved for W10 (Audio Generation workstream). When shipped, unlocks meaningful use of Teacher-Cue-Drop (#15), Myth-Buster (#6) without paired wrong/right, What-I-Wish-I-Knew (reconsidered with VO), and provides a second teacher-presence register for nordpilates beyond text-on-screen P5. Architecture note: brand persona schema includes `voice_config: VoiceConfig | null` from W2 so W10 landing is a field-population, not a schema migration.

---

## Form × Posture allowlist (nordpilates, v1)

✓ = allowed, blank = disallowed, (?) = decision during W3 calibration, (V) = would unlock/expand with W10 voice generation.

| FORM                             | P1 Soft | P2 Editorial | P3 Raw | P4 Meme | P5 Clean |
|----------------------------------|---------|--------------|--------|---------|----------|
| 1. Targeted Microtutorial        | ✓       |              |        |         | ✓        |
| 2. Fast-Cut Montage              | ✓       | ✓            |        | ✓       |          |
| 3. Cinematic Slow-Cinema         | ✓       | ✓            |        |         |          |
| 4. Day-in-the-Life               | ✓       | (?)          |        |         |          |
| 5. Routine-Sequence              | ✓       |              |        |         | ✓        |
| 6. Myth-Buster                   |         |              |        | ✓       | ✓ (V)    |
| 7. Before-vs-Better              |         |              |        |         | ✓        |
| 8. Single-Exercise Deep-Dive     | (?)     |              |        |         | ✓        |
| 9. Running-Joke/Meme-Remix       |         |              |        | ✓       |          |
| 10. Reaction                     |         |              |        | ✓ (V)   |          |
| 11. Progress-Montage             | ✓       | ✓            |        |         |          |
| 12. Beginner-Follow-Along        | ✓       |              |        |         | ✓        |
| 13. Hook-Rev-Tip                 | ✓       |              |        | (?)     | ✓        |
| 14. Aesthetic-Ambient            | ✓       | ✓            |        |         |          |
| 15. Teacher-Cue Drop             |         |              |        |         | ✓ (V)    |
| 16. Equipment/Prop Spotlight     | ✓       |              |        |         | ✓        |

The grid implies ~38 distinct nordpilates video-identities before Copywriter voice and brand persona fine-tuning kick in. That's enough variance.

---

## Library gaps (post-Sprint-2 v1.1, 2026-04-23)

Sprint 2 ingestion brought the library from 190/720 (parents/segments) pre-Sprint-2 to 1116+ segments at last mid-session check, still climbing. The doubling did resolve 4 of the 4 original gaps (long_holds, lifestyle b-roll, b-roll mix, temporal metadata — the last remains structurally blocked and not fixable via ingestion). The remaining gap is talking-head scarcity, which ingestion did not meaningfully relieve.

1. **Talking-head scarcity.** 7 talking-head segments in 1116+ = 0.6% of library (was 8 in 720 = 1.1% pre-Sprint-2). Sprint 2 did not materially relieve this; one reclassification lowered the count by 1. Blocks Reaction (#10), significantly limits Teacher-Cue-Drop (#15) and Myth-Buster (#6). W10 voice generation remains the primary unlock path.

2. **Lifestyle b-roll mix — RESOLVED v1.1.** 122 b-roll total, classified via `segment_v2->'setting'->>'location'` + equipment_visible heuristic: 60 lifestyle_likely + 71 exercise_adjacent_likely + 0 ambiguous. Day-in-the-Life (#4) and Aesthetic-Ambient (#14) now flagged ✅ viable.

3. **Long single-shot footage — RESOLVED v1.1.** 271 segments ≥10s in hold/exercise pool. Part A caps (12s exercise, 15s hold) still bind per-segment, but the pool is deep enough for Cinematic Slow-Cinema (#3) and Beginner-Follow-Along (#12) to draw from. Director can also reassemble multiple same-parent segments via the subject-continuity boost chain.

4. **Temporal metadata — STILL BLOCKED.** Progress-Montage (#11) needs shoot-date / program-week tags. Out of scope for Part A; requires a future metadata extension. Not fixable via ingestion. Sprint 2 did not address.

Logged separately as `docs/content-library-gaps.md`.

---

## Change log

- **v1.1 (2026-04-23):** Readiness flags refreshed with Sprint 2 mid-ingestion numbers (1116+ segments). 5 forms flipped ⚠️ → ✅ (Cinematic Slow-Cinema, Day-in-the-Life, Single-Exercise Deep-Dive, Beginner-Follow-Along, Aesthetic-Ambient, Equipment/Prop Spotlight). 2 forms flipped to reflect talking-head count update (6 → 7; Reaction and Teacher-Cue-Drop stay 🔴). Library gaps section updated: 3 of 4 original gaps resolved by ingestion (long holds, lifestyle b-roll, b-roll mix); talking-head scarcity remains; temporal metadata remains structurally blocked. Sprint 2 still in progress; v1.2 refresh expected once ingestion stabilizes.
- **v1 (2026-04-21):** 18 forms → 16 (merged #1+#17, dropped What-I-Wish-I-Knew). "Feels organic because" → "hook mechanism" across all forms + new top-level hook-mechanism concept section. Posture P6 Voice-Over-Led deferred to W10. Voice-unlock-when-W10-ships noted with (V) markers in allowlist grid. Library-readiness flags marked as pre-Sprint-2 estimates; post-Sprint-2 audit scheduled.
- **v0 (2026-04-21):** initial draft, 18 forms, 6 postures.

---

*Canonical playbook for nordpilates through end of Part B. Reference material for W2 (shipped), W3 Planner (shipped + W6.5 tuned), W5 Visual Director (shipped), W6 Coherence Critic (shipped + W6.5 tuned), W7 Copywriter (next brief). v1.1 refreshed 2026-04-23 with Sprint 2 mid-ingestion numbers. Final v1.2 refresh expected once Sprint 2 fully stabilizes.*
