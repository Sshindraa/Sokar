#!/usr/bin/env bash
# Synchronise l'allowlist des opérateurs Sokar depuis l'environnement du
# workflow vers l'API. Les identifiants Clerk ne sont jamais exposés au
# dashboard ni affichés dans les logs.

set -Eeuo pipefail
umask 077

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}" ;;
  prod) TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}" ;;
  *) echo "Usage: $0 staging|prod" >&2; exit 2 ;;
esac

candidate="${SOKAR_OPERATOR_USER_IDS:-}"
if [[ -z "$candidate" ]]; then
  echo "Aucun identifiant opérateur fourni ; configuration existante conservée pour $DEPLOY_ENV"
  exit 0
fi

# Clerk user IDs are opaque but currently use the user_ prefix. Reject spaces,
# quotes and shell metacharacters before writing the value to the dotenv file.
if [[ ! "$candidate" =~ ^user_[A-Za-z0-9_-]+(,user_[A-Za-z0-9_-]+)*$ ]]; then
  echo "SOKAR_OPERATOR_USER_IDS absent ou invalide (CSV d'identifiants Clerk user_*)" >&2
  exit 1
fi

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

tmp_file=$(mktemp "${TARGET_ENV_FILE}.operator.XXXXXX")
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT
chmod 0600 "$tmp_file"

awk -v key='SOKAR_OPERATOR_USER_IDS' -v value="$candidate" '
  BEGIN { prefix = key "="; replaced = 0 }
  index($0, prefix) == 1 { print prefix value; replaced = 1; next }
  { print }
  END { if (!replaced) print prefix value }
' "$TARGET_ENV_FILE" > "$tmp_file"

chmod 0600 "$tmp_file"
mv -f "$tmp_file" "$TARGET_ENV_FILE"
echo "Allowlist opérateur synchronisée pour $DEPLOY_ENV"
