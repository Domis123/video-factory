const CHAR_CAP = 45_000;
const IG_CAP = 200;

function collapseNewlines(s: string): string {
  return s.replace(/\n/g, ' ');
}

export function formatFullBrief(contextPacket: any): string {
  if (!contextPacket) return '(no context packet)';

  const brief = contextPacket.brief ?? {};
  const clips = contextPacket.clips ?? {};
  const copy = contextPacket.copy ?? {};

  const selectionsBySegment = new Map<number, any>();
  for (const sel of clips.clip_selections ?? []) {
    selectionsBySegment.set(sel.segment_id, sel);
  }

  const lines: string[] = [];

  // SLOT sections
  const segments = brief.segments ?? [];
  for (const seg of segments) {
    const labelSuffix = seg.label && seg.label !== seg.type ? ` — ${seg.label}` : '';

    const parenParts: string[] = [`${seg.duration_target}s`];
    if (seg.energy_level !== undefined && seg.energy_level !== null) {
      parenParts.push(`energy ${seg.energy_level}/10`);
    }
    if (seg.pacing) parenParts.push(seg.pacing);
    const paren = `(${parenParts.join(', ')})`;

    lines.push(`=== SLOT ${seg.segment_id} — ${seg.type}${labelSuffix} ${paren} ===`);

    if (seg.text_overlay?.text) {
      const style = seg.text_overlay.style ? ` [${seg.text_overlay.style}]` : '';
      lines.push(`Overlay: "${seg.text_overlay.text}"${style}`);
    }

    const cr = seg.clip_requirements ?? {};
    const types = Array.isArray(cr.content_type) ? cr.content_type.join('/') : (cr.content_type ?? '?');
    const mood = Array.isArray(cr.mood) ? cr.mood.join('/') : (cr.mood ?? '?');
    const minQ = cr.min_quality !== undefined ? ` | min_quality=${cr.min_quality}` : '';
    lines.push(`Requirements: type=${types} | mood=${mood}${minQ}`);

    const sel = selectionsBySegment.get(seg.segment_id);
    if (sel) {
      const score = typeof sel.match_score === 'number' ? sel.match_score : null;
      const rationale = typeof sel.match_rationale === 'string' ? sel.match_rationale : '';
      const isFallback = (score !== null && score < 0.5) || rationale.startsWith('Fallback:');
      const prefix = isFallback ? '⚠️ FALLBACK ' : '';

      if (Array.isArray(sel.clips) && sel.clips.length > 0) {
        for (const c of sel.clips) {
          const id = c.asset_id ? `${c.asset_id.slice(0, 8)}...` : '(no asset)';
          const trim = c.trim ? ` @ ${c.trim.start_s}-${c.trim.end_s}s` : '';
          lines.push(`${prefix}Picked: ${id}${trim}`);
        }
      } else {
        const id = sel.asset_id ? `${sel.asset_id.slice(0, 8)}...` : '(no asset)';
        const trim = sel.trim ? ` @ ${sel.trim.start_s}-${sel.trim.end_s}s` : '';
        const scoreStr = score !== null ? ` (match ${score.toFixed(2)})` : '';
        lines.push(`${prefix}Picked: ${id}${trim}${scoreStr}`);
      }

      if (rationale) lines.push(`Reasoning: ${rationale}`);
    } else {
      lines.push('(no clip selected)');
    }
    lines.push('');
  }

  // COPY section
  lines.push('=== COPY ===');

  const hookVariants = copy.hook_variants ?? [];
  if (hookVariants.length > 0) {
    lines.push('Hook variants:');
    for (const h of hookVariants) {
      const text = typeof h.text === 'string' ? collapseNewlines(h.text) : '';
      lines.push(`  - "${text}" [${h.style ?? '?'}]`);
    }
  }

  const captions = copy.captions ?? {};
  const tiktok = typeof captions.tiktok === 'string' ? collapseNewlines(captions.tiktok) : '';
  const instagramRaw = typeof captions.instagram === 'string' ? collapseNewlines(captions.instagram) : '';
  const youtube = typeof captions.youtube === 'string' ? collapseNewlines(captions.youtube) : '';

  const hasCaptions = tiktok || instagramRaw || youtube;
  if (hasCaptions) {
    lines.push('Captions:');
    if (tiktok) lines.push(`  TikTok: ${tiktok}`);
    if (instagramRaw) {
      const ig = instagramRaw.length > IG_CAP
        ? instagramRaw.slice(0, IG_CAP) + ' [...]'
        : instagramRaw;
      lines.push(`  Instagram: ${ig}`);
    }
    if (youtube) lines.push(`  YouTube: ${youtube}`);
  }

  const hashtags = copy.hashtags ?? {};
  const hasTags = hashtags.tiktok?.length || hashtags.instagram?.length || hashtags.youtube?.length;
  if (hasTags) {
    lines.push('Hashtags:');
    if (hashtags.tiktok?.length) lines.push(`  TikTok: ${hashtags.tiktok.join(' ')}`);
    if (hashtags.instagram?.length) lines.push(`  Instagram: ${hashtags.instagram.join(' ')}`);
    if (hashtags.youtube?.length) lines.push(`  YouTube: ${hashtags.youtube.join(' ')}`);
  }

  let out = lines.join('\n');
  if (out.length > CHAR_CAP) {
    out = out.slice(0, CHAR_CAP - 32) + '\n\n[... truncated at 45000 chars]';
  }
  return out;
}
