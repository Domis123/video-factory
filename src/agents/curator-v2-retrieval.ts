import { supabaseAdmin } from '../config/supabase.js';
import { embedText } from '../lib/clip-embed.js';

// ── Types ──

export interface BriefSlot {
  index: number;
  description: string;
  valid_segment_types: string[];
  min_quality: number;
  aesthetic_guidance?: string;
  body_focus?: string;
  type?: 'hook' | 'body' | 'cta';
}

export interface CandidateSegment {
  segmentId: string;
  parentAssetId: string;
  parentR2Key: string;
  brandId: string;
  startS: number;
  endS: number;
  durationS: number;
  segmentType: string;
  description: string;
  qualityScore: number;
  distance: number;
  clipR2Key: string | null;
}

/**
 * Retrieve top-K candidate segments for a brief slot via CLIP vector search.
 * Calls the match_segments RPC (pgvector cosine similarity) then resolves
 * parent r2_keys from the assets table.
 */
export async function retrieveCandidatesForSlot(
  slot: BriefSlot,
  brandId: string,
  topK = 15,
): Promise<CandidateSegment[]> {
  // 1. Embed slot description via CLIP text encoder
  console.log(`[curator-v2-retrieval] Embedding slot ${slot.index}: "${slot.description.slice(0, 60)}..."`);
  const embedding = await embedText(slot.description);

  // 2. Call match_segments RPC
  // pgvector expects the embedding as a string literal '[v1,v2,...]'
  const embeddingLiteral = `[${embedding.join(',')}]`;

  const { data: matches, error: rpcErr } = await supabaseAdmin
    .rpc('match_segments', {
      query_embedding: embeddingLiteral,
      brand_filter: brandId,
      type_filter: slot.valid_segment_types,
      min_quality: slot.min_quality,
      match_count: topK,
    });

  if (rpcErr) {
    console.error(`[curator-v2-retrieval] RPC error for slot ${slot.index}:`, rpcErr.message);
    return [];
  }

  if (!matches || matches.length === 0) {
    console.warn(`[curator-v2-retrieval] Zero candidates for slot ${slot.index}`);
    return [];
  }

  // 3. Resolve parent r2_keys — batch query
  const parentIds = [...new Set(matches.map((m: any) => m.parent_asset_id as string))];
  const { data: parents, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id, r2_key')
    .in('id', parentIds);

  if (parentErr) {
    console.error(`[curator-v2-retrieval] Failed to resolve parent assets:`, parentErr.message);
    return [];
  }

  const r2Map = new Map<string, string>();
  for (const p of parents ?? []) {
    r2Map.set(p.id, p.r2_key);
  }

  // 4. Join and return
  const candidates: CandidateSegment[] = [];
  for (const m of matches) {
    const r2Key = r2Map.get(m.parent_asset_id as string);
    if (!r2Key) continue; // orphaned segment — skip

    candidates.push({
      segmentId: m.id as string,
      parentAssetId: m.parent_asset_id as string,
      parentR2Key: r2Key,
      brandId: m.brand_id as string,
      startS: Number(m.start_s),
      endS: Number(m.end_s),
      durationS: Number(m.duration_s),
      segmentType: m.segment_type as string,
      description: m.description as string,
      qualityScore: Number(m.quality_score),
      distance: Number(m.distance),
      clipR2Key: (m.clip_r2_key as string) ?? null,
    });
  }

  console.log(
    `[curator-v2-retrieval] Slot ${slot.index}: ${candidates.length} candidates ` +
    `(distance range: ${candidates[0]?.distance.toFixed(3)} – ${candidates[candidates.length - 1]?.distance.toFixed(3)})`,
  );

  return candidates;
}
