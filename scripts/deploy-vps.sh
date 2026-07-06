#!/bin/bash
# Deploy script pour VPS Sokar
# Usage: bash scripts/deploy-vps.sh [branch]
#        bash scripts/deploy-vps.sh rollback [release-timestamp]
# Gère la mémoire limitée, les trois apps PM2 et le routage Nginx.
#
# Zero-downtime: l'API reste en ligne pendant le build. Seuls dashboard et
# Sokar Connect sont arrêtés (Next.js standalone ne peut pas servir pendant que
# `next build` écrase .next). Le redémarrage final prend ~5s.
#
# Release dirs: snapshot des artefacts avant/après build dans
# /opt/sokar/releases/. Rollback instantané si build échoue ou sur commande.

set -Eeuo pipefail
BRANCH="${1:-main}"
SOKAR_ROOT="/opt/sokar"
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

# ── Helpers release dirs ─────────────────────────────────
# snapshot_artifacts <target> <label> [paths...]
# Si paths est omis, utilise ARTIFACT_PATHS (tous les apps).
# Si paths est fourni (ex. "apps/dashboard/.next apps/dashboard/public"),
# ne snapshot que ces apps — utile pour le snapshot pré-build quand
# seul un app a été rebuild.
snapshot_artifacts() {
    local target="$1"
    local label="${2:-snapshot}"
    shift 2
    local paths=("$@")
    if [ ${#paths[@]} -eq 0 ]; then
        paths=("${ARTIFACT_PATHS[@]}")
    fi
    echo "   → Snapshot artefacts vers $target ($label)"
    install -d -m 0755 "$target"
    for p in "${paths[@]}"; do
        if [ -e "$SOKAR_ROOT/$p" ]; then
            install -d -m 0755 "$target/$(dirname "$p")"
            cp -a "$SOKAR_ROOT/$p" "$target/$(dirname "$p")/"
        fi
    done
    # Metadata
    {
        echo "timestamp=$(basename "$target")"
        echo "label=$label"
        echo "date=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "git_hash=$(cd "$SOKAR_ROOT" && git rev-parse HEAD 2>/dev/null || echo 'unknown')"
        echo "git_branch=$(cd "$SOKAR_ROOT" && git branch --show-current 2>/dev/null || echo 'unknown')"
    } > "$target/META"
}

restore_artifacts() {
    local source="$1"
    if [ ! -d "$source" ]; then
        echo "   ❌ Release $source introuvable" >&2
        return 1
    fi
    echo "   → Restore artefacts depuis $source"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$source/$p" ]; then
            rm -rf "$SOKAR_ROOT/$p"
            install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
            cp -a "$source/$p" "$SOKAR_ROOT/$(dirname "$p")/"
        fi
    done
}

cleanup_releases() {
    local keep="${1:-5}"
    local count
    count=$(ls -1 "$RELEASES_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort -r | wc -l)
    if [ "$count" -le "$keep" ]; then
        return
    fi
    echo "   → Nettoyage releases (garde $keep sur $count)"
    ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | tail -n +"$((keep + 1))" \
        | while read -r old; do
            rm -rf "$RELEASES_DIR/$old"
            echo "     supprimé: $old"
        done
}

list_releases() {
    echo "Releases disponibles (plus récent en premier) :"
    ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | while read -r ts; do
            local meta="$RELEASES_DIR/$ts/META"
            local hash="" branch=""
            if [ -f "$meta" ]; then
                hash=$(grep '^git_hash=' "$meta" | cut -d= -f2- | cut -c1-8)
                branch=$(grep '^git_branch=' "$meta" | cut -d= -f2-)
            fi
            printf "   %s  %s  %s\n" "$ts" "${hash:-????????}" "${branch:-?}"
        done
}

# ── Commande rollback ────────────────────────────────────
if [ "${1:-}" = "rollback" ]; then
    cd "$SOKAR_ROOT"
    TARGET_RELEASE="${2:-}"
    if [ -z "$TARGET_RELEASE" ]; then
        # Pas de release spécifiée → prendre l'avant-dernière
        # (la dernière est potentiellement celle qui vient de casser)
        echo "=== Rollback Sokar — recherche de la release précédente ==="
        list_releases
        echo ""
        TARGET_RELEASE=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
            | grep -E '^[0-9]{8}T[0-9]{6}Z' \
            | sort -r \
            | sed -n '2p')
        if [ -z "$TARGET_RELEASE" ]; then
            echo "❌ Aucune release précédente trouvée dans $RELEASES_DIR"
            exit 1
        fi
        echo "→ Rollback vers : $TARGET_RELEASE"
    fi

    RELEASE_PATH="$RELEASES_DIR/$TARGET_RELEASE"
    if [ ! -d "$RELEASE_PATH" ]; then
        echo "❌ Release $TARGET_RELEASE introuvable"
        list_releases
        exit 1
    fi

    echo "→ Stop services..."
    pm2 stop sokar-dashboard sokar-connect 2>/dev/null || true

    echo "→ Restore artefacts..."
    restore_artifacts "$RELEASE_PATH"

    echo "→ Restart services..."
    pm2 start infra/ecosystem.config.js --update-env
    sleep 8
    pm2 save
    sudo systemctl reload nginx 2>/dev/null || true

    echo ""
    echo "→ Vérification..."
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health 2>/dev/null || echo "FAIL")
    DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null || echo "FAIL")
    echo "   api → $API_STATUS | dashboard → $DASH_STATUS"

    if [ "$API_STATUS" = "200" ] && [ "$DASH_STATUS" = "200" ]; then
        echo ""
        echo "✅ Rollback vers $TARGET_RELEASE terminé"
        echo "   Meta: $(cat "$RELEASE_PATH/META" 2>/dev/null | tr '\n' ' ')"
    else
        echo ""
        echo "🔴 Rollback terminé mais vérifications échouées — investiguer manuellement"
        exit 1
    fi
    exit 0
