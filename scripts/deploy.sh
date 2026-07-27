#!/usr/bin/env bash
# Script de déploiement unifié Sokar (prod + staging).
#
# Usage:
#   bash scripts/deploy.sh --env prod --confirm-production [branch]
#   bash scripts/deploy.sh --env prod --confirm-production rollback [--with-db-rollback] [release-timestamp]
#   bash scripts/deploy.sh --env staging [branch]
#   bash scripts/deploy.sh --env staging --dry-run
#   bash scripts/deploy.sh --env staging --force
#   bash scripts/deploy.sh --env staging rollback [--with-db-rollback] [release-timestamp]
#   bash scripts/deploy.sh --help
#
# Ce script remplace scripts/deploy-vps.sh (prod) et scripts/deploy-staging.sh (staging).
# La logique commune est dans scripts/ops/deploy-common.sh.
#
# Zero-downtime: l'API reste en ligne pendant le build. Seuls dashboard et
# Sokar Connect sont arrêtés (Next.js standalone ne peut pas servir pendant que
# `next build` écrase .next). Le redémarrage final prend ~5s.
#
# Release dirs: snapshot des artefacts avant/après build dans
# $RELEASES_DIR/. Rollback instantané si build échoue ou sur commande.
#
# NOTE: Si ce script casse, les anciens scripts sont récupérables via:
#   git show <commit>:scripts/deploy-vps.sh > /tmp/deploy-vps.sh
#   git show <commit>:scripts/deploy-staging.sh > /tmp/deploy-staging.sh

set -Eeuo pipefail

# ── Variables par défaut ─────────────────────────────────
DEPLOY_ENV=""
CONFIRM_PRODUCTION=false
DRY_RUN=false
FORCE=false
BRANCH="main"
COMMAND="deploy"
WITH_DB_ROLLBACK=false
TARGET_RELEASE=""
PRIVILEGED_WRAPPER="/usr/local/sbin/sokar-deploy-root"
WAIT_TIMEOUT=${WAIT_TIMEOUT:-60}

# ── Aide ─────────────────────────────────────────────────
print_usage() {
    cat <<'EOF'
Usage: bash scripts/deploy.sh --env prod|staging [options] [command] [branch]

Environments:
  --env prod       Déploiement production (/opt/sokar)
  --env staging    Déploiement staging (/opt/sokar-staging)

Commands:
  deploy           Déploiement complet (défaut)
  rollback         Rollback vers la release précédente (ou spécifiée)

Options:
  --confirm-production   Requis pour --env prod (safety check)
  --dry-run              Simulation (staging only — pas de restart ni migrations)
  --force                Ignore les modifications locales trackées (staging only)
  --with-db-rollback     Rollback inclut la restauration DB (avec rollback)
  --help, -h             Affiche cette aide

Examples:
  bash scripts/deploy.sh --env prod --confirm-production
  bash scripts/deploy.sh --env prod --confirm-production rollback
  bash scripts/deploy.sh --env prod --confirm-production rollback --with-db-rollback
  bash scripts/deploy.sh --env prod --confirm-production rollback 20260726T194319Z
  bash scripts/deploy.sh --env staging
  bash scripts/deploy.sh --env staging --dry-run
  bash scripts/deploy.sh --env staging rollback
EOF
}

# ── Parse args ───────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "${1:-}" in
        --env)
            DEPLOY_ENV="${2:-}"
            shift 2
            ;;
        --env=*)
            DEPLOY_ENV="${1#*=}"
            shift
            ;;
        --confirm-production)
            CONFIRM_PRODUCTION=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --with-db-rollback)
            WITH_DB_ROLLBACK=true
            shift
            ;;
        --help|-h)
            print_usage
            exit 0
            ;;
        rollback)
            COMMAND="rollback"
            shift
            ;;
        deploy)
            COMMAND="deploy"
            shift
            ;;
        *)
            # Argument non-flag : en mode rollback c'est la release cible,
            # sinon c'est la branche git à déployer.
            if [ "$COMMAND" = "rollback" ]; then
                if [ -z "$TARGET_RELEASE" ]; then
                    TARGET_RELEASE="$1"
                fi
            else
                if [ -z "${BRANCH_SET:-}" ]; then
                    BRANCH="$1"
                    BRANCH_SET=1
                fi
            fi
            shift
            ;;
    esac
