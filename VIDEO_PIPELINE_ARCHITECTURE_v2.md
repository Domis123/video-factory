# Video Factory — Full Pipeline Architecture (v2)

## Executive Summary

A 95% automated video production system for 30 brands, producing ~150 short-form videos per week (30-60 seconds each) for TikTok, Instagram Reels, and YouTube Shorts. The system uses UGC footage from Google Drive as source material, AI agents for creative planning, and automated rendering via FFmpeg + Remotion on VPS workers.

**Scale**: 30 brands × 5 videos/week = 150 videos/week = ~21 videos/day

### Finalized Stack

| Role | Tool | Notes |
|------|------|-------|
| Orchestrator | n8n (self-hosted, Hetzner) | Existing server, SSH access |
| Database | Supabase (Postgres) | Asset catalog, jobs, brand configs, job_events |
| Job Queue | BullMQ + Upstash Redis | Serverless Redis, scales per-command |
| Render Workers | Hetzner VPS × 3 (CX41) | 8 vCPU, 16GB RAM — FFmpeg, Remotion, whisper.cpp |
| Working Storage | Cloudflare R2 | Clips, rendered videos, brand assets — zero egress |
| UGC Source | Google Drive | Drop zone only — write-once, read-never after ingestion |
| AI Agents | Claude Sonnet API | 3 creative agents + clip tagger |
| Transcription | whisper.cpp (self-hosted) | Runs on render workers, eliminates API cost |
| Worker Interface | Google Sheets | Read-only view of Supabase state |
| Music | Artlist / Epidemic Sound | Licensed library, mood-tagged in DB |
| Template Engine | Remotion | Open source, React-based video renderer |

---

## 1. System Layers

### Layer 1 — Asset Ingestion & Cataloging

**Purpose**: Transform raw UGC dumps into a searchable, tagged asset library. Clips are copied to R2 during ingestion — the render pipeline never touches Google Drive.

**Flow**: Drive (drop zone) → Download to VPS → FFprobe → AI Tagger → Copy to R2 → Insert metadata to Supabase → Done

**Components**:

- **Google Drive Watcher** (n8n) — Monitors brand-specific Drive folders for new uploads. Triggers on new file detection. Drive is write-once: workers upload raw UGC here and the system never reads from it again after ingestion.
- **Asset Processor** (runs on render VPS workers) — Not a separate service. The same workers that render videos also handle ingestion during idle time. Extracts metadata via FFprobe: duration, resolution, aspect ratio, file size, codec.
- **AI Clip Tagger** (Claude/Gemini API) — Analyzes each clip (samples 3-5 frames + audio) and assigns structured tags:
  - `content_type`: talking-head, product-demo, b-roll, lifestyle, unboxing, testimonial, workout, cooking, before-after
  - `mood`: energetic, calm, inspirational, funny, serious, casual
  - `quality_score`: 1-10 (based on lighting, stability, audio clarity)
  - `usable_segments`: array of `{start_s, end_s, description}` — identifies best sub-clips
  - `has_speech`: boolean + transcript summary
  - `visual_elements`: what's visible (product, person, food, nature, gym, kitchen, etc.)
- **R2 Upload** — After tagging, the raw clip is uploaded to R2 at a deterministic path: `assets/{brand_id}/{asset_id}.{ext}`. All downstream pipeline reads come from R2.
- **Asset Database** (Supabase Postgres) — Schema:

```sql
-- Assets table
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id VARCHAR(50) NOT NULL,
  drive_file_id VARCHAR(255),
  r2_key TEXT NOT NULL,                -- "assets/nordpilates/uuid.mp4"
  r2_url TEXT NOT NULL,                -- Full R2 URL for direct access
  filename VARCHAR(500),
  duration_seconds FLOAT,
  resolution VARCHAR(20),              -- "1080x1920", "720x1280"
  aspect_ratio VARCHAR(10),            -- "9:16", "16:9", "1:1"
  file_size_mb FLOAT,
  content_type VARCHAR(50),
  mood VARCHAR(50),
  quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 10),
  has_speech BOOLEAN DEFAULT false,
  transcript_summary TEXT,
  visual_elements JSONB DEFAULT '[]',  -- ["product", "person", "kitchen"]
  usable_segments JSONB DEFAULT '[]',  -- [{start_s, end_s, description}]
  tags JSONB DEFAULT '[]',             -- flexible tag array
  used_count INTEGER DEFAULT 0,        -- prevents overuse
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  indexed_at TIMESTAMPTZ
);

CREATE INDEX idx_assets_brand ON assets(brand_id);
CREATE INDEX idx_assets_content ON assets(content_type);
CREATE INDEX idx_assets_quality ON assets(quality_score DESC);
CREATE INDEX idx_assets_tags ON assets USING GIN(tags);
CREATE INDEX idx_assets_used ON assets(used_count ASC, last_used_at ASC);

-- Jobs table
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'idea_seed',
  idea_seed TEXT,
  context_packet JSONB,                -- Full context packet after planning
  brief_summary TEXT,
  hook_text TEXT,
  cta_text TEXT,
  template_id VARCHAR(100),
  clip_selections JSONB,
  copy_package JSONB,
  
  -- Review fields
  review_decision VARCHAR(20),         -- approve / reject / edit
  rejection_notes TEXT,
  rejection_count INTEGER DEFAULT 0,
  
  -- Render fields
  render_worker_id VARCHAR(50),
  render_started_at TIMESTAMPTZ,
  render_completed_at TIMESTAMPTZ,
  rendered_video_r2_key TEXT,
  preview_url TEXT,
  
  -- QA fields
  auto_qa_results JSONB,
  auto_qa_passed BOOLEAN,
  qa_decision VARCHAR(20),
  qa_issues JSONB DEFAULT '[]',
  qa_notes TEXT,
  qa_reviewed_by VARCHAR(100),
  qa_reviewed_at TIMESTAMPTZ,
  
  -- Output
  final_outputs JSONB,                 -- {tiktok: "r2://...", instagram: "r2://...", youtube: "r2://..."}
  metadata_sidecar JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_brand ON jobs(brand_id);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

-- Job events table (monitoring/observability)
CREATE TABLE job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  event_type VARCHAR(50) NOT NULL,     -- "state_transition", "error", "retry", "timeout"
  details JSONB,                       -- Error messages, retry counts, worker info
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_job ON job_events(job_id);
CREATE INDEX idx_events_created ON job_events(created_at DESC);
CREATE INDEX idx_events_type ON job_events(event_type);

-- Brand configs table (source of truth — NOT Google Sheets)
CREATE TABLE brand_configs (
  brand_id VARCHAR(50) PRIMARY KEY,
  brand_name VARCHAR(200) NOT NULL,
  
  -- Colors
  primary_color VARCHAR(7) NOT NULL CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color VARCHAR(7) NOT NULL CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color VARCHAR(7) CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  
  -- Typography
  font_family VARCHAR(100) NOT NULL,
  font_weight_title INTEGER DEFAULT 700,
  font_weight_body INTEGER DEFAULT 400,
  
  -- Caption preset
  caption_preset JSONB NOT NULL,       -- Full caption style config
  
  -- Brand assets (R2 URLs)
  logo_r2_key TEXT NOT NULL,
  watermark_r2_key TEXT,
  watermark_position VARCHAR(20) DEFAULT 'top_right',
  watermark_opacity FLOAT DEFAULT 0.6 CHECK (watermark_opacity BETWEEN 0 AND 1),
  
  -- CTA style
  cta_style VARCHAR(50) DEFAULT 'button_rounded',
  cta_bg_color VARCHAR(7),
  cta_text_color VARCHAR(7),
  
  -- Content config
  transition_style VARCHAR(20) DEFAULT 'fade',
  voice_guidelines TEXT,
  hook_style_preference JSONB DEFAULT '[]',
  content_pillars JSONB DEFAULT '[]',
  
  -- Drive folders (for ingestion only)
  drive_input_folder_id VARCHAR(255),
  drive_output_folder_id VARCHAR(255),
  
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Music library
CREATE TABLE music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  artist VARCHAR(500),
  r2_key TEXT NOT NULL,
  duration_seconds FLOAT,
  mood VARCHAR(50),                    -- energetic, calm, upbeat, dramatic, minimal
  genre VARCHAR(50),                   -- electronic, acoustic, hip-hop, ambient
  tempo_bpm INTEGER,
  energy_level INTEGER CHECK (energy_level BETWEEN 1 AND 10),
  license_source VARCHAR(50),          -- artlist, epidemic, pixabay
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_music_mood ON music_tracks(mood);
CREATE INDEX idx_music_energy ON music_tracks(energy_level);
```

