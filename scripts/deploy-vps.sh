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
# Build tous les workspaces dans l'ordre de dépendance (config → types → database → shared → api)
NODE_OPTIONS="--max-old-space-size=1536" pnpm -r --workspace-concurrency=1 build

# Dashboard: skip lint (déjà fait en CI), disable Sentry telemetry
# 2048MB pour éviter le timeout/OOM sur la phase type-checking de Next.js (VPS 4GB sans swap)
NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 pnpm --filter @sokar/dashboard build

# ── 6. Copy static assets to standalone ─────────────────
echo ""
echo "📦 Copying static assets to standalone..."
bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"

# ── 7. DB Sync ──────────────────────────────────────────
echo ""
echo "📦 Syncing database..."
# Use API env for correct DATABASE_URL
export DATABASE_URL=$(grep "^DATABASE_URL" apps/api/.env | cut -d= -f2-)
# prod: accept data loss when adding unique constraints on empty/new columns
pnpm exec prisma db push --schema=packages/database/prisma/schema.prisma --accept-data-loss
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

# Vérification post-déploiement : un asset CSS/JS réel doit répondre 200.
# Bug historique : `curl -I /` répond 200 même si .next/static n'a pas été
# copié dans le standalone → page blanche côté client. On extrait le premier
# chunk JS du HTML rendu et on vérifie qu'il est servi.
DASH_CSS_STATUS="N/A"
FIRST_CHUNK=$(curl -s -H "Host: sokar.tech" http://127.0.0.1/ 2>/dev/null \
  | grep -oE '/_next/static/[^"]+\.(js|css)' \
  | head -1 || true)
if [ -n "$FIRST_CHUNK" ]; then
  DASH_CSS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Host: sokar.tech" "http://127.0.0.1${FIRST_CHUNK}" 2>/dev/null || echo "FAIL")
  echo "   dashboard asset ${FIRST_CHUNK} → $DASH_CSS_STATUS"
else
  echo "   ⚠️  Aucun chunk JS/CSS trouvé dans le HTML du dashboard (build cassé ?)"
fi

FREE_AFTER=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_AFTER}MB"

# Le dashboard est OK SEULEMENT si l'HTML et un asset statique répondent 200.
# Si l'asset est 404, c'est le bug pitfall #29 (static non copiés dans standalone).
if [ "$API_STATUS" = "200" ] && [ "$DASH_STATUS" = "200" ] && [ "$DASH_CSS_STATUS" = "200" ]; then
    echo ""
    echo "✅ Deploy complete — api + dashboard (HTML + assets) OK"
elif [ "$DASH_STATUS" = "200" ] && [ "$DASH_CSS_STATUS" != "200" ]; then
    echo ""
    echo "🔴 Deploy REGRESSED : dashboard HTML répond 200 mais assets statiques 404."
    echo "   Cause probable : scripts/copy-static.sh non exécuté ou .next/static manquant."
    echo "   Fix manuel : cd /opt/sokar/apps/dashboard && bash scripts/copy-static.sh && sudo pm2 restart sokar-dashboard"
    exit 1
else
    echo ""
    echo "⚠️  Deploy finished but some checks failed"
fi
