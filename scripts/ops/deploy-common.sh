#!/bin/bash
# Librairie partagée pour les déploiements Sokar (prod + staging).
# Sourcée par scripts/deploy.sh après configuration des variables d'environnement.
#
# Variables attendues (set par deploy.sh avant de source ce fichier) :
#   DEPLOY_ENV              prod | staging
#   SOKAR_ROOT              /opt/sokar | /opt/sokar-staging
#   RELEASES_DIR            $SOKAR_ROOT/releases
#   PORT_API / PORT_DASH / PORT_CONNECT
#   PM2_API / PM2_DASH / PM2_CONNECT
#   ECOSYSTEM_FILE          infra/ecosystem.config.js | infra/ecosystem.staging.config.js
#   NGINX_CONFIG            sokar | sokar-staging (sans .conf)
#   DB_NAME                 sokar | sokar_staging
#   KEEP_RELEASES           5 | 3
#   CONFIRM_PRODUCTION      true | false
#   DRY_RUN                 true | false
#   FORCE                   true | false
#   HAS_LOCALSTACK          true | false
#   HAS_LOGROTATE           true | false
#   HAS_CERT_CHECK          true | false
#   EXTENDED_HEALTH_CHECKS  true | false
#   BRANCH                  branche git à déployer
#   PRIVILEGED_WRAPPER      /usr/local/sbin/sokar-deploy-root
#   WAIT_TIMEOUT            timeout en secondes pour wait_for_services
#
# Fonctions exposées :
#   ensure_privileged_wrapper()
#   wait_for_services(timeout)
#   snapshot_artifacts(target, label, [paths...])
#   restore_artifacts(source)
#   cleanup_releases(keep)
#   list_releases()
#   clean_next_artifacts(app)
#   recover_services()
#   detect_changed_apps(last_hash, new_hash)
#   build_packages_api(need_packages, need_api)
#   build_dashboard_connect(need_dash, need_connect)
#   copy_static(need_dash, need_connect)
#   apply_migrations(need_prisma)
#   install_nginx()
#   validate_nginx_config()
#   restart_services()
#   health_checks()
#   validate_env_files()

# Artefacts à snapshoter (chemins relatifs à SOKAR_ROOT)
ARTIFACT_PATHS=(
    "apps/api/dist"
    "apps/dashboard/.next"
    "apps/dashboard/public"
    "apps/connect/.next"
    "apps/connect/public"
)

ensure_privileged_wrapper() {
    if [ -x "$PRIVILEGED_WRAPPER" ]; then
        log info "🔄 Mise à jour du wrapper privilégié..."
        if sudo -n "$PRIVILEGED_WRAPPER" self-update "$DEPLOY_ENV" >/dev/null 2>&1; then
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

# Attendre que les services soient up (health + livez), timeout configurable
wait_for_services() {
    local timeout=${1:-$WAIT_TIMEOUT}
    local WAIT_START WAIT_NOW API_HEALTH API_LIVEZ DASH_READY CONNECT_READY
    log info ""
    log info "⏳ Waiting for ${DEPLOY_ENV} services to be ready (timeout ${timeout}s)..."
    WAIT_START=$(date +%s)
    while true; do
        API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_API}/health" 2>/dev/null || echo "000")
        API_LIVEZ=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_API}/livez" 2>/dev/null || echo "000")
        DASH_READY=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_DASH}" 2>/dev/null || echo "000")
        CONNECT_READY=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_CONNECT}/restaurant/chez-sokar-demo" 2>/dev/null || echo "000")
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
    log info "   → Snapshot artefacts vers $target ($label)"
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
        log_error "Release $source introuvable" >&2
        return 1
    fi
    log info "   → Restore artefacts depuis $source"
    for p in "${ARTIFACT_PATHS[@]}"; do
        if [ -e "$source/$p" ]; then
            rm -rf "$SOKAR_ROOT/$p"
            install -d -m 0755 "$SOKAR_ROOT/$(dirname "$p")"
            cp -a "$source/$p" "$SOKAR_ROOT/$(dirname "$p")/"
        fi
    done
}

