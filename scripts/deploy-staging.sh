#!/bin/bash
# Deploy script pour l'environnement de STAGING Sokar.
#
# Usage:
#   bash scripts/deploy-staging.sh              # déploiement complet
#   bash scripts/deploy-staging.sh --dry-run    # simulation (pas de restart, pas de migrations)
#   bash scripts/deploy-staging.sh rollback     # rollback vers la release précédente
#
# Cible : /opt/sokar-staging/ sur le VPS pmbtc.
# Ports  : API=4100, Dashboard=3100, Connect=4102 (décalés vs prod 4000/3000/4002).
# Domaine: staging.sokar.tech (+ api-staging.sokar.tech pour l'API directe).
#
# Isolement staging vs prod :
#   - DB Postgres séparée (sokar_staging)
#   - Redis DB index séparé (db=2)
#   - Clés Clerk staging (pk_test / sk_test)
#   - Telnyx / Deepgram / Cartesia désactivés (STAGING_DISABLE_VOICE=true)
#   - Stripe en mode test (pk_test_*)
#   - PM2 services séparés (préfixe sokar-staging-*)
#   - Nginx vhost séparé (sokar-staging.conf)
#
# Zero-downtime : l'API reste en ligne pendant le build. Seuls dashboard et
# Connect sont arrêtés (Next.js standalone ne peut pas servir pendant next build).

set -Eeuo pipefail

BRANCH="main"
DRY_RUN=false
SOKAR_ROOT="/opt/sokar-staging"
RELEASES_DIR="$SOKAR_ROOT/releases"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Artefacts à snapshoter (chemins relatifs à SOKAR_ROOT)
ARTIFACT_PATHS=(
    "apps/api/dist"
    "apps/dashboard/.next"
    "apps/dashboard/public"
    "apps/connect/.next"
    "apps/connect/public"
)

# ── Parse args ───────────────────────────────────────────
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
    shift
fi
if [ "${1:-}" = "rollback" ]; then
    # Rollback vers la release précédente
    cd "$SOKAR_ROOT"
    echo "=== Staging Rollback ==="
    TARGET_RELEASE=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | sed -n '2p')
    if [ -z "$TARGET_RELEASE" ]; then
        echo "❌ Aucune release précédente trouvée dans $RELEASES_DIR"
        exit 1
    fi
    echo "→ Rollback vers : $TARGET_RELEASE"
    pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
    RELEASE_PATH="$RELEASES_DIR/$TARGET_RELEASE"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$RELEASE_PATH/$p" ]; then
            rm -rf "$SOKAR_ROOT/$p"
            install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
            cp -a "$RELEASE_PATH/$p" "$SOKAR_ROOT/$(dirname "$p")/"
        fi
    done
    pm2 start infra/ecosystem.staging.config.js --update-env
    sleep 8
    pm2 save
    sudo /usr/local/sbin/sokar-deploy-root reload-nginx staging 2>/dev/null || true
    echo "✅ Rollback staging vers $TARGET_RELEASE terminé"
    exit 0
fi

echo "=== Sokar Staging Deploy $DATE ==="
echo "Root: $SOKAR_ROOT"
echo "Branch: $BRANCH"
[ "$DRY_RUN" = true ] && echo "Mode: DRY-RUN (pas de restart ni migrations)"

# Vérifier qu'on est sur le VPS
if [ "$(hostname)" != "pmbtc" ]; then
    echo "❌ Ce script s'exécute uniquement sur le VPS (pmbtc)"
    exit 1
fi

cd "$SOKAR_ROOT"

# ── 0. Swap check ───────────────────────────────────────
if ! swapon --show | grep -q swapfile 2>/dev/null; then
    echo "❌ Aucun swap détecté. Les builds Next.js seront tués par OOM."
    echo "   Lance d'abord (en root) : sudo bash scripts/ops/setup-swap.sh"
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Fichiers suivis modifiés sur le VPS staging. Refus de les stasher automatiquement."
    git status --short
    exit 1
fi

# ── 0b. Snapshot avant build (pour rollback) ────────────
if [ "$DRY_RUN" = false ]; then
    PREV_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')-pre"
    PREV_RELEASE="$RELEASES_DIR/$PREV_TIMESTAMP"
    install -d -m 0755 "$RELEASES_DIR"
    echo ""
    echo "📦 Snapshot pré-build (rollback safety net)..."
    install -d -m 0755 "$PREV_RELEASE"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$SOKAR_ROOT/$p" ]; then
            install -d -m 0755 "$PREV_RELEASE/$(dirname "$p")"
            cp -a "$SOKAR_ROOT/$p" "$PREV_RELEASE/$(dirname "$p")/"
        fi
    done
    RESTORE_ON_FAIL="$PREV_RELEASE"
