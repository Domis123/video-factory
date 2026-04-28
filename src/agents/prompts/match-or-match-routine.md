You are selecting clips for a brand's social-media routine video — a short
sequence of segments from a SINGLE parent clip that flow together into a
coherent micro-tutorial or routine demonstration.

Your job: pick ONE parent and 2–5 segments from inside that parent.

═══ BRAND AESTHETIC ═══

{aesthetic_description}

═══ THE OPERATOR'S IDEA SEED ═══

"{idea_seed}"

═══ HOW TO PICK ═══

1. Read the idea seed and decide which kind of routine the brand would post
   for this idea — what body region, what feeling, what energy.

2. Scan the available parents (each is a continuous shoot — one subject,
   one location, one outfit). Pick the ONE parent whose segments best match
   the idea seed.

3. Within that parent, pick BETWEEN 2 AND 5 segments that fit the idea seed
   naturally. The exact count is YOUR call. Use this rule:

   • If the parent has only 2–3 strong matches, pick 2 or 3. Don't pad.
   • If the parent has 4–5 segments that genuinely flow together, pick 4 or 5.
   • A 3-clip routine that is tight and cohesive is BETTER than a 5-clip
     routine that includes one weak segment to "fill space."
   • Order the segment_ids so the resulting video reads as a natural flow
     start → middle → end. (Source order in the parent is usually the right
     order, but you can reorder if it makes the routine flow better.)

4. Stay within the brand aesthetic. If a parent matches the idea seed
   semantically but its visual feel is off-brand (wrong palette, wrong
   energy, wrong location vibe), skip it and pick a parent that matches
   BOTH the idea and the aesthetic.

═══ WHAT YOU CANNOT PICK ═══

Excluded parents (recently used — for variety, do NOT pick from these):
{excluded_parents_block}

═══ AVAILABLE PARENTS ═══

Each parent below has its full segment list. You see only segments that
have been deeply analyzed (segment_v2 sidecar populated). Parents with
fewer than 10 such segments are not shown — they're not eligible for the
routine path.

{library_block}

═══ OUTPUT ═══

Return ONLY a JSON object matching this schema. No markdown fences, no
prose outside the JSON.

{
  "parent_asset_id": "<UUID of the chosen parent>",
  "segment_ids": ["<UUID>", "<UUID>", ...],
  "slot_count": <integer 2-5, must equal segment_ids.length>,
  "reasoning": "<2-4 sentences explaining why this parent + these segments fit the idea seed and brand aesthetic>"
}

All segment_ids must come from the chosen parent. Length must be between
2 and 5 inclusive. slot_count must equal segment_ids.length exactly.
