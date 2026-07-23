#!/bin/bash
# Deploy script pour l'environnement de STAGING Sokar.
#
# Usage:
#   bash scripts/deploy-staging.sh              # déploiement complet
#   bash scripts/deploy-staging.sh --dry-run    # simulation (pas de restart, pas de migrations)
#   bash scripts/deploy-staging.sh rollback [--with-db-rollback] [release-timestamp]
#                                               # rollback vers la release précédente
#       --with-db-rollback : restaure aussi la base Postgres depuis le backup de la release
#
# Cible : /opt/sokar-staging/ sur le VPS pmbtc.
# Ports  : API=4100, Dashboard=3100, Connect=4102 (décalés vs prod 4000/3000/4002).
# Domaine: staging.sokar.tech (+ api-staging.sokar.tech pour l'API directe).
#
# Isolement staging vs prod :
#   - DB Postgres séparée (sokar_staging)
#   - Redis DB index séparé (db=2)
#   - Clés Clerk staging (pk_test / sk_test)
#   - Telnyx / Deepgram / Cartesia désactivés (VOICE_DISABLED=true)
#   - Stripe en mode test (pk_test_*)
#   - PM2 services séparés (préfixe sokar-staging-*)
#   - Nginx vhost séparé (sokar-staging.conf)
#
# Zero-downtime : l'API reste en ligne pendant le build. Seuls dashboard et
# Connect sont arrêtés (Next.js standalone ne peut pas servir pendant next build).

set -Eeuo pipefail

BRANCH="main"
DRY_RUN=false
FORCE=false
SOKAR_ROOT="/opt/sokar-staging"
RELEASES_DIR="$SOKAR_ROOT/releases"
DATE=$(date '+%Y-%m-%d %H:%M:%S')
PRIVILEGED_WRAPPER="/usr/local/sbin/sokar-deploy-root"
WAIT_TIMEOUT=${WAIT_TIMEOUT:-60}
WITH_DB_ROLLBACK=false

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=ops/db-backup.sh
source "$SCRIPT_DIR/ops/logging.sh"
# shellcheck source=ops/db-backup.sh
source "$SCRIPT_DIR/ops/db-backup.sh"

ensure_privileged_wrapper() {
    if [ -x "$PRIVILEGED_WRAPPER" ]; then
        log info "🔄 Mise à jour du wrapper privilégié..."
        if sudo -n "$PRIVILEGED_WRAPPER" self-update staging >/dev/null 2>&1; then
            log_ok "Wrapper mis à jour."
        else
            log_warn "self-update indisponible ou échoué ; le wrapper existant sera utilisé."
        fi
    else
        log info "📦 Installation initiale du wrapper privilégié..."
        sudo install -o root -g root -m 0755 \
            "$SOKAR_ROOT/scripts/ops/sokar-deploy-root.sh" "$PRIVILEGED_WRAPPER"
    fi
}

