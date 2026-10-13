#!/usr/bin/env bash
# Synchronise les réglages fournisseurs de staging depuis les secrets et variables `*_STAGING` du seul
# workflow de staging. Le workflow de production ne les transmet pas : une valeur de staging ne peut
# donc pas atteindre la production.
#
# Chaque réglage est lu par un consommateur réel de l'API :
#   RESEND_API_KEY        shared/email                       envoi des e-mails
#   EMAIL_FROM            shared/email                       expéditeur (repli sur noreply@sokar.fr sinon)
#   TELNYX_API_KEY        shared/telnyx/client               API Telnyx
#   TELNYX_PUBLIC_KEY     voice/telnyx.guard                 vérification de la signature des webhooks
#   TELNYX_CONNECTION_ID  admin/provisioning.service         rattachement du numéro à l'application d'appel
#   TELNYX_FROM_NUMBER    shared/telnyx/client               numéro émetteur (appels sortants, SMS)
# TELNYX_APP_ID et TELNYX_WEBHOOK_SECRET ne sont lus par aucun code : ils ne sont pas synchronisés.
#
# Les valeurs ne sont jamais affichées. Une variable vide ne modifie pas le fichier : sans réglage,
# l'e-mail et la voix restent désactivés en staging.

set -Eeuo pipefail
umask 077

TARGET_ENV_FILE="${SOKAR_API_ENV_FILE:-/opt/sokar-staging/apps/api/.env}"
PROVIDER_KEYS=(
  RESEND_API_KEY
  EMAIL_FROM
  TELNYX_API_KEY
  TELNYX_PUBLIC_KEY
  TELNYX_CONNECTION_ID
  TELNYX_FROM_NUMBER
)

# Format attendu par réglage. Une valeur hors format est refusée, sans être affichée.
is_valid_value() {
  case "$1" in
    EMAIL_FROM) [[ "$2" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] ;;
    TELNYX_FROM_NUMBER) [[ "$2" =~ ^\+[1-9][0-9]{7,14}$ ]] ;;
    *) [[ "$2" =~ ^[^[:space:]]{8,}$ ]] ;;
  esac
}

selected=()
for key in "${PROVIDER_KEYS[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    continue
  fi
  if ! is_valid_value "$key" "$value"; then
    echo "Valeur invalide pour $key (format attendu : voir docs/runbooks/environment.md)" >&2
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