done

# ── Validation env ───────────────────────────────────────
if [ -z "$DEPLOY_ENV" ]; then
    echo "Erreur: --env est requis." >&2
    echo "" >&2
    print_usage >&2
    exit 1
fi

case "$DEPLOY_ENV" in
    prod)
        SOKAR_ROOT="/opt/sokar"
        RELEASES_DIR="$SOKAR_ROOT/releases"
        PORT_API=4000
        PORT_DASH=3000
        PORT_CONNECT=4002
        PM2_API="sokar-api"
        PM2_DASH="sokar-dashboard"
        PM2_CONNECT="sokar-connect"
        ECOSYSTEM_FILE="infra/ecosystem.config.js"
        NGINX_CONFIG="sokar"
        DB_NAME="sokar"
        KEEP_RELEASES=5
        HAS_LOCALSTACK=true
        HAS_LOGROTATE=true
        HAS_CERT_CHECK=true
        EXTENDED_HEALTH_CHECKS=true
        # Prod : --dry-run non supporté
        if [ "$DRY_RUN" = true ]; then
            echo "Erreur: --dry-run n'est pas supporté en production." >&2
            exit 1
        fi
        # Prod : --force non supporté
        if [ "$FORCE" = true ]; then
            echo "Erreur: --force n'est pas supporté en production." >&2
            exit 1
        fi
        ;;
    staging)
        SOKAR_ROOT="/opt/sokar-staging"
        RELEASES_DIR="$SOKAR_ROOT/releases"
        PORT_API=4100
        PORT_DASH=3100
        PORT_CONNECT=4102
        PM2_API="sokar-staging-api"
        PM2_DASH="sokar-staging-dashboard"
        PM2_CONNECT="sokar-staging-connect"
        ECOSYSTEM_FILE="infra/ecosystem.staging.config.js"
        NGINX_CONFIG="sokar-staging"
        DB_NAME="sokar_staging"
        KEEP_RELEASES=3
        HAS_LOCALSTACK=false
        HAS_LOGROTATE=false
        HAS_CERT_CHECK=false
        EXTENDED_HEALTH_CHECKS=false
        # Staging : --confirm-production non requis (ignoré silencieusement)
        ;;
    *)
        echo "Erreur: --env doit être 'prod' ou 'staging' (reçu: '$DEPLOY_ENV')." >&2
        echo "" >&2
        print_usage >&2
        exit 1
        ;;
esac

DATE=$(date '+%Y-%m-%d %H:%M:%S')

# ── Source libs ──────────────────────────────────────────
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=ops/logging.sh
source "$SCRIPT_DIR/ops/logging.sh"
# shellcheck source=ops/db-backup.sh
source "$SCRIPT_DIR/ops/db-backup.sh"
# shellcheck source=ops/deploy-common.sh
source "$SCRIPT_DIR/ops/deploy-common.sh"

# ── Lock anti-déploiements concurrents ───────────────────
# Placé après le source des libs (pour log_error) et avant toute opération.
LOCK_FILE="/tmp/sokar-deploy-${DEPLOY_ENV}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log_error "Un déploiement ${DEPLOY_ENV} est déjà en cours (lock: $LOCK_FILE)"
    exit 1
fi

# ── Validation flags (prod) ──────────────────────────────
if [ "$DEPLOY_ENV" = "prod" ] && [ "$CONFIRM_PRODUCTION" != true ]; then
    log_error "Confirmation production requise : relancez avec --confirm-production." >&2
    exit 2
fi