# Vérifier que les .env staging existent et ne contiennent pas de placeholders
validate_env_files() {
    local required_files=(
        "apps/api/.env"
        "apps/dashboard/.env"
        "apps/connect/.env"
    )
    local errors=0
    log info ""
    log info "🔍 Validating env files..."

    for env_file in "${required_files[@]}"; do
        if [ ! -f "$env_file" ]; then
            log_error "Env file manquant : $env_file" >&2
            errors=$((errors + 1))
            continue
        fi
        chmod 0600 "$env_file"
    done

    if [ "$errors" -gt 0 ]; then
        log info "   Créez-les sur le VPS staging avec les valeurs de staging (voir .env.staging.example)." >&2
        exit 1
    fi

    # DATABASE_URL : pas de placeholder de mot de passe et doit pointer sur sokar_staging
    if grep -qE 'DATABASE_URL=.*:(CHANGE_ME_PASSWORD|password)@' apps/api/.env; then
        log_error "Le mot de passe de DATABASE_URL dans apps/api/.env est un placeholder." >&2
        log info "   Remplacez-le par une valeur forte avant de déployer." >&2
        exit 1
    fi

    if ! grep -qE 'DATABASE_URL=.*sokar_staging' apps/api/.env; then
        log_error "DATABASE_URL dans apps/api/.env doit pointer sur la base sokar_staging." >&2
        exit 1
    fi

    # REDIS_URL : staging utilise db=2
    if ! grep -qE 'REDIS_URL=.*:6379/2' apps/api/.env; then
        log_error "REDIS_URL dans apps/api/.env doit utiliser db=2 (REDIS_URL=...:6379/2)." >&2
        exit 1
    fi

    # Le Service Copilot signe les événements navigateur avec ce secret.
    # Valider avant d'arrêter les services évite une boucle PM2 au redémarrage.
    local copilot_secret
    copilot_secret=$(grep -E '^SERVICE_COPILOT_TELEMETRY_SECRET=' apps/api/.env \
        | tail -n 1 | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//" || true)
    if [ "${#copilot_secret}" -lt 32 ]; then
        log_error "SERVICE_COPILOT_TELEMETRY_SECRET doit contenir au moins 32 caractères." >&2
        exit 1
    fi

    # Recherche de placeholders restants (CHANGE_ME ou ...)
    local placeholders
    placeholders=$(grep -nE '=(.*CHANGE_ME|.*\.\.\.)' apps/api/.env apps/dashboard/.env apps/connect/.env 2>/dev/null || true)
    if [ -n "$placeholders" ]; then
        log_error "Des valeurs placeholder sont présentes dans les fichiers .env :" >&2
        log_warn "$placeholders" | sed 's/^/   /'
        exit 1
    fi

    log info "   ✅ Env files validés."
}

# Attendre que les services staging soient up (health + livez), timeout configurable
wait_for_services() {
    local timeout=${1:-$WAIT_TIMEOUT}
    local WAIT_START WAIT_NOW API_HEALTH API_LIVEZ DASH_READY CONNECT_READY
    log info ""
    log info "⏳ Waiting for staging services to be ready (timeout ${timeout}s)..."
    WAIT_START=$(date +%s)
    while true; do
        API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/health 2>/dev/null || echo "000")
        API_LIVEZ=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/livez 2>/dev/null || echo "000")
        DASH_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100 2>/dev/null || echo "000")
        CONNECT_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/restaurant/chez-sokar-demo 2>/dev/null || echo "000")
        if [ "$API_HEALTH" = "200" ] && [ "$API_LIVEZ" = "200" ] && [ "$DASH_READY" = "200" ] && [ "$CONNECT_READY" = "200" ]; then
            log info "   API (health + livez) + Dashboard + Connect ready"
            break
        fi
        WAIT_NOW=$(date +%s)
        if [ $((WAIT_NOW - WAIT_START)) -ge "$timeout" ]; then
            log_warn "Timeout (health=$API_HEALTH livez=$API_LIVEZ dash=$DASH_READY connect=$CONNECT_READY)"
            break
        fi
        sleep 2
    done
}

# Artefacts à snapshoter (chemins relatifs à SOKAR_ROOT)
ARTIFACT_PATHS=(
    "apps/api/dist"
    "apps/dashboard/.next"
    "apps/dashboard/public"
    "apps/connect/.next"
    "apps/connect/public"
)

# ── Parse args ───────────────────────────────────────────
while [ "${1:-}" = "--dry-run" ] || [ "${1:-}" = "--force" ]; do
    if [ "$1" = "--dry-run" ]; then
        DRY_RUN=true
    fi
    if [ "$1" = "--force" ]; then
        FORCE=true
    fi
    shift