fi

recover_services() {
    local exit_code=$?
    trap - ERR
    echo ""
    echo "🔴 Déploiement staging interrompu (code ${exit_code})."
    if [ -n "${RESTORE_ON_FAIL:-}" ] && [ -d "${RESTORE_ON_FAIL}" ]; then
        echo "   → Restore artefacts pré-build..."
        pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
        for p in "${ARTIFACT_PATHS[@]}"; do
            if [ -e "${RESTORE_ON_FAIL}/$p" ]; then
                rm -rf "$SOKAR_ROOT/$p"
                install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
                cp -a "${RESTORE_ON_FAIL}/$p" "$SOKAR_ROOT/$(dirname "$p")/"
            fi
        done
    fi
    echo "   → Remise en ligne des services staging..."
    pm2 restart sokar-staging-api sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
    rm -rf "${RESTORE_ON_FAIL}" 2>/dev/null || true
    echo "🔴 Services staging restaurés à l'état pré-build."
    exit "$exit_code"
}
if [ "$DRY_RUN" = false ]; then
    trap recover_services ERR
fi

# ── 1. Free memory (keep API running) ──────────────────
echo ""
echo "📦 Freeing memory before build..."
echo "   Stopping staging dashboard + connect (API stays up)..."
pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_BEFORE}MB"

# ── 2. Pull code ────────────────────────────────────────
echo ""
echo "📦 Pulling latest code from $BRANCH..."
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_HASH=$(git rev-parse HEAD)
echo "   HEAD → $NEW_HASH"

# ── 3. Install deps ─────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Env files critiques — fail fast si absent
REQUIRED_ENV_FILES=(
    "apps/api/.env"
    "apps/dashboard/.env"
    "apps/connect/.env"
)
for env_file in "${REQUIRED_ENV_FILES[@]}"; do
    if [ ! -f "$env_file" ]; then
        echo "❌ Env file manquant : $env_file"
        echo "   Créez-le sur le VPS staging avec les valeurs de staging (voir .env.staging.example)."
        exit 1
    fi
    chmod 0600 "$env_file"
done

# ── 4. Generate Prisma ──────────────────────────────────
echo ""
echo "📦 Generating Prisma client..."
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate

# ── 5. Build ─────────────────────────────────────────────
echo ""
echo "📦 Building all apps..."

# Phase 1 : packages + API
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/config build
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database build
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/shared build
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api build

# Phase 2 : dashboard + connect en parallèle
echo "   → Lancement dashboard + connect en parallèle..."
NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @sokar/dashboard build &
DASH_PID=$!
NODE_OPTIONS="--max-old-space-size=1024" NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @sokar/connect build &
CONNECT_PID=$!
DASH_EXIT=0
CONNECT_EXIT=0
wait "$DASH_PID" || DASH_EXIT=$?
wait "$CONNECT_PID" || CONNECT_EXIT=$?
if [ "$DASH_EXIT" -ne 0 ]; then
    echo "❌ Dashboard build échoué (exit $DASH_EXIT)"
    kill "$CONNECT_PID" 2>/dev/null || true
    exit 1
fi
if [ "$CONNECT_EXIT" -ne 0 ]; then
    echo "❌ Connect build échoué (exit $CONNECT_EXIT)"
    exit 1
fi

# ── 6. Copy static assets ────────────────────────────────
echo ""
echo "📦 Copying static assets to standalone..."
bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"
bash "$SOKAR_ROOT/apps/connect/scripts/copy-static.sh"

# ── 7. DB migrations (skip en dry-run) ───────────────────
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "⏭️  Skip DB migrations (dry-run)"
else
    echo ""
    echo "📦 Applying database migrations (staging DB)..."
    export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//")
    pnpm exec prisma migrate deploy --schema=packages/database/prisma/schema.prisma
    unset DATABASE_URL
fi

# ── 8. Nginx routing (skip en dry-run) ───────────────────
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "⏭️  Skip Nginx install (dry-run)"
else
    echo ""
    echo "📦 Installing Nginx staging routing..."
    sudo /usr/local/sbin/sokar-deploy-root install-nginx staging
fi

