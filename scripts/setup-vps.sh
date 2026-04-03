#!/bin/bash
# ============================================================
# Video Factory — VPS Setup Script
# Run on a fresh Hetzner CX41 (4 vCPU, 16GB RAM, Ubuntu 22.04)
# ============================================================

set -euo pipefail

echo "🎬 Video Factory — VPS Setup"
echo "=============================="

# ── 1. System Updates ──
echo "📦 Updating system..."
apt-get update -y && apt-get upgrade -y

# ── 2. Node.js 20 ──
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
echo "   Node: $(node --version)"
echo "   npm: $(npm --version)"

# ── 3. FFmpeg ──
echo "📦 Installing FFmpeg..."
apt-get install -y ffmpeg
echo "   FFmpeg: $(ffmpeg -version | head -1)"

# ── 4. Build tools (for whisper.cpp and native deps) ──
echo "📦 Installing build tools..."
apt-get install -y build-essential git cmake

# ── 5. whisper.cpp ──
echo "📦 Installing whisper.cpp..."
cd /opt
if [ ! -d "whisper.cpp" ]; then
  git clone https://github.com/ggerganov/whisper.cpp.git
fi
cd whisper.cpp
cmake -B build
cmake --build build --config Release
# Download small model for testing, medium for production
bash models/download-ggml-model.sh base.en
echo "   whisper.cpp built at /opt/whisper.cpp/build/bin/whisper-cli"

# ── 6. Chromium (for Remotion) ──
echo "📦 Installing Chromium dependencies..."
apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  fonts-liberation fonts-noto-color-emoji

# ── 7. Create app user ──
echo "👤 Creating app user..."
id -u videofactory &>/dev/null || useradd -m -s /bin/bash videofactory

# ── 8. Clone + setup project ──
echo "📁 Setting up project..."
APP_DIR="/home/videofactory/video-factory"
if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  chown videofactory:videofactory "$APP_DIR"
  echo "   Clone your repo to $APP_DIR"
  echo "   Then: cd $APP_DIR && npm install && cp env.video-factory .env"
fi

# ── 9. Create temp dir ──
mkdir -p /tmp/video-factory
chown videofactory:videofactory /tmp/video-factory

# ── 10. Systemd service ──
echo "⚙️  Creating systemd service..."
cat > /etc/systemd/system/video-factory.service << 'EOF'
[Unit]
Description=Video Factory Worker
After=network.target

[Service]
Type=simple
User=videofactory
WorkingDirectory=/home/videofactory/video-factory
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=video-factory

# Environment
Environment=NODE_ENV=production

# Resource limits
LimitNOFILE=65536
MemoryMax=12G

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable video-factory
echo "   Service created. Start with: systemctl start video-factory"
echo "   Logs: journalctl -u video-factory -f"

# ── Summary ──
echo ""
echo "=============================="
echo "✅ VPS Setup Complete"
echo ""
echo "Next steps:"
echo "  1. Clone repo to /home/videofactory/video-factory"
echo "  2. cd /home/videofactory/video-factory"
echo "  3. npm install"
echo "  4. cp env.video-factory .env  (then edit with real credentials)"
echo "  5. npm run build"
echo "  6. systemctl start video-factory"
echo "  7. journalctl -u video-factory -f  (watch logs)"
echo ""
echo "whisper.cpp: /opt/whisper.cpp/build/bin/whisper-cli"
echo "Model: /opt/whisper.cpp/models/ggml-base.en.bin"
echo "=============================="
