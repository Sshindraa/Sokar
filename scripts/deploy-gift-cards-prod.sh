#!/bin/bash
# Déploiement production de la feature cartes cadeaux (P1-P3 + shortCode).
# Usage sur le VPS pmbtc : bash /opt/sokar/scripts/deploy-gift-cards-prod.sh --confirm-production

set -Eeuo pipefail

if [ "${1:-}" != "--confirm-production" ]; then
  echo "Confirmation production requise : relancez avec --confirm-production." >&2
  exit 2
fi

SOKAR_ROOT="/opt/sokar"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# ── Vérifications préliminaires ──────────────────────────────────────

if [ "$(hostname)" != "pmbtc" ]; then
  log_error "Ce script doit être exécuté sur le VPS pmbtc."
  exit 1
fi

if [ "$EUID" -eq 0 ]; then
  log_error "Ne pas exécuter ce script en root. Utilise l'utilisateur sokar."
  exit 1
fi

cd "$SOKAR_ROOT"

log_info "Vérification des variables d'environnement..."
MISSING_VARS=()

for env_file in apps/api/.env apps/connect/.env apps/dashboard/.env; do
  if [ ! -f "$env_file" ]; then
    log_error "Fichier $env_file introuvable."
    exit 1
  fi
done

for var in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TELNYX_WHATSAPP_FROM; do
  if ! grep -qE "^${var}=" apps/api/.env; then
    MISSING_VARS+=("$var (apps/api/.env)")
  fi
done

for var in NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; do
  if ! grep -qE "^${var}=" apps/connect/.env; then
    MISSING_VARS+=("$var (apps/connect/.env)")
  fi
  if ! grep -qE "^${var}=" apps/dashboard/.env; then
    MISSING_VARS+=("$var (apps/dashboard/.env)")
  fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  log_error "Variables d'environnement manquantes :"
  for v in "${MISSING_VARS[@]}"; do
    echo "  - $v"
  done
  exit 1
fi

log_info "Variables d'environnement OK."

# ── Déploiement ───────────────────────────────────────────────────────

log_info "Lancement du déploiement..."
PREV_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
if ! bash scripts/deploy-vps.sh --confirm-production main; then
  log_error "Déploiement échoué. Voir les logs ci-dessus."
  exit 1
fi

# Si deploy-gift-cards-prod.sh a été modifié par le git pull de deploy-vps.sh,
# on re-exec ce wrapper pour charger la nouvelle version (sinon le backfill
# utilise l'ancien code).
NEW_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ "${SOKAR_WRAPPER_REEXECED:-0}" != "1" ] && [ "$PREV_HASH" != "$NEW_HASH" ]; then
    if git diff --name-only "$PREV_HASH" "$NEW_HASH" 2>/dev/null | grep -qE '^scripts/deploy-gift-cards-prod\.sh$'; then
        log_info "📎 deploy-gift-cards-prod.sh mis à jour — re-exec pour charger la nouvelle version..."
        export SOKAR_WRAPPER_REEXECED=1
        exec bash "$0" --confirm-production
    fi
fi

log_info "Déploiement terminé avec succès."

# ── Backfill shortCode ────────────────────────────────────────────────
# tsx n'est pas exposé globalement sur le VPS (pnpm ne met pas tsx dans PATH).
# On utilise le chemin direct dans node_modules/.pnpm.
# DATABASE_URL est sourcé depuis apps/api/.env (Prisma en a besoin).

log_info "Backfill des shortCodes en production..."
cd "$SOKAR_ROOT"
export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//")
TSX_BIN="node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs"
if [ ! -f "$TSX_BIN" ]; then
  # Fallback : chercher tsx dans .pnpm (version peut varier)
  TSX_BIN=$(find node_modules/.pnpm -path "*/tsx/dist/cli.mjs" 2>/dev/null | head -1)
fi
if [ -z "$TSX_BIN" ] || [ ! -f "$TSX_BIN" ]; then
  log_warn "tsx introuvable dans node_modules. Backfill skippé."
  log_warn "Lance manuellement : cd /opt/sokar && DATABASE_URL=... node <tsx-path> apps/api/scripts/backfill-gift-card-shortcodes.ts"
  unset DATABASE_URL
else
  if node "$TSX_BIN" apps/api/scripts/backfill-gift-card-shortcodes.ts; then
    log_info "Backfill terminé."
  else
    log_error "Backfill échoué."
    unset DATABASE_URL
    exit 1
  fi
fi
unset DATABASE_URL

# ── Vérifications post-déploiement ─────────────────────────────────────

log_info "Vérifications post-déploiement..."

API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health || echo "000")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "000")
CONNECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4002 || echo "000")

log_info "API health: $API_STATUS"
log_info "Dashboard: $DASH_STATUS"
log_info "Connect: $CONNECT_STATUS"

if [ "$API_STATUS" != "200" ] || [ "$DASH_STATUS" != "200" ] || [ "$CONNECT_STATUS" != "200" ]; then
  log_error "Une ou plusieurs vérifications ont échoué."
  exit 1
fi

log_info "Vérifications OK."

# ── Vérification DB shortCode ─────────────────────────────────────────

log_info "Vérification des shortCodes en base..."
export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//")
if [ -z "$TSX_BIN" ] || [ ! -f "$TSX_BIN" ]; then
  log_warn "tsx introuvable — vérification shortCodes skippée."
else
  if SHORT_CODE_CHECK=$(cd "$SOKAR_ROOT" && node "$TSX_BIN" apps/api/scripts/check-gift-card-shortcodes.ts 2>&1); then
    log_info "Résultat DB :"
    echo "$SHORT_CODE_CHECK"
  else
    log_error "Vérification des shortCodes en base échouée."
    echo "$SHORT_CODE_CHECK"
    exit 1
  fi
fi
unset DATABASE_URL

# ── Résumé ───────────────────────────────────────────────────────────

log_info "Déploiement de la feature cartes cadeaux terminé avec succès."
log_info "Commits déployés :"
git log --oneline -5

log_warn "Pense à vérifier le webhook Stripe dans le dashboard Stripe :"
log_warn "https://dashboard.stripe.com/webhooks -> https://api.sokar.tech/webhooks/stripe"
