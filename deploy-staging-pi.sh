#!/bin/bash
# Deploy enkel-ao STAGING til Raspberry Pi (aos.efugl.no)
#
# Egen mappe (~/enkel-ao-staging) og egen database, atskilt fra produksjon —
# samme mønster som dagens-funn-staging på Pi-en. Deler kun den skrivebeskyttede
# lokasjonsdatabasen (shared-locations) med produksjon, slik at stedssøk uten
# AO-innlogging faktisk fungerer i staging (i motsetning til Fly-staging, som
# mangler LOCATION_DB_PATH).

set -e

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
  --exclude 'node_modules' \
  --exclude 'tests' \
  --exclude 'tools' \
  --exclude 'docs' \
  --exclude 'fly.toml' \
  --exclude 'fly.staging.toml' \
  --exclude 'mock' \
  --exclude 'docker-compose.pi.yml' \
  --exclude '/data' \
  /Users/kjetil/git/enkel-ao/ \
  "$PI_HOST:$PI_DIR/"

echo "🏗️  Bygger og starter staging-container på Pi..."
ssh "$PI_HOST" "cd $PI_DIR && docker compose -f docker-compose.staging.yml up -d --build"

echo "✅ Staging (Pi) deploy ferdig: https://aos.efugl.no"
