#!/usr/bin/env bash
# Sauvegarde PostgreSQL de la base staging (sokar_staging).
#
# Wrapper autour de scripts/backup-postgres.sh qui positionne les variables
# d'environnement par défaut pour staging.
#
# Usage:
#   /usr/local/sbin/sokar-staging-backup-postgres
#   BACKUP_DIR=/tmp/staging-dumps bash scripts/backup-staging-postgres.sh

set -euo pipefail

SOKAR_ROOT="${SOKAR_ROOT:-/opt/sokar-staging}"
POSTGRES_DB="${POSTGRES_DB:-sokar_staging}"
POSTGRES_USER="${POSTGRES_USER:-sokar}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-infra-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sokar-staging}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

export POSTGRES_DB POSTGRES_USER POSTGRES_CONTAINER BACKUP_DIR RETENTION_DAYS

exec "${SOKAR_ROOT}/scripts/backup-postgres.sh"