**Key design decisions**:

1. **Drive is a drop zone only.** Workers upload raw UGC to Drive. The ingestion pipeline downloads it once, processes it, copies to R2, indexes in Supabase. From that point on, the clip lives on R2. The render pipeline never calls the Drive API. This eliminates the Drive rate limit risk entirely.

2. **Brand configs live in Supabase, not Sheets.** Color hex values are validated by regex constraints. Required fields are enforced by NOT NULL. No accidental cell edit can silently break renders. A read-only Google Sheet can be generated from Supabase for worker visibility, but the Sheet is never the source of truth.

3. **No standalone Asset Indexer service.** The processing runs on the render VPS workers during idle time, triggered via BullMQ. One fewer service to deploy and maintain.

---

### Layer 2 — Creative Planning (Multi-Agent System)

**Purpose**: Transform a simple idea seed from a worker into a fully detailed creative brief.

**Critical architecture decision**: Planning is split across **multiple n8n workflows**, not one long-lived execution. State lives in Supabase, not in n8n execution memory. An n8n restart loses nothing.

#### Workflow Split

```
Workflow 2A: Plan Generation
  Trigger: Sheet webhook (new idea_seed)
  → Claim job in Supabase (UPDATE ... WHERE status = 'idea_seed' RETURNING *)
  → Fetch brand config from Supabase
  → Agent 1: Creative Director
  → Agent 2: Asset Curator  }  parallelized after Agent 1
  → Agent 3: Copywriter     }
  → Merge into Context Packet
  → Save Context Packet to Supabase (jobs.context_packet)
  → Log event: job_events (idea_seed → brief_review)
  → Update job status: "brief_review"
  → Update Sheet row: populate brief_summary, hook_text, status
  END. Execution completes. No waiting.

Workflow 2B: Brief Approval Handler
  Trigger: Sheet webhook (review_decision column changed)
  → Read job from Supabase
  → IF approved:
      → Update status: "queued"
      → Log event: brief_review → queued
      → Enqueue job_id in BullMQ (priority by brand)
  → IF rejected:
      → Increment rejection_count
      → Log event: brief_review → planning (with rejection_notes)
      → Re-trigger Workflow 2A with rejection context
  END. Clean execution, no state to lose.
```

#### Agent Architecture

**Agent 1: Creative Director** (Claude Sonnet via API)
- **System prompt** includes: brand voice guidelines, template catalog, trending hooks database, performance data from past videos
- **Input**: idea seed (1-2 sentences from worker), brand config from Supabase
- **Process**: 
  1. Pulls brand config (colors, fonts, CTA style, caption preset)
  2. Selects video template (from template registry)
  3. Structures the video timeline: hook (0-3s), body segments, CTA (last 3-5s)
  4. Specifies text overlays with timing
  5. Defines clip requirements (what type of footage is needed at each segment)
- **Output**: Creative Brief JSON

