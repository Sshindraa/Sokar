#!/usr/bin/env bash
# Canal A — Lance le serveur standalone en production.
#
# Usage: bash bin/run-canal-a.sh
#   - Copie les static assets (via copy-static.sh)
#   - Exécute le binaire standalone sur le port 4002

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP_DIR}"

# 1. Copier les assets statiques si pas déjà fait
if [ ! -d ".next/standalone/apps/canal-a/.next/static" ]; then
  echo "→ Running copy-static.sh"
  bash scripts/copy-static.sh
fi

# 2. Charger .env.prod si présent
if [ -f ".env.prod" ]; then
  set -a
  source .env.prod
  set +a
fi

# 3. Lancer le serveur
export PORT="${PORT:-4002}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
echo "→ Starting Canal A standalone on ${HOSTNAME}:${PORT}"
exec node .next/standalone/apps/canal-a/server.js
