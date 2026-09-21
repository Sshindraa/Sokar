#!/usr/bin/env bash
# Le vault Obsidian est de la mémoire inter-session : tout ce qui est lu au
# démarrage est repayé à chaque session. `Context.md` doit rester court — TODOs
# + décisions du mois courant. L'activité va dans `Journal.md`, le reste à
# l'archive. Sans garde-fou, la section « Décisions récentes » se remplit
# d'entrées d'activité et le fichier regonfle en quelques heures.
#
# Usage: scripts/quality/check-vault-size.sh [warn|fail]
#   warn (default) : imprime un avertissement, retourne 0
#   fail           : retourne 1 si `Context.md` dépasse les bornes

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MODE="${1:-warn}"
CONTEXT="${VAULT_CONTEXT:-docs/obsidian/Context.md}"
MAX_BYTES="${VAULT_CONTEXT_MAX_BYTES:-8192}"
MAX_AGE_DAYS="${VAULT_CONTEXT_MAX_AGE_DAYS:-45}"

[ -f "$CONTEXT" ] || exit 0

SIZE=$(wc -c <"$CONTEXT" | tr -d ' ')

# BSD date puis GNU date : les dates ISO se comparent correctement en texte.
CUTOFF=$(date -v-"${MAX_AGE_DAYS}"d +%F 2>/dev/null || date -d "-${MAX_AGE_DAYS} days" +%F 2>/dev/null || echo '')

STALE=''
if [ -n "$CUTOFF" ]; then
  STALE=$(grep -E '^20[0-9]{2}-[0-9]{2}-[0-9]{2} — ' "$CONTEXT" | cut -c1-10 | sort -u | awk -v c="$CUTOFF" '$0 < c' || true)
fi

PROBLEM=false
DETAIL=''

if [ "$SIZE" -gt "$MAX_BYTES" ]; then
  PROBLEM=true
  DETAIL="$DETAIL taille=${SIZE}o (max ${MAX_BYTES}o)"
fi

if [ -n "$STALE" ]; then
  PROBLEM=true
  DETAIL="$DETAIL décisions de plus de ${MAX_AGE_DAYS}j : $(echo "$STALE" | tr '\n' ' ')"
fi

if [ "$PROBLEM" = true ]; then
  echo "⚠️  $CONTEXT dépasse les bornes :$DETAIL"
  echo "   $CONTEXT ne garde que les TODOs et les décisions du mois courant."
  echo "   Une entrée d'activité va dans docs/obsidian/Journal.md, jamais ici."
  echo "   Réparation : activité → archive/Context-log-2026.md,"
  echo "   décisions anciennes → archive/Context-decisions-2026.md."
  if [ "$MODE" = "fail" ]; then
    exit 1
  fi
fi

exit 0
