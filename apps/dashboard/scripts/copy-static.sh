#!/bin/bash
# Copy .next/static + public/ to standalone after build
# Required: Next.js 14 standalone does NOT auto-copy these directories (pitfall #29)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
STANDALONE="$DASHBOARD_DIR/.next/standalone/apps/dashboard"

echo "📦 Copying static assets to standalone..."
rm -rf "$STANDALONE/.next/static" "$STANDALONE/public" 2>/dev/null
cp -r "$DASHBOARD_DIR/.next/static" "$STANDALONE/.next/static"
cp -r "$DASHBOARD_DIR/public" "$STANDALONE/public"
echo "✅ .next/static + public/ → standalone"
