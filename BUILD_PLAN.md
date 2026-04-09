# Video Factory — Step-by-Step Build Plan

## Context
Video Factory is a 95% automated video production pipeline for 30 brands (150 videos/week). All infrastructure (Supabase, Redis, R2, n8n) is live. Code is deployed and running on VPS.

## Overall Progress

| Phase | Status | Tests | Key Files |
|-------|--------|-------|-----------|
| 1. Foundation | ✅ COMPLETE | 5/5 connectivity | config/, types/, lib/ (11 files) |
| 2. Workers | ✅ COMPLETE | 16/16 pipeline | 9 workers + exec helper |
| 2B. Gemini Analyzer | ✅ COMPLETE | Tested on real video | gemini.ts |
| 3. AI Agents | ✅ COMPLETE | 28/28 mock, 27/27 live | 3 agents + 3 prompts + context-packet |
| 4. Remotion Templates | ✅ COMPLETE | Build clean | 6 components + 3 layouts |
| 5A. Renderer + Server | ✅ DEPLOYED | 36/36 + 27/27 live | renderer, pipeline, index.ts |
| 5B. Google Sheets | ✅ CREATED | — | "Video Pipeline" spreadsheet, 6 tabs |
| 5C. n8n Workflows | ✅ IMPORTED | — | 11 workflows (S1-S7, P1-P4) |
| 5D. End-to-end test | 🔄 IN PROGRESS | — | Music ingest testing via S7 |
| 6.0 Video Type Matrix | ✅ COMPLETE | 41/41 quality | video-types.ts, video-type-selector.ts |
| 6.1 Ingestion Enrichment | ✅ COMPLETE | Build clean | clip-analysis.ts |
| 6.2 Beat-Synced Transitions | ✅ COMPLETE | Build clean | beat-detector.ts |
| 6.3 Audio Ducking | ✅ COMPLETE | Build clean | Sidechain compressor in ffmpeg.ts |
| 6.4 Encoding Upgrade | ✅ COMPLETE | Build clean | CRF 18 + slow in ffmpeg.ts |
| 6.5 Color Grading | ✅ COMPLETE | Build clean | color-grading.ts |
| 6.6 Music Selection | ✅ COMPLETE | Build clean | music-selector.ts |
| 6.7 Dynamic Pacing | ✅ COMPLETE | Build clean | template-config-builder.ts |
| 6.8 Trending Audio | DEFERRED | — | Manual curation, pilot later |
| Music Ingest | ✅ BUILT | — | music-ingest.ts + S7 workflow |
| Redis Fix | ✅ COMPLETE | — | drainDelay 30s |
| DB Migration | ✅ APPLIED | — | Both migrations ran on Supabase |

**Total**: ~55 source files + 11 n8n workflow JSONs + 2 SQL migrations
**Tests**: 98/98 passing (30 mock + 41 quality + 27 live)
**Cost**: ~$35/mo production (VPS $4.50 + Gemini $0.60 + Claude ~$4 + Upstash free)

## Current Status (2026-04-09)

### What's Running
- **VPS** at 95.216.137.35 — all BullMQ workers (planning, rendering, ingestion) + HTTP API
- **n8n** at 46.224.56.174 — workflows being imported and activated
- **Google Sheets** — "Video Pipeline" spreadsheet created with all 6 tabs
- **Supabase** — 5 pilot brands seeded, quality upgrade columns applied

### What's Being Tested
- **S7 Music Ingest** — 15 MP3 tracks in Google Drive `Music Uploads/` folder, workflow downloads → VPS ffprobes → R2 upload → Supabase insert → Sheet update → Move to Processed

### What's Next (in order)
1. ✅ ~~Music library stocking~~ — 15 tracks in Drive, S7 processing
2. Verify S7 completes — all 15 tracks in Supabase + R2 + Sheet
3. Import remaining n8n workflows (S1-S6, P1-P4) and activate
4. Upload UGC clips for nordpilates (5-10 clips in brand Drive folder)
5. Test S1: create job via Sheet → Supabase → BullMQ planning queue
6. Test full pipeline: idea seed → AI agents → brief review → render → QA → delivered
7. Fix any issues found in end-to-end test

