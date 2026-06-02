#!/bin/bash
# Oppdater Fugleobservasjoner app til staging eller production

set -e

ENVIRONMENT=${1:-local}

if [[ "$ENVIRONMENT" == "staging" ]]; then
    echo "🔄 Deployer til STAGING..."
    SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    PROJECT_ROOT="$SCRIPT_DIR"
    cd "$PROJECT_ROOT"
    flyctl deploy --config fly.staging.toml --app enkel-ao-staging --remote-only
    echo "✅ Staging deployment ferdig! URL: https://enkel-ao-staging.fly.dev"
    exit 0
elif [[ "$ENVIRONMENT" == "production" ]]; then
    echo "🔄 Deployer til PRODUCTION..."

    # Kjør tester før production deploy
    echo "🧪 Kjører tester før production deploy..."
    .venv/bin/python3 -m pytest --maxfail=3
    if [ $? -ne 0 ]; then
        echo "❌ Tester feilet! Avbryter production deploy."
        echo "💡 Fikse testene før du prøver igjen."
        exit 1
    fi
    echo "✅ Alle tester passerte"
    echo ""

    flyctl deploy --config fly.toml
    echo "✅ Production deployment ferdig! URL: https://enkel-ao.fly.dev"
    exit 0
fi

echo "🔄 Oppdaterer Fugleobservasjoner lokalt..."

cd ~/enkel-ao

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