# ══════════════════════════════════════════════════════════
# Commande ROLLBACK
# ══════════════════════════════════════════════════════════
if [ "$COMMAND" = "rollback" ]; then
    cd "$SOKAR_ROOT"
    log_section "${DEPLOY_ENV^} Rollback"

    # TARGET_RELEASE est désormais parsé par la boucle d'arguments principale
    # (le prochain argument non-flag après "rollback" est traité comme release cible).

    if [ -z "$TARGET_RELEASE" ]; then
        # Pas de release spécifiée → prendre l'avant-dernière
        # (la dernière est potentiellement celle qui vient de casser)
        list_releases
        log info ""
        TARGET_RELEASE=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
            | grep -E '^[0-9]{8}T[0-9]{6}Z' \
            | sort -r \
            | sed -n '2p')
        if [ -z "$TARGET_RELEASE" ]; then
            log_error "Aucune release précédente trouvée dans $RELEASES_DIR"
            exit 1
        fi
        log info "→ Rollback vers : $TARGET_RELEASE"
    fi

    RELEASE_PATH="$RELEASES_DIR/$TARGET_RELEASE"
    if [ ! -d "$RELEASE_PATH" ]; then
        log_error "Release $TARGET_RELEASE introuvable"
        list_releases
        exit 1
    fi

    log info "→ Stop services..."
    pm2 stop "$PM2_DASH" "$PM2_CONNECT" 2>/dev/null || true

    log info "→ Restore artefacts..."
    restore_artifacts "$RELEASE_PATH"

    if [ "$WITH_DB_ROLLBACK" = true ]; then
        log info "→ Restore DB..."
        if ! restore_db "$RELEASE_PATH"; then
            log_error "DB restore échoué — rollback annulé"
            exit 1
        fi
    fi

    log info "→ Restart services..."
    pm2 start "$ECOSYSTEM_FILE"
    wait_for_services
    pm2 save
    sudo "$PRIVILEGED_WRAPPER" reload-nginx "$DEPLOY_ENV" 2>/dev/null || true

    log info ""
    log info "→ Vérification..."
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_API}/health" 2>/dev/null || echo "FAIL")
    DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_DASH}" 2>/dev/null || echo "FAIL")
    log info "   api → $API_STATUS | dashboard → $DASH_STATUS"

    if [ "$API_STATUS" = "200" ] && [ "$DASH_STATUS" = "200" ]; then
        log info ""
        log_ok "Rollback vers $TARGET_RELEASE terminé"
        log info "   Meta: $(cat "$RELEASE_PATH/META" 2>/dev/null | tr '\n' ' ')"
        notify "✅ Sokar ${DEPLOY_ENV} rollback OK (${TARGET_RELEASE})"
    else
        log info ""
        log_error "Rollback terminé mais vérifications échouées — investiguer manuellement"
        notify "🔴 Sokar ${DEPLOY_ENV} rollback failed (${TARGET_RELEASE})"
        exit 1
    fi
    exit 0
fi

# ══════════════════════════════════════════════════════════
# Commande DEPLOY
# ══════════════════════════════════════════════════════════
log_section "Sokar ${DEPLOY_ENV^} Deploy $DATE"
log info "Root: $SOKAR_ROOT"
log info "Branch: $BRANCH"
[ "$DRY_RUN" = true ] && log warn "Mode: DRY-RUN (pas de restart ni migrations)"

# ── 1. Hostname check ────────────────────────────────────
# Vérifier qu'on est sur le VPS (accepte pmbtc et sokar — transition FRA VPS)
HOSTNAME=$(hostname)
if [ "$HOSTNAME" != "sokar" ] && [ "$HOSTNAME" != "pmbtc" ]; then
    log_error "Ce script s'exécute uniquement sur le VPS (sokar/pmbtc)"
    exit 1
fi

cd "$SOKAR_ROOT"
ensure_privileged_wrapper

# ── 2. Swap check ────────────────────────────────────────
# Le VPS a 4GB RAM ; sans swap les builds Next.js sont tués par OOM (exit 137).
if ! swapon --show | grep -q swapfile 2>/dev/null; then
    log_error "Aucun swap détecté. Les builds Next.js seront tués par OOM."
    log info "   Lance d'abord (en root) : sudo bash scripts/ops/setup-swap.sh"
    exit 1
fi

# ── 3. Cert check (prod only) ────────────────────────────
if [ "$HAS_CERT_CHECK" = true ]; then
    if ! sudo "$PRIVILEGED_WRAPPER" check-cert "$DEPLOY_ENV"; then
        log_error "Certificat origine absent. Lance d'abord :"
        log info "   sudo bash scripts/ops/setup-origin-tls.sh"
        exit 1
    fi