fi

echo "=== Sokar Deploy $DATE ==="
echo "Branch: $BRANCH"

# Vérifier qu'on est sur le VPS
if [ "$(hostname)" != "pmbtc" ]; then
    echo "❌ Ce script s'exécute uniquement sur le VPS (pmbtc)"
    exit 1
fi

cd "$SOKAR_ROOT"

# ── 0. Swap check ───────────────────────────────────────
# Le VPS a 4GB RAM ; sans swap les builds Next.js sont tués par OOM (exit 137).
if ! swapon --show | grep -q swapfile 2>/dev/null; then
    echo "❌ Aucun swap détecté. Les builds Next.js seront tués par OOM."
    echo "   Lance d'abord (en root) : sudo bash scripts/ops/setup-swap.sh"
    exit 1
fi

if ! sudo test -f /etc/letsencrypt/live/sokar.tech/fullchain.pem \
    || ! sudo test -f /etc/letsencrypt/live/sokar.tech/privkey.pem; then
    echo "❌ Certificat origine absent. Lance d'abord :"
    echo "   sudo bash scripts/ops/setup-origin-tls.sh"
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

# ── 0b. Snapshot avant build (pour rollback) ────────────
PREV_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')-pre"
PREV_RELEASE="$RELEASES_DIR/$PREV_TIMESTAMP"
install -d -m 0755 "$RELEASES_DIR"
echo ""
echo "📦 Snapshot pré-build (rollback safety net)..."
snapshot_artifacts "$PREV_RELEASE" "pre-build"

# Variable globale pour le trap ERR
RESTORE_ON_FAIL="$PREV_RELEASE"

recover_services() {
    local exit_code=$?
    trap - ERR
    echo ""
    echo "🔴 Déploiement interrompu (code ${exit_code})."

    # Restore les artefacts d'avant le build si un snapshot existe
    if [ -n "${RESTORE_ON_FAIL:-}" ] && [ -d "${RESTORE_ON_FAIL}" ]; then
        echo "   → Restore artefacts pré-build (${RESTORE_ON_FAIL##*/})..."
        pm2 stop sokar-dashboard sokar-connect 2>/dev/null || true
        restore_artifacts "${RESTORE_ON_FAIL}"
    fi

    echo "   → Remise en ligne des services..."
    pm2 restart sokar-api sokar-dashboard sokar-connect 2>/dev/null \
        || pm2 resurrect 2>/dev/null \
        || true
    # Rollback Nginx si un backup existe
    if [ -f /etc/nginx/sites-available/sokar.bak ]; then
        echo "   Rollback Nginx vers la configuration précédente..."
        sudo install -m 0644 /etc/nginx/sites-available/sokar.bak /etc/nginx/sites-available/sokar
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx || true
    fi
    docker start infra-localstack-1 2>/dev/null || true

    # Nettoyer le snapshot pré-build (il n'a pas servi)
    rm -rf "${RESTORE_ON_FAIL}" 2>/dev/null || true

    echo ""
    echo "🔴 Services restaurés à l'état pré-build. Le déploiement a échoué."
    exit "$exit_code"
}
trap recover_services ERR

