#!/bin/bash
# Déploiement production de la feature cartes cadeaux (P1-P3 + shortCode).
# Usage sur le VPS pmbtc : bash /opt/sokar/scripts/deploy-gift-cards-prod.sh

set -Eeuo pipefail

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
if ! bash scripts/deploy-vps.sh main; then
  log_error "Déploiement échoué. Voir les logs ci-dessus."
  exit 1
fi

log_info "Déploiement terminé avec succès."

# ── Backfill shortCode ────────────────────────────────────────────────

log_info "Backfill des shortCodes en production..."
cd "$SOKAR_ROOT"
if npx tsx apps/api/scripts/backfill-gift-card-shortcodes.ts; then
  log_info "Backfill terminé."
else
  log_error "Backfill échoué."
  exit 1
fi

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
SHORT_CODE_CHECK=$(cd "$SOKAR_ROOT/packages/database" && npx prisma db execute --stdin <<EOF 2>/dev/null
SELECT COUNT(*) AS total, COUNT(short_code) AS with_short_code FROM gift_cards;
EOF
)

if [ -z "$SHORT_CODE_CHECK" ]; then
  log_warn "Impossible de vérifier les shortCodes. Vérifie manuellement avec Prisma Studio."
else
  log_info "Résultat DB :"
  echo "$SHORT_CODE_CHECK"
fi

# ── Résumé ───────────────────────────────────────────────────────────

log_info "Déploiement de la feature cartes cadeaux terminé avec succès."
log_info "Commits déployés :"
git log --oneline -5

log_warn "Pense à vérifier le webhook Stripe dans le dashboard Stripe :"
log_warn "https://dashboard.stripe.com/webhooks -> https://api.sokar.tech/webhooks/stripe"