fi

# ── 4. Node check ────────────────────────────────────────
log info "🔍 Checking Node version..."
if ! pnpm node:check; then
    log_error "Node version check failed. Use Node >=20 <23 (see .nvmrc)." >&2
    exit 1
fi

# ── 5. Git status check ──────────────────────────────────
if [ "$FORCE" = true ]; then
    log_warn "--force : reset des modifications locales trackées..."
    git checkout -- .
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    log_error "Fichiers suivis modifiés sur le VPS ${DEPLOY_ENV}. Refus de les stasher automatiquement."
    if [ "$DEPLOY_ENV" = "staging" ]; then
        log info "   Relancez avec --force pour ignorer."
    fi
    git status --short
    exit 1
fi

UNTRACKED_FILES=$(git ls-files --others --exclude-standard)
if [ -n "$UNTRACKED_FILES" ]; then
    log_warn " Fichiers non suivis conservés sur le VPS :"
    printf '%s\n' "$UNTRACKED_FILES" | sed 's/^/   /'
fi

# ── 6. Snapshot pré-build + backup DB (skip si DRY_RUN) ──
if [ "$DRY_RUN" = false ]; then
    PREV_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')-pre"
    PREV_RELEASE="$RELEASES_DIR/$PREV_TIMESTAMP"
    install -d -m 0755 "$RELEASES_DIR"
    log info ""
    log info "📦 Snapshot pré-build (rollback safety net)..."
    snapshot_artifacts "$PREV_RELEASE" "pre-build"
    backup_db "$PREV_RELEASE" || true

    # Variable globale pour le trap ERR
    RESTORE_ON_FAIL="$PREV_RELEASE"
fi

# ── 7. Trap ERR + recover_services (skip si DRY_RUN) ─────
if [ "$DRY_RUN" = false ]; then
    trap recover_services ERR
fi

# ── 8. Free memory (LocalStack si prod) ──────────────────
log info ""
log info "📦 Freeing memory before build..."

# Stop ONLY Next.js apps — API stays up (it doesn't use .next).
log info "   Stopping $PM2_DASH + $PM2_CONNECT (API stays up)..."
pm2 stop "$PM2_DASH" "$PM2_CONNECT" 2>/dev/null || true

if [ "$HAS_LOCALSTACK" = true ]; then
    # Stop LocalStack (libère ~420MB)
    log info "   Stopping LocalStack..."
    sudo "$PRIVILEGED_WRAPPER" stop-localstack "$DEPLOY_ENV" 2>/dev/null || true
fi

# PM2 tourne désormais comme deploy → plus de caches root-owned.
# ── Cache webpack persistant ──────────────────────────────────
# On NE détruit PAS .next/cache/ : c'est le cache webpack qui permet
# les incremental builds (3 min → ~1 min sur le compile). On ne supprime
# que les artefacts de build (standalone, server, static, BUILD_ID).
# Les caches root-owned (legacy PM2 root) sont nettoyés avec sudo.

FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
log info "   Memory free: ${FREE_BEFORE}MB"

# ── 9. Pull code + re-exec ───────────────────────────────
log info ""
log info "📦 Pulling latest code${DEPLOY_ENV:+ from $BRANCH}..."
PREV_HASH=$(git rev-parse HEAD 2>/dev/null || log info "")
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_HASH=$(git rev-parse HEAD)

# ── 9a. Re-exec si le script lui-même a été modifié ──────
# Bash charge le script en mémoire au démarrage. Si le git pull met à jour
# deploy.sh, la version en cours d'exécution est l'ANCIENNE. On re-exec
# pour charger la nouvelle version (une seule fois, tracée par SOKAR_REEXECED).
if [ "${SOKAR_REEXECED:-0}" != "1" ] && [ "$PREV_HASH" != "$NEW_HASH" ]; then
    if git diff --name-only "$PREV_HASH" "$NEW_HASH" 2>/dev/null | grep -qE '^scripts/deploy\.sh$'; then
        log info "   📎 deploy.sh mis à jour par le pull — re-exec pour charger la nouvelle version..."
        export SOKAR_REEXECED=1
        exec bash "$0" --env "$DEPLOY_ENV" \
            $([ "$CONFIRM_PRODUCTION" = true ] && echo "--confirm-production") \
            $([ "$DRY_RUN" = true ] && echo "--dry-run") \
            $([ "$FORCE" = true ] && echo "--force") \
            $([ "$WITH_DB_ROLLBACK" = true ] && echo "--with-db-rollback") \
            "$BRANCH"
    fi