### Deferred
- Phase 6.8 (Trending Audio) — add after 50+ outputs reviewed
- A/B Performance Tracking — add `performance_metrics` table later
- Quality Director Agent — deferred until failure taxonomy built from real outputs

---

## Architecture Summary

### Data Flow
```
Worker (Sheets/Drive) → n8n → Supabase → BullMQ → VPS Workers → R2 → n8n → Sheets
```

### Music Ingest Flow (S7)
```
Worker drops MP3 in Drive → n8n downloads → POST /music-ingest on VPS
→ VPS: ffprobe duration → upload to R2 → insert Supabase → return metadata
→ n8n: write to Music Library sheet → move file to Processed folder
```

### Video Production Flow
```
1. Worker fills Idea Seed + Brand in Jobs sheet
2. S1: Sheet → Supabase (create job) → BullMQ planning queue
3. VPS: 3 AI agents (Creative Director, Asset Curator, Copywriter) → Context Packet
4. n8n: push status to Sheet (brief_review)
5. Worker approves/rejects brief in Sheet
6. S2: Sheet → Supabase → BullMQ rendering queue
7. VPS: clip-prep → transcription → rendering → audio-mix → sync-check → export → QA
8. n8n: push preview URL + auto QA results to Sheet (human_qa)
9. Worker reviews video, approves/rejects
10. S3: Sheet → Supabase (delivered or re-plan/re-render)
```

### Key Credentials
- Google Sheets/Drive: Service account `AIqzMYUXoQjud7IW` ("Flemingo service acc")
- Supabase HTTP: `l66cV4Gj1L3T6MjJ` ("Strapi API Token")
- Sheet ID: `1qQ69Oxl-2Tjf0r8Ox4NhZnv1MlPOebs2eNpgf5Ywk78`
- Jobs tab gid: `645720058`, Brands tab gid: `219264500`
- Drive Music Uploads: `1s2vUnIoJUt7rltSRlJeY9uqQyQ5_Lzso`
- Drive Music Processed: `1RtBDaSxM45TT2B7ATvQGXvnY5HB1nWGw`

---

## Phase Details (completed phases collapsed)

### Phase 1: Foundation ✅ COMPLETE
Config modules, type definitions, job state machine, R2 storage, FFmpeg builders, connectivity test. DB schema deployed.

### Phase 2: Workers ✅ COMPLETE
8 processing workers (ingestion, clip-prep, transcriber, audio-mixer, sync-checker, exporter, qa-checker, renderer). Integration test 16/16.

### Phase 2B: Gemini Analyzer ✅ COMPLETE
Gemini 2.0 Flash video analysis during ingestion. Cost ~$0.001/clip.

### Phase 3: AI Agents ✅ COMPLETE
3 agents (Creative Director, Asset Curator, Copywriter) with mock + live Claude Sonnet modes. Context Packet merger. Mock 28/28, live 27/27.

### Phase 4: Remotion Templates ✅ COMPLETE
6 components + 3 layouts. 1080x1920 30fps vertical video. Data-driven from Context Packet.

### Phase 5A: Renderer + Server ✅ DEPLOYED
Full pipeline wired. VPS running at 95.216.137.35 as systemd service. HTTP API on port 3000.

### Phase 5B: Google Sheets ✅ CREATED
"Video Pipeline" spreadsheet with Jobs, Brands, Caption Presets, Music Library, Templates, Dashboard tabs.

### Phase 5C: n8n Workflows ✅ READY
11 workflow JSONs with real credentials. S1-S7 (Sheet→Supabase), P1-P4 (Supabase→Sheet).

### Quality Phases 0-7 ✅ ALL COMPLETE
Video type system, ingestion enrichment, beat-synced transitions, audio ducking, CRF 18 encoding, color grading, music selection, dynamic pacing. All deployed to VPS. 41/41 quality tests passing.

### Music Ingest Pipeline ✅ BUILT
`POST /music-ingest` endpoint on VPS. S7 n8n workflow: Drive download → VPS ffprobe → R2 → Supabase → Sheet → Move to Processed. Worker-friendly: just drop MP3 in Drive folder.