done
if [ "${1:-}" = "rollback" ]; then
    # Rollback vers la release précédente
    cd "$SOKAR_ROOT"
    log_section "Staging Rollback"
    shift
    while [ "${1:-}" = "--with-db-rollback" ]; do
        WITH_DB_ROLLBACK=true
        shift
    done
    TARGET_RELEASE=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | sed -n '2p')
    if [ -n "${1:-}" ]; then
        TARGET_RELEASE="$1"
    fi
    if [ -z "$TARGET_RELEASE" ]; then
        log_error "Aucune release précédente trouvée dans $RELEASES_DIR"
        exit 1
    fi
    log info "→ Rollback vers : $TARGET_RELEASE"
    pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
    RELEASE_PATH="$RELEASES_DIR/$TARGET_RELEASE"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$RELEASE_PATH/$p" ]; then
            rm -rf "$SOKAR_ROOT/$p"
            install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
            cp -a "$RELEASE_PATH/$p" "$SOKAR_ROOT/$(dirname "$p")/"
        fi
    done
    if [ "$WITH_DB_ROLLBACK" = true ]; then
        log info "→ Restore DB..."
        restore_db "$RELEASE_PATH"
    fi
    pm2 start infra/ecosystem.staging.config.js
    wait_for_services
    pm2 save
    sudo /usr/local/sbin/sokar-deploy-root reload-nginx staging 2>/dev/null || true
    log_ok "Rollback staging vers $TARGET_RELEASE terminé"
    exit 0
fi

log_section "Sokar Staging Deploy $DATE"
log info "Root: $SOKAR_ROOT"
log info "Branch: $BRANCH"
[ "$DRY_RUN" = true ] && log warn "Mode: DRY-RUN (pas de restart ni migrations)"

# Vérifier qu'on est sur le VPS
if [ "$(hostname)" != "pmbtc" ]; then
    log_error "Ce script s'exécute uniquement sur le VPS (pmbtc)"
    exit 1
fi

cd "$SOKAR_ROOT"
ensure_privileged_wrapper

# Check Node version (DEP-015).
log info "🔍 Checking Node version..."
if ! pnpm node:check; then
    log_error "Node version check failed. Use Node >=20 <23 (see .nvmrc)." >&2
    exit 1
fi

# ── 0. Swap check ───────────────────────────────────────
if ! swapon --show | grep -q swapfile 2>/dev/null; then
    log_error "Aucun swap détecté. Les builds Next.js seront tués par OOM."
    log info "   Lance d'abord (en root) : sudo bash scripts/ops/setup-swap.sh"
    exit 1
fi

if [ "$FORCE" = true ]; then
    log_warn "--force : reset des modifications locales trackées..."
    git checkout -- .
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    log_error "Fichiers suivis modifiés sur le VPS staging. Refus de les stasher automatiquement."
    log info "   Relancez avec --force pour ignorer."
    git status --short
    exit 1
fi

# ── 0b. Snapshot avant build (pour rollback) ────────────
if [ "$DRY_RUN" = false ]; then
    PREV_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')-pre"
    PREV_RELEASE="$RELEASES_DIR/$PREV_TIMESTAMP"
    install -d -m 0755 "$RELEASES_DIR"
    log info ""
    log info "📦 Snapshot pré-build (rollback safety net)..."
    install -d -m 0755 "$PREV_RELEASE"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$SOKAR_ROOT/$p" ]; then
            install -d -m 0755 "$PREV_RELEASE/$(dirname "$p")"
            cp -a "$SOKAR_ROOT/$p" "$PREV_RELEASE/$(dirname "$p")/"
        fi
    done
    backup_db "$PREV_RELEASE" || true
    RESTORE_ON_FAIL="$PREV_RELEASE"
fi

recover_services() {
    local exit_code=${1:-$?}
    trap - ERR
    log info ""
    log_error "Déploiement staging interrompu (code ${exit_code})."
    if [ -n "${RESTORE_ON_FAIL:-}" ] && [ -d "${RESTORE_ON_FAIL}" ]; then
        log info "   → Restore artefacts pré-build..."
        pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
        for p in "${ARTIFACT_PATHS[@]}"; do
            if [ -e "${RESTORE_ON_FAIL}/$p" ]; then
                rm -rf "$SOKAR_ROOT/$p"
                install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
                cp -a "${RESTORE_ON_FAIL}/$p" "$SOKAR_ROOT/$(dirname "$p")/"
            fi
        done
    fi
    log info "   → Remise en ligne des services staging..."
    pm2 restart sokar-staging-api sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true
    rm -rf "${RESTORE_ON_FAIL}" 2>/dev/null || true
    log_error "Services staging restaurés à l'état pré-build."
    notify "🔴 Sokar staging deploy failed (branch ${BRANCH}, exit ${exit_code})"
    exit "$exit_code"
}
if [ "$DRY_RUN" = false ]; then
    trap recover_services ERR