fi

# ── 10. Detect changed apps ──────────────────────────────
# Compare le hash actuel avec le hash du dernier déploiement réussi.
# Si un app n'a pas changé, on skip son build (gain ~5 min sur le dashboard).
LAST_DEPLOYED_HASH=$(cat "$RELEASES_DIR/.latest-hash" 2>/dev/null || echo "")
detect_changed_apps "$LAST_DEPLOYED_HASH" "$NEW_HASH"

# ── 11. Install deps (conditionnel) ──────────────────────
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

# ── 12. validate_env_files (staging only) ────────────────
if [ "$DEPLOY_ENV" = "staging" ]; then
    validate_env_files

    # Libérer la mémoire seulement après le préflight : une configuration invalide
    # ne doit jamais interrompre Dashboard ou Connect.
    log info ""
    log info "📦 Freeing memory before build..."
    log info "   Stopping staging dashboard + connect (API stays up)..."
    pm2 stop "$PM2_DASH" "$PM2_CONNECT" 2>/dev/null || true

    FREE_BEFORE=$(free -m | awk '/^Mem:/ {print $4}')
    log info "   Memory free: ${FREE_BEFORE}MB"
fi

# ── 13. Env files check (prod) ───────────────────────────
if [ "$DEPLOY_ENV" = "prod" ]; then
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
            log_error "Env file manquant : $env_file — l'app correspondante démarrera sans config."
            log info "   Créez-le sur le VPS avec les valeurs de prod (voir apps/api/.env.example du repo)."
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
fi

# ── 14. Prisma generate (conditionnel) ───────────────────
if [ "$SKIP_ALL_BUILDS" = true ] || [ "$NEED_PRISMA" = false ]; then
    log info ""
    log info "⏭️  Skip Prisma generate (schema inchangé)"
else
    log info ""
    log info "📦 Generating Prisma client..."
    NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database generate
fi