# ── 1. Free memory (keep API running) ──────────────────
echo ""
echo "📦 Freeing memory before build..."

# Stop ONLY Next.js apps — API stays up (it doesn't use .next).
echo "   Stopping dashboard + Sokar Connect (API stays up)..."
pm2 stop sokar-dashboard sokar-connect 2>/dev/null || true

# Stop LocalStack (libère ~420MB)
echo "   Stopping LocalStack..."
docker stop infra-localstack-1 2>/dev/null || true

# PM2 tourne désormais comme deploy → plus de caches root-owned.
# ── Cache webpack persistant ──────────────────────────────────
# On NE détruit PAS .next/cache/ : c'est le cache webpack qui permet
# les incremental builds (3 min → ~1 min sur le compile). On ne supprime
# que les artefacts de build (standalone, server, static, BUILD_ID).
# Les caches root-owned (legacy PM2 root) sont nettoyés avec sudo.
clean_next_artifacts() {
    local app_dir="$1"
    for sub in standalone server static types; do
        sudo rm -rf "$app_dir/.next/$sub" 2>/dev/null || true
    done
    sudo rm -f "$app_dir/.next/BUILD_ID" 2>/dev/null || true
    sudo rm -rf "$app_dir/.next/eslint*" 2>/dev/null || true
    # Les .nft.json à la racine de .next (traces standalone)
    sudo find "$app_dir/.next" -maxdepth 1 -name '*.nft.json' -delete 2>/dev/null || true
    # Les traces dans .next/server (si elles existent encore)
    sudo find "$app_dir/.next/server" -name '*.nft.json' -delete 2>/dev/null || true
}
clean_next_artifacts "$SOKAR_ROOT/apps/dashboard"
clean_next_artifacts "$SOKAR_ROOT/apps/connect"

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
echo "   Memory free: ${FREE_BEFORE}MB"

# ── 2. Pull code ────────────────────────────────────────
echo ""
echo "📦 Pulling latest code..."
PREV_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_HASH=$(git rev-parse HEAD)

# ── 2b. Detect which apps changed ───────────────────────
# Compare le hash actuel avec le hash du dernier déploiement réussi.
# Si un app n'a pas changé, on skip son build (gain ~5 min sur le dashboard).
LAST_DEPLOYED_HASH=$(cat "$RELEASES_DIR/.latest-hash" 2>/dev/null || echo "")

NEED_DASHBOARD=false
NEED_CONNECT=false
NEED_API=false
NEED_PACKAGES=false

if [ -z "$LAST_DEPLOYED_HASH" ] || [ "$LAST_DEPLOYED_HASH" = "$NEW_HASH" ]; then
    # Premier déploiement ou aucun changement → build tout
    NEED_DASHBOARD=true
    NEED_CONNECT=true
    NEED_API=true
    NEED_PACKAGES=true
    echo "   📎 Build complet (premier déploiement ou hash inchangé)"
else
    CHANGED_FILES=$(git diff --name-only "$LAST_DEPLOYED_HASH" "$NEW_HASH" 2>/dev/null || echo "")
    if [ -z "$CHANGED_FILES" ]; then
        NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
    else
        echo "$CHANGED_FILES" | grep -qE '^apps/dashboard/' && NEED_DASHBOARD=true
        echo "$CHANGED_FILES" | grep -qE '^apps/connect/' && NEED_CONNECT=true
        echo "$CHANGED_FILES" | grep -qE '^apps/api/' && NEED_API=true
        # packages/ ou turbo.json ou next.config → rebuild tout
        echo "$CHANGED_FILES" | grep -qE '^packages/|^turbo\.json|^pnpm-lock\.yaml' && {
            NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
        }
        # Si aucun app modifié mais infra/ ou scripts/ → pas de build
        echo "   📎 Apps à builder :$([ "$NEED_DASHBOARD" = true ] && echo ' dashboard')$([ "$NEED_CONNECT" = true ] && echo ' connect')$([ "$NEED_API" = true ] && echo ' api')"
        if [ "$NEED_DASHBOARD" = false ] && [ "$NEED_CONNECT" = false ] && [ "$NEED_API" = false ]; then
            echo "   ⏭️  Aucun app modifié — skip build"
        fi
    fi
