---
# Template for new brand personas.
# Copy this file to docs/brand-personas/{brand_id}.md and fill in every <TODO>.
# Loading this file as-is via loadBrandPersona('_template') will fail Zod validation
# (status, posture values, etc.) — that is intentional.
brand_id: <TODO>
brand_name: <TODO>
schema_version: 1
status: <TODO: active|draft|archived>

audience:
  primary: <TODO>
  psychographic: <TODO>

form_posture_allowlist:
  # Add entries from FORM_ID_VALUES (src/types/content-forms.ts).
  # Allowed posture values: P1, P2, P3, P4, P5. Remove unused form keys entirely.
  targeted_microtutorial: [<TODO>]

content_pillars: [<TODO>]

allowed_color_treatments: [<TODO>]

preferred_music_intents: [<TODO>]
avoid_music_intents: [<TODO>]

# voice_config stays null until W10 (audio generation) ships.
voice_config: null
---

# <TODO: brand display name>

## Identity

<TODO: what the brand sells, who it's for, and the emotional register it inhabits.>

## The bar

<TODO: the creative bar. Specific, testable. "If X, it passes. If Y, it fails.">

## Voice

- <TODO: tone, register, directness>
- <TODO: what the voice never does>

## Aesthetic

- <TODO: lighting preferences>
- <TODO: camera preferences>
- <TODO: framing, pacing, subject continuity>
- <TODO: text overlay posture>

## Don't list

- <TODO: explicit creative exclusions — sales framing, medical claims, drill-sergeant voice, etc.>

## Evaluation check

<TODO: 2-4 questions to ask before shipping a video for this brand.>