# ── 15. Build (incrémental) ──────────────────────────────
if [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip tous les builds (hash inchangé)"
else
    log info ""
    log info "📦 Building..."

    # Phase 1 : packages + API (séquentiel — dépendances)
    build_packages_api "$NEED_PACKAGES" "$NEED_API"

    # Phase 2 : dashboard + connect en parallèle (si les deux sont nécessaires).
    build_dashboard_connect "$NEED_DASHBOARD" "$NEED_CONNECT"
fi

# ── 16. Copy static assets to standalone ─────────────────
if [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip copy-static (aucun rebuild)"
else
    log info ""
    log info "📦 Copying static assets to standalone..."
    copy_static "$NEED_DASHBOARD" "$NEED_CONNECT"
fi

# ── 17. DB backup + migrations (skip si DRY_RUN) ─────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip DB migrations (dry-run)"
elif [ "$SKIP_ALL_BUILDS" = true ]; then
    log info ""
    log info "⏭️  Skip DB backup + migrations (aucun changement de code)"
elif [ "$NEED_PRISMA" = false ]; then
    # Des fichiers de code ont changé mais pas le schema/migrations → pas besoin de backup
    log info ""
    log info "⏭️  Skip DB backup (aucune migration Prisma modifiée)"
else
    apply_migrations "$NEED_PRISMA"
fi

# ── 18. Nginx install (skip si DRY_RUN) ──────────────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip Nginx install (dry-run)"
else
    install_nginx
fi

# ── 19. Logrotate (prod only) ────────────────────────────
if [ "$HAS_LOGROTATE" = true ] && [ "$DRY_RUN" = false ]; then
    log info ""
    log info "📦 Installing logrotate..."
    sudo "$PRIVILEGED_WRAPPER" install-runtime "$DEPLOY_ENV"
fi

# ── 20. Restart services (skip si DRY_RUN) ───────────────
if [ "$DRY_RUN" = true ]; then
    log info ""
    log info "⏭️  Skip PM2 restart (dry-run)"
    log info ""
    log_ok "Dry-run terminé — build OK, aucun changement appliqué"
    exit 0
fi

restart_services

# ── 21. Health checks ────────────────────────────────────
health_checks

# ── 22. Résultat + snapshot post-build ───────────────────
if [ "$EXTENDED_HEALTH_CHECKS" = true ]; then
    # Prod : checks étendus
    if [ "${DEPLOY_HEALTH_REGRESSED:-false}" = true ]; then
        if [ "$DRY_RUN" = false ]; then
            recover_services 1
        fi
        exit 1
    elif [ "${DEPLOY_HEALTH_OK:-false}" = true ]; then
        log info ""
        log_ok "Deploy complete — API + dashboard + Sokar Connect + routing OK"
        notify "✅ Sokar ${DEPLOY_ENV} deploy OK (branch ${BRANCH}, hash $(git rev-parse --short HEAD))"
        trap - ERR

        # ── Snapshot post-build réussi + cleanup ─────────
        # Skip le snapshot si rien n'a été rebuild (les artefacts sont identiques
        # à la release précédente — pas besoin d'un nouveau snapshot).
        if [ "$SKIP_ALL_BUILDS" = true ]; then
            log info ""
            log info "⏭️  Skip snapshot post-build (aucun changement)"
        else
            NEW_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
            NEW_RELEASE="$RELEASES_DIR/$NEW_TIMESTAMP"
            log info ""
            log info "📦 Snapshot post-build (release $NEW_TIMESTAMP)..."
            snapshot_artifacts "$NEW_RELEASE" "deploy-ok"
            echo "$NEW_TIMESTAMP" > "$RELEASES_DIR/.latest"
            cleanup_releases "$KEEP_RELEASES"
        fi
        # Sauvegarder le hash pour le prochain déploiement incrémental
        git rev-parse HEAD > "$RELEASES_DIR/.latest-hash"

        # Le snapshot pré-build a servi de safety net et n'est plus needed
        rm -rf "$PREV_RELEASE" 2>/dev/null || true

        log info ""
        log info "📦 Releases disponibles pour rollback :"
        list_releases
        log info ""
        log info "   Pour rollback : bash scripts/deploy.sh --env $DEPLOY_ENV rollback"
    else
        log info ""
        log_error "Deploy finished but routing or application checks failed"
        notify "🔴 Sokar ${DEPLOY_ENV} deploy finished with failed checks (branch ${BRANCH})"
        if [ "$DRY_RUN" = false ]; then
            recover_services 1
        fi
        exit 1
    fi
else
    # Staging : checks simples
    if [ "${DEPLOY_HEALTH_OK:-false}" = true ]; then
        # ── Snapshot post-build réussi ───────────────────
        NEW_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
        NEW_RELEASE="$RELEASES_DIR/$NEW_TIMESTAMP"
        log info ""
        log info "📦 Snapshot post-build (release $NEW_TIMESTAMP)..."
        snapshot_artifacts "$NEW_RELEASE" "deploy-ok"
        echo "$NEW_TIMESTAMP" > "$RELEASES_DIR/.latest"

        # Cleanup old releases (garde KEEP_RELEASES)
        cleanup_releases "$KEEP_RELEASES"

        # Nettoyer le snapshot pré-build
        rm -rf "${PREV_RELEASE}" 2>/dev/null || true

        # ── Résultat ─────────────────────────────────────
        log info ""
        log_ok "Staging deploy complete — API + Dashboard + Connect OK"
        log info "   URLs : https://staging.sokar.tech (dashboard)"
        log info "          https://api-staging.sokar.tech (API)"
        log info "   Rollback : bash scripts/deploy.sh --env staging rollback"
        notify "✅ Sokar staging deploy OK (branch ${BRANCH}, hash $(git rev-parse --short HEAD))"
        # Sauvegarder le hash pour le prochain déploiement incrémental
        git rev-parse HEAD > "$RELEASES_DIR/.latest-hash"
        trap - ERR
    fi
fi