fi

# ── 1. Pull code ────────────────────────────────────────
log info ""
log info "📦 Pulling latest code from $BRANCH..."
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_HASH=$(git rev-parse HEAD)
log info "   HEAD → $NEW_HASH"

# ── 2b. Detect which apps changed ───────────────────────
# Compare le hash actuel avec le hash du dernier déploiement staging réussi.
# Si un app n'a pas changé, on skip son build.
LAST_DEPLOYED_HASH=$(cat "$RELEASES_DIR/.latest-hash" 2>/dev/null || echo "")

NEED_DASHBOARD=false
NEED_CONNECT=false
NEED_API=false
NEED_PACKAGES=false
NEED_INSTALL=false
NEED_PRISMA=false
SKIP_ALL_BUILDS=false

if [ -z "$LAST_DEPLOYED_HASH" ]; then
    # Premier déploiement → build tout
    NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
    NEED_INSTALL=true; NEED_PRISMA=true
    log info "   📎 Build complet (premier déploiement)"
elif [ "$LAST_DEPLOYED_HASH" = "$NEW_HASH" ]; then
    # Même hash → rien à builder
    SKIP_ALL_BUILDS=true
    log info "   ⏭️  Hash inchangé ($NEW_HASH) — skip tous les builds"
else
    CHANGED_FILES=$(git diff --name-only "$LAST_DEPLOYED_HASH" "$NEW_HASH" 2>/dev/null || echo "")
    if [ -z "$CHANGED_FILES" ]; then
        NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
        NEED_INSTALL=true; NEED_PRISMA=true
        log info "   📎 Build complet (diff indisponible)"
    else
        # Par défaut, ne pas rebuild API/packages si seuls dashboard/connect ont changé
        echo "$CHANGED_FILES" | grep -qE '^apps/dashboard/' && NEED_DASHBOARD=true
        echo "$CHANGED_FILES" | grep -qE '^apps/connect/' && NEED_CONNECT=true
        echo "$CHANGED_FILES" | grep -qE '^apps/api/' && NEED_API=true
        # Prisma schema/migrations changent → generate + migrate
        if echo "$CHANGED_FILES" | grep -qE '^packages/database/prisma/'; then
            NEED_PRISMA=true
        fi

        # Packages non-test changent → rebuild packages et dépendants
        NON_TEST_PKG_FILES=$(echo "$CHANGED_FILES" | grep -E '^packages/' | grep -vE '/__tests__/' | grep -vE '\.test\.(ts|tsx|js|jsx)$' || true)
        if [ -n "$NON_TEST_PKG_FILES" ]; then
            NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
        fi

        # turbo.json change → rebuild tout (pipeline/build config changed)
        if echo "$CHANGED_FILES" | grep -qE '^turbo\.json'; then
            NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
        fi
        # pnpm-lock.yaml ou package.json racine → reinstall
        echo "$CHANGED_FILES" | grep -qE '^pnpm-lock\.yaml|^package\.json' && NEED_INSTALL=true

        # Fallback : si un artefact manque, on rebuild l'app
        [ ! -f "apps/api/dist/main.js" ] && NEED_API=true
        [ ! -f "apps/dashboard/.next/standalone/apps/dashboard/server.js" ] && NEED_DASHBOARD=true
        [ ! -f "apps/connect/.next/standalone/apps/connect/server.js" ] && NEED_CONNECT=true

        log info "   📎 Apps à builder :$([ "$NEED_DASHBOARD" = true ] && echo ' dashboard')$([ "$NEED_CONNECT" = true ] && echo ' connect')$([ "$NEED_API" = true ] && echo ' api')"
        if [ "$NEED_DASHBOARD" = false ] && [ "$NEED_CONNECT" = false ] && [ "$NEED_API" = false ] && [ "$NEED_PACKAGES" = false ]; then
            SKIP_ALL_BUILDS=true
            log info "   ⏭️  Aucun app modifié — skip build"
        fi
    fi