```json
{
  "brief_id": "uuid",
  "brand_id": "nordpilates",
  "template_id": "hook-demo-cta-v3",
  "total_duration_target": 45,
  "segments": [
    {
      "segment_id": 1,
      "type": "hook",
      "duration_target": 3,
      "clip_requirements": {
        "content_type": ["b-roll", "lifestyle"],
        "mood": "energetic",
        "visual_elements": ["workout", "person"],
        "min_quality": 7
      },
      "text_overlay": {
        "text": "You've been stretching WRONG",
        "style": "hook_bold",
        "position": "center",
        "animation": "pop_in"
      }
    },
    {
      "segment_id": 2,
      "type": "body",
      "duration_target": 25,
      "clip_requirements": {
        "content_type": ["product-demo", "talking-head"],
        "mood": ["calm", "inspirational"],
        "has_speech": true,
        "visual_elements": ["person", "product"]
      },
      "sub_segments": [
        {"duration": 8, "text_overlay": {"text": "Step 1: Hip flexor release", "style": "subtitle"}},
        {"duration": 8, "text_overlay": {"text": "Step 2: Spinal decompression", "style": "subtitle"}},
        {"duration": 9, "text_overlay": {"text": "Step 3: Full body flow", "style": "subtitle"}}
      ]
    },
    {
      "segment_id": 3,
      "type": "cta",
      "duration_target": 5,
      "clip_requirements": {
        "content_type": ["b-roll", "lifestyle"],
        "mood": "inspirational"
      },
      "text_overlay": {
        "text": "Try NordPilates free for 7 days",
        "style": "cta_button",
        "position": "bottom_center"
      }
    }
  ],
  "audio": {
    "strategy": "ugc_audio_primary",
    "background_music": {
      "mood": "upbeat_minimal",
      "volume_level": 0.15
    }
  },
  "caption_preset": "nordpilates_default"
}
```

**Agent 2: Asset Curator** (Claude Sonnet via API)
- **Input**: Creative Brief + Asset DB query results (from Supabase REST API)
- **Process**:
  1. Queries asset DB with clip requirements from each segment
  2. Ranks candidates by quality, recency, and usage count (avoids overuse)
  3. Selects best clips with exact timestamps
  4. Validates total duration matches target (±5s tolerance)
  5. All clip references use R2 keys — no Drive URLs
- **Output**: Clip Selection List

```json
{
  "brief_id": "uuid",
  "clip_selections": [
    {
      "segment_id": 1,
      "asset_id": "uuid",
      "r2_key": "assets/nordpilates/abc123.mp4",
      "trim": {"start_s": 4.2, "end_s": 7.5},
      "match_score": 0.92,
      "match_rationale": "High-energy workout b-roll, well-lit, 1080x1920"
    },
    {
      "segment_id": 2,
      "clips": [
        {"asset_id": "uuid", "r2_key": "assets/nordpilates/def456.mp4", "trim": {"start_s": 0, "end_s": 8.0}},
        {"asset_id": "uuid", "r2_key": "assets/nordpilates/ghi789.mp4", "trim": {"start_s": 12.5, "end_s": 20.5}},
        {"asset_id": "uuid", "r2_key": "assets/nordpilates/jkl012.mp4", "trim": {"start_s": 3.0, "end_s": 12.0}}
      ]
    },
    {
      "segment_id": 3,
      "asset_id": "uuid",
      "r2_key": "assets/nordpilates/mno345.mp4",
      "trim": {"start_s": 0, "end_s": 5.0}
    }
  ]
}
```

**Agent 3: Copywriter** (Claude Sonnet via API)
- **Input**: Creative Brief + Brand voice guidelines (from Supabase brand_configs.voice_guidelines)
- **Process**:
  1. Generates all text overlays with exact character counts
  2. Writes caption/description for each platform
  3. Generates hashtag sets per platform
  4. Creates alt hook variants (A/B testing)
- **Output**: Copy Package

```json
{
  "brief_id": "uuid",
  "overlays": [
    {"segment_id": 1, "text": "You've been stretching WRONG", "char_count": 28},
    {"segment_id": 2, "sub_overlays": [
      {"text": "Step 1: Hip flexor release", "char_count": 26, "timing": {"appear_s": 3, "duration_s": 8}},
      {"text": "Step 2: Spinal decompression", "char_count": 28, "timing": {"appear_s": 11, "duration_s": 8}},
      {"text": "Step 3: Full body flow", "char_count": 22, "timing": {"appear_s": 19, "duration_s": 9}}
    ]},
    {"segment_id": 3, "text": "Try NordPilates free for 7 days", "char_count": 31}
  ],
  "captions": {
    "tiktok": "This changed everything #pilates #stretching #flexibility #nordpilates",
    "instagram": "Stop stretching like it's 2010. Here's what actually works...",
    "youtube": "3-Minute Pilates Flow That Actually Works | NordPilates"
  },
  "hook_variants": [
    {"text": "You've been stretching WRONG", "style": "controversial"},
    {"text": "3 stretches that changed my life", "style": "listicle"},
    {"text": "POV: You finally try real Pilates", "style": "pov"}
  ]
}
```

#### Context Packet

All three agent outputs are merged into a single **Context Packet** — an immutable artifact that carries all creative decisions through the entire pipeline:

```json
{
  "context_packet_id": "uuid",
  "brief": { /* Creative Brief */ },
  "clips": { /* Clip Selection List — all R2 keys */ },
  "copy": { /* Copy Package */ },
  "brand_config": { /* Pulled from Supabase brand_configs table */ },
  "template_config": { /* From template registry */ },
  "music_selection": {
    "track_id": "uuid",
    "r2_key": "music/upbeat_minimal_042.mp3",
    "volume_level": 0.15
  },
  "created_at": "2026-03-30T10:00:00Z"
}
```

The Context Packet is stored in `jobs.context_packet` (JSONB column in Supabase). It is written once during planning and read by the assembly pipeline. It is never mutated — if a rejection causes re-planning, a new Context Packet replaces the old one entirely.

#### Worker Interface (Google Sheets)

The primary human interface. **Sheets reads FROM Supabase** — it is a view layer, not a data source. n8n keeps the Sheet in sync by writing to it after every state transition. Worker actions (approve/reject, idea seed) are captured via Sheet webhooks that trigger n8n workflows which write to Supabase.

| Column | Purpose |
|--------|---------|
| `job_id` | Auto-generated UUID |
| `brand` | Dropdown: 30 brand options |
| `idea_seed` | Free text: worker writes concept |
| `status` | Auto-updated from Supabase |
| `brief_summary` | AI-generated summary of the brief |
| `selected_clips` | R2 preview links |
| `hook_text` | Editable: worker can modify |
| `cta_text` | Editable: worker can modify |
| `template` | Editable: worker can switch templates |
| `review_decision` | Dropdown: approve / reject / edit |
| `rejection_notes` | Free text: what to change |
| `final_video_url` | R2 presigned URL to rendered output |
| `qa_decision` | Dropdown: approve / reject |
| `qa_notes` | Free text |
| `created_at` | Timestamp |
| `completed_at` | Timestamp |

