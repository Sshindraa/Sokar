#!/usr/bin/env bash
# Synchronise les identifiants de prix Stripe non secrets dans l'environnement
# de déploiement avant le build. Les valeurs viennent des variables GitHub
# Actions et ne doivent jamais contenir de clé secrète.

set -Eeuo pipefail

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

PRICE_NAMES=(
  STRIPE_PRICE_ESSENTIAL_MONTHLY
  STRIPE_PRICE_ESSENTIAL_ANNUAL
  STRIPE_PRICE_PRO_MONTHLY
  STRIPE_PRICE_PRO_ANNUAL
  STRIPE_PRICE_MULTI_SITE_MONTHLY
  STRIPE_PRICE_MULTI_SITE_ANNUAL
  STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY
  STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL
)

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

for name in "${PRICE_NAMES[@]}"; do
  value="${!name:-}"
  if [[ ! "$value" =~ ^price_[A-Za-z0-9]+$ ]]; then
    echo "Identifiant Stripe manquant ou invalide pour $name" >&2
    exit 1
  fi
done

tmp_file=$(mktemp "${TARGET_ENV_FILE}.sync.XXXXXX")
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT

# Les priceId ne rendent pas le checkout accessible : seul
# BILLING_CHECKOUT_ENABLED le fait. On les synchronise donc même lorsque la
# vente est fermée, afin qu'une activation ultérieure ne redémarre jamais avec
# les anciens tarifs. Le fichier complet est préparé dans un temporaire et
# publié en un seul rename après validation.
awk \
  -v STRIPE_PRICE_ESSENTIAL_MONTHLY="$STRIPE_PRICE_ESSENTIAL_MONTHLY" \
  -v STRIPE_PRICE_ESSENTIAL_ANNUAL="$STRIPE_PRICE_ESSENTIAL_ANNUAL" \
  -v STRIPE_PRICE_PRO_MONTHLY="$STRIPE_PRICE_PRO_MONTHLY" \
  -v STRIPE_PRICE_PRO_ANNUAL="$STRIPE_PRICE_PRO_ANNUAL" \
  -v STRIPE_PRICE_MULTI_SITE_MONTHLY="$STRIPE_PRICE_MULTI_SITE_MONTHLY" \
  -v STRIPE_PRICE_MULTI_SITE_ANNUAL="$STRIPE_PRICE_MULTI_SITE_ANNUAL" \
  -v STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY="$STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY" \
  -v STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL="$STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL" '
  BEGIN {
    keys[1] = "STRIPE_PRICE_ESSENTIAL_MONTHLY"
    keys[2] = "STRIPE_PRICE_ESSENTIAL_ANNUAL"
    keys[3] = "STRIPE_PRICE_PRO_MONTHLY"
    keys[4] = "STRIPE_PRICE_PRO_ANNUAL"
    keys[5] = "STRIPE_PRICE_MULTI_SITE_MONTHLY"
    keys[6] = "STRIPE_PRICE_MULTI_SITE_ANNUAL"
    keys[7] = "STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY"
    keys[8] = "STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL"
    values["STRIPE_PRICE_ESSENTIAL_MONTHLY"] = STRIPE_PRICE_ESSENTIAL_MONTHLY
    values["STRIPE_PRICE_ESSENTIAL_ANNUAL"] = STRIPE_PRICE_ESSENTIAL_ANNUAL
    values["STRIPE_PRICE_PRO_MONTHLY"] = STRIPE_PRICE_PRO_MONTHLY
    values["STRIPE_PRICE_PRO_ANNUAL"] = STRIPE_PRICE_PRO_ANNUAL
    values["STRIPE_PRICE_MULTI_SITE_MONTHLY"] = STRIPE_PRICE_MULTI_SITE_MONTHLY
    values["STRIPE_PRICE_MULTI_SITE_ANNUAL"] = STRIPE_PRICE_MULTI_SITE_ANNUAL
    values["STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY"] = STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY
    values["STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL"] = STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL
  }
  {
    key = $0
    sub(/=.*/, "", key)
    if (key in values) {
      print key "=" values[key]
      seen[key] = 1
      next
    }
    print
  }
  END {
    for (position = 1; position <= 8; position++) {
      key = keys[position]
      if (!(key in seen)) print key "=" values[key]
    }
  }
' "$TARGET_ENV_FILE" > "$tmp_file"
chmod 600 "$tmp_file"

# Contrôle du catalogue : le code ne vérifie que le préfixe `price_`. Sans cette
# étape, un identifiant pointant vers l'ancien prix 149/249 € activerait le
# checkout au mauvais montant. Dès que le checkout est ouvert, le contrôle est
# obligatoire et porte sur le fichier temporaire avant sa publication.
SOKAR_ROOT="${SOKAR_ROOT:-$(cd "$(dirname "$TARGET_ENV_FILE")/../.." && pwd)}"
VERIFY_SCRIPT="$SOKAR_ROOT/scripts/ops/verify-stripe-catalog.mjs"
if grep -Eq '^BILLING_CHECKOUT_ENABLED=[[:space:]]*"?true"?[[:space:]]*$' "$tmp_file"; then
  if [[ ! -f "$VERIFY_SCRIPT" ]] || ! command -v node >/dev/null 2>&1; then
    echo "Contrôle du catalogue indisponible : activation du checkout refusée." >&2
    exit 1
  fi
  if ! node --env-file="$tmp_file" "$VERIFY_SCRIPT"; then
    echo "Catalogue Stripe non conforme : corriger les prix avant d'activer le checkout." >&2
    exit 1
  fi
else
  echo "Checkout abonnements désactivé pour $DEPLOY_ENV ; prix synchronisés, contrôle Stripe différé"
fi

mv "$tmp_file" "$TARGET_ENV_FILE"
trap - EXIT
echo "Stripe price IDs synchronisés pour $DEPLOY_ENV"
