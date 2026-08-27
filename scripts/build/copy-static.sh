#!/usr/bin/env bash
# Copie les assets statiques (.next/static + public/) dans le build standalone.
#
# Next.js 14 standalone ne copie PAS automatiquement .next/static ni public/
# dans le dossier standalone (pitfall #29). Sans ce script, le serveur
# standalone crashe avec ENOENT sur les assets.
#
# Usage :
#   bash scripts/build/copy-static.sh <app-name>
#   bash scripts/build/copy-static.sh dashboard
#   bash scripts/build/copy-static.sh connect
#
# Les wrappers apps/<app>/scripts/copy-static.sh délèguent à ce script.

set -euo pipefail

APP_NAME="${1:?Usage: copy-static.sh <dashboard|connect>}"

# Résoudre la racine du repo (deux niveaux au-dessus de scripts/build/)
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/$APP_NAME"
# Le déploiement peut fournir NEXT_DIST_DIR pour copier les assets dans une
# release isolée. Les runners PM2 ne définissent pas cette variable et restent
# donc sur le dossier actif `.next`.
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next}"
STANDALONE_DIR="$APP_DIR/$NEXT_DIST_DIR/standalone/apps/$APP_NAME"
NEXT_DIR="$APP_DIR/$NEXT_DIST_DIR"
# Le standalone conserve le distDir utilisé au build (par exemple
# `.next-deploy-...`) dans son arborescence interne. Utiliser le même nom ici
# évite de placer les assets dans `.next/` quand la release est isolée.
STANDALONE_NEXT_DIR="$STANDALONE_DIR/$NEXT_DIST_DIR"

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
    rm -rf "$STANDALONE_NEXT_DIR/static"
    mkdir -p "$STANDALONE_NEXT_DIR"
    rsync -a --checksum "$NEXT_DIR/static/" "$STANDALONE_NEXT_DIR/static/"

    # ── Copie public/ (si présent) avec rsync
    if [ -d "$APP_DIR/public" ]; then
        rm -rf "$STANDALONE_DIR/public"
        mkdir -p "$STANDALONE_DIR/public"
        rsync -a --checksum "$APP_DIR/public/" "$STANDALONE_DIR/public/"
    fi
else
    # ── Fallback cp -R si rsync n'est pas dispo
    rm -rf "$STANDALONE_NEXT_DIR/static"
    mkdir -p "$STANDALONE_NEXT_DIR"
    cp -R "$NEXT_DIR/static/." "$STANDALONE_NEXT_DIR/static/"

    if [ -d "$APP_DIR/public" ]; then
        rm -rf "$STANDALONE_DIR/public"
        mkdir -p "$STANDALONE_DIR/public"
        cp -R "$APP_DIR/public/." "$STANDALONE_DIR/public/"
    fi
fi

# ── Garde-fou 3 : le dossier static du standalone ne doit pas être vide ──
if ! find "$STANDALONE_NEXT_DIR/static" -type f -print -quit | grep -q .; then
  echo "🔴 Le dossier static du standalone est vide après la copie." >&2
  exit 1
fi

echo "✅ [$APP_NAME] .next/static + public/ → standalone"