---

### Layer 3 — Video Assembly Engine

**Purpose**: Take a Context Packet and produce a rendered video file.

**Critical**: This pipeline reads clips from **R2 only**, never from Google Drive.

#### Tech Stack: Remotion + FFmpeg + whisper.cpp

- **Remotion** (React-based programmatic video) — Templates are React components with brand config injection. Renders via headless Chromium for pixel-perfect overlays, text animations, and transitions.
- **FFmpeg** — Pre-processing (clip trim, format normalize, audio extraction), post-processing (audio mix, final encoding, platform exports).
- **whisper.cpp** — Self-hosted on render workers. No API cost, no network latency. Runs on CPU (8 vCPU CX41 handles 1-minute clips in ~15 seconds).

#### Assembly Pipeline

```
Context Packet (from Supabase)
    │
    ├──1. CLIP PREPARATION (FFmpeg)
    │   ├── Download clips from R2 (parallel)
    │   ├── Trim to specified segments
    │   ├── Normalize: 1080x1920, 30fps, h264
    │   ├── Audio normalization (-14 LUFS)
    │   └── Output: /tmp/job_id/clips/
    │
    ├──2. TRANSCRIPTION (whisper.cpp — local)
    │   ├── Process each clip with speech
    │   ├── Generate word-level timestamps
    │   ├── Output: SRT + word-timestamp JSON
    │   └── ~15s per minute of audio on 8 vCPU
    │
    ├──3. REMOTION RENDER
    │   ├── Load template component (e.g., HookDemoCTA_v3)
    │   ├── Inject Context Packet as props
    │   ├── Template renders:
    │   │   ├── Background clips (composited)
    │   │   ├── Text overlays with animations
    │   │   ├── Logo + watermark
    │   │   ├── Caption track (word-by-word, brand preset)
    │   │   ├── Transition effects between segments
    │   │   └── CTA screen
    │   ├── Render at 1080x1920 @ 30fps
    │   └── Output: raw MP4 (no final audio mix yet)
    │
    ├──4. AUDIO MIX (FFmpeg)
    │   ├── Layer UGC audio track (from clips)
    │   ├── Layer background music from R2 (volume-ducked per Context Packet)
    │   ├── Apply audio normalization
    │   └── Merge with video
    │
    ├──5. A/V SYNC CHECK
    │   ├── Compare Whisper transcript timestamps against video timeline
    │   ├── For talking-head segments: verify lip-sync drift < 100ms
    │   ├── Flag if drift > 200ms → auto-retry with adjusted audio offset
    │   └── Log sync metrics to job_events
    │
    └──6. PLATFORM EXPORT (FFmpeg)
        ├── TikTok: h264, AAC, ≤60s, ≤287MB
        ├── Instagram: h264, AAC, ≤60s, ≤100MB
        ├── YouTube Shorts: h264, AAC, ≤60s
        └── Upload all versions to R2 → update jobs.final_outputs
```

#### Remotion Template System

Templates are React components that accept a standardized props interface:

```typescript
interface VideoTemplateProps {
  brand: BrandConfig;
  segments: Segment[];
  clips: ClipSelection[];
  copy: CopyPackage;
  captions: WordTimestamp[];
  music?: BackgroundMusic;
}
```

Template categories (initial set — expand per brand needs):

| Template ID | Structure | Best For |
|-------------|-----------|----------|
| `hook-demo-cta` | Hook → Product demo → CTA | Product showcases |
| `hook-listicle-cta` | Hook → 3-5 tips with overlays → CTA | Educational content |
| `hook-transformation` | Hook → Before/After → CTA | Fitness/diet results |
| `hook-testimonial-cta` | Hook → UGC testimonial → CTA | Social proof |
| `hook-broll-montage` | Hook → Fast-cut b-roll → CTA | Mood/aesthetic content |
| `pov-style` | POV text → UGC → Reveal → CTA | Trendy/relatable |
| `splitscreen-compare` | Split screen comparison → CTA | Product comparisons |
| `storytelling` | Setup → Conflict → Resolution → CTA | Narrative content |

Each template supports brand-level customization via the BrandConfig pulled from Supabase:
- Color scheme (primary, secondary, accent) — validated hex in DB
- Typography (font, weights, sizes per element type)
- Caption preset (font, color, stroke, animation style, position)
- Logo placement and sizing
- Transition style (cut, fade, slide, zoom)
- CTA design (button style, animation)

---

### Layer 4 — Brand Configuration System

**Purpose**: Ensure every video is perfectly on-brand without manual intervention.

**Source of truth**: `brand_configs` table in Supabase (see schema above). NOT Google Sheets.

**Why Supabase, not Sheets**:
- Column type constraints prevent invalid data (regex-validated hex colors, NOT NULL on required fields, CHECK constraints on numeric ranges)
- No accidental cell edits silently breaking renders
- Direct REST API access from render workers (Supabase PostgREST) — no Sheets API rate limits
- Proper foreign key relationships with jobs and assets tables
- Cache in Upstash Redis for sub-ms reads during render

**Google Sheets role**: A read-only "dashboard" Sheet is populated by n8n from Supabase for worker visibility. Workers can see brand configs in the Sheet but cannot edit them there. Config changes go through a protected process (admin updates Supabase directly, or via a simple admin UI).

#### Caption Presets

Each brand gets a named caption preset stored in the `brand_configs.caption_preset` JSONB column:

```json
{
  "preset_name": "nordpilates_default",
  "engine": "remotion_caption_component",
  "style": {
    "font_family": "Montserrat",
    "font_size": 42,
    "font_weight": 700,
    "text_color": "#FFFFFF",
    "stroke_color": "#000000",
    "stroke_width": 3,
    "background": "none",
    "position": "bottom_center",
    "margin_bottom_px": 160,
    "max_width_percent": 85,
    "text_align": "center",
    "animation": {
      "type": "word_by_word",
      "highlight_color": "#E8B4A2",
      "highlight_style": "background_pill",
      "word_gap_ms": 50
    },
    "shadow": {
      "color": "rgba(0,0,0,0.5)",
      "blur": 4,
      "offset_x": 0,
      "offset_y": 2
    }
  }
}
```

