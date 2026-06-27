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

# 2. Charger les variables d'environnement.
#    Le serveur standalone Next.js ne charge PAS automatiquement les fichiers
#    .env (contrairement à `next dev`/`next start`). Sans CLERK_SECRET_KEY au
#    runtime, le middleware Clerk ne peut pas vérifier le session token →
#    boucle de redirection /login ↔ /dashboard (le client useAuth() voit
#    l'utilisateur connecté via le publishable key inliné au build, mais le
#    middleware le rejette côté serveur).
#
#    On source .env (créé par deploy-vps.sh) puis .env.prod en override si
#    présent (chemin historique, non utilisé actuellement).
for env_file in .env .env.prod; do
  if [ -f "$env_file" ]; then
    set -a
    source "$env_file"
    set +a
  fi
done

# 3. Lancer le serveur standalone
export PORT="${PORT:-3000}"
# :: = dual-stack IPv4+IPv6. Next.js middleware proxy utilise ::1 (IPv6),
# Nginx utilise 127.0.0.1 (IPv4). 127.0.0.1 seul provoque un deadlock
# car le proxy interne tente ::1 qui est refusé (bug Next.js IPv4/IPv6).
# UFW bloque le port 3000 aux IP externes.
export HOSTNAME="${HOSTNAME:-::}"
echo "→ Starting dashboard standalone on ${HOSTNAME}:${PORT}"
exec node .next/standalone/apps/dashboard/server.js
