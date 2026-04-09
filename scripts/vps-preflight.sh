#!/bin/bash
# Run this on the VPS: bash /home/video-factory/scripts/vps-preflight.sh
cd /home/video-factory

echo "=== 1. Generate test clip ==="
ffmpeg -y -f lavfi -i "testsrc=d=2:s=1080x1920:r=30" -f lavfi -i "sine=f=440:d=2" -c:v libx264 -c:a aac -shortest /tmp/test-clip.mp4 2>/dev/null
ls -lh /tmp/test-clip.mp4

echo ""
echo "=== 2. Test Claude API ==="
ANTH=$(awk -F= '/^ANTHROPIC_API_KEY/{print $2}' .env)
curl -s -X POST \
  -H "x-api-key: $ANTH" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' \
  https://api.anthropic.com/v1/messages
echo ""

echo ""
echo "=== 3. Test Gemini API ==="
GEM=$(awk -F= '/^GEMINI_API_KEY/{print $2}' .env)
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEM" | head -3
echo ""

echo ""
echo "=== 4. Test /ugc-ingest ==="
META=$(echo -n '{"filename":"nordpilates_test.mp4","brand_id":"nordpilates"}' | base64 -w0)
curl -s -X POST \
  http://localhost:3000/ugc-ingest \
  -H "Content-Type: application/octet-stream" \
  -H "x-asset-meta: $META" \
  --data-binary @/tmp/test-clip.mp4
echo ""

echo ""
echo "=== 5. drainDelay check ==="
grep drainDelay dist/config/redis.js

echo ""
echo "=== Done ==="
