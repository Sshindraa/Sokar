#!/usr/bin/env bash
# Synchronise les canaux d'alerte API depuis les secrets du workflow.
# Les valeurs ne sont jamais affichées ; les variables absentes restent
# inchangées afin qu'un déploiement manuel ne désactive pas l'alerting.

set -Eeuo pipefail

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

ALERT_NAMES=(SENTRY_DSN ALERT_EMAIL_TO ALERT_WEBHOOK_URL ALERT_SMS_TO)

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

valid_value() {
  local name="$1"
  local value="$2"
  case "$name" in
    SENTRY_DSN|ALERT_WEBHOOK_URL)
      [[ "$value" =~ ^https://[^[:space:]]+$ ]] ;;
    ALERT_EMAIL_TO)
      [[ "$value" =~ ^[^[:space:],@]+@[^[:space:],@]+(,[[:space:]]*[^[:space:],@]+@[^[:space:],@]+)*$ ]] ;;
    ALERT_SMS_TO)
      [[ "$value" =~ ^\+[0-9]{7,15}(,[[:space:]]*\+[0-9]{7,15})*$ ]] ;;
    *) return 1 ;;
  esac
}

updated=0
for name in "${ALERT_NAMES[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    continue
  fi
  value="${!name}"
  if ! valid_value "$name" "$value"; then
    echo "Valeur d'alerting invalide pour $name" >&2
    exit 1
  fi
  tmp_file=$(mktemp "${TARGET_ENV_FILE}.alerting.XXXXXX")
  awk -v key="$name" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0 }
    index($0, prefix) == 1 { print prefix value; replaced = 1; next }
    { print }
    END { if (!replaced) print prefix value }
  ' "$TARGET_ENV_FILE" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$TARGET_ENV_FILE"
  updated=1
done

if [[ "$updated" -eq 1 ]]; then
  echo "Canaux d'alerte API synchronisés pour $DEPLOY_ENV"
else
  echo "Aucun secret d'alerting fourni ; configuration existante conservée pour $DEPLOY_ENV"
fi
