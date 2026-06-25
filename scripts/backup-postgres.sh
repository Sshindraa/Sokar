#!/usr/bin/env bash
# Sauvegarde PostgreSQL production avec vérification par restauration temporaire.
#
# Usage:
#   bash scripts/backup-postgres.sh
#   BACKUP_DIR=/var/backups/sokar RETENTION_DAYS=14 bash scripts/backup-postgres.sh

set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-infra-postgres-1}"
DB_NAME="${POSTGRES_DB:-sokar}"
DB_USER="${POSTGRES_USER:-sokar}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sokar}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
BACKUP_PATH="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.dump"
VERIFY_DB="${DB_NAME}_restore_check_${TIMESTAMP//[^0-9]/}"

install -d -m 0700 "${BACKUP_DIR}"
umask 077

cleanup() {
  docker exec "${CONTAINER}" dropdb --if-exists --force -U "${DB_USER}" "${VERIFY_DB}" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ Sauvegarde ${DB_NAME} vers ${BACKUP_PATH}"
docker exec "${CONTAINER}" pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --username="${DB_USER}" \
  "${DB_NAME}" >"${BACKUP_PATH}"

test -s "${BACKUP_PATH}"
chmod 0600 "${BACKUP_PATH}"

echo "→ Vérification du dump par restauration dans ${VERIFY_DB}"
docker exec "${CONTAINER}" createdb -U "${DB_USER}" "${VERIFY_DB}"
docker exec -i "${CONTAINER}" pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --username="${DB_USER}" \
  --dbname="${VERIFY_DB}" <"${BACKUP_PATH}"

SOURCE_TABLES="$(
  docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -Atc \
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
)"
RESTORED_TABLES="$(
  docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${VERIFY_DB}" -Atc \
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
)"

if [ "${SOURCE_TABLES}" != "${RESTORED_TABLES}" ]; then
  echo "❌ Vérification échouée : ${SOURCE_TABLES} tables source, ${RESTORED_TABLES} restaurées." >&2
  exit 1
fi

docker exec "${CONTAINER}" dropdb --force -U "${DB_USER}" "${VERIFY_DB}"
trap - EXIT

find "${BACKUP_DIR}" -type f -name "${DB_NAME}-*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "✅ Sauvegarde vérifiée : ${BACKUP_PATH} (${SOURCE_TABLES} tables)"
