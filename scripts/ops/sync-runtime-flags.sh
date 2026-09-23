#!/usr/bin/env bash
# Synchronise les flags runtime non secrets depuis les variables du workflow.
# Les flags absents restent inchangés ; aucune valeur n'est affichée dans les logs.

set -Eeuo pipefail
umask 077

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

# Allowlist deliberately excludes provider credentials and outbound switches.
# Opening the Marketing control plane must never enable SMS/email delivery.
RUNTIME_FLAG_NAMES=(MARKETING_FEATURES_ENABLED VOICE_TURN_PLAN_SHADOW_ENABLED VOICE_TURN_PLAN_AUTHORITY_ENABLED)

valid_value() {
  local value="$1"
  [[ "$value" == "true" || "$value" == "false" ]]
}

updated=0
for name in "${RUNTIME_FLAG_NAMES[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    continue
  fi
  value="${!name}"
  if ! valid_value "$value"; then
    echo "Valeur invalide pour le flag runtime $name (attendu: true ou false)" >&2
    exit 1
  fi

  tmp_file=$(mktemp "${TARGET_ENV_FILE}.runtime-flags.XXXXXX")
  cleanup() { rm -f "$tmp_file"; }
  trap cleanup EXIT
  awk -v key="$name" -v value="$value" '
    BEGIN { prefix = key "="; replaced = 0 }
    index($0, prefix) == 1 { print prefix value; replaced = 1; next }
    { print }
    END { if (!replaced) print prefix value }
  ' "$TARGET_ENV_FILE" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv -f "$tmp_file" "$TARGET_ENV_FILE"
  trap - EXIT
  updated=1
done

if [[ "$updated" -eq 1 ]]; then
  echo "Flags runtime synchronisés pour $DEPLOY_ENV"
else
  echo "Aucun flag runtime fourni ; configuration existante conservée pour $DEPLOY_ENV"
fi
