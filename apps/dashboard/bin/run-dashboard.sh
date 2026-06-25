#!/usr/bin/env bash
# Dashboard — Lance le serveur standalone en production.
#
# Usage: bash bin/run-dashboard.sh
#   - Copie les static assets + public/ (via scripts/copy-static.sh)
#     si pas déjà fait (cf. pitfall #29 de la skill sokar-deployment)
#   - Exécute le binaire standalone Next.js sur le port 3000
#
# Pourquoi ce wrapper plutôt que `next start` :
#   - PM2 gère un process unique = moins de surface (no watch, no dev server)
#   - Le standalone évite d'avoir à `cd` dans node_modules
#   - Le copy-static est idempotent : pas de risque de double-copie

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP_DIR}"

# 1. Copier les assets statiques à chaque démarrage.
#    Next.js 14 standalone ne copie PAS auto .next/static ni public/
#    dans le bundle standalone → page blanche si oublié.
echo "→ Running copy-static.sh"
bash scripts/copy-static.sh

# 2. Charger .env.prod si présent
if [ -f ".env.prod" ]; then
  set -a
  source .env.prod
  set +a
fi

# 3. Lancer le serveur standalone
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
echo "→ Starting dashboard standalone on ${HOSTNAME}:${PORT}"
exec node .next/standalone/apps/dashboard/server.js
