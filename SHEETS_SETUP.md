# Google Sheets Setup — Video Factory Control Panel

Create a new Google Spreadsheet and name it **"Video Factory Control Panel"**.
Share it with the Google service account used by n8n (edit access).

---

## Tab 1: Jobs

The main worker interface. n8n polls this every 30 seconds.

### Columns (in order)

| Col | Header | Type | Who fills | Color | Notes |
|-----|--------|------|-----------|-------|-------|
| A | Row Status | text | system | gray | Sync status: OK, SYNCING, ERROR {msg} |
| B | Job ID | text | system | gray | UUID, auto-populated from Supabase |
| C | Brand | dropdown | worker | white | Options: nordpilates, ketoway, carnimeat, nodiet, highdiet |
| D | Idea Seed | text | worker | white | Free text: "3 desk stretches for posture" |
| E | Status | text | system | gray | Current job_status from Supabase |
| F | Brief Summary | text | system | gray | AI-generated: "hook-listicle-cta \| 45s \| 3 segments" |
| G | Hook Text | text | system | gray | From AI copywriter (first hook variant) |
| H | CTA Text | text | system | gray | From AI creative brief |
| I | Template | dropdown | worker | white | Options: hook-demo-cta, hook-listicle-cta, hook-transformation |
| J | Review Decision | dropdown | worker | white | Options: (empty), approve, reject |
| K | Rejection Notes | text | worker | white | Free text: what to change |
| L | Preview URL | text | system | gray | R2 presigned URL to rendered video |
| M | Auto QA | text | system | gray | PASSED or FLAGGED (with details) |
| N | QA Decision | dropdown | worker | white | Options: (empty), approve, reject |
| O | QA Issues | dropdown (multi) | worker | white | Options: audio_sync, text_overlap, clip_quality, wrong_clip, branding_error, timing_off |
| P | QA Notes | text | worker | white | Free text feedback |
| Q | QA Reviewed By | text | worker | white | Worker name |
| R | Video Type | text | system | gray | workout-demo, recipe-walkthrough, tips-listicle, transformation |
| S | Created At | datetime | system | gray | Job creation timestamp |
| T | Completed At | datetime | system | gray | Delivery timestamp |

### Setup steps

1. Create headers in row 1 (freeze row 1)
2. **Gray columns** (A, B, E, F, G, H, L, M, R, S, T): Set background `#E8E8E8`. Protect these columns (Data → Protected sheets and ranges → set warning)
3. **White columns** (C, D, I, J, K, N, O, P, Q): Leave white background
4. **Dropdowns**:
   - C (Brand): Data validation → List of items: `nordpilates,ketoway,carnimeat,nodiet,highdiet`
   - I (Template): Data validation → List of items: `hook-demo-cta,hook-listicle-cta,hook-transformation`
   - J (Review Decision): Data validation → List of items: `approve,reject`
   - N (QA Decision): Data validation → List of items: `approve,reject`
   - O (QA Issues): Data validation → List of items: `audio_sync,text_overlap,clip_quality,wrong_clip,branding_error,timing_off`
5. Set column widths: A=100, B=120, C=120, D=250, E=120, F=200, G=200, H=200, I=160, J=120, K=200, L=200, M=120, N=120, O=160, P=200, Q=120, R=140, S=140, T=140

### How workers use it

1. **New video**: Fill Brand (C) + Idea Seed (D) → n8n creates job in Supabase, fills Job ID + Status
2. **Review brief**: Wait for Status=brief_review → Read Hook/CTA/Summary → Set Review Decision (J) to approve/reject
3. **QA video**: Wait for Status=human_qa → Watch Preview URL (L) → Set QA Decision (N), fill issues/notes if rejecting

---

## Tab 2: Brands

Brand configuration editor. n8n polls every 5 minutes.

### Columns

| Col | Header | Type | Who fills | Color | Notes |
|-----|--------|------|-----------|-------|-------|
| A | Row Status | text | system | gray | OK / ERROR |
| B | Brand ID | text | system | gray | Primary key (e.g., nordpilates) |
| C | Brand Name | text | worker | white | Display name |
| D | Primary Color | text | worker | white | Hex: #E8B4A2 |
| E | Secondary Color | text | worker | white | Hex: #2C2C2C |
| F | Accent Color | text | worker | white | Hex: #FFFFFF |
| G | Font Family | text | worker | white | e.g., Montserrat, Inter |
| H | Font Weight Title | number | worker | white | 400-900 |
| I | Font Weight Body | number | worker | white | 400-900 |
| J | Logo R2 Key | text | system | gray | brands/{id}/logo.png |
| K | Watermark R2 Key | text | system | gray | |
| L | Watermark Position | dropdown | worker | white | top_right, top_left, bottom_right, bottom_left |
| M | Watermark Opacity | number | worker | white | 0.0 - 1.0 |
| N | CTA Style | dropdown | worker | white | link-in-bio, swipe-up, follow, shop-now, minimal |
| O | CTA BG Color | text | worker | white | Hex |
| P | CTA Text Color | text | worker | white | Hex |
| Q | Transition Style | dropdown | worker | white | cut, fade, slide-left, slide-up, zoom, wipe |
| R | Voice Guidelines | text | worker | white | Free text for AI agents |
| S | Hook Styles | text | worker | white | Comma-separated: pov,question,challenge |
| T | Content Pillars | text | worker | white | Comma-separated: pilates,flexibility,wellness |
| U | Allowed Video Types | text | worker | white | Comma-separated: workout-demo,tips-listicle,transformation |
| V | Color Grade Preset | dropdown | worker | white | warm-vibrant, cool-clean, neutral, high-contrast |
| W | Drive Input Folder ID | text | worker | white | Google Drive folder ID |
| X | Active | checkbox | worker | white | TRUE/FALSE |