---

### Layer 5 — QA & Review System

**Purpose**: Human quality gate before final delivery. Automated checks catch technical failures before human eyes see the video.

#### Automated QA Checks (Pre-Human Review)

Before reaching human QA, the system runs automated checks:

1. **Duration check**: Is the video within 30-60s target range?
2. **Resolution check**: Is it 1080x1920?
3. **Audio check**: Is audio present? Is it within -14 LUFS ± 2?
4. **A/V sync check**: For talking-head segments, is lip-sync drift < 200ms? (Compares Whisper transcript timestamps against the video timeline position of each clip.)
5. **Text readability**: Are overlays on-screen long enough (>2s)?
6. **Logo presence**: Is logo/watermark detected in output?
7. **Black frame check**: Any unexpected black frames?
8. **Aspect ratio**: Confirmed 9:16?

Each check produces a pass/fail with details stored in `jobs.auto_qa_results` (JSONB). If A/V sync fails, the system auto-retries with an adjusted audio offset before flagging for human review. All other failures are logged and flagged.

#### QA Review Sheet (Google Sheets)

Videos land in a QA queue after rendering and auto-QA. Workers review and decide:

| Column | Purpose |
|--------|---------|
| `job_id` | Links back to job in Supabase |
| `brand` | Brand name |
| `preview_url` | R2 presigned URL for video preview |
| `thumbnail` | Auto-generated thumbnail |
| `duration` | Actual rendered duration |
| `hook_text` | For quick reference |
| `template_used` | Template ID |
| `auto_qa_result` | Pass / flagged (with details) |
| `qa_status` | pending → approved / rejected |
| `qa_issues` | Multi-select: audio_sync, text_overlap, clip_quality, wrong_clip, branding_error, timing_off |
| `qa_notes` | Free text feedback |
| `reviewed_by` | Worker name |

#### QA Approval Handler (Workflow 3B)

```
Trigger: Sheet webhook (qa_decision column changed)
  → Read job from Supabase
  → IF approved:
      → Update job status: "delivered"
      → Log event: human_qa → delivered
      → Copy final videos to Drive output folder (optional — for worker access)
      → Write metadata sidecar to R2
  → IF rejected:
      → Read qa_issues + qa_notes
      → Log event: human_qa → (planning or clip_prep, depending on issue type)
      → Route to appropriate re-work:
          → clip_quality / wrong_clip → re-trigger Asset Curator only
          → text_overlap / branding_error → re-trigger Copywriter + re-render
          → audio_sync / timing_off → re-render only
          → fundamental concept issue → re-trigger full planning (Workflow 2A)
  END.
```

---

### Layer 6 — Output & Organization

**Purpose**: Organize finished videos for easy access and future distribution.

#### Output Structure (R2 — primary)

```
r2://video-factory/
├── rendered/
│   ├── nordpilates/
│   │   ├── 2026-03/
│   │   │   ├── 2026-03-30_hook-demo-cta_stretching-wrong_v1_tiktok.mp4
│   │   │   ├── 2026-03-30_hook-demo-cta_stretching-wrong_v1_instagram.mp4
│   │   │   ├── 2026-03-30_hook-demo-cta_stretching-wrong_v1_youtube.mp4
│   │   │   └── 2026-03-30_hook-demo-cta_stretching-wrong_v1_metadata.json
│   │   └── ...
│   ├── carnimeat/
│   └── ... (30 brands)
├── assets/
│   ├── nordpilates/
│   │   ├── {asset_uuid}.mp4
│   │   └── ...
│   └── ...
├── brands/
│   ├── nordpilates/
│   │   ├── logo.png
│   │   ├── watermark.png
│   │   └── ...
│   └── ...
└── music/
    ├── upbeat_minimal_042.mp3
    └── ...
```

#### Naming Convention

```
{date}_{template-id}_{slug}_{version}_{platform}.mp4
```

Example: `2026-03-30_hook-demo-cta_stretching-wrong_v1_tiktok.mp4`

#### Google Drive (secondary — delivery only)

Approved videos are optionally copied to Drive for worker access:

```
/Video Factory Output/
├── nordpilates/
│   ├── 2026-03/
│   │   ├── 2026-03-30_stretching-wrong_tiktok.mp4
│   │   └── ...
│   └── ...
└── ...
```

This copy is a convenience write — Drive is not the source of truth for any output. R2 is.

---

## 2. Infrastructure & Tooling

### Final Cost Breakdown

| Component | Tool | Monthly Cost |
|-----------|------|-------------|
| Orchestrator | n8n (Hetzner, existing) | $0 |
| Database | Supabase Postgres (free tier) | $0 |
| Job Queue | Upstash Redis (serverless) | $10 |
| Render Workers | Hetzner CX41 × 3 | $90 |
| Working Storage | Cloudflare R2 | $5 |
| AI Agents | Claude Sonnet API (with ~15% retry buffer) | $110 |
| Transcription | whisper.cpp (self-hosted on workers) | $0 |
| Music Library | Artlist or Epidemic Sound | $15 |
| **Total** | | **$230/mo** |
| **Per video** | | **$0.38** |

### Music Strategy

Licensed music library (Artlist or Epidemic Sound, $15/mo) with tracks downloaded, mood-tagged, and stored in both R2 and the `music_tracks` table in Supabase. The AI Creative Director selects tracks by querying mood/energy/genre tags, not randomly. Build initial library of 200-500 tagged tracks organized by mood × energy level.

---

## 3. n8n Workflow Architecture

All workflows are **short-lived and event-driven**. No workflow waits for human input. State is always persisted to Supabase before the execution ends. If n8n restarts, nothing is lost.

### Workflow 1: Asset Ingestion

