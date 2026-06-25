#!/bin/bash
# Deploy script pour VPS Sokar
# Usage: bash scripts/deploy-vps.sh [branch]
# Gère la mémoire limitée, les trois apps PM2 et le routage Nginx.

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

if [ ! -f /etc/letsencrypt/live/sokar.tech/fullchain.pem ] \
    || [ ! -f /etc/letsencrypt/live/sokar.tech/privkey.pem ]; then
    echo "❌ Certificat origine absent. Lance d'abord :"
    echo "   sudo bash scripts/setup-origin-tls.sh"
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Fichiers suivis modifiés sur le VPS. Refus de les stasher automatiquement."
    git status --short
    exit 1
fi

UNTRACKED_FILES=$(git ls-files --others --exclude-standard)
if [ -n "$UNTRACKED_FILES" ]; then
    echo "⚠️  Fichiers non suivis conservés sur le VPS :"
    printf '%s\n' "$UNTRACKED_FILES" | sed 's/^/   /'
fi

recover_services() {
    exit_code=$?
    trap - ERR
    echo ""
    echo "🔴 Déploiement interrompu (code ${exit_code}). Tentative de remise en ligne..."
    sudo pm2 restart sokar-api sokar-dashboard sokar-canal-a 2>/dev/null \
        || sudo pm2 resurrect 2>/dev/null \
        || true
    docker start infra-localstack-1 2>/dev/null || true
    exit "$exit_code"
}
trap recover_services ERR

# ── 1. Free memory ──────────────────────────────────────
echo ""
echo "📦 Freeing memory before build..."

# Stop PM2 services before the memory-heavy Next.js builds.
echo "   Stopping PM2 services..."
sudo pm2 stop sokar-api sokar-dashboard sokar-canal-a 2>/dev/null || true

# Stop LocalStack (libère ~420MB)
echo "   Stopping LocalStack..."
docker stop infra-localstack-1 2>/dev/null || true

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_BEFORE}MB"

# ── 2. Pull code ────────────────────────────────────────
echo ""
echo "📦 Pulling latest code..."
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ── 3. Install deps ─────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

for env_file in apps/api/.env apps/dashboard/.env apps/canal-a/.env.prod infra/.env; do
    if [ -f "$env_file" ]; then
        chmod 0600 "$env_file"
    fi
done

# ── 4. Generate Prisma ──────────────────────────────────
echo ""
echo "📦 Generating Prisma client..."
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate

# ── 5. Build all ────────────────────────────────────────
echo ""
echo "📦 Building..."
# API + dépendances workspace, puis les deux applications Next séquentiellement.
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api... build
NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 \
    pnpm --filter @sokar/dashboard build
NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @sokar/canal-a build

# ── 6. Copy static assets to standalone ─────────────────
echo ""
echo "📦 Copying static assets to standalone..."
bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"
bash "$SOKAR_ROOT/apps/canal-a/scripts/copy-static.sh"

# ── 7. DB backup + migrations ───────────────────────────
echo ""
echo "📦 Backing up database..."
bash "$SOKAR_ROOT/scripts/backup-postgres.sh"

sudo install -m 0750 "$SOKAR_ROOT/scripts/backup-postgres.sh" \
    /usr/local/sbin/sokar-backup-postgres
sudo install -m 0644 "$SOKAR_ROOT/infra/cron/sokar-postgres-backup" \
    /etc/cron.d/sokar-postgres-backup

echo ""
echo "📦 Applying database migrations..."
export DATABASE_URL=$(grep "^DATABASE_URL" apps/api/.env | cut -d= -f2-)
pnpm exec prisma migrate deploy --schema=packages/database/prisma/schema.prisma
unset DATABASE_URL

# ── 8. Install and validate Nginx routing ───────────────
echo ""
echo "📦 Installing Nginx routing..."
sudo install -d -m 0755 /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo install -m 0644 infra/nginx/snippets/sokar-proxy.conf \
    /etc/nginx/snippets/sokar-proxy.conf
sudo install -m 0644 infra/nginx/snippets/sokar-cloudflare-real-ip.conf \
    /etc/nginx/snippets/sokar-cloudflare-real-ip.conf
sudo install -m 0644 infra/nginx/sokar.conf /etc/nginx/sites-available/sokar
sudo ln -sfn /etc/nginx/sites-available/sokar /etc/nginx/sites-enabled/sokar
sudo nginx -t

