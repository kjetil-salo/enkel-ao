#!/bin/bash
# Oppdater Fugleobservasjoner app

set -e

echo "🔄 Oppdaterer Fugleobservasjoner..."

cd ~/bird-observations-made-simple

# Pull siste endringer
echo "📥 Henter siste kode fra GitHub..."
git pull

# Bygg ny image
echo "🏗️  Bygger ny Docker image..."
docker build -t fugleobservasjoner:latest .

# Stopp gammel container
echo "🛑 Stopper gammel container..."
docker stop fugleobservasjoner
docker rm fugleobservasjoner

# Kjør ny container
echo "🚀 Starter ny container..."
docker run -d \
  --name fugleobservasjoner \
  --restart unless-stopped \
  -p 3000:3000 \
  fugleobservasjoner:latest

# Rydd opp gamle images
echo "🧹 Rydder gamle Docker images..."
docker image prune -f

# Sjekk status
sleep 2
if docker ps | grep -q fugleobservasjoner; then
    echo "✅ App oppdatert og kjører! ($(date))"
    docker logs --tail 10 fugleobservasjoner
else
    echo "❌ Noe gikk galt. Sjekk logs:"
    docker logs fugleobservasjoner
    exit 1
fi
