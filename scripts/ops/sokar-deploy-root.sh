#!/bin/bash

set -Eeuo pipefail

if [ "${EUID}" -ne 0 ]; then
    echo "Ce wrapper doit être exécuté en root." >&2
    exit 1
fi

PRIVILEGED_WRAPPER="/usr/local/sbin/sokar-deploy-root"
SUDOERS_DST="/etc/sudoers.d/deploy"

usage() {
    echo "Usage: $0 {check-cert|clean-next|install-nginx|restore-nginx|reload-nginx|install-runtime|self-update|check-prod-vhost|start-localstack|stop-localstack|backup-db} {prod|staging} [dashboard|connect]" >&2
    exit 2
}

[ "$#" -ge 2 ] || usage
ACTION="$1"
ENVIRONMENT="$2"

case "$ENVIRONMENT" in
    prod)
        ROOT="/opt/sokar"
        VHOST="sokar"
        CERT_ROOT="/etc/letsencrypt/live/sokar.tech"
        ;;
    staging)
        ROOT="/opt/sokar-staging"
        VHOST="sokar-staging"
        CERT_ROOT="/etc/letsencrypt/live/staging.sokar.tech"
        ;;
    *)
        usage
        ;;
esac

install_nginx() {
    install -d -m 0755 /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
    install -m 0644 "$ROOT/infra/nginx/snippets/sokar-proxy.conf" /etc/nginx/snippets/sokar-proxy.conf
    install -m 0644 "$ROOT/infra/nginx/snippets/sokar-cloudflare-real-ip.conf" /etc/nginx/snippets/sokar-cloudflare-real-ip.conf

    if [ -f "/etc/nginx/sites-available/$VHOST" ]; then
        install -m 0644 "/etc/nginx/sites-available/$VHOST" "/etc/nginx/sites-available/$VHOST.bak"
    fi

    if [ "$ENVIRONMENT" = "prod" ]; then
        install -m 0644 "$ROOT/infra/nginx/sokar.conf" "/etc/nginx/sites-available/$VHOST"
        ln -sfn "/etc/nginx/sites-available/$VHOST" "/etc/nginx/sites-enabled/$VHOST"
    else
        install -m 0644 "$ROOT/infra/nginx/sokar-staging.conf" "/etc/nginx/sites-available/$VHOST"
        install -m 0644 "$ROOT/infra/nginx/sokar-staging.conf" "/etc/nginx/sites-enabled/$VHOST"
    fi

    if ! nginx -t; then
        restore_nginx
        nginx -t && systemctl reload nginx || true
        return 1
    fi

    find "/etc/nginx/sites-available" -maxdepth 1 -type f -name "$VHOST.bak" -delete
}

restore_nginx() {
    if [ -f "/etc/nginx/sites-available/$VHOST.bak" ]; then
        install -m 0644 "/etc/nginx/sites-available/$VHOST.bak" "/etc/nginx/sites-available/$VHOST"
        if [ "$ENVIRONMENT" = "prod" ]; then
            ln -sfn "/etc/nginx/sites-available/$VHOST" "/etc/nginx/sites-enabled/$VHOST"
        else
            install -m 0644 "/etc/nginx/sites-available/$VHOST.bak" "/etc/nginx/sites-enabled/$VHOST"
        fi
    fi
}

clean_next() {
    [ "$#" -eq 1 ] || usage
    case "$1" in
        dashboard) APP_DIR="$ROOT/apps/dashboard" ;;
        connect) APP_DIR="$ROOT/apps/connect" ;;
        *) usage ;;
    esac
    for sub in standalone server static types; do
        rm -rf "$APP_DIR/.next/$sub"
    done
    rm -f "$APP_DIR/.next/BUILD_ID"
    rm -rf "$APP_DIR"/.next/eslint*
    find "$APP_DIR/.next" -maxdepth 1 -name '*.nft.json' -delete
    find "$APP_DIR/.next/server" -name '*.nft.json' -delete 2>/dev/null || true
}

