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
- **Library readiness:** ✅ strong — 420 exercise segments, 21 body regions covered
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
- **Library readiness:** ✅ abundant, but clip-to-clip visual continuity needs Director enforcement
- **Hook mechanism:** opening-energy — first 2 clips do the work
- **Feels organic because:** energy compound. Music drives the edit. Viewer is carried, not instructed.
- **Reference:** Wall Pilates teasers; Spotify Wrapped "Pink Pilates Princess" auto-generated reels.

### 3. Cinematic Slow-Cinema

- **What it IS:** one long continuous clip (15–45s) of a single movement, minimal cuts, often an unusual angle
- **Slot count:** 1–2
- **Pacing:** smooth (deepest smoothness)
- **Dominant segment_types:** one long `exercise` or `hold`, editorial window near-full
- **Overlay posture:** silent or one poetic line
- **Library readiness:** ⚠️ — Part A's 12s exercise cap limits single-segment length; need to query whether hold segments approaching the 15s cap exist. Viable if yes.
- **Hook mechanism:** visual-pattern-interrupt — slow where feed is fast
- **Feels organic because:** the form trusts the viewer. Pattern-breaking in a fast-cut-dominated feed.
- **Reference:** Align.app long-form; Move With Nicole extended demos. Your "cinematic pilates" reference.

### 4. Day-in-the-Life

- **What it IS:** 6–10 vignette clips covering a morning routine — stretching, matcha, outfit, commute, workout, post-workout — chronologically with minimal text
- **Slot count:** 6–10
- **Pacing:** smooth
- **Dominant segment_types:** mixed — needs lifestyle `b-roll` (non-workout) + `exercise` for the workout section
- **Overlay posture:** sparse — time-of-day label or nothing
- **Library readiness:** ⚠️-to-🔴 — 117 b-roll segments exist but content mix unknown. If b-roll is exercise-adjacent (equipment, gym shots) rather than lifestyle-adjacent (waking up, food, hands, outfit), form is partially or fully blocked. POST-SPRINT-2 AUDIT.
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
- **Library readiness:** ⚠️ — requires paired wrong/right variants (likely need Director creative-recombination) or talking-head explanation (gated by 8-segment scarcity). Works in a minimal form: 2-3 clips with strong text overlay per Domis's framing.
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
- **Library readiness:** ⚠️ — depends on exercise-name consistency. If 3–5 same-named segments exist, viable. POST-SPRINT-2 PIVOT QUERY.
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
- **Library readiness:** 🔴 — 8 talking-head segments; reaction is talking-head-heavy. Blocked pending content expansion. Also copyright question on reacted-to content.
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
- **Library readiness:** ⚠️ — depends on continuous 30–45s front-on sequences. Part A's 12s cap means Director must reassemble multiple same-parent segments. Viable if same-parent continuous footage exists.
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
- **Library readiness:** ⚠️ — depends on lifestyle b-roll mix. POST-SPRINT-2 AUDIT. Core form for Pink-Pilates-Princess aesthetic tribe.
- **Hook mechanism:** visual-pattern-interrupt
- **Feels organic because:** pure visual pleasure, no sell-intent. Closest form to Domis's "pleasurable to watch, not selling" north-star.
- **Reference:** Pink Pilates Princess canonical aesthetic; align.app lean.

### 15. Teacher-Cue Drop

- **What it IS:** instructor delivers one technical cue in voiceover or text, demo'd across 1–2 clips. Authority voice. Dense, saveable.
- **Slot count:** 2–3
- **Pacing:** mid
- **Dominant segment_types:** `talking-head` + `exercise` demo
- **Overlay posture:** label-heavy (text-only until W10 voice generation)
- **Library readiness:** 🔴 — talking-head-gated (8 segments)
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
- **Library readiness:** ⚠️ — equipment-tagging consistency in v2 analyzer needs verification
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

## Library gaps (pre-Content-Sprint-2)

Forms with ⚠️ or 🔴 flags imply content-shoot priorities for nordpilates. All four gaps should be re-audited after Content Sprint 2 ingests, since current stats (190 parents / 720 segments) will roughly double.

1. **Talking-head scarcity.** 8 talking-head segments across 720 = 1.1% of library. Blocks Reaction (#10), significantly limits Teacher-Cue-Drop (#15) and Myth-Buster (#6). W10 (voice generation) reduces this pressure but doesn't eliminate it — some forms genuinely need a visible face.

2. **Lifestyle b-roll mix unknown.** 117 b-roll segments total, but split between exercise-adjacent (equipment, gym interiors) and lifestyle-adjacent (waking up, food, outfit, hands, texture, ritual objects) is unmeasured. Gates Day-in-the-Life (#4) and Aesthetic-Ambient (#14). Post-Sprint-2 audit: run the v2 analyzer's `setting.location` + `setting.equipment_visible` distribution query and classify b-roll by lifestyle-vs-exercise-adjacency.

3. **Long single-shot footage.** Part A's 12s exercise cap + 15s hold cap means single-segment continuous footage for Cinematic Slow-Cinema (#3) and Beginner-Follow-Along (#12) requires either segments near the hold cap or Director-reassembly from same-parent segments.

4. **Temporal metadata.** Progress-Montage (#11) needs shoot-date / program-week tags. Out of scope for Part A; requires a future metadata extension.

Logged separately as `docs/content-library-gaps.md`.

---

## Change log

- **v1 (2026-04-21):** 18 forms → 16 (merged #1+#17, dropped What-I-Wish-I-Knew). "Feels organic because" → "hook mechanism" across all forms + new top-level hook-mechanism concept section. Posture P6 Voice-Over-Led deferred to W10. Voice-unlock-when-W10-ships noted with (V) markers in allowlist grid. Library-readiness flags marked as pre-Sprint-2 estimates; post-Sprint-2 audit scheduled.
- **v0 (2026-04-21):** initial draft, 18 forms, 6 postures.

---

*Canonical playbook for nordpilates through end of Part B. Reference material for W2 brief, W3 Planner, W5 Visual Director, W6 Coherence Critic, W7 Copywriter. Revised post-Sprint-2 with real library numbers before W2 brief commits.*
