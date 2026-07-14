#!/bin/bash
# Lightweight structured logging helpers for Sokar deploy/ops scripts.
# Sourced by deploy-vps.sh, deploy-staging.sh, db-backup.sh, etc.
#
# Usage:
#   source "$(dirname "$0")/ops/logging.sh"
#   log info "Starting deploy"
#   log warn "Swap not configured"
#   log error "Build failed" && exit 1

log() {
  local level="${1:-info}"
  local message="${2:-}"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  # Ensure valid level
  case "$level" in
    debug|info|warn|error) ;;
    *)
      message="$level ${message}"
      level="info"
      ;;
  esac
  # Uppercase level, pad to 5 chars
  local level_upper
  level_upper=$(printf '%-5s' "$(echo "$level" | tr 'a-z' 'A-Z')")
  if [ "$level" = "error" ]; then
    echo "${timestamp} [${level_upper}] ${message}" >&2
  else
    echo "${timestamp} [${level_upper}] ${message}"
  fi
}

log_section() {
  local title="${1:-}"
  log info ""
  log info "=== ${title} ==="
}

log_ok() {
  log info "✅ ${1:-}"
}

log_warn() {
  log warn "⚠️  ${1:-}"
}

log_error() {
  log error "❌ ${1:-}"
}
