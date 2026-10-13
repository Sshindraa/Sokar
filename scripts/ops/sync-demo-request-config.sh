#!/usr/bin/env bash
# Synchronise les destinataires des demandes de démonstration depuis le secret du workflow.
# La valeur n'est jamais affichée. Sans secret, la configuration existante est conservée : les
# demandes restent enregistrées, sans notification.

set -Eeuo pipefail
umask 077

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

if [[ -z "${DEMO_REQUEST_NOTIFY_TO:-}" ]]; then
  echo "Aucun destinataire de demande de démonstration fourni ; configuration existante conservée pour $DEPLOY_ENV"
  exit 0
fi

# Adresses séparées par des virgules ; les espaces sont retirés avant écriture.
value="${DEMO_REQUEST_NOTIFY_TO// /}"
if ! [[ "$value" =~ ^[^[:space:],@]+@[^[:space:],@]+(,[^[:space:],@]+@[^[:space:],@]+)*$ ]]; then
  echo "Valeur invalide pour DEMO_REQUEST_NOTIFY_TO (liste d'adresses e-mail attendue)" >&2
  exit 1
fi

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

tmp_file=$(mktemp "${TARGET_ENV_FILE}.demo-request.XXXXXX")
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT
awk -v key="DEMO_REQUEST_NOTIFY_TO" -v value="$value" '
  BEGIN { prefix = key "="; replaced = 0 }
  index($0, prefix) == 1 { print prefix value; replaced = 1; next }
  { print }
  END { if (!replaced) print prefix value }
' "$TARGET_ENV_FILE" > "$tmp_file"
chmod 600 "$tmp_file"
mv -f "$tmp_file" "$TARGET_ENV_FILE"
trap - EXIT

echo "Destinataires des demandes de démonstration synchronisés pour $DEPLOY_ENV"
