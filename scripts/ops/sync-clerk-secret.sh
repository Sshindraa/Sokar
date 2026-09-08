#!/usr/bin/env bash
# Synchronise la clé secrète Clerk d'un environnement depuis le gestionnaire
# de secrets du workflow. La valeur n'est jamais imprimée ni passée en
# argument : elle reste dans l'environnement du processus SSH.

set -Eeuo pipefail
umask 077

DEPLOY_ENV="${1:-}"
case "$DEPLOY_ENV" in
  staging)
    API_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}"
    DASHBOARD_ENV_FILE="${SOKAR_DASHBOARD_ENV_FILE:-/opt/sokar-staging/apps/dashboard/.env}"
    EXPECTED_PREFIX='sk_test_'
    ;;
  prod)
    API_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar/apps/api/.env}"
    DASHBOARD_ENV_FILE="${SOKAR_DASHBOARD_ENV_FILE:-/opt/sokar/apps/dashboard/.env}"
    EXPECTED_PREFIX='sk_live_'
    ;;
  *)
    echo "Usage: $0 staging|prod" >&2
    exit 2
    ;;
esac

CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-}"
if [[ -z "$CLERK_SECRET_KEY" || "$CLERK_SECRET_KEY" != "$EXPECTED_PREFIX"* ]]; then
  echo "CLERK_SECRET_KEY absent ou incompatible avec l'environnement $DEPLOY_ENV" >&2
  exit 1
fi

env_files=("$API_ENV_FILE" "$DASHBOARD_ENV_FILE")

for env_file in "${env_files[@]}"; do
  if [[ ! -f "$env_file" ]]; then
    echo "Fichier .env absent: $env_file" >&2
    exit 1
  fi
done

tmp_files=()
cleanup() {
  for tmp_file in "${tmp_files[@]:-}"; do
    rm -f "$tmp_file"
  done
}
trap cleanup EXIT

for env_file in "${env_files[@]}"; do
  tmp_file=$(mktemp "${env_file}.clerk.XXXXXX")
  tmp_files+=("$tmp_file")
  chmod 0600 "$tmp_file"
  awk -v key='CLERK_SECRET_KEY' '
    BEGIN {
      prefix = key "="
      value = ENVIRON["CLERK_SECRET_KEY"]
      replaced = 0
    }
    index($0, prefix) == 1 {
      print prefix value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print prefix value
    }
  ' "$env_file" > "$tmp_file"
done

for index in "${!tmp_files[@]}"; do
  mv -f "${tmp_files[$index]}" "${env_files[$index]}"
  tmp_files[$index]=''
done

echo "Clé Clerk synchronisée pour $DEPLOY_ENV (API + dashboard)"