```
Trigger: Google Drive new file in /brands/{brand_id}/raw/
    → Filter: video files only (.mp4, .mov, .webm)
    → Enqueue ingestion job in BullMQ
    → Worker picks it up:
      → Download from Drive to VPS temp
      → FFprobe: extract technical metadata
      → AI Tagger (Claude/Gemini API): analyze content
      → Upload processed clip to R2: assets/{brand_id}/{uuid}.{ext}
      → Supabase: INSERT into assets table
      → Log event: asset_ingested
      → Cleanup: delete temp file from VPS
```

### Workflow 2A: Creative Planning

```
Trigger: Google Sheet webhook (new idea_seed row)
    → Claim Job: Supabase UPDATE jobs SET status = 'planning'
                 WHERE id = X AND status = 'idea_seed' RETURNING *
    → IF claim fails (race condition): exit
    → Fetch brand config: Supabase GET /brand_configs?brand_id=eq.X
    → Agent 1: Creative Director (Claude API)
        → Input: idea_seed + brand_config + template_catalog
        → Output: Creative Brief JSON
    → PARALLEL:
        → Agent 2: Asset Curator (Claude API)
            → Input: Brief + Supabase asset query results
            → Output: Clip Selection List (R2 keys)
        → Agent 3: Copywriter (Claude API)
            → Input: Brief + brand voice guidelines
            → Output: Copy Package
    → Merge: Create Context Packet
    → Supabase: UPDATE jobs SET context_packet = X, status = 'brief_review'
    → Log event: planning → brief_review
    → Update Sheet: populate brief_summary, hook_text, status
    END.
```

### Workflow 2B: Brief Approval Handler

```
Trigger: Google Sheet webhook (review_decision changed)
    → Read job from Supabase
    → IF review_decision = 'approve':
        → Supabase: UPDATE status = 'queued'
        → Log event: brief_review → queued
        → Enqueue job_id in BullMQ with priority
    → IF review_decision = 'reject':
        → Supabase: UPDATE status = 'planning', INCREMENT rejection_count
        → Log event: brief_review → planning (include rejection_notes)
        → Re-trigger Workflow 2A with rejection_notes as additional context
    END.
```

### Workflow 3A: Video Assembly

```
Trigger: BullMQ job dequeued by render worker
    → Read Context Packet from Supabase
    → Supabase: UPDATE status = 'clip_prep', render_worker_id = X
    → Log event: queued → clip_prep

    → Download clips from R2 (parallel, NOT from Drive)
    → FFmpeg: trim + normalize clips to 1080x1920 30fps
    → Log event: clip_prep → transcription

    → whisper.cpp: transcribe clips with speech (local, no API)
    → Log event: transcription → rendering

    → Remotion: render video with Context Packet as props
    → Log event: rendering → audio_mix

    → FFmpeg: audio mix (UGC audio + background music from R2)
    → Log event: audio_mix → sync_check

    → A/V sync verification:
        → Compare Whisper timestamps vs video timeline
        → IF drift > 200ms on talking-head: auto-retry with offset
    → Log event: sync_check → platform_export

    → FFmpeg: platform-specific exports (TikTok, IG, YT)
    → Upload all versions to R2
    → Log event: platform_export → auto_qa

    → Run automated QA checks (8 checks including A/V sync)
    → Supabase: UPDATE auto_qa_results, auto_qa_passed, status = 'human_qa'
    → Generate R2 presigned preview URL
    → Update QA Sheet: populate preview_url, auto_qa_result, status
    → Log event: auto_qa → human_qa
    END.
```

### Workflow 3B: QA Approval Handler

```
Trigger: Google Sheet webhook (qa_decision changed)
    → Read job from Supabase
    → IF qa_decision = 'approve':
        → Supabase: UPDATE status = 'delivered', completed_at = NOW()
        → Log event: human_qa → delivered
        → (Optional) Copy final videos to Drive output folder
        → Write metadata sidecar to R2
    → IF qa_decision = 'reject':
        → Route based on qa_issues:
            → clip/content issues → Supabase: status = 'planning', re-trigger 2A
            → render/technical issues → Supabase: status = 'queued', re-enqueue in BullMQ
        → Log event: human_qa → (planning or queued)
    END.
```

### Workflow 4: Stale Job Monitor (Cron)

```
Trigger: Cron every 15 minutes
    → Query Supabase: jobs WHERE status IN ('clip_prep','transcription','rendering','audio_mix')
                      AND updated_at < NOW() - INTERVAL '30 minutes'
    → For each stale job:
        → Check job_events for last known state
        → IF render worker is unresponsive:
            → Reset status to 'queued'
            → Re-enqueue in BullMQ
            → Log event: timeout_recovery
        → Send Slack alert with job details + last event
    → Also check: jobs in 'brief_review' for > 24 hours → Slack nudge
    → Also check: jobs in 'human_qa' for > 12 hours → Slack nudge
```

---

## 4. State Machine — Formal Definition

```
States: {
  IDLE,
  IDEA_SEED,
  PLANNING,
  BRIEF_REVIEW,     ← Human gate 1
  QUEUED,
  CLIP_PREP,
  TRANSCRIPTION,
  RENDERING,
  AUDIO_MIX,
  SYNC_CHECK,        ← New: A/V sync verification
  PLATFORM_EXPORT,
  AUTO_QA,
  HUMAN_QA,          ← Human gate 2
  DELIVERED,
  FAILED
}

Transitions:
  IDLE → IDEA_SEED:             Worker fills idea_seed in sheet
  IDEA_SEED → PLANNING:         Workflow 2A triggered
  PLANNING → BRIEF_REVIEW:      All 3 agents complete, context packet in Supabase
  BRIEF_REVIEW → QUEUED:        Workflow 2B: worker approves
  BRIEF_REVIEW → PLANNING:      Workflow 2B: worker rejects → re-plan with feedback
  QUEUED → CLIP_PREP:           Workflow 3A: worker dequeues from BullMQ
  CLIP_PREP → TRANSCRIPTION:    Clips downloaded from R2 and normalized
  TRANSCRIPTION → RENDERING:    whisper.cpp complete
  RENDERING → AUDIO_MIX:        Remotion render complete
  AUDIO_MIX → SYNC_CHECK:       Audio layered
  SYNC_CHECK → PLATFORM_EXPORT: Sync verified (or auto-corrected)
  SYNC_CHECK → AUDIO_MIX:       Sync failed → auto-retry with offset (max 2 retries)
  PLATFORM_EXPORT → AUTO_QA:    All platform versions exported to R2
  AUTO_QA → HUMAN_QA:           Auto checks pass (or flagged with details)
  AUTO_QA → FAILED:             Critical auto-check failure (after retries)
  HUMAN_QA → DELIVERED:         Workflow 3B: worker approves final video
  HUMAN_QA → QUEUED:            Workflow 3B: worker rejects → re-render (technical fix)
  HUMAN_QA → PLANNING:          Workflow 3B: worker rejects → re-plan entirely
  FAILED → PLANNING:            Manual retry after investigation

Terminal states: DELIVERED, FAILED (manual recovery)

Every transition logged to job_events with timestamp, worker_id, and details.
```

