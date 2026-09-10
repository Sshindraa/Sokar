#!/usr/bin/env bash
# Synchronise le jeton de service de la route legacy de réservation depuis
# le secret du workflow. La valeur ne doit jamais apparaître dans les logs,
# la ligne de commande ou le dépôt.

set -Eeuo pipefail
umask 077

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

candidate="${RESERVATION_SERVICE_TOKEN:-}"
if [[ ! "$candidate" =~ ^[^[:space:]]{32,}$ ]]; then
  echo "RESERVATION_SERVICE_TOKEN absent ou trop court (minimum 32 caractères)" >&2
  exit 1
fi

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

tmp_file=$(mktemp "${TARGET_ENV_FILE}.reservation-token.XXXXXX")
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT
chmod 0600 "$tmp_file"

awk -v key='RESERVATION_SERVICE_TOKEN' -v value="$candidate" '
  BEGIN { prefix = key "="; replaced = 0 }
  index($0, prefix) == 1 { print prefix value; replaced = 1; next }
  { print }
  END { if (!replaced) print prefix value }
' "$TARGET_ENV_FILE" > "$tmp_file"

chmod 0600 "$tmp_file"
mv -f "$tmp_file" "$TARGET_ENV_FILE"
echo "RESERVATION_SERVICE_TOKEN synchronisé pour $DEPLOY_ENV"
