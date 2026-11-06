#!/bin/bash
# Deploy enkel-ao STAGING til Raspberry Pi (aos.efugl.no)
#
# Egen mappe (~/enkel-ao-staging) og egen database, atskilt fra produksjon —
# samme mønster som dagens-funn-staging på Pi-en. Stedssøk bruker en egen
# SQLite-kopi i data/staging-locations.db, slik at staging ikke skriver til
# produksjonens shared-locations. Kopien klargjøres før første utrulling.

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SOURCE_DIR"

PI_HOST="kjetil@100.76.35.106"
PI_DIR="~/enkel-ao-staging"

echo "🧪 Kjører tester..."
python3 -m pytest --maxfail=3
npm test

echo "📤 Synker filer til Pi (staging)..."
rsync -av --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude '.codex-tmp' \
  --exclude '.codex' \
  --exclude '.claude' \
  --exclude '.pytest_cache' \
  --exclude '.coverage' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude '/test-results' \
  --exclude 'node_modules' \
  --exclude 'tests' \
  --exclude 'tools' \
  --exclude 'docs' \
  --exclude 'fly.toml' \
  --exclude 'fly.staging.toml' \
  --exclude 'mock' \
  --exclude 'docker-compose.pi.yml' \
  --exclude '/data' \
  "$SOURCE_DIR/" \
  "$PI_HOST:$PI_DIR/"

echo "🏗️  Bygger og starter staging-container på Pi..."
ssh "$PI_HOST" "cd $PI_DIR && docker compose -f docker-compose.staging.yml up -d --build"

echo "✅ Staging (Pi) deploy ferdig: https://aos.efugl.no"