# Un seul virtual host doit posséder api.sokar.tech. Un doublon peut envoyer
# les requêtes vers une ancienne configuration dashboard.
API_VHOST_COUNT=$(sudo nginx -T 2>/dev/null \
    | grep -Ec 'server_name[[:space:]]+api\.sokar\.tech' || true)
if [ "$API_VHOST_COUNT" -ne 1 ]; then
    echo "❌ ${API_VHOST_COUNT} virtual hosts déclarent api.sokar.tech (attendu: 1)."
    echo "   Supprime l'ancien fichier dans /etc/nginx/sites-enabled avant de relancer."
    exit 1
fi

# ── 9. Restart services ─────────────────────────────────
echo ""
echo "📦 Restarting services..."
sudo pm2 start infra/ecosystem.config.js --update-env
sleep 4
sudo pm2 save
sudo systemctl reload nginx

# Restart LocalStack
echo ""
echo "📦 Restarting LocalStack..."
docker start infra-localstack-1 2>/dev/null || true

# ── 10. Verify ──────────────────────────────────────────
echo ""
echo "📦 Verifying..."
sleep 3
sudo pm2 status

echo ""
echo "=== Checking HTTP endpoints ==="
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null || echo "FAIL")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "FAIL")
CANAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4002/r/chez-sokar-demo 2>/dev/null || echo "FAIL")
API_VHOST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: api.sokar.tech" \
    http://127.0.0.1/health 2>/dev/null || echo "FAIL")
WIDGET_API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
    http://127.0.0.1/api/proxy/public/widget/chez-sokar-demo 2>/dev/null || echo "FAIL")
PUBLIC_PAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
    http://127.0.0.1/r/chez-sokar-demo 2>/dev/null || echo "FAIL")
echo "   api (localhost:4000/health) → $API_STATUS"
echo "   dashboard (localhost:3000)  → $DASH_STATUS"
echo "   canal-a (localhost:4002/r/chez-sokar-demo) → $CANAL_STATUS"
echo "   api.sokar.tech/health via Nginx → $API_VHOST_STATUS"
echo "   widget slug API via Next proxy → $WIDGET_API_STATUS"
echo "   public Canal A page via Nginx → $PUBLIC_PAGE_STATUS"

WIDGET_HEADERS=$(curl -sSI -H "Host: sokar.tech" \
    http://127.0.0.1/widget/chez-sokar-demo 2>/dev/null || true)
if printf '%s' "$WIDGET_HEADERS" | grep -Eqi '^X-Frame-Options:'; then
    WIDGET_IFRAME_STATUS="FAIL"
else
    WIDGET_IFRAME_STATUS="OK"
fi
if ! printf '%s' "$WIDGET_HEADERS" | grep -Eqi '^Content-Security-Policy:.*frame-ancestors \*'; then
    WIDGET_IFRAME_STATUS="FAIL"
fi
echo "   widget iframe headers → $WIDGET_IFRAME_STATUS"

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
if [ "$API_STATUS" = "200" ] \
    && [ "$DASH_STATUS" = "200" ] \
    && [ "$CANAL_STATUS" = "200" ] \
    && [ "$API_VHOST_STATUS" = "200" ] \
    && [ "$WIDGET_API_STATUS" = "200" ] \
    && [ "$PUBLIC_PAGE_STATUS" = "200" ] \
    && [ "$WIDGET_IFRAME_STATUS" = "OK" ] \
    && [ "$DASH_CSS_STATUS" = "200" ]; then
    echo ""
    echo "✅ Deploy complete — API + dashboard + Canal A + routing OK"
    trap - ERR
elif [ "$DASH_STATUS" = "200" ] && [ "$DASH_CSS_STATUS" != "200" ]; then
    echo ""
    echo "🔴 Deploy REGRESSED : dashboard HTML répond 200 mais assets statiques 404."
    echo "   Cause probable : scripts/copy-static.sh non exécuté ou .next/static manquant."
    echo "   Fix manuel : cd /opt/sokar/apps/dashboard && bash scripts/copy-static.sh && sudo pm2 restart sokar-dashboard"
    exit 1
else
    echo ""
    echo "🔴 Deploy finished but routing or application checks failed"
    exit 1
fi
