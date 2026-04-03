// ── Job Status (matches Postgres ENUM `job_status`) ──

export type JobStatus =
  | 'idle'
  | 'idea_seed'
  | 'planning'
  | 'brief_review'
  | 'queued'
  | 'clip_prep'
  | 'transcription'
  | 'rendering'
  | 'audio_mix'
  | 'sync_check'
  | 'platform_export'
  | 'auto_qa'
  | 'human_qa'
  | 'delivered'
  | 'failed';

// ── Database Row Types ──

export interface BrandConfig {
  brand_id: string;
  brand_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string | null;
  font_family: string;
  font_weight_title: number;
  font_weight_body: number;
  caption_preset: CaptionPreset;
  logo_r2_key: string;
  watermark_r2_key: string | null;
  watermark_position: string;
  watermark_opacity: number;
  cta_style: string;
  cta_bg_color: string | null;
  cta_text_color: string | null;
  transition_style: string;
  voice_guidelines: string | null;
  hook_style_preference: string[];
  content_pillars: string[];
  drive_input_folder_id: string | null;
  drive_output_folder_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  brand_id: string;
  drive_file_id: string | null;
  r2_key: string;
  r2_url: string;
  filename: string | null;
  duration_seconds: number | null;
  resolution: string | null;
  aspect_ratio: string | null;
  file_size_mb: number | null;
  content_type: string | null;
  mood: string | null;
  quality_score: number | null;
  has_speech: boolean;
  transcript_summary: string | null;
  visual_elements: string[];
  usable_segments: UsableSegment[];
  tags: string[];
  used_count: number;
  last_used_at: string | null;
  created_at: string;
  indexed_at: string | null;
}

export interface Job {
  id: string;
  brand_id: string;
  status: JobStatus;
  idea_seed: string | null;
  context_packet: ContextPacket | null;
  brief_summary: string | null;
  hook_text: string | null;
  cta_text: string | null;
  template_id: string | null;
  clip_selections: ClipSelectionList | null;
  copy_package: CopyPackage | null;
  review_decision: string | null;
  rejection_notes: string | null;
  rejection_count: number;
  render_worker_id: string | null;
  render_started_at: string | null;
  render_completed_at: string | null;
  rendered_video_r2_key: string | null;
  preview_url: string | null;
  auto_qa_results: AutoQAResults | null;
  auto_qa_passed: boolean | null;
  qa_decision: string | null;
  qa_issues: string[];
  qa_notes: string | null;
  qa_reviewed_by: string | null;
  qa_reviewed_at: string | null;
  final_outputs: PlatformOutputs | null;
  metadata_sidecar: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobEvent {
  id: number;
  job_id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  event_type: 'state_transition' | 'error' | 'retry' | 'timeout';
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface MusicTrack {
  id: string;
  title: string | null;
  artist: string | null;
  r2_key: string;
  duration_seconds: number | null;
  mood: string | null;
  genre: string | null;
  tempo_bpm: number | null;
  energy_level: number | null;
  license_source: string | null;
  used_count: number;
  created_at: string;
}

// ── Nested / JSONB Types ──

export interface UsableSegment {
  start_s: number;
  end_s: number;
  description: string;
}

export interface CaptionPreset {
  preset_name: string;
  engine: string;
  style: {
    font_family: string;
    font_size: number;
    font_weight: number;
    text_color: string;
    stroke_color: string;
    stroke_width: number;
    background: string;
    position: string;
    margin_bottom_px: number;
    max_width_percent: number;
    text_align: string;
    animation: {
      type: string;
      highlight_color: string;
      highlight_style: string;
      word_gap_ms: number;
    };
    shadow: {
      color: string;
      blur: number;
      offset_x: number;
      offset_y: number;
    };
  };
}

// ── Context Packet (immutable artifact from planning) ──

export interface ContextPacket {
  context_packet_id: string;
  brief: CreativeBrief;
  clips: ClipSelectionList;
  copy: CopyPackage;
  brand_config: BrandConfig;
  template_config: Record<string, unknown>;
  music_selection: {
    track_id: string;
    r2_key: string;
    volume_level: number;
  } | null;
  created_at: string;
}

// ── Creative Brief (Agent 1: Creative Director output) ──

export interface CreativeBrief {
  brief_id: string;
  brand_id: string;
  template_id: string;
  total_duration_target: number;
  segments: BriefSegment[];
  audio: {
    strategy: string;
    background_music: {
      mood: string;
      volume_level: number;
    };
  };
  caption_preset: string;
}

export interface BriefSegment {
  segment_id: number;
  type: 'hook' | 'body' | 'cta';
  duration_target: number;
  clip_requirements: {
    content_type: string[];
    mood: string | string[];
    visual_elements?: string[];
    min_quality?: number;
    has_speech?: boolean;
  };
  text_overlay: {
    text: string;
    style: string;
    position: string;
    animation?: string;
  };
  sub_segments?: {
    duration: number;
    text_overlay: { text: string; style: string };
  }[];
}

// ── Clip Selection List (Agent 2: Asset Curator output) ──

export interface ClipSelectionList {
  brief_id: string;
  clip_selections: ClipSelection[];
}

export interface ClipSelection {
  segment_id: number;
  asset_id?: string;
  r2_key?: string;
  trim?: { start_s: number; end_s: number };
  match_score?: number;
  match_rationale?: string;
  clips?: {
    asset_id: string;
    r2_key: string;
    trim: { start_s: number; end_s: number };
  }[];
}

// ── Copy Package (Agent 3: Copywriter output) ──

export interface CopyPackage {
  brief_id: string;
  overlays: CopyOverlay[];
  captions: {
    tiktok: string;
    instagram: string;
    youtube: string;
  };
  hashtags: {
    tiktok: string[];
    instagram: string[];
    youtube: string[];
  };
  hook_variants: {
    text: string;
    style: string;
  }[];
}

export interface CopyOverlay {
  segment_id: number;
  text?: string;
  char_count?: number;
  timing?: { appear_s: number; duration_s: number };
  sub_overlays?: {
    text: string;
    char_count: number;
    timing: { appear_s: number; duration_s: number };
  }[];
}

// ── QA & Output Types ──

export interface AutoQAResults {
  duration_check: QACheck;
  resolution_check: QACheck;
  audio_check: QACheck;
  sync_check: QACheck;
  text_readability: QACheck;
  logo_presence: QACheck;
  black_frame_check: QACheck;
  aspect_ratio_check: QACheck;
}

export interface QACheck {
  passed: boolean;
  details: string;
  value?: number | string;
}

export interface PlatformOutputs {
  tiktok?: string;
  instagram?: string;
  youtube?: string;
}
