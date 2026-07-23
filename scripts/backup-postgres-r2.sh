#!/usr/bin/env bash
# Compatibility shim for the existing VPS cron entry.
# New installations use scripts/database/backup-postgres-r2.sh directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/database" && pwd)"
exec "$SCRIPT_DIR/backup-postgres-r2.sh" "$@"
