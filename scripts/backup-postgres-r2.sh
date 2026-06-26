#!/usr/bin/env bash
# Backup PostgreSQL vers Cloudflare R2 (offsite) avec garde-fou de quota.
#
# Free tier R2 : 10GB/mois stockage + 0 egress.
# Ce script s'arrête si le bucket dépasse QUOTA_LIMIT (défaut 5GB = 50% du free).
#
# Usage: bash scripts/backup-postgres-r2.sh
# Cron: 0 4 * * * (4h après le dump local à 3h20)
#
# Requiert: docker, rclone
# Variables d'env:
#   R2_BUCKET        — nom du bucket (défaut: sokar-backups)
#   R2_PATH          — préfixe (défaut: postgres)
#   RETENTION_DAYS   — jours de rétention (défaut: 30)
#   QUOTA_LIMIT_GB   — limite dure en GB (défaut: 5)
#   POSTGRES_CONTAINER — nom du conteneur (défaut: infra-postgres-1)
#   ALERT_CMD        — commande d'alerte optionnelle (ex: mail, webhook)

set -euo pipefail

# Forcer rclone dans le PATH (install user, pas /usr/bin)
export PATH="$HOME/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CONTAINER="${POSTGRES_CONTAINER:-infra-postgres-1}"
DB_NAME="${POSTGRES_DB:-sokar}"
DB_USER="${POSTGRES_USER:-sokar}"
BUCKET="${R2_BUCKET:-sokar-backups}"
PREFIX="${R2_PATH:-postgres}"
RETENTION="${RETENTION_DAYS:-30}"
QUOTA_GB="${QUOTA_LIMIT_GB:-5}"
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DUMP_PATH="/tmp/${DB_NAME}-${TIMESTAMP}.dump"
LOG_PATH="${LOG_PATH:-/var/log/sokar/postgres-r2-backup.log}"
ALERT="${ALERT_CMD:-true}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_PATH" >&2; }
alert() { $ALERT "$@"; }

# ── Garde-fou de quota ────────────────────────────────────
log "→ Vérification quota (limite: ${QUOTA_GB}GB)"
BUCKET_BYTES=$(rclone size "r2:${BUCKET}/" --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('bytes',0))" 2>/dev/null || echo 0)
BUCKET_GB=$(python3 -c "print(f'{$BUCKET_BYTES/1024**3:.3f}')")
LIMIT_BYTES=$(python3 -c "print(int($QUOTA_GB * 1024**3))")

if [ "$BUCKET_BYTES" -gt "$LIMIT_BYTES" ]; then
    log "❌ QUOTA DÉPASSÉ: ${BUCKET_GB}GB > ${QUOTA_GB}GB"
    log "   Réduisez RETENTION_DAYS ou augmentez QUOTA_LIMIT_GB manuellement"
    alert "R2 backup ABORTED: bucket ${BUCKET} at ${BUCKET_GB}GB exceeds ${QUOTA_GB}GB limit"
    exit 1
fi
log "✓ Quota OK: ${BUCKET_GB}GB / ${QUOTA_GB}GB"

# ── Dump ───────────────────────────────────────────────────
log "→ Dump PostgreSQL ${DB_NAME}@${CONTAINER}"
docker exec "$CONTAINER" pg_dump \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-acl \
    --username="$DB_USER" \
    "$DB_NAME" > "$DUMP_PATH"

chmod 0600 "$DUMP_PATH"
SIZE=$(stat -c%s "$DUMP_PATH" 2>/dev/null || stat -f%z "$DUMP_PATH")
log "✓ Dump créé: $DUMP_PATH ($SIZE octets)"

# ── Upload ─────────────────────────────────────────────────
log "→ Upload vers R2: r2:${BUCKET}/${PREFIX}/${TIMESTAMP}.dump"
rclone copyto "$DUMP_PATH" "r2:${BUCKET}/${PREFIX}/${TIMESTAMP}.dump"

# ── Vérification d'intégrité ───────────────────────────────
log "→ Vérification d'intégrité"
# Hash local avant upload
LOCAL_HASH=$(sha256sum "$DUMP_PATH" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$DUMP_PATH" | cut -d' ' -f1)
log "  hash local: $LOCAL_HASH"

# Hash distant après download via rclone cat
TMP_CHECK="/tmp/r2-check-${TIMESTAMP}.dump"
rm -f "$TMP_CHECK"
rclone cat "r2:${BUCKET}/${PREFIX}/${TIMESTAMP}.dump" > "$TMP_CHECK" 2>>"$LOG_PATH"
if [ ! -s "$TMP_CHECK" ]; then
    log "❌ Téléchargement échoué (fichier vide ou absent)"
    exit 1
fi

REMOTE_HASH=$(sha256sum "$TMP_CHECK" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$TMP_CHECK" | cut -d' ' -f1)
log "  hash distant: $REMOTE_HASH"

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    log "❌ Intégrité compromise: hash local ≠ hash distant"
    rm -f "$TMP_CHECK"
    exit 1
fi

# Bonus: si pg_restore est dispo sur l'hôte, on valide la structure
if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$TMP_CHECK" >/dev/null
    log "  structure pg_dump validée (pg_restore --list)"
fi
rm -f "$TMP_CHECK"
log "✓ Intégrité vérifiée (SHA256 match)"

# ── Rotation (libère de l'espace, garde le quota bas) ─────
log "→ Rotation (rétention ${RETENTION} jours)"
rclone delete "r2:${BUCKET}/${PREFIX}/" \
    --min-age "${RETENTION}d" \
    --use-json-log 2>/dev/null || true
log "✓ Rotation terminée"

# ── Cleanup local ──────────────────────────────────────────
rm -f "$DUMP_PATH"

# ── Recheck quota post-rotation ────────────────────────────
NEW_BYTES=$(rclone size "r2:${BUCKET}/" --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('bytes',0))" 2>/dev/null || echo 0)
NEW_GB=$(python3 -c "print(f'{$NEW_BYTES/1024**3:.3f}')")
log "✅ Backup offsite ${DB_NAME} terminé — bucket: ${NEW_GB}GB"