fi

# ── 3. Install deps ─────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Env files critiques — fail fast si absent (silence = app démarre sans config)
REQUIRED_ENV_FILES=(
    "apps/api/.env"
    "apps/dashboard/.env"
    "apps/connect/.env"
)
OPTIONAL_ENV_FILES=(
    "infra/.env"
)

for env_file in "${REQUIRED_ENV_FILES[@]}"; do
    if [ ! -f "$env_file" ]; then
        echo "❌ Env file manquant : $env_file — l'app correspondante démarrera sans config."
        echo "   Créez-le sur le VPS avec les valeurs de prod (voir apps/api/.env.example du repo)."
        FAIL_MISSING_ENV=1
    else
        chmod 0600 "$env_file"
    fi
done
for env_file in "${OPTIONAL_ENV_FILES[@]}"; do
    [ -f "$env_file" ] && chmod 0600 "$env_file"
done
if [ "${FAIL_MISSING_ENV:-0}" = "1" ]; then
    exit 1
fi

# ── 4. Generate Prisma ──────────────────────────────────
echo ""
echo "📦 Generating Prisma client..."
NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate

# ── 5. Build (incrémental) ──────────────────────────────
echo ""
echo "📦 Building..."

# Phase 1 : packages + API (séquentiel — dépendances)
if [ "$NEED_PACKAGES" = true ] || [ "$NEED_API" = true ]; then
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/config build
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database build
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/shared build
fi
if [ "$NEED_API" = true ]; then
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api build
fi

# Phase 2 : dashboard + connect en parallèle (si les deux sont nécessaires).
# Sur 2 CPUs le gain est modeste mais le connect (15 s compile) chevauche le dashboard.
BUILD_DASHBOARD_CMD=""
BUILD_CONNECT_CMD=""
if [ "$NEED_DASHBOARD" = true ]; then
    BUILD_DASHBOARD_CMD="NODE_OPTIONS='--max-old-space-size=2048' NEXT_TELEMETRY_DISABLED=1 SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 pnpm --filter @sokar/dashboard build"
fi
if [ "$NEED_CONNECT" = true ]; then
    BUILD_CONNECT_CMD="NODE_OPTIONS='--max-old-space-size=1024' NEXT_TELEMETRY_DISABLED=1 pnpm --filter @sokar/connect build"
fi

if [ -n "$BUILD_DASHBOARD_CMD" ] && [ -n "$BUILD_CONNECT_CMD" ]; then
    echo "   → Lancement dashboard + connect en parallèle..."
    eval "$BUILD_DASHBOARD_CMD" &
    DASH_PID=$!
    eval "$BUILD_CONNECT_CMD" &
    CONNECT_PID=$!
    # Attendre les deux. Si l'un échoue, on kill l'autre et on fail.
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
elif [ -n "$BUILD_DASHBOARD_CMD" ]; then
    echo "   → Dashboard build seul..."
    eval "$BUILD_DASHBOARD_CMD"
elif [ -n "$BUILD_CONNECT_CMD" ]; then
    echo "   → Connect build seul..."
    eval "$BUILD_CONNECT_CMD"
else
    echo "   ⏭️  Aucun build Next.js nécessaire"
fi

# ── 6. Copy static assets to standalone ─────────────────
echo ""
echo "📦 Copying static assets to standalone..."
if [ "$NEED_DASHBOARD" = true ]; then
    bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"
else
    echo "   ⏭️  Dashboard non rebuild — static déjà en place"
fi
if [ "$NEED_CONNECT" = true ]; then
    bash "$SOKAR_ROOT/apps/connect/scripts/copy-static.sh"
else
    echo "   ⏭️  Connect non rebuild — static déjà en place"