---

## 5. Monitoring & Observability

**No separate monitoring infrastructure needed.** Everything runs through Supabase + n8n + Slack.

### job_events table

Every state transition, error, retry, and timeout is logged:

```sql
INSERT INTO job_events (job_id, from_status, to_status, event_type, details)
VALUES (
  'uuid',
  'rendering',
  'audio_mix',
  'state_transition',
  '{"worker_id": "worker-2", "render_time_ms": 342000, "output_size_mb": 28.4}'
);
```

### Stale Job Detection (Workflow 4)

Cron every 15 minutes checks for:
- Render states (`clip_prep`, `transcription`, `rendering`, `audio_mix`) stuck > 30 min → auto-recovery + Slack alert
- `brief_review` stuck > 24 hours → Slack nudge to reviewer
- `human_qa` stuck > 12 hours → Slack nudge to QA reviewer
- `failed` jobs → daily Slack summary

### Key Metrics (queryable from Supabase)

```sql
-- Average time from idea_seed to delivered
SELECT brand_id, AVG(completed_at - created_at) as avg_turnaround
FROM jobs WHERE status = 'delivered' GROUP BY brand_id;

-- Rejection rate by brand
SELECT brand_id,
  COUNT(*) FILTER (WHERE rejection_count > 0)::FLOAT / COUNT(*) as rejection_rate
FROM jobs GROUP BY brand_id;

-- Render time distribution
SELECT e.details->>'render_time_ms' as render_ms
FROM job_events e WHERE e.event_type = 'state_transition'
AND e.to_status = 'audio_mix';

-- Jobs per day by status
SELECT DATE(created_at), status, COUNT(*)
FROM jobs GROUP BY DATE(created_at), status ORDER BY 1 DESC;
```

---

## 6. Scaling Strategy

### Current Scale: 150 videos/week

- 3 VPS render workers (parallel) on Hetzner
- 1 n8n instance orchestrating (existing Hetzner)
- BullMQ on Upstash Redis handles job distribution
- whisper.cpp on workers — no API bottleneck
- All reads from R2 — no Drive API rate limits
- Average render time: ~5-8 minutes per video
- Peak capacity: 3 workers × 8 videos/hour = 24 videos/hour = 192/day

### Growth to 300+ videos/week

- Add Hetzner VPS workers (horizontal, just add more BullMQ consumers)
- Supabase free tier → Pro ($25/mo) for 8GB database
- Upstash Redis auto-scales — no changes needed
- R2 auto-scales — no changes needed
- Consider batching AI agent calls for cost efficiency

### Growth to 1000+ videos/week

- 8-10 Hetzner workers (or switch to autoscaling with Hetzner Cloud API)
- Supabase Pro handles easily at this scale
- Dedicated Whisper GPU instance for batch transcription
- Template pre-rendering (brand-specific shells cached on workers)
- Split n8n into planning + rendering instances
- Real-time dashboard (replace Sheets with Supabase Realtime + React frontend)

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up Supabase project + all tables (assets, jobs, job_events, brand_configs, music_tracks)
- [ ] Set up Upstash Redis + BullMQ
- [ ] Provision first Hetzner VPS render worker (FFmpeg, Node.js, whisper.cpp)
- [ ] Build Asset Ingestion workflow (n8n): Drive → VPS → R2 → Supabase
- [ ] Load 5 pilot brand configs into Supabase
- [ ] Set up Cloudflare R2 bucket with proper folder structure

### Phase 2: Creative Brain (Weeks 3-4)
- [ ] Build Creative Director agent (system prompt + few-shot examples)
- [ ] Build Asset Curator agent with Supabase REST query integration
- [ ] Build Copywriter agent with brand voice injection
- [ ] Build Context Packet merging logic
- [ ] Build Workflow 2A (planning) + 2B (approval) in n8n
- [ ] Create worker Google Sheet with proper columns + webhooks
- [ ] Test full planning loop with 5 pilot brands

### Phase 3: Video Engine (Weeks 5-7)
- [ ] Install Remotion on VPS workers
- [ ] Build 3 initial templates (hook-demo-cta, hook-listicle-cta, hook-transformation)
- [ ] Build caption rendering component (word-by-word with brand presets)
- [ ] Build FFmpeg pre-processing pipeline (trim, normalize, audio)
- [ ] Integrate whisper.cpp for local transcription
- [ ] Build audio mixing pipeline with music selection
- [ ] Build A/V sync check
- [ ] Build platform export pipeline
- [ ] Build Workflow 3A (assembly) + 3B (QA approval) in n8n

### Phase 4: QA & Monitoring (Week 8)
- [ ] Build all 8 automated QA checks (including A/V sync)
- [ ] Build QA review Sheet
- [ ] Build rejection → re-work routing logic
- [ ] Build Workflow 4 (stale job monitor) with Slack alerts
- [ ] End-to-end testing with 5 pilot brands
- [ ] Performance tuning (render time optimization)

### Phase 5: Scale (Weeks 9-10)
- [ ] Expand to all 30 brands (load configs into Supabase)
- [ ] Provision remaining 2 VPS render workers
- [ ] Build remaining templates (5-8 more)
- [ ] Music library setup (Artlist/Epidemic + mood tagging)
- [ ] Build read-only brand config Sheet synced from Supabase
- [ ] Worker training documentation
- [ ] Load testing at full volume (30 brands × 5 videos/week)