### Setup steps

1. Create headers in row 1 (freeze row 1)
2. Gray columns: A, B, J, K
3. Dropdowns: L (positions), N (CTA styles), Q (transitions), V (color grade presets: `warm-vibrant,cool-clean,neutral,high-contrast`)
4. Pre-populate rows 2-6 with the 5 pilot brands from Supabase
5. Data validation on D, E, F, O, P: custom formula `=REGEXMATCH(D2,"^#[0-9A-Fa-f]{6}$")` (shows warning on invalid hex)

---

## Tab 3: Caption Presets

Flattened JSONB — 20 columns per brand. n8n reassembles to nested JSON before writing to Supabase `brand_configs.caption_preset`.

### Columns

| Col | Header | Type | Notes |
|-----|--------|------|-------|
| A | Row Status | text | gray |
| B | Brand ID | text | gray, references Brands tab |
| C | Preset Name | text | e.g., nordpilates_default |
| D | Font Family | text | Montserrat, Inter, etc. |
| E | Font Size | number | 36-56 |
| F | Font Weight | number | 400-900 |
| G | Text Color | text | Hex: #FFFFFF |
| H | Stroke Color | text | Hex: #000000 |
| I | Stroke Width | number | 0-5 |
| J | Background | text | none, pill, box |
| K | Position | dropdown | bottom_center, top_center, center |
| L | Margin Bottom | number | px: 120-200 |
| M | Max Width % | number | 70-95 |
| N | Text Align | dropdown | center, left, right |
| O | Animation Type | dropdown | word_by_word, karaoke, word_pop |
| P | Highlight Color | text | Hex: brand accent |
| Q | Highlight Style | dropdown | background_pill, underline, bold |
| R | Word Gap ms | number | 30-100 |
| S | Shadow Color | text | rgba(0,0,0,0.5) |
| T | Shadow Blur | number | 0-8 |

### Setup steps

1. Freeze row 1, gray columns A-B
2. Pre-populate from the 5 pilot brand caption_preset values
3. Dropdowns on K, N, O, Q

---

## Tab 4: Music Library

Music track management. n8n polls every 5 minutes.

### Columns

| Col | Header | Type | Who fills | Color |
|-----|--------|------|-----------|-------|
| A | Row Status | text | system | gray |
| B | Track ID | text | system | gray |
| C | Title | text | worker | white |
| D | Artist | text | worker | white |
| E | R2 Key | text | worker | white |
| F | Duration (s) | number | worker | white |
| G | Mood | dropdown | worker | white |
| H | Genre | dropdown | worker | white |
| I | Tempo BPM | number | worker | white |
| J | Energy Level | dropdown | worker | white |
| K | License Source | dropdown | worker | white |
| L | Used Count | number | system | gray |

### Dropdowns

- G (Mood): `energetic,calm,upbeat,dramatic,minimal,inspiring,chill`
- H (Genre): `electronic,acoustic,hip-hop,ambient,pop,lo-fi`
- J (Energy Level): `1,2,3,4,5,6,7,8,9,10`
- K (License Source): `artlist,epidemic,pixabay,custom`

---

## Tab 5: Templates

Reference tab — read-only listing of available templates.

### Columns

| Col | Header | Type |
|-----|--------|------|
| A | Template ID | text |
| B | Name | text |
| C | Structure | text |
| D | Best For | text |
| E | Allowed Brands | text |

### Pre-populate

| Template ID | Name | Structure | Best For | Allowed Brands |
|-------------|------|-----------|----------|----------------|
| hook-demo-cta | Hook Demo CTA | Hook → Exercise/product demo → CTA | workout-demo, recipe-walkthrough | nordpilates, highdiet, ketoway, carnimeat |
| hook-listicle-cta | Hook Listicle CTA | Hook → Numbered tips → CTA | tips-listicle | all |
| hook-transformation | Hook Transformation | Hook → Before/After → CTA | transformation | nordpilates, nodiet, highdiet |

**Video Type → Template mapping:**
- `workout-demo` → `hook-demo-cta`
- `recipe-walkthrough` → `hook-demo-cta`
- `tips-listicle` → `hook-listicle-cta`
- `transformation` → `hook-transformation`

Protect this entire tab (read-only for workers).

---

## Tab 6: Dashboard

Read-only stats from `v_brand_stats` view. n8n refreshes every 5 minutes.

### Columns

| Col | Header | Type |
|-----|--------|------|
| A | Brand ID | text |
| B | Brand Name | text |
| C | Total Jobs | number |
| D | Delivered | number |
| E | Failed | number |
| F | In Progress | number |
| G | Avg Turnaround (hrs) | number |
| H | Last Updated | datetime |

### Setup

1. Protect entire tab (read-only)
2. Format numbers: C-F as integers, G as 1 decimal
3. Background: light blue header row
4. n8n will overwrite rows 2+ on every refresh

---

## After creating the spreadsheet

1. Copy the **Spreadsheet ID** from the URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
2. Share the sheet with your n8n Google service account email (Editor access)
3. Note the **Sheet/Tab names** exactly as created (Jobs, Brands, Caption Presets, Music Library, Templates, Dashboard)
4. Add to `.env`:
   ```
   GOOGLE_SHEET_ID=your_spreadsheet_id_here
   ```
5. Configure n8n Google Sheets credentials if not already done
