#!/usr/bin/env bash
# Jeu de test de comportements du tour structuré : prompt courant → modèle de production → seuils.
# Compose les requêtes ici, les rejoue sur le VPS (la clé y reste), note ici.
#   scripts/ops/voice-behavior-eval.sh [--only id,comportement] [--samples N]   (hôte : $VBE_HOST, défaut sokar)
# Plafond d'entrée par passage : VBE_MAX_INPUT_TOKENS (500 000 par défaut).
set -euo pipefail
HOST="${VBE_HOST:-sokar}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; ssh "$HOST" "rm -f /tmp/vbe-requests.json /tmp/vbe-replay.mjs" 2>/dev/null || true' EXIT
cd "$ROOT/apps/api"
npx tsx scripts/voice-behavior-eval.ts build "$@" > "$TMP/requests.json"
scp -q "$TMP/requests.json" "$ROOT/apps/api/scripts/voice-behavior-replay.mjs" "$HOST:/tmp/" 
ssh "$HOST" "mv /tmp/voice-behavior-replay.mjs /tmp/vbe-replay.mjs && mv /tmp/requests.json /tmp/vbe-requests.json && node /tmp/vbe-replay.mjs /tmp/vbe-requests.json" > "$TMP/responses.json"
npx tsx scripts/voice-behavior-eval.ts score "$TMP/responses.json"
