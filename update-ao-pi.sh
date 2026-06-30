#!/bin/bash
# Deploy enkel-ao til Raspberry Pi (ao-pi.efugl.no)

set -e

PI_HOST="kjetil@100.76.35.106"
PI_DIR="~/enkel-ao"

echo "🔄 Deployer enkel-ao til Pi..."

# Rsync kode til Pi (ekskluder lokale filer som ikke skal med)
echo "📤 Synker filer til Pi..."
rsync -av \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'tests' \
  --exclude 'tools' \
  --exclude 'docs' \
  --exclude 'fly.toml' \
  --exclude 'fly.staging.toml' \
  --exclude 'mock' \
  /Users/kjetil/git/enkel-ao/ \
  "$PI_HOST:$PI_DIR/"

# Bygg og start container på Pi
echo "🏗️  Bygger og starter Docker container på Pi..."
ssh "$PI_HOST" "cd $PI_DIR && docker compose -f docker-compose.pi.yml build --no-cache enkel-ao && docker compose -f docker-compose.pi.yml up -d"

# Sjekk status
echo "✅ Deploy ferdig! Sjekker status..."
ssh "$PI_HOST" "docker ps | grep enkel-ao || echo 'ADVARSEL: enkel-ao container ikke funnet'"

echo ""
echo "✅ enkel-ao kjører på Pi port 3001"
echo "🌐 Test: https://ao-pi.efugl.no (når DNS og tunnel er satt opp)"