cleanup_releases() {
    local keep="${1:-$KEEP_RELEASES}"
    local count
    count=$(ls -1 "$RELEASES_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort -r | wc -l)
    if [ "$count" -le "$keep" ]; then
        return
    fi
    log info "   → Nettoyage releases (garde $keep sur $count)"
    ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E '^[0-9]{8}T[0-9]{6}Z' \
        | sort -r \
        | tail -n +"$((keep + 1))" \
        | while read -r old; do
            rm -rf "$RELEASES_DIR/$old"
            log info "     supprimé: $old"
        done
}

list_releases() {
    log info "Releases disponibles (plus récent en premier) :"
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

clean_next_artifacts() {
    local app="$1"
    local app_dir="$SOKAR_ROOT/apps/$app"
    if [ -d "$app_dir/.next" ]; then
        rm -rf "$app_dir/.next/standalone" "$app_dir/.next/server" "$app_dir/.next/static" "$app_dir/.next/types"
        rm -f "$app_dir/.next/BUILD_ID"
        rm -rf "$app_dir"/.next/eslint*
        find "$app_dir/.next" -maxdepth 1 -name '*.nft.json' -delete
        find "$app_dir/.next/server" -name '*.nft.json' -delete 2>/dev/null || true
    fi
}

# Trap ERR — remet les services en ligne après un échec de déploiement.
# Utilise RESTORE_ON_FAIL (snapshot pré-build) et les variables PM2_*.
recover_services() {
    local exit_code=${1:-$?}
    trap - ERR
    log info ""
    log_error "Déploiement ${DEPLOY_ENV} interrompu (code ${exit_code})."

    # Restore les artefacts d'avant le build si un snapshot existe
    if [ -n "${RESTORE_ON_FAIL:-}" ] && [ -d "${RESTORE_ON_FAIL}" ]; then
        log info "   → Restore artefacts pré-build (${RESTORE_ON_FAIL##*/})..."
        pm2 stop "$PM2_DASH" "$PM2_CONNECT" 2>/dev/null || true
        restore_artifacts "${RESTORE_ON_FAIL}"
    fi

    log info "   → Remise en ligne des services ${DEPLOY_ENV}..."
    pm2 restart "$PM2_API" "$PM2_DASH" "$PM2_CONNECT" 2>/dev/null \
        || pm2 resurrect 2>/dev/null \
        || true

    if [ "$DEPLOY_ENV" = "prod" ]; then
        log info "   Rollback Nginx vers la configuration précédente..."
        sudo "$PRIVILEGED_WRAPPER" restore-nginx "$DEPLOY_ENV"
        sudo "$PRIVILEGED_WRAPPER" reload-nginx "$DEPLOY_ENV" || true
        sudo "$PRIVILEGED_WRAPPER" start-localstack "$DEPLOY_ENV" 2>/dev/null || true
    fi

    # Nettoyer le snapshot pré-build (il n'a pas servi)
    rm -rf "${RESTORE_ON_FAIL}" 2>/dev/null || true

    log info ""
    log_error "Services ${DEPLOY_ENV} restaurés à l'état pré-build. Le déploiement a échoué."
    notify "🔴 Sokar ${DEPLOY_ENV} deploy failed (branch ${BRANCH}, exit ${exit_code})"
    exit "$exit_code"
}

# Détecte quels apps ont changé entre last_hash et new_hash.
# Set les variables globales : NEED_PACKAGES, NEED_API, NEED_DASH, NEED_CONNECT,
# NEED_INSTALL, NEED_PRISMA, SKIP_ALL_BUILDS.
detect_changed_apps() {
    local last_hash="$1"
    local new_hash="$2"

    NEED_DASHBOARD=false
    NEED_CONNECT=false
    NEED_API=false
    NEED_PACKAGES=false
    NEED_INSTALL=false
    NEED_PRISMA=false
    SKIP_ALL_BUILDS=false

    if [ -z "$last_hash" ]; then
        # Premier déploiement → build tout
        NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
        NEED_INSTALL=true; NEED_PRISMA=true
        log info "   📎 Build complet (premier déploiement)"
    elif [ "$last_hash" = "$new_hash" ]; then
        # Même hash → rien à builder, juste restart + nginx
        SKIP_ALL_BUILDS=true
        log info "   ⏭️  Hash inchangé ($new_hash) — skip tous les builds"
    else
        local changed_files
        changed_files=$(git diff --name-only "$last_hash" "$new_hash" 2>/dev/null || echo "")
        if [ -z "$changed_files" ]; then
            NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
            NEED_INSTALL=true; NEED_PRISMA=true
            if [ "$DEPLOY_ENV" = "prod" ]; then
                log info "   📎 Build complet (diff indisponible)"
            else
                log info "   📎 Build complet (diff indisponible)"
            fi
        else
            # Afficher les fichiers modifiés
            local local_count
            local_count=$(echo "$changed_files" | wc -l)
            log info "   📎 $local_count fichier(s) modifié(s) depuis $last_hash"
            echo "$changed_files" | head -10 | sed 's/^/      /'
            [ "$local_count" -gt 10 ] && log info "      ... et $((local_count - 10)) autre(s)"

            echo "$changed_files" | grep -qE '^apps/dashboard/' && NEED_DASHBOARD=true
            echo "$changed_files" | grep -qE '^apps/connect/' && NEED_CONNECT=true
            echo "$changed_files" | grep -qE '^apps/api/' && NEED_API=true
            # Prisma schema/migrations changent → generate + migrate
            if echo "$changed_files" | grep -qE '^packages/database/prisma/'; then
                NEED_PRISMA=true
            fi

            # Packages non-test changent → rebuild packages et dépendants
            local non_test_pkg_files
            non_test_pkg_files=$(echo "$changed_files" | grep -E '^packages/' | grep -vE '/__tests__/' | grep -vE '\.test\.(ts|tsx|js|jsx)$' || true)
            if [ -n "$non_test_pkg_files" ]; then
                NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
            fi

            # turbo.json change → rebuild tout (pipeline/build config changed)
            if echo "$changed_files" | grep -qE '^turbo\.json'; then
                NEED_DASHBOARD=true; NEED_CONNECT=true; NEED_API=true; NEED_PACKAGES=true
            fi
            echo "$changed_files" | grep -qE '^pnpm-lock\.yaml|^package\.json' && NEED_INSTALL=true

            # Si un build précédent a nettoyé les artefacts sans rebatcher l'app,
            # on force le rebuild pour restaurer le standalone.
            if [ "$NEED_DASHBOARD" = false ] && [ ! -f "$SOKAR_ROOT/apps/dashboard/.next/standalone/apps/dashboard/server.js" ]; then
                NEED_DASHBOARD=true
                log_warn "Dashboard standalone manquant — build forcé"
            fi
            if [ "$NEED_CONNECT" = false ] && [ ! -f "$SOKAR_ROOT/apps/connect/.next/standalone/apps/connect/server.js" ]; then
                NEED_CONNECT=true
                log_warn "Connect standalone manquant — build forcé"
            fi
            # Staging : fallback supplémentaire sur apps/api/dist/main.js
            if [ "$DEPLOY_ENV" = "staging" ] && [ "$NEED_API" = false ] && [ ! -f "apps/api/dist/main.js" ]; then
                NEED_API=true
            fi

            log info "   📎 Apps à builder :$([ "$NEED_DASHBOARD" = true ] && echo ' dashboard')$([ "$NEED_CONNECT" = true ] && echo ' connect')$([ "$NEED_API" = true ] && echo ' api')"
            if [ "$NEED_DASHBOARD" = false ] && [ "$NEED_CONNECT" = false ] && [ "$NEED_API" = false ] && [ "$NEED_PACKAGES" = false ]; then
                SKIP_ALL_BUILDS=true
                log info "   ⏭️  Aucun app modifié — skip build"
            fi
        fi
    fi
}

# Build Phase 1 : packages + API (séquentiel — dépendances)
build_packages_api() {
    local need_packages="$1"
    local need_api="$2"

    if [ "$need_packages" = true ] || [ "$need_api" = true ]; then
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/config build
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/database build
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/shared build
    fi
    if [ "$need_api" = true ]; then
        NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter @sokar/api build
    fi
}

# Build Phase 2 : dashboard + connect (en parallèle si les deux sont nécessaires)
build_dashboard_connect() {
    local need_dash="$1"
    local need_connect="$2"

    local build_dash_cmd=""
    local build_connect_cmd=""
    if [ "$need_dash" = true ]; then
        build_dash_cmd="NODE_OPTIONS='--max-old-space-size=2048' NEXT_TELEMETRY_DISABLED=1 SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 pnpm --filter @sokar/dashboard build"
    fi
    if [ "$need_connect" = true ]; then
        build_connect_cmd="NODE_OPTIONS='--max-old-space-size=1024' NEXT_TELEMETRY_DISABLED=1 pnpm --filter @sokar/connect build"
    fi

    # Nettoyage des artefacts anciens juste avant le build (pas au début du script,
    # sinon on peut supprimer le standalone d'une app qui n'est pas rebuildée).
    [ "$need_dash" = true ] && clean_next_artifacts dashboard
    [ "$need_connect" = true ] && clean_next_artifacts connect

    if [ -n "$build_dash_cmd" ] && [ -n "$build_connect_cmd" ]; then
        log info "   → Lancement dashboard + connect en parallèle..."
        eval "$build_dash_cmd" &
        local dash_pid=$!
        eval "$build_connect_cmd" &
        local connect_pid=$!
        # Attendre les deux. Si l'un échoue, on kill l'autre et on fail.
        local dash_exit=0
        local connect_exit=0
        wait "$dash_pid" || dash_exit=$?
        wait "$connect_pid" || connect_exit=$?
        if [ "$dash_exit" -ne 0 ]; then
            log_error "Dashboard build échoué (exit $dash_exit)"
            kill "$connect_pid" 2>/dev/null || true
            exit 1
        fi
        if [ "$connect_exit" -ne 0 ]; then
            log_error "Connect build échoué (exit $connect_exit)"
            exit 1
        fi
    elif [ -n "$build_dash_cmd" ]; then
        log info "   → Dashboard build seul..."
        eval "$build_dash_cmd"
    elif [ -n "$build_connect_cmd" ]; then
        log info "   → Connect build seul..."
        eval "$build_connect_cmd"
    else
        log info "   ⏭️  Aucun build Next.js nécessaire"
    fi
}

# Copier les static assets dans standalone
copy_static() {
    local need_dash="$1"
    local need_connect="$2"

    if [ "$need_dash" = true ]; then
        bash "$SOKAR_ROOT/apps/dashboard/scripts/copy-static.sh"
    else
        log info "   ⏭️  Dashboard non rebuild — static déjà en place"
    fi
    if [ "$need_connect" = true ]; then
        bash "$SOKAR_ROOT/apps/connect/scripts/copy-static.sh"
    else
        log info "   ⏭️  Connect non rebuild — static déjà en place"
    fi
}

# Appliquer les migrations Prisma (prod : backup DB via wrapper avant)
apply_migrations() {
    local need_prisma="$1"

    if [ "$DEPLOY_ENV" = "prod" ]; then
        log info ""
        log info "📦 Backing up database..."
        sudo "$PRIVILEGED_WRAPPER" install-runtime "$DEPLOY_ENV"
        sudo "$PRIVILEGED_WRAPPER" backup-db "$DEPLOY_ENV"
    fi

    log info ""
    log info "📦 Applying database migrations${DEPLOY_ENV:+ ($DEPLOY_ENV DB)}..."
    export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | sed "s/^[\"'[:space:]]*//;s/[\"'[:space:]]*$//")
    pnpm exec prisma migrate deploy --schema=packages/database/prisma/schema.prisma
    unset DATABASE_URL
}

# Installer la configuration Nginx
install_nginx() {
    log info ""
    log info "📦 Installing Nginx ${DEPLOY_ENV} routing..."
    sudo "$PRIVILEGED_WRAPPER" install-nginx "$DEPLOY_ENV"

    # Prod : vérifier qu'un seul virtual host déclare api.sokar.tech
    if [ "$DEPLOY_ENV" = "prod" ]; then
        if ! sudo "$PRIVILEGED_WRAPPER" check-prod-vhost "$DEPLOY_ENV"; then
            log_error "Le nombre de virtual hosts déclarant api.sokar.tech est incorrect (attendu: 1)."
            log info "   Supprime l'ancien fichier dans /etc/nginx/sites-enabled avant de relancer."
            exit 1
        fi
    fi

    # Valider que le catch-all a default_server sur 443 (avant le reload).
    validate_nginx_config
}

# Vérifier que le catch-all Nginx déclare default_server sur 443.
# Bug PR #67 : les sous-domaines *.sokar.tech tombaient sur le dashboard au lieu
# de Connect car default_server manquait sur le listen 443 du server_name _.
validate_nginx_config() {
    # Staging n'a pas de catch-all (pas de subdomains) — skip la validation.
    if [ "$DEPLOY_ENV" != "prod" ]; then
        return 0
    fi

    local conf_file="/etc/nginx/sites-available/sokar"

    if ! grep -q "listen 443 ssl http2 default_server" "$conf_file" 2>/dev/null; then
        log_error "Nginx catch-all missing 'default_server' on listen 443."
        log_error "Subdomains *.sokar.tech will be routed to the wrong server block."
        log_error "Check $conf_file — the server_name _ block must have default_server on 443."
        exit 1
    fi
    log info "   ✅ Nginx catch-all default_server 443 — OK"
}

# Redémarrer les services PM2 + Nginx (+ LocalStack en prod)
restart_services() {
    log info ""
    log info "📦 Restarting ${DEPLOY_ENV} services..."
    pm2 start "$ECOSYSTEM_FILE"
    pm2 save
    sudo "$PRIVILEGED_WRAPPER" reload-nginx "$DEPLOY_ENV"

    if [ "$HAS_LOCALSTACK" = true ]; then
        log info ""
        log info "📦 Restarting LocalStack..."
        sudo "$PRIVILEGED_WRAPPER" start-localstack "$DEPLOY_ENV" 2>/dev/null || true
    fi
}

# Valider les fichiers .env de staging avant le build.
# Vérifie : présence des fichiers, pas de placeholder, DATABASE_URL sur sokar_staging,
# REDIS_URL sur db=3, secret Service Copilot ≥ 32 chars.
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

    # REDIS_URL : staging utilise db=3 (isolé de prod db=0/1/2)
    if ! grep -qE 'REDIS_URL=.*:6379/3' apps/api/.env; then
        log_error "REDIS_URL dans apps/api/.env doit utiliser db=3 (REDIS_URL=...:6379/3)." >&2
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

# Health checks — étendus en prod, simples en staging
health_checks() {
    log info ""
    log info "📦 Verifying ${DEPLOY_ENV}..."
    pm2 status
    wait_for_services

    log info ""
    log_section "Checking ${DEPLOY_ENV} HTTP endpoints"
    local API_STATUS DASH_STATUS CONNECT_STATUS
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_API}/health" 2>/dev/null || echo "FAIL")
    DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_DASH}" 2>/dev/null || echo "FAIL")
    CONNECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_CONNECT}/restaurant/chez-sokar-demo" 2>/dev/null || echo "FAIL")
    log info "   api (127.0.0.1:${PORT_API}/health) → $API_STATUS"
    log info "   dashboard (127.0.0.1:${PORT_DASH})  → $DASH_STATUS"
    log info "   connect (127.0.0.1:${PORT_CONNECT}/restaurant/chez-sokar-demo) → $CONNECT_STATUS"

    if [ "$EXTENDED_HEALTH_CHECKS" = true ]; then
        # Checks étendus prod
        local API_VHOST_STATUS WIDGET_API_STATUS PUBLIC_PAGE_STATUS
        API_VHOST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: api.sokar.tech" \
            http://127.0.0.1/health 2>/dev/null || echo "FAIL")
        WIDGET_API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
            http://127.0.0.1/api/proxy/public/widget/chez-sokar-demo 2>/dev/null || echo "FAIL")
        PUBLIC_PAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
            http://127.0.0.1/restaurant/chez-sokar-demo 2>/dev/null || echo "FAIL")
        log info "   api.sokar.tech/health via Nginx → $API_VHOST_STATUS"
        log info "   widget slug API via Next proxy → $WIDGET_API_STATUS"
        log info "   public Sokar Connect page via Nginx → $PUBLIC_PAGE_STATUS"

        local WIDGET_HEADERS WIDGET_IFRAME_STATUS
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
        log info "   widget iframe headers → $WIDGET_IFRAME_STATUS"

        # Vérification de la page achat carte cadeau (P1.4) — route /widget/[slug]/gift-card.
        local GIFT_CARD_WIDGET_STATUS
        GIFT_CARD_WIDGET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: sokar.tech" \
            http://127.0.0.1/widget/chez-sokar-demo/gift-card 2>/dev/null || echo "FAIL")
        log info "   gift-card widget page → $GIFT_CARD_WIDGET_STATUS"

        # Subdomain routing check — verify *.sokar.tech middleware routes to Connect
        # (not the dashboard). Bug historique : default_server manquant sur 443 →
        # les sous-domaines tombaient sur le dashboard au lieu de Connect.
        local SUBDOMAIN_STATUS
        SUBDOMAIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Host: chez-sokar-demo.sokar.tech" "http://127.0.0.1/" 2>/dev/null || echo "FAIL")
        log info "   subdomain (Host: chez-sokar-demo.sokar.tech) → $SUBDOMAIN_STATUS"

        # Vérification post-déploiement : un asset CSS/JS réel doit répondre 200.
        # Bug historique : `curl -I /` répond 200 même si .next/static n'a pas été
        # copié dans le standalone → page blanche côté client. On extrait le premier
        # chunk JS du HTML rendu et on vérifie qu'il est servi.
        local DASH_CSS_STATUS FIRST_CHUNK
        DASH_CSS_STATUS="N/A"
        FIRST_CHUNK=$(curl -s -H "Host: sokar.tech" http://127.0.0.1/ 2>/dev/null \
          | grep -oE '/_next/static/[^\"]+\.(js|css)' \
          | head -1 || true)
        if [ -n "$FIRST_CHUNK" ]; then
          DASH_CSS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "Host: sokar.tech" "http://127.0.0.1${FIRST_CHUNK}" 2>/dev/null || echo "FAIL")
          log info "   dashboard asset ${FIRST_CHUNK} → $DASH_CSS_STATUS"
        else
          log_warn " Aucun chunk JS/CSS trouvé dans le HTML du dashboard (build cassé ?)"
        fi

        local FREE_AFTER
        FREE_AFTER=$(free -m | awk '/^Mem:/ {print $4}')
        log info "   Memory free: ${FREE_AFTER}MB"

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
            && [ "$SUBDOMAIN_STATUS" = "200" ] \
            && [ "$DASH_CSS_STATUS" = "200" ]; then
            DEPLOY_HEALTH_OK=true
        elif [ "$DASH_STATUS" = "200" ] && [ "$DASH_CSS_STATUS" != "200" ]; then
            log info ""
            log_error "Deploy REGRESSED : dashboard HTML répond 200 mais assets statiques 404."
            log info "   Cause probable : scripts/copy-static.sh non exécuté ou .next/static manquant."
            log info "   Fix manuel : cd /opt/sokar/apps/dashboard && bash scripts/copy-static.sh && pm2 restart sokar-dashboard"
            notify "🔴 Sokar production deploy REGRESSED (static assets 404, branch ${BRANCH})"
            DEPLOY_HEALTH_OK=false
            DEPLOY_HEALTH_REGRESSED=true
        else
            DEPLOY_HEALTH_OK=false
        fi
    else
        # Checks simples staging
        local LIVEZ_STATUS STAGING_API_VHOST STAGING_DASH_VHOST
        LIVEZ_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT_API}/livez" 2>/dev/null || echo "FAIL")
        log info "   api (/livez)       → $LIVEZ_STATUS"

        # Vérifier via Nginx (Host header)
        STAGING_API_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
            http://127.0.0.1/health 2>/dev/null || echo "FAIL")
        STAGING_DASH_VHOST=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: staging.sokar.tech" \
            http://127.0.0.1/ 2>/dev/null || echo "FAIL")
        log info "   staging.sokar.tech/health via Nginx → $STAGING_API_VHOST"
        log info "   staging.sokar.tech/ via Nginx       → $STAGING_DASH_VHOST"

        if [ "$API_STATUS" = "200" ] \
            && [ "$LIVEZ_STATUS" = "200" ] \
            && [ "$DASH_STATUS" = "200" ] \
            && [ "$CONNECT_STATUS" = "200" ]; then
            DEPLOY_HEALTH_OK=true
        else
            DEPLOY_HEALTH_OK=false
            # Staging : appeler recover_services explicitement (exit 1 n'émet pas ERR)
            log info ""
            log_error "Staging deploy finished but checks failed"
            log info "   API=$API_STATUS Livez=$LIVEZ_STATUS Dash=$DASH_STATUS Connect=$CONNECT_STATUS"
            recover_services 1
        fi
    fi
}