### Phase 6: Optimization (Ongoing)
- [ ] A/B hook testing integration
- [ ] Performance analytics feedback loop (which templates/hooks perform best)
- [ ] Template iteration based on engagement data
- [ ] Asset quality scoring refinement
- [ ] Build simple admin UI for brand config management

---

## 8. Key Technical Decisions

### Why Supabase over raw Postgres on Railway?
- Built-in REST API (PostgREST) — n8n can query via HTTP without custom API server
- Row Level Security for future multi-user access
- Realtime subscriptions for future dashboard
- Free tier covers this scale easily
- Managed backups and scaling

### Why Remotion over pure FFmpeg for templates?
FFmpeg is incredible for clip manipulation but terrible for complex overlays, animations, and branded template rendering. Remotion lets you build templates as React components with full CSS animations, SVG overlays, and dynamic data binding.

### Why BullMQ + Upstash over n8n's built-in queue?
n8n's execution queue is not designed for heavy render jobs. BullMQ provides priority queues, retry with exponential backoff, concurrency control per worker, job progress tracking, and dead letter queue for failed jobs. Upstash Redis scales serverlessly — no provisioning.

### Why event-driven workflows instead of long-lived n8n executions?
An n8n workflow that "waits for human review" holds an execution open for hours or days. If n8n restarts, the execution dies and the job is lost. Event-driven workflows write state to Supabase and complete immediately. A new workflow is triggered when the human acts. State lives in the database, not in memory.

### Why self-hosted whisper.cpp instead of Whisper API?
The render workers have 8 vCPU sitting idle between render jobs. whisper.cpp processes 1 minute of audio in ~15 seconds on CPU. This eliminates the $4/mo API cost, removes network latency from the pipeline, and means transcription works offline if the OpenAI API has issues.

### Why R2 as working storage instead of Google Drive?
Google Drive API has aggressive rate limits, especially for service accounts. At 150+ videos/week with multiple clip downloads per video, you'll hit 403 errors. R2 has no rate limits, zero egress fees, and is designed for programmatic access. Drive becomes a human-friendly drop zone for raw UGC, not a system dependency.

### Why brand configs in Supabase instead of Google Sheets?
Sheets has no column type constraints. A typo in a hex color, a deleted row, an extra space — any of these silently break renders. Supabase enforces regex validation on color columns, NOT NULL on required fields, and CHECK constraints on numeric ranges. The Sheet becomes a read-only view, not the source of truth.

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| AI generates off-brand content | Brand voice guidelines in system prompts + human review gate |
| UGC footage quality varies | Quality scoring in asset tagger + minimum quality threshold |
| Render failures | BullMQ retry with exponential backoff + Slack alerting + stale job monitor |
| Music copyright issues | Licensed library only (Artlist/Epidemic) + track-level verification |
| Worker bottleneck at review | Batch review interface + "auto-approve" mode for trusted templates |
| Asset exhaustion (same clips reused) | Usage counter + recency weighting in asset curator |
| Template fatigue (same look) | Template rotation logic + periodic new template creation |
| Scale bottleneck | Horizontal VPS scaling + R2 (infinite) + Upstash (auto-scale) |
| A/V sync drift | Auto-detection via Whisper timestamps + auto-retry with offset |
| n8n restart during job | Event-driven workflows + state in Supabase = zero state loss |
| Drive API rate limits | Drive is drop zone only — all pipeline reads from R2 |
| Brand config corruption | Supabase column constraints + validation + Sheets is read-only |
| Stale/stuck jobs | Cron monitor every 15 min + auto-recovery + Slack alerts |
| Brief rejection loops | rejection_count tracked + max 3 retries before FAILED + human escalation |

---

## 10. Files & Repositories

```
video-factory/
├── infra/
│   ├── docker-compose.yml          # VPS worker setup (FFmpeg, Remotion, whisper.cpp, BullMQ consumer)
│   ├── supabase/
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql
│   │   └── seed.sql                # 5 pilot brand configs
│   └── remotion.config.ts
├── workers/
│   ├── clip-prep.ts                # FFmpeg clip processing (reads from R2)
│   ├── transcriber.ts              # whisper.cpp integration (local)
│   ├── renderer.ts                 # Remotion render orchestration
│   ├── audio-mixer.ts              # FFmpeg audio processing
│   ├── sync-checker.ts             # A/V sync verification
│   ├── exporter.ts                 # Platform-specific export
│   ├── qa-checker.ts               # All 8 automated QA checks
│   └── ingestion.ts                # Asset ingestion (Drive → R2 → Supabase)
├── agents/
│   ├── creative-director.ts
│   ├── asset-curator.ts
│   ├── copywriter.ts
│   └── prompts/                    # System prompt templates per brand
├── templates/
│   ├── components/
│   │   ├── CaptionTrack.tsx        # Word-by-word captions (brand preset driven)
│   │   ├── HookText.tsx            # Hook overlay animations
│   │   ├── CTAScreen.tsx           # CTA end screen
│   │   ├── LogoWatermark.tsx       # Brand logo overlay
│   │   └── TransitionEffect.tsx    # Segment transitions
│   ├── layouts/
│   │   ├── HookDemoCTA.tsx
│   │   ├── HookListicleCTA.tsx
│   │   ├── HookTransformation.tsx
│   │   └── ...
│   └── brand-themes/               # Per-brand style overrides (generated from Supabase configs)
├── n8n-workflows/
│   ├── 1-asset-ingestion.json
│   ├── 2a-creative-planning.json
│   ├── 2b-brief-approval.json
│   ├── 3a-video-assembly.json
│   ├── 3b-qa-approval.json
│   └── 4-stale-job-monitor.json
└── docs/
    ├── ARCHITECTURE.md             # This document
    ├── TEMPLATE_GUIDE.md           # How to build new Remotion templates
    ├── BRAND_SETUP.md              # How to add a new brand to Supabase
    └── WORKER_GUIDE.md             # How workers use the Sheet interface
```