fi

# ── 7. DB backup + migrations ───────────────────────────
echo ""
echo "📦 Backing up database..."
sudo install -d -m 0700 -o deploy -g deploy /var/backups/sokar
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
# Cache dirs for origin caching (sokar.tech vhost — spec §D2)
sudo install -d -m 0755 -o www-data -g www-data /var/cache/nginx/connect

# Backup current config before overwriting (pour rollback automatique).
if [ -f /etc/nginx/sites-available/sokar ]; then
    sudo install -m 0644 /etc/nginx/sites-available/sokar /etc/nginx/sites-available/sokar.bak
fi

sudo install -m 0644 infra/nginx/snippets/sokar-proxy.conf \
    /etc/nginx/snippets/sokar-proxy.conf
sudo install -m 0644 infra/nginx/snippets/sokar-cloudflare-real-ip.conf \
    /etc/nginx/snippets/sokar-cloudflare-real-ip.conf
sudo install -m 0644 infra/nginx/sokar.conf /etc/nginx/sites-available/sokar
sudo ln -sfn /etc/nginx/sites-available/sokar /etc/nginx/sites-enabled/sokar

if ! sudo nginx -t 2>&1; then
    echo "❌ nginx -t échoué. Rollback de la configuration précédente."
    if [ -f /etc/nginx/sites-available/sokar.bak ]; then
        sudo install -m 0644 /etc/nginx/sites-available/sokar.bak /etc/nginx/sites-available/sokar
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx || true
    fi
    exit 1
fi

# Un seul virtual host doit posséder api.sokar.tech. Un doublon peut envoyer
# les requêtes vers une ancienne configuration dashboard.
API_VHOST_COUNT=$(sudo nginx -T 2>/dev/null \
    | grep -Ec 'server_name[[:space:]]+api\.sokar\.tech' || true)
if [ "$API_VHOST_COUNT" -ne 1 ]; then
    echo "❌ ${API_VHOST_COUNT} virtual hosts déclarent api.sokar.tech (attendu: 1)."
    echo "   Supprime l'ancien fichier dans /etc/nginx/sites-enabled avant de relancer."
    exit 1
fi

# Nettoyer le backup après validation.
sudo find /etc/nginx/sites-available -name sokar.bak -delete 2>/dev/null || true

# ── 8b. Install logrotate ───────────────────────────────
echo ""
echo "📦 Installing logrotate..."
sudo install -m 0644 "$SOKAR_ROOT/infra/logrotate/sokar" /etc/logrotate.d/sokar

# ── 9. Restart services ─────────────────────────────────
echo ""
echo "📦 Restarting services..."
pm2 start infra/ecosystem.config.js --update-env
sleep 4
pm2 save
sudo systemctl reload nginx

# Restart LocalStack
echo ""
echo "📦 Restarting LocalStack..."
docker start infra-localstack-1 2>/dev/null || true

# ── 10. Verify ──────────────────────────────────────────
echo ""
echo "📦 Verifying..."
sleep 3
pm2 status

# Attendre que les services Fastify/Connect soient prêts (bind 127.0.0.1, démarrage >3s).
# Timeout total 30s, retry toutes les 2s.
echo ""
echo "⏳ Waiting for API and Connect to be ready..."
WAIT_START=$(date +%s)
while true; do
    API_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health 2>/dev/null || echo "000")
    CONNECT_READY=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4002/restaurant/chez-sokar-demo 2>/dev/null || echo "000")
    if [ "$API_READY" = "200" ] && [ "$CONNECT_READY" = "200" ]; then
        echo "   API + Connect ready"
        break
    fi
    WAIT_NOW=$(date +%s)
    if [ $((WAIT_NOW - WAIT_START)) -ge 30 ]; then
        echo "   ⚠️ Timeout waiting for API/Connect (API=$API_READY Connect=$CONNECT_READY)"
        break
    fi
    sleep 2
done

echo ""
echo "=== Checking HTTP endpoints ==="
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health 2>/dev/null || echo "FAIL")
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null || echo "FAIL")
CONNECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4002/restaurant/chez-sokar-demo 2>/dev/null || echo "FAIL")
API_VHOST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: api.sokar.tech" \
    http://127.0.0.1/health 2>/dev/null || echo "FAIL")
