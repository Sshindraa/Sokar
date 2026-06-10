#!/bin/bash
# Deploy script pour VPS Sokar
# Usage: bash scripts/deploy-vps.sh [branch]
# Gère la mémoire limitée (4GB sans swap), les arrêts/redémarrages, le build

set -euo pipefail
BRANCH="${1:-main}"
SOKAR_ROOT="/opt/sokar"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "=== Sokar Deploy $DATE ==="
echo "Branch: $BRANCH"

# Vérifier qu'on est sur le VPS
if [ "$(hostname)" != "pmbtc" ]; then
    echo "❌ Ce script s'exécute uniquement sur le VPS (pmbtc)"
    exit 1
fi

cd "$SOKAR_ROOT"

# ── 1. Free memory ──────────────────────────────────────
echo ""
echo "📦 Freeing memory before build..."

# Stop PM2 services (libère ~200MB)
echo "   Stopping PM2 services..."
sudo pm2 stop sokar-api sokar-dashboard 2>/dev/null || true

# Stop LocalStack (libère ~420MB)
echo "   Stopping LocalStack..."
docker stop infra-localstack-1 2>/dev/null || true

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_BEFORE}MB"

# ── 2. Pull code ────────────────────────────────────────
echo ""
echo "📦 Pulling latest code..."
git stash 2>/dev/null || true
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ── 3. Install deps ─────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# ── 4. Generate Prisma ──────────────────────────────────
echo ""
echo "📦 Generating Prisma client..."
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate

# ── 5. Build all ────────────────────────────────────────
echo ""
echo "📦 Building..."
# Config d'abord (dépendance synchrone de l'API)
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/config build
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api build

# Dashboard: skip lint (déjà fait en CI), disable Sentry telemetry
NODE_OPTIONS="--max-old-space-size=1536" NEXT_TELEMETRY_DISABLED=1 SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 pnpm --filter @sokar/dashboard build

# ── 6. Copy static assets to standalone ─────────────────
echo ""
echo "📦 Copying static assets to standalone..."
cd "$SOKAR_ROOT/apps/dashboard"
if [ -f scripts/copy-static.sh ]; then
    bash scripts/copy-static.sh
fi
cd "$SOKAR_ROOT"

# ── 7. DB Sync ──────────────────────────────────────────
echo ""
echo "📦 Syncing database..."
# Use API env for correct DATABASE_URL
export DATABASE_URL=$(grep "^DATABASE_URL" apps/api/.env | cut -d= -f2-)
pnpm db:push
unset DATABASE_URL

# ── 8. Restart services ─────────────────────────────────
echo ""
echo "📦 Restarting services..."
sudo pm2 start sokar-api --update-env
sleep 2
sudo pm2 start sokar-dashboard --update-env
sleep 2
sudo pm2 save

# Restart LocalStack
echo ""
echo "📦 Restarting LocalStack..."
docker start infra-localstack-1 2>/dev/null || true

# ── 9. Verify ───────────────────────────────────────────
echo ""
echo "📦 Verifying..."
sleep 3
sudo pm2 status

echo ""
echo "=== Checking HTTP endpoints ==="
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null || echo "FAIL")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "FAIL")
echo "   api (localhost:4000/health) → $API_STATUS"
echo "   dashboard (localhost:3000)  → $DASH_STATUS"

FREE_AFTER=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_AFTER}MB"

if [ "$API_STATUS" = "200" ] && [ "$DASH_STATUS" = "200" ]; then
    echo ""
    echo "✅ Deploy complete — both services OK"
else
    echo ""
    echo "⚠️  Deploy finished but some checks failed"
fi
