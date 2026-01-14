#!/usr/bin/env bash
set -euo pipefail

HOST=${1:-http://localhost:3001}

echo "Smoke-test mot $HOST"

echo "1) Henter root..."
curl -sS --fail "$HOST/" | head -c 200

echo -e "\n\n2) Tester reverse geocoding (mock coords)..."
curl -sS --fail "$HOST/api/reverse?lat=59.9139&lon=10.7522" | jq || true

echo -e "\n\n3) Tester species search (søke=Rødbyk)..."
curl -sS --fail "$HOST/api/species?search=Rødbyk" | jq || true

echo -e "\nSmoke-test ferdig"