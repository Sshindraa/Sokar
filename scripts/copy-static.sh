#!/usr/bin/env bash
# Copie les assets statiques (.next/static + public/) dans le build standalone.
#
# Next.js 14 standalone ne copie PAS automatiquement .next/static ni public/
# dans le dossier standalone (pitfall #29). Sans ce script, le serveur
# standalone crashe avec ENOENT sur les assets.
#
# Usage :
#   bash scripts/copy-static.sh <app-name>
#   bash scripts/copy-static.sh dashboard
#   bash scripts/copy-static.sh connect
#
# Les wrappers apps/<app>/scripts/copy-static.sh délèguent à ce script.

set -euo pipefail

APP_NAME="${1:?Usage: copy-static.sh <dashboard|connect>}"

# Résoudre la racine du repo (parent du dossier scripts/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/$APP_NAME"
STANDALONE_DIR="$APP_DIR/.next/standalone/apps/$APP_NAME"
NEXT_DIR="$APP_DIR/.next"

# ── Garde-fou 1 : standalone doit exister (build fait + output: 'standalone') ──
if [ ! -f "$STANDALONE_DIR/server.js" ]; then
  echo "🔴 $STANDALONE_DIR/server.js introuvable." >&2
  echo "   Le build n'a pas produit de standalone. Vérifie next.config.js :" >&2
  echo "     const nextConfig = { output: 'standalone', ... }" >&2
  exit 1
fi

# ── Garde-fou 2 : les sources statiques doivent exister ──
if [ ! -d "$NEXT_DIR/static" ]; then
  echo "🔴 $NEXT_DIR/static introuvable. Lance d'abord le build de $APP_NAME." >&2
  exit 1
fi

echo "📦 [$APP_NAME] Copying static assets to standalone..."

if command -v rsync >/dev/null 2>&1; then
    # ── Copie .next/static avec rsync (checksum, ne recopie pas les fichiers inchangés)
    rm -rf "$STANDALONE_DIR/.next/static"
    mkdir -p "$STANDALONE_DIR/.next"
    rsync -a --checksum "$NEXT_DIR/static/" "$STANDALONE_DIR/.next/static/"

    # ── Copie public/ (si présent) avec rsync
    if [ -d "$APP_DIR/public" ]; then
        rm -rf "$STANDALONE_DIR/public"
        mkdir -p "$STANDALONE_DIR/public"
        rsync -a --checksum "$APP_DIR/public/" "$STANDALONE_DIR/public/"
    fi
else
    # ── Fallback cp -R si rsync n'est pas dispo
    rm -rf "$STANDALONE_DIR/.next/static"
    mkdir -p "$STANDALONE_DIR/.next"
    cp -R "$NEXT_DIR/static/." "$STANDALONE_DIR/.next/static/"

    if [ -d "$APP_DIR/public" ]; then
        rm -rf "$STANDALONE_DIR/public"
        mkdir -p "$STANDALONE_DIR/public"
        cp -R "$APP_DIR/public/." "$STANDALONE_DIR/public/"
    fi
fi

# ── Garde-fou 3 : le dossier static du standalone ne doit pas être vide ──
if ! find "$STANDALONE_DIR/.next/static" -type f -print -quit | grep -q .; then
  echo "🔴 Le dossier static du standalone est vide après la copie." >&2
  exit 1
fi

echo "✅ [$APP_NAME] .next/static + public/ → standalone"