WIDGET_API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
    http://127.0.0.1/api/proxy/public/widget/chez-sokar-demo 2>/dev/null || echo "FAIL")
PUBLIC_PAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
    http://127.0.0.1/restaurant/chez-sokar-demo 2>/dev/null || echo "FAIL")
echo "   api (127.0.0.1:4000/health) → $API_STATUS"
echo "   dashboard (127.0.0.1:3000)  → $DASH_STATUS"
echo "   connect (127.0.0.1:4002/restaurant/chez-sokar-demo) → $CONNECT_STATUS"
echo "   api.sokar.tech/health via Nginx → $API_VHOST_STATUS"
echo "   widget slug API via Next proxy → $WIDGET_API_STATUS"
echo "   public Sokar Connect page via Nginx → $PUBLIC_PAGE_STATUS"

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

# Vérification de la page achat carte cadeau (P1.4) — route /widget/[slug]/gift-card.
GIFT_CARD_WIDGET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
    http://127.0.0.1/widget/chez-sokar-demo/gift-card 2>/dev/null || echo "FAIL")
echo "   gift-card widget page → $GIFT_CARD_WIDGET_STATUS"

# Vérification post-déploiement : un asset CSS/JS réel doit répondre 200.
# Bug historique : `curl -I /` répond 200 même si .next/static n'a pas été
# copié dans le standalone → page blanche côté client. On extrait le premier
# chunk JS du HTML rendu et on vérifie qu'il est servi.
DASH_CSS_STATUS="N/A"
FIRST_CHUNK=$(curl -s -H "Host: sokar.tech" http://127.0.0.1/ 2>/dev/null \
  | grep -oE '/_next/static/[^\"]+\.(js|css)' \
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

# Le dashboard est OK SEULELEMENT si l'HTML et un asset statique répondent 200.
# Si l'asset est 404, c'est le bug pitfall #29 (static non copiés dans standalone).
if [ "$API_STATUS" = "200" ] \
    && [ "$DASH_STATUS" = "200" ] \
    && [ "$CONNECT_STATUS" = "200" ] \
    && [ "$API_VHOST_STATUS" = "200" ] \
    && [ "$WIDGET_API_STATUS" = "200" ] \
    && [ "$PUBLIC_PAGE_STATUS" = "200" ] \
    && [ "$WIDGET_IFRAME_STATUS" = "OK" ] \
    && [ "$GIFT_CARD_WIDGET_STATUS" = "200" ] \
    && [ "$DASH_CSS_STATUS" = "200" ]; then
    echo ""
    echo "✅ Deploy complete — API + dashboard + Sokar Connect + routing OK"
    trap - ERR

    # ── 11. Snapshot post-build réussi + cleanup ─────────
    NEW_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
    NEW_RELEASE="$RELEASES_DIR/$NEW_TIMESTAMP"
    echo ""
    echo "📦 Snapshot post-build (release $NEW_TIMESTAMP)..."
    snapshot_artifacts "$NEW_RELEASE" "deploy-ok"
    echo "$NEW_TIMESTAMP" > "$RELEASES_DIR/.latest"
    # Sauvegarder le hash pour le prochain déploiement incrémental
    git rev-parse HEAD > "$RELEASES_DIR/.latest-hash"
    cleanup_releases 5

    # Le snapshot pré-build a servi de safety net et n'est plus needed
    rm -rf "$PREV_RELEASE" 2>/dev/null || true

    echo ""
    echo "📦 Releases disponibles pour rollback :"
    list_releases
    echo ""
    echo "   Pour rollback : bash scripts/deploy-vps.sh rollback"

elif [ "$DASH_STATUS" = "200" ] && [ "$DASH_CSS_STATUS" != "200" ]; then
    echo ""
    echo "🔴 Deploy REGRESSED : dashboard HTML répond 200 mais assets statiques 404."
    echo "   Cause probable : scripts/copy-static.sh non exécuté ou .next/static manquant."
    echo "   Fix manuel : cd /opt/sokar/apps/dashboard && bash scripts/copy-static.sh && pm2 restart sokar-dashboard"
    exit 1
else
    echo ""
    echo "🔴 Deploy finished but routing or application checks failed"
    exit 1
fi
