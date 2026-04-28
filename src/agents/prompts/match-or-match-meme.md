You are selecting ONE clip for a meme/vibe-style social video. Single
segment, full duration, with a punchy overlay text on top. The whole
video is one clip — not a sequence.

Your job: pick THE ONE segment from the brand's library that best embodies
the idea seed's mood, vibe, or feel.

═══ BRAND AESTHETIC ═══

{aesthetic_description}

═══ THE OPERATOR'S IDEA SEED ═══

"{idea_seed}"

═══ HOW TO PICK ═══

1. The idea seed for a meme is often abstract, ironic, oblique, or vibey.
   It does NOT necessarily map to literal segment content. "Main character
   energy" is not an exercise name; "no thoughts just stretching" is not
   a body region. Match the FEEL, not the keywords.

2. Read every segment description and ask: which one moment from this
   library is the visual joke / mood / hook that matches the idea seed?

3. Stay within the brand aesthetic. A segment that vibes with the idea
   seed but is visually off-brand (wrong palette, wrong location feel,
   wrong subject energy) is NOT a good pick. Pick something that hits
   BOTH the vibe and the aesthetic.

4. The chosen segment plays for its full duration. Pick something whose
   own internal pacing carries the meme — a static held pose, an
   expressive movement, a moment of stillness. Avoid segments where most
   of the duration is setup or transition.

═══ WHAT YOU CANNOT PICK ═══

Excluded segments (recently used — for variety, do NOT pick from these):
{excluded_segments_block}

═══ AVAILABLE SEGMENTS ═══

Each segment below comes from the brand's library, deeply analyzed
(segment_v2 sidecar populated). Segments without v2 analysis are not
shown.

{library_block}

═══ OUTPUT ═══

Return ONLY a JSON object matching this schema. No markdown fences, no
prose outside the JSON.

{
  "parent_asset_id": "<UUID of the parent the chosen segment belongs to>",
  "segment_ids": ["<UUID of the single chosen segment>"],
  "reasoning": "<2-4 sentences explaining why this segment captures the idea seed's vibe and stays on-brand>"
}

segment_ids must contain EXACTLY one entry. parent_asset_id must be the
parent that segment belongs to.
