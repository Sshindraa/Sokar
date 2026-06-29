#!/usr/bin/env bash
# Sokar Connect — Lance le serveur standalone en production.
#
# Usage: bash bin/run-connect.sh
#   - Copie les static assets (via copy-static.sh)
#   - Exécute le binaire standalone sur le port 4002

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP_DIR}"

# 1. Copier les assets statiques si pas déjà fait
if [ ! -d ".next/standalone/apps/connect/.next/static" ]; then
  echo "→ Running copy-static.sh"
  bash scripts/copy-static.sh
fi

# 2. Charger les variables d'environnement.
#    Le serveur standalone Next.js ne charge PAS automatiquement les fichiers
#    .env. On source .env.prod (créé sur le VPS) puis .env en fallback.
for env_file in .env.prod .env; do
  if [ -f "$env_file" ]; then
    set -a
    source "$env_file"
    set +a
  fi
done

# 3. Lancer le serveur
export PORT="${PORT:-4002}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
echo "→ Starting Sokar Connect standalone on ${HOSTNAME}:${PORT}"
exec node .next/standalone/apps/connect/server.js