fi

# ── 3. Install deps ─────────────────────────────────────
if [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip pnpm install (aucun changement de code)"
elif [ "$NEED_INSTALL" = true ]; then
    log info ""
    log info "📦 Installing dependencies..."
    pnpm install --frozen-lockfile
else
    log info ""
    log info "⏭️  Skip pnpm install (lockfile inchangé)"
fi

validate_env_files

# Libérer la mémoire seulement après le préflight : une configuration invalide
# ne doit jamais interrompre Dashboard ou Connect.
log info ""
log info "📦 Freeing memory before build..."
log info "   Stopping staging dashboard + connect (API stays up)..."
pm2 stop sokar-staging-dashboard sokar-staging-connect 2>/dev/null || true

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
log info "   Memory free: ${FREE_BEFORE}MB"

# ── 4. Generate Prisma ──────────────────────────────────
if [ "$SKIP_ALL_BUILDS" = true ] || [ "$NEED_PRISMA" = false ]; then
    log info ""
    log info "⏭️  Skip Prisma generate (schema inchangé)"
else
    log info ""
    log info "📦 Generating Prisma client..."
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate
fi

# ── 5. Build ─────────────────────────────────────────────
if [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip tous les builds (hash inchangé)"
else
    log info ""
    log info "📦 Building..."

    # Phase 1 : packages + API
    if [ "$NEED_PACKAGES" = true ] || [ "$NEED_API" = true ]; then
        # Toujours builder les packages si API ou packages nécessaires
        # (l'API dépend de @sokar/config, @sokar/database, @sokar/shared)
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/config build
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database build
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/shared build
        [ "$NEED_API" = true ] && NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api build
    fi

    # Phase 2 : dashboard + connect en parallèle
    if [ "$NEED_DASHBOARD" = true ] || [ "$NEED_CONNECT" = true ]; then
        log info "   → Lancement dashboard + connect en parallèle..."
        if [ "$NEED_DASHBOARD" = true ]; then
            NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 \
                pnpm --filter @sokar/dashboard build &
            DASH_PID=$!
        fi
        if [ "$NEED_CONNECT" = true ]; then
            NODE_OPTIONS="--max-old-space-size=1024" NEXT_TELEMETRY_DISABLED=1 \
                pnpm --filter @sokar/connect build &
            CONNECT_PID=$!
        fi
        DASH_EXIT=0
        CONNECT_EXIT=0
        if [ -n "${DASH_PID:-}" ]; then
            wait "$DASH_PID" || DASH_EXIT=$?
        fi
        if [ -n "${CONNECT_PID:-}" ]; then
            wait "$CONNECT_PID" || CONNECT_EXIT=$?
        fi
        if [ -n "${DASH_PID:-}" ] && [ "$DASH_EXIT" -ne 0 ]; then
            log_error "Dashboard build échoué (exit $DASH_EXIT)"
            [ -n "${CONNECT_PID:-}" ] && kill "$CONNECT_PID" 2>/dev/null || true
            exit 1
        fi
        if [ -n "${CONNECT_PID:-}" ] && [ "$CONNECT_EXIT" -ne 0 ]; then
            log_error "Connect build échoué (exit $CONNECT_EXIT)"
            exit 1
        fi
    fi
fi

# ── 6. Copy static assets ────────────────────────────────
if [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip copy-static (aucun rebuild)"
else
    log info ""
    log info "📦 Copying static assets to standalone..."
    [ "$NEED_DASHBOARD" = true ] && bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"
    [ "$NEED_CONNECT" = true ] && bash "$SOKAR_ROOT/apps/connect/scripts/copy-static.sh"
fi

# ── 7. DB migrations (skip en dry-run) ───────────────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip DB migrations (dry-run)"
elif [ "$SKIP_ALL_BUILDS" = true ] || [ "$NEED_PRISMA" = false ]; then
    log info ""
    log info "⏭️  Skip DB migrations (schema inchangé)"
else
    log info ""
    log info "📦 Applying database migrations (staging DB)..."
    export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//")
    pnpm exec prisma migrate deploy --schema=packages/database/prisma/schema.prisma
    unset DATABASE_URL
fi

# ── 8. Nginx routing (skip en dry-run) ───────────────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip Nginx install (dry-run)"
else
    log info ""
    log info "📦 Installing Nginx staging routing..."
    sudo /usr/local/sbin/sokar-deploy-root install-nginx staging
fi

# ── 9. Restart services (skip en dry-run) ────────────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip PM2 restart (dry-run)"
    log info ""
    log_ok "Dry-run terminé — build OK, aucun changement appliqué"
    exit 0
fi

log info ""
log info "📦 Restarting staging services..."
pm2 start infra/ecosystem.staging.config.js
pm2 save
sudo /usr/local/sbin/sokar-deploy-root reload-nginx staging

# ── 10. Verify ───────────────────────────────────────────
log info ""
log info "📦 Verifying staging..."
pm2 status
wait_for_services

log info ""
log_section "Checking staging HTTP endpoints"
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/health 2>/dev/null || echo "FAIL")
LIVEZ_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/livez 2>/dev/null || echo "FAIL")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100 2>/dev/null || echo "FAIL")
CONNECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4102/restaurant/chez-sokar-demo 2>/dev/null || echo "FAIL")
log info "   api (/health)      → $API_STATUS"
log info "   api (/livez)       → $LIVEZ_STATUS"
log info "   dashboard (/)      → $DASH_STATUS"
log info "   connect (/restaurant/chez-sokar-demo) → $CONNECT_STATUS"

