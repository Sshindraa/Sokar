#!/usr/bin/env bash
# Synchronise les identifiants de prix Stripe non secrets dans l'environnement
# de déploiement avant le build. Les valeurs viennent des variables GitHub
# Actions et ne doivent jamais contenir de clé secrète.

set -Eeuo pipefail

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="/opt/sokar-staging/apps/api/.env" ;;
  prod) TARGET_ENV_FILE="/opt/sokar/apps/api/.env" ;;
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

for name in "${PRICE_NAMES[@]}"; do
  value="${!name}"
  tmp_file=$(mktemp "${TARGET_ENV_FILE}.sync.XXXXXX")
  awk -v key="$name" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0 }
    index($0, prefix) == 1 { print prefix value; replaced = 1; next }
    { print }
    END { if (!replaced) print prefix value }
  ' "$TARGET_ENV_FILE" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$TARGET_ENV_FILE"
done

echo "Stripe price IDs synchronisés pour $DEPLOY_ENV"
