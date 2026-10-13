#!/usr/bin/env bash
# Synchronise les réglages fournisseurs de staging (e-mail, téléphonie) depuis les secrets `*_STAGING`
# du workflow de staging. Le workflow de production ne transmet pas ces variables : une clé de staging
# ne peut donc pas atteindre la production.
# Les valeurs ne sont jamais affichées. Une variable vide ne modifie pas le fichier : sans clé, l'e-mail
# et la voix restent désactivés en staging.

set -Eeuo pipefail
umask 077

TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}"
PROVIDER_KEYS=(
  RESEND_API_KEY
  TELNYX_API_KEY
  TELNYX_APP_ID
  TELNYX_PUBLIC_KEY
  TELNYX_WEBHOOK_SECRET
  TELNYX_FROM_NUMBER
)

selected=()
for key in "${PROVIDER_KEYS[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    continue
  fi
  if [[ ! "$value" =~ ^[^[:space:]]{8,}$ ]]; then
    echo "Valeur invalide pour $key (8 caractères minimum, sans espace)" >&2
    exit 1
  fi
  selected+=("$key")
done

if [[ ${#selected[@]} -eq 0 ]]; then
  echo "Aucun réglage fournisseur staging fourni ; configuration existante conservée"
  exit 0
fi

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  echo "Fichier .env absent: $TARGET_ENV_FILE" >&2
  exit 1
fi

tmp_file=$(mktemp "${TARGET_ENV_FILE}.provider.XXXXXX")
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT
chmod 0600 "$tmp_file"

# Les valeurs passent par ENVIRON : awk n'interprète aucune séquence d'échappement.
SELECTED_KEYS="${selected[*]}" awk '
  BEGIN {
    n = split(ENVIRON["SELECTED_KEYS"], names, " ")
    for (i = 1; i <= n; i++) { done[names[i]] = 0 }
  }
  {
    handled = 0
    for (i = 1; i <= n; i++) {
      k = names[i]
      if (index($0, k "=") == 1) {
        print k "=" ENVIRON[k]
        done[k] = 1
        handled = 1
        break
      }
    }
    if (!handled) print
  }
  END {
    for (i = 1; i <= n; i++) {
      k = names[i]
      if (!done[k]) print k "=" ENVIRON[k]
    }
  }
' "$TARGET_ENV_FILE" > "$tmp_file"

chmod 0600 "$tmp_file"
mv -f "$tmp_file" "$TARGET_ENV_FILE"
trap - EXIT
echo "Réglages fournisseurs staging synchronisés : ${selected[*]}"