# Vérifier via Nginx (Host header)
STAGING_API_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
    http://127.0.0.1/health 2>/dev/null || echo "FAIL")
STAGING_DASH_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
    http://127.0.0.1/ 2>/dev/null || echo "FAIL")
log info "   staging.sokar.tech/health via Nginx → $STAGING_API_VHOST"
log info "   staging.sokar.tech/ via Nginx       → $STAGING_DASH_VHOST"

# Un échec de health check n'émet pas ERR lorsqu'il se termine par `exit 1`.
# Appeler explicitement la récupération avant de créer/supprimer les snapshots.
if [ "$API_STATUS" != "200" ] \
    || [ "$LIVEZ_STATUS" != "200" ] \
    || [ "$DASH_STATUS" != "200" ] \
    || [ "$CONNECT_STATUS" != "200" ]; then
    log info ""
    log_error "Staging deploy finished but checks failed"
    log info "   API=$API_STATUS Livez=$LIVEZ_STATUS Dash=$DASH_STATUS Connect=$CONNECT_STATUS"
    recover_services 1
fi

# ── 11. Snapshot post-build réussi ───────────────────────
NEW_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
NEW_RELEASE="$RELEASES_DIR/$NEW_TIMESTAMP"
log info ""
log info "📦 Snapshot post-build (release $NEW_TIMESTAMP)..."
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
log info ""
log_ok "Staging deploy complete — API + Dashboard + Connect OK"
log info "   URLs : https://staging.sokar.tech (dashboard)"
log info "          https://api-staging.sokar.tech (API)"
log info "   Rollback : bash scripts/deploy-staging.sh rollback"
notify "✅ Sokar staging deploy OK (branch ${BRANCH}, hash $(git rev-parse --short HEAD))"
# Sauvegarder le hash pour le prochain déploiement incrémental
git rev-parse HEAD > "$RELEASES_DIR/.latest-hash"
trap - ERR