check_prod_vhost() {
    [ "$ENVIRONMENT" = "prod" ] || usage
    [ "$(grep -lE '^[[:space:]]*server_name[[:space:]]+api\.sokar\.tech' /etc/nginx/sites-enabled/* 2>/dev/null | wc -l)" -eq 1 ]
}

localstack() {
    [ "$ENVIRONMENT" = "prod" ] || usage
    case "$ACTION" in
        start-localstack) /usr/bin/docker start infra-localstack-1 ;;
        stop-localstack) /usr/bin/docker stop infra-localstack-1 ;;
        *) usage ;;
    esac
}

install_runtime() {
    [ "$ENVIRONMENT" = "prod" ] || usage
    install -d -m 0700 -o deploy -g deploy /var/backups/sokar
    install -m 0750 "$ROOT/scripts/backup-postgres.sh" /usr/local/sbin/sokar-backup-postgres
    install -m 0644 "$ROOT/infra/cron/sokar-postgres-backup" /etc/cron.d/sokar-postgres-backup
    install -d -m 0755 -o www-data -g www-data /var/cache/nginx/connect
    install -m 0644 "$ROOT/infra/logrotate/sokar" /etc/logrotate.d/sokar
}

self_update() {
    [ "$ENVIRONMENT" = "prod" ] || [ "$ENVIRONMENT" = "staging" ] || usage
    local wrapper_src="$ROOT/scripts/ops/sokar-deploy-root.sh"
    local sudoers_src="$ROOT/infra/sudoers.d/deploy"
    local wrapper_backup="$PRIVILEGED_WRAPPER.bak"
    local sudoers_backup="$SUDOERS_DST.bak"

    install -m 0755 "$PRIVILEGED_WRAPPER" "$wrapper_backup"

    if [ -f "$SUDOERS_DST" ]; then
        install -m 0440 "$SUDOERS_DST" "$sudoers_backup"
    fi

    install -o root -g root -m 0755 "$wrapper_src" "$PRIVILEGED_WRAPPER"

    if [ -f "$sudoers_src" ]; then
        install -o root -g root -m 0440 "$sudoers_src" "$SUDOERS_DST"
        if ! visudo -c >/dev/null 2>&1; then
            install -o root -g root -m 0755 "$wrapper_backup" "$PRIVILEGED_WRAPPER"
            if [ -f "$sudoers_backup" ]; then
                install -o root -g root -m 0440 "$sudoers_backup" "$SUDOERS_DST"
            fi
            echo "❌ visudo a détecté une erreur. Restauration effectuée." >&2
            exit 1
        fi
    fi

    rm -f "$wrapper_backup" "$sudoers_backup"
    echo "✅ Wrapper sokar-deploy-root mis à jour depuis $wrapper_src"
}

case "$ACTION" in
    check-cert)
        [ "$#" -eq 2 ] || usage
        test -f "$CERT_ROOT/fullchain.pem" && test -f "$CERT_ROOT/privkey.pem"
        ;;
    clean-next)
        [ "$#" -eq 3 ] || usage
        clean_next "$3"
        ;;
    install-nginx)
        [ "$#" -eq 2 ] || usage
        install_nginx
        ;;
    restore-nginx)
        [ "$#" -eq 2 ] || usage
        restore_nginx
        ;;
    reload-nginx)
        [ "$#" -eq 2 ] || usage
        nginx -t
        systemctl reload nginx
        ;;
    install-runtime)
        [ "$#" -eq 2 ] || usage
        install_runtime
        ;;
    backup-db)
        [ "$#" -eq 2 ] || usage
        /usr/local/sbin/sokar-backup-postgres
        ;;
    self-update)
        [ "$#" -eq 2 ] || usage
        self_update
        ;;
    check-prod-vhost)
        [ "$#" -eq 2 ] || usage
        check_prod_vhost
        ;;
    start-localstack|stop-localstack)
        [ "$#" -eq 2 ] || usage
        localstack
        ;;
    *)
        usage
        ;;
esac
