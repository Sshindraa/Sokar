#!/bin/bash
# Copy .next/static + public/ to standalone after build
# Required: Next.js 14 standalone does NOT auto-copy these directories (pitfall #29)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
STANDALONE="$DASHBOARD_DIR/.next/standalone/apps/dashboard"

# Garde-fou : si standalone n'existe pas, le build ne s'est pas fait ou
# next.config.js n'a pas `output: 'standalone'`. On ne fait pas semblant.
if [ ! -d "$STANDALONE" ]; then
  echo "🔴 $STANDALONE introuvable."
  echo "   Le build n'a pas produit de standalone. Vérifie next.config.js :"
  echo "     const nextConfig = { output: 'standalone', ... }"
  exit 1
fi

echo "📦 Copying static assets to standalone..."
rm -rf "$STANDALONE/.next/static" "$STANDALONE/public" 2>/dev/null
# mkdir -p : cp -r exige que le parent du destination existe.
# standalone/ est créé par next build, mais .next/ à l'intérieur n'est pas garanti.
mkdir -p "$STANDALONE/.next"
cp -r "$DASHBOARD_DIR/.next/static" "$STANDALONE/.next/static"
cp -r "$DASHBOARD_DIR/public" "$STANDALONE/public"
echo "✅ .next/static + public/ → standalone"