# ── 9. Restart services (skip en dry-run) ────────────────
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "⏭️  Skip PM2 restart (dry-run)"
    echo ""
    echo "✅ Dry-run terminé — build OK, aucun changement appliqué"
    exit 0
fi

echo ""
echo "📦 Restarting staging services..."
pm2 start infra/ecosystem.staging.config.js --update-env
sleep 4
pm2 save
sudo /usr/local/sbin/sokar-deploy-root reload-nginx staging

# ── 10. Verify ───────────────────────────────────────────
echo ""
echo "📦 Verifying staging..."
sleep 3
pm2 status

# Attendre que les services soient prêts (timeout 30s)
echo ""
echo "⏳ Waiting for staging services to be ready..."
WAIT_START=$(date +%s)
while true; do
    API_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/health 2>/dev/null || echo "000")
    DASH_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100 2>/dev/null || echo "000")
    CONNECT_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/restaurant/chez-sokar-demo 2>/dev/null || echo "000")
    if [ "$API_READY" = "200" ] && [ "$DASH_READY" = "200" ] && [ "$CONNECT_READY" = "200" ]; then
        echo "   API + Dashboard + Connect ready"
        break
    fi
    WAIT_NOW=$(date +%s)
    if [ $((WAIT_NOW - WAIT_START)) -ge 30 ]; then
        echo "   ⚠️ Timeout (API=$API_READY Dash=$DASH_READY Connect=$CONNECT_READY)"
        break
    fi
    sleep 2
done

echo ""
echo "=== Checking staging HTTP endpoints ==="
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/health 2>/dev/null || echo "FAIL")
LIVEZ_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/livez 2>/dev/null || echo "FAIL")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100 2>/dev/null || echo "FAIL")
CONNECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/restaurant/chez-sokar-demo 2>/dev/null || echo "FAIL")
echo "   api (/health)      → $API_STATUS"
echo "   api (/livez)       → $LIVEZ_STATUS"
echo "   dashboard (/)      → $DASH_STATUS"
echo "   connect (/restaurant/chez-sokar-demo) → $CONNECT_STATUS"

# Vérifier via Nginx (Host header)
STAGING_API_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
    http://127.0.0.1/health 2>/dev/null || echo "FAIL")
STAGING_DASH_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
    http://127.0.0.1/ 2>/dev/null || echo "FAIL")
echo "   staging.sokar.tech/health via Nginx → $STAGING_API_VHOST"
echo "   staging.sokar.tech/ via Nginx       → $STAGING_DASH_VHOST"

# ── 11. Snapshot post-build réussi ───────────────────────
NEW_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
NEW_RELEASE="$RELEASES_DIR/$NEW_TIMESTAMP"
echo ""
echo "📦 Snapshot post-build (release $NEW_TIMESTAMP)..."
install -d -m 0755 "$NEW_RELEASE"
for p in "${ARTIFACT_PATHS[@]}"; do
    if [ -e "$SOKAR_ROOT/$p" ]; then
        install -d -m 0755 "$NEW_RELEASE/$(dirname "$p")"
        cp -a "$SOKAR_ROOT/$p" "$NEW_RELEASE/$(dirname "$p")/"
    fi
done
echo "$NEW_TIMESTAMP" > "$RELEASES_DIR/.latest"

# Cleanup old releases (garde 3)
RELEASE_COUNT=$(ls -1 "$RELEASES_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort -r | wc -l)
if [ "$RELEASE_COUNT" -gt 3 ]; then
    ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | tail -n +4 \
        | while read -r old; do
            rm -rf "$RELEASES_DIR/$old"
        done
fi

# Nettoyer le snapshot pré-build
rm -rf "${PREV_RELEASE}" 2>/dev/null || true

# ── Résultat ─────────────────────────────────────────────
if [ "$API_STATUS" = "200" ] \
    && [ "$LIVEZ_STATUS" = "200" ] \
    && [ "$DASH_STATUS" = "200" ] \
    && [ "$CONNECT_STATUS" = "200" ]; then
    echo ""
    echo "✅ Staging deploy complete — API + Dashboard + Connect OK"
    echo "   URLs : https://staging.sokar.tech (dashboard)"
    echo "          https://api-staging.sokar.tech (API)"
    echo "   Rollback : bash scripts/deploy-staging.sh rollback"
    trap - ERR
else
    echo ""
    echo "🔴 Staging deploy finished but checks failed"
    echo "   API=$API_STATUS Livez=$LIVEZ_STATUS Dash=$DASH_STATUS Connect=$CONNECT_STATUS"
    exit 1
fi
