-- ========== VIDEO FACTORY SCHEMA ==========
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard → your project → SQL Editor

-- 1. Job status enum
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM (
    'idle','idea_seed','planning','brief_review','queued',
    'clip_prep','transcription','rendering','audio_mix',
    'sync_check','platform_export','auto_qa','human_qa',
    'delivered','failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Brand configs
CREATE TABLE IF NOT EXISTS brand_configs (
  brand_id VARCHAR(50) PRIMARY KEY,
  brand_name VARCHAR(200) NOT NULL,
  primary_color VARCHAR(7) NOT NULL CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color VARCHAR(7) NOT NULL CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color VARCHAR(7) CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family VARCHAR(100) NOT NULL,
  font_weight_title INTEGER DEFAULT 700,
  font_weight_body INTEGER DEFAULT 400,
  caption_preset JSONB NOT NULL,
  logo_r2_key TEXT NOT NULL,
  watermark_r2_key TEXT,
  watermark_position VARCHAR(20) DEFAULT 'top_right',
  watermark_opacity FLOAT DEFAULT 0.6 CHECK (watermark_opacity BETWEEN 0 AND 1),
  cta_style VARCHAR(50) DEFAULT 'button_rounded',
  cta_bg_color VARCHAR(7),
  cta_text_color VARCHAR(7),
  transition_style VARCHAR(20) DEFAULT 'fade',
  voice_guidelines TEXT,
  hook_style_preference JSONB DEFAULT '[]',
  content_pillars JSONB DEFAULT '[]',
  drive_input_folder_id VARCHAR(255),
  drive_output_folder_id VARCHAR(255),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Assets
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id VARCHAR(50) NOT NULL REFERENCES brand_configs(brand_id),
  drive_file_id VARCHAR(255),
  r2_key TEXT NOT NULL,
  r2_url TEXT NOT NULL,
  filename VARCHAR(500),
  duration_seconds FLOAT,
  resolution VARCHAR(20),
  aspect_ratio VARCHAR(10),
  file_size_mb FLOAT,
  content_type VARCHAR(50),
  mood VARCHAR(50),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 10),
  has_speech BOOLEAN DEFAULT false,
  transcript_summary TEXT,
  visual_elements JSONB DEFAULT '[]',
  usable_segments JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  used_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  indexed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assets_brand ON assets(brand_id);
CREATE INDEX IF NOT EXISTS idx_assets_content ON assets(content_type);
CREATE INDEX IF NOT EXISTS idx_assets_quality ON assets(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_assets_used ON assets(used_count ASC, last_used_at ASC);

-- 4. Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id VARCHAR(50) NOT NULL REFERENCES brand_configs(brand_id),
  status job_status NOT NULL DEFAULT 'idea_seed',
  idea_seed TEXT,
  context_packet JSONB,
  brief_summary TEXT,
  hook_text TEXT,
  cta_text TEXT,
  template_id VARCHAR(100),
  clip_selections JSONB,
  copy_package JSONB,
  review_decision VARCHAR(20),
  rejection_notes TEXT,
  rejection_count INTEGER DEFAULT 0,
  render_worker_id VARCHAR(50),
  render_started_at TIMESTAMPTZ,
  render_completed_at TIMESTAMPTZ,
  rendered_video_r2_key TEXT,
  preview_url TEXT,
  auto_qa_results JSONB,
  auto_qa_passed BOOLEAN,
  qa_decision VARCHAR(20),
  qa_issues JSONB DEFAULT '[]',
  qa_notes TEXT,
  qa_reviewed_by VARCHAR(100),
  qa_reviewed_at TIMESTAMPTZ,
  final_outputs JSONB,
  metadata_sidecar JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_brand ON jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

-- 5. Job events
CREATE TABLE IF NOT EXISTS job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON job_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON job_events(event_type);

-- 6. Music tracks
CREATE TABLE IF NOT EXISTS music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  artist VARCHAR(500),
  r2_key TEXT NOT NULL,
  duration_seconds FLOAT,
  mood VARCHAR(50),
  genre VARCHAR(50),
  tempo_bpm INTEGER,
  energy_level INTEGER CHECK (energy_level BETWEEN 1 AND 10),
  license_source VARCHAR(50),
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_mood ON music_tracks(mood);
CREATE INDEX IF NOT EXISTS idx_music_energy ON music_tracks(energy_level);

-- 7. Auto-updating updated_at trigger on jobs
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_updated_at ON jobs;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Helpful views
CREATE OR REPLACE VIEW v_active_jobs AS
SELECT * FROM jobs WHERE status NOT IN ('delivered', 'failed');

CREATE OR REPLACE VIEW v_stale_jobs AS
SELECT * FROM jobs
WHERE status IN ('clip_prep','transcription','rendering','audio_mix','sync_check')
  AND updated_at < NOW() - INTERVAL '30 minutes';

CREATE OR REPLACE VIEW v_brand_stats AS
SELECT brand_id,
  COUNT(*) AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) AS avg_turnaround_seconds
FROM jobs GROUP BY brand_id;

-- 9. Seed 5 pilot brands
INSERT INTO brand_configs (brand_id, brand_name, primary_color, secondary_color, accent_color, font_family, caption_preset, logo_r2_key, content_pillars, voice_guidelines)
VALUES
  ('nordpilates', 'NordPilates', '#E8B4A2', '#2C2C2C', '#FFFFFF', 'Montserrat',
   '{"preset_name":"nordpilates_default","engine":"remotion_caption_component","style":{"font_family":"Montserrat","font_size":42,"font_weight":700,"text_color":"#FFFFFF","stroke_color":"#000000","stroke_width":3,"background":"none","position":"bottom_center","margin_bottom_px":160,"max_width_percent":85,"text_align":"center","animation":{"type":"word_by_word","highlight_color":"#E8B4A2","highlight_style":"background_pill","word_gap_ms":50},"shadow":{"color":"rgba(0,0,0,0.5)","blur":4,"offset_x":0,"offset_y":2}}}',
   'brands/nordpilates/logo.png', '["pilates","flexibility","wellness","mindful movement"]',
   'Encouraging, knowledgeable, calm but energizing. Speak like a supportive instructor.'),

  ('ketoway', 'KetoWay', '#4CAF50', '#1B1B1B', '#FFD700', 'Inter',
   '{"preset_name":"ketoway_default","engine":"remotion_caption_component","style":{"font_family":"Inter","font_size":40,"font_weight":700,"text_color":"#FFFFFF","stroke_color":"#000000","stroke_width":3,"background":"none","position":"bottom_center","margin_bottom_px":160,"max_width_percent":85,"text_align":"center","animation":{"type":"word_by_word","highlight_color":"#4CAF50","highlight_style":"background_pill","word_gap_ms":50},"shadow":{"color":"rgba(0,0,0,0.5)","blur":4,"offset_x":0,"offset_y":2}}}',
   'brands/ketoway/logo.png', '["keto recipes","meal prep","weight loss","low carb"]',
   'Friendly, practical, no-nonsense. Focus on easy wins and real results.'),

  ('carnimeat', 'CarniMeat', '#8B0000', '#1A1A1A', '#FF6347', 'Oswald',
   '{"preset_name":"carnimeat_default","engine":"remotion_caption_component","style":{"font_family":"Oswald","font_size":44,"font_weight":700,"text_color":"#FFFFFF","stroke_color":"#000000","stroke_width":3,"background":"none","position":"bottom_center","margin_bottom_px":160,"max_width_percent":85,"text_align":"center","animation":{"type":"word_by_word","highlight_color":"#FF6347","highlight_style":"background_pill","word_gap_ms":50},"shadow":{"color":"rgba(0,0,0,0.5)","blur":4,"offset_x":0,"offset_y":2}}}',
   'brands/carnimeat/logo.png', '["carnivore diet","meat recipes","protein","animal-based"]',
   'Bold, confident, slightly provocative. Challenge mainstream nutrition advice.'),

  ('nodiet', 'NoDiet', '#FF69B4', '#2D2D2D', '#FFF0F5', 'Poppins',
   '{"preset_name":"nodiet_default","engine":"remotion_caption_component","style":{"font_family":"Poppins","font_size":40,"font_weight":600,"text_color":"#FFFFFF","stroke_color":"#000000","stroke_width":3,"background":"none","position":"bottom_center","margin_bottom_px":160,"max_width_percent":85,"text_align":"center","animation":{"type":"word_by_word","highlight_color":"#FF69B4","highlight_style":"background_pill","word_gap_ms":50},"shadow":{"color":"rgba(0,0,0,0.5)","blur":4,"offset_x":0,"offset_y":2}}}',
   'brands/nodiet/logo.png', '["intuitive eating","body positivity","food freedom","mindful eating"]',
   'Warm, empathetic, liberating. Anti-diet culture messaging.'),

  ('highdiet', 'HighDiet', '#00BFFF', '#0D0D0D', '#E0F7FA', 'Raleway',
   '{"preset_name":"highdiet_default","engine":"remotion_caption_component","style":{"font_family":"Raleway","font_size":40,"font_weight":700,"text_color":"#FFFFFF","stroke_color":"#000000","stroke_width":3,"background":"none","position":"bottom_center","margin_bottom_px":160,"max_width_percent":85,"text_align":"center","animation":{"type":"word_by_word","highlight_color":"#00BFFF","highlight_style":"background_pill","word_gap_ms":50},"shadow":{"color":"rgba(0,0,0,0.5)","blur":4,"offset_x":0,"offset_y":2}}}',
   'brands/highdiet/logo.png', '["high protein","muscle building","fitness nutrition","supplements"]',
   'Energetic, motivational, science-backed. Speak like a knowledgeable gym bro.')
ON CONFLICT (brand_id) DO NOTHING;

-- 10. Enable RLS (with service_role bypass)
ALTER TABLE brand_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;

-- ========== END ==========
