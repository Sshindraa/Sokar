#!/usr/bin/env bash
# Canal A — Copie les assets statiques dans le build standalone.
#
# Next.js 14 standalone ne copie PAS automatiquement .next/static ni public/
# dans le dossier standalone (pitfall #29). Sans ce script, le serveur
# standalone crashe avec ENOENT sur les assets.
#
# Cf. skill sokar-nextjs-dashboard §"Pourquoi ne pas lancer `next start` direct".
#
# Usage: bash scripts/copy-static.sh
#   - Lit .next/standalone/apps/canal-a/
#   - Copie .next/static/apps/canal-a/ → .next/standalone/apps/canal-a/.next/static/
#   - Copie public/ → .next/standalone/apps/canal-a/public/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="canal-a"
STANDALONE_DIR="${APP_DIR}/.next/standalone/apps/${APP_NAME}"
NEXT_DIR="${APP_DIR}/.next"

# Garde-fou : si standalone n'existe pas, le build ne s'est pas fait ou
# next.config.js n'a pas `output: 'standalone'`.
if [ ! -d "${STANDALONE_DIR}" ]; then
  echo "❌ Standalone directory not found: ${STANDALONE_DIR}" >&2
  echo "   Lance d'abord: pnpm build" >&2
  exit 1
fi

# Copy .next/static
if [ -d "${NEXT_DIR}/static" ]; then
  echo "→ Copying ${NEXT_DIR}/static → ${STANDALONE_DIR}/.next/static"
  mkdir -p "${STANDALONE_DIR}/.next/static"
  cp -R "${NEXT_DIR}/static/." "${STANDALONE_DIR}/.next/static/"
fi

# Copy public
if [ -d "${APP_DIR}/public" ]; then
  echo "→ Copying public/ → ${STANDALONE_DIR}/public"
  mkdir -p "${STANDALONE_DIR}/public"
  cp -R "${APP_DIR}/public/." "${STANDALONE_DIR}/public/"
fi

echo "✅ Static assets copied to standalone"
