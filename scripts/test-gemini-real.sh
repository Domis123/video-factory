#!/bin/bash
# Tests /ugc-ingest with a visually rich clip to verify Gemini returns real analysis
cd /home/video-factory

echo "=== Generate mandelbrot clip (10s, 1080x1920) ==="
ffmpeg -y -f lavfi -i "mandelbrot=s=1080x1920:r=30" -t 10 -c:v libx264 /tmp/test-mandelbrot.mp4 2>/dev/null
ls -lh /tmp/test-mandelbrot.mp4

echo ""
echo "=== POST to /ugc-ingest ==="
META=$(echo -n '{"filename":"nordpilates_mandelbrot_test.mp4","brand_id":"nordpilates"}' | base64 -w0)
curl -s -X POST \
  http://localhost:3000/ugc-ingest \
  -H "Content-Type: application/octet-stream" \
  -H "x-asset-meta: $META" \
  --data-binary @/tmp/test-mandelbrot.mp4
echo ""
echo ""
echo "=== Check full asset in Supabase ==="
node -e "
const {createClient} = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();
const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
c.from('assets')
  .select('content_type,mood,quality_score,visual_elements,tags,has_speech')
  .eq('filename','nordpilates_mandelbrot_test.mp4')
  .single()
  .then(r => console.log(JSON.stringify(r.data, null, 2)));
"
echo ""
echo "=== Done ==="
