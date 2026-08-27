#!/usr/bin/env bash
set -Eeuo pipefail

# Teste les opérations de release qui ne nécessitent ni VPS ni PM2 réel.
# Usage : bash scripts/ops/test-deploy-common.sh

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d /tmp/sokar-deploy-test.XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

SOKAR_ROOT="$TMP_ROOT"
DEPLOY_ENV="staging"
source "$ROOT/scripts/ops/logging.sh"
source "$ROOT/scripts/ops/deploy-common.sh"

mkdir -p \
  "$TMP_ROOT/apps/dashboard/.next/standalone/apps/dashboard" \
  "$TMP_ROOT/apps/connect/.next/standalone/apps/connect" \
  "$TMP_ROOT/apps/dashboard/.next-deploy-fixture-dashboard/standalone/apps/dashboard" \
  "$TMP_ROOT/apps/connect/.next-deploy-fixture-connect/standalone/apps/connect"

printf 'dashboard-tsconfig\n' > "$TMP_ROOT/apps/dashboard/tsconfig.json"
printf 'dashboard-next-env\n' > "$TMP_ROOT/apps/dashboard/next-env.d.ts"

printf 'old-dashboard\n' > "$TMP_ROOT/apps/dashboard/.next/standalone/apps/dashboard/server.js"
printf 'old-connect\n' > "$TMP_ROOT/apps/connect/.next/standalone/apps/connect/server.js"
printf 'new-dashboard\n' > "$TMP_ROOT/apps/dashboard/.next-deploy-fixture-dashboard/standalone/apps/dashboard/server.js"
printf 'new-connect\n' > "$TMP_ROOT/apps/connect/.next-deploy-fixture-connect/standalone/apps/connect/server.js"

NEXT_DIST_DIR_DASHBOARD=".next-deploy-fixture-dashboard"
NEXT_DIST_DIR_CONNECT=".next-deploy-fixture-connect"

backup_next_build_configs
printf 'generated-dashboard-tsconfig\n' > "$TMP_ROOT/apps/dashboard/tsconfig.json"
printf 'generated-dashboard-next-env\n' > "$TMP_ROOT/apps/dashboard/next-env.d.ts"
printf 'generated-connect-next-env\n' > "$TMP_ROOT/apps/connect/next-env.d.ts"
restore_next_build_configs
test "$(cat "$TMP_ROOT/apps/dashboard/tsconfig.json")" = 'dashboard-tsconfig'
test "$(cat "$TMP_ROOT/apps/dashboard/next-env.d.ts")" = 'dashboard-next-env'
test ! -e "$TMP_ROOT/apps/connect/next-env.d.ts"

activate_next_builds
test -L "$TMP_ROOT/apps/dashboard/.next"
test "$(readlink "$TMP_ROOT/apps/dashboard/.next")" = "$NEXT_DIST_DIR_DASHBOARD"
test -L "$TMP_ROOT/apps/connect/.next"
test "$(readlink "$TMP_ROOT/apps/connect/.next")" = "$NEXT_DIST_DIR_CONNECT"
test "$(cat "$TMP_ROOT/apps/dashboard/.next/standalone/apps/dashboard/server.js")" = 'new-dashboard'
test "$(cat "$TMP_ROOT/apps/connect/.next/standalone/apps/connect/server.js")" = 'new-connect'
test -d "$NEXT_PREVIOUS_DIR_DASHBOARD"
test -d "$NEXT_PREVIOUS_DIR_CONNECT"
snapshot_artifacts "$TMP_ROOT/release" test "apps/dashboard/.next" "apps/connect/.next"
test -d "$TMP_ROOT/release/apps/dashboard/.next/standalone/apps/dashboard"
test -d "$TMP_ROOT/release/apps/connect/.next/standalone/apps/connect"

mkdir -p \
  "$TMP_ROOT/apps/dashboard/.next-deploy-fixture2-dashboard/standalone/apps/dashboard" \
  "$TMP_ROOT/apps/connect/.next-deploy-fixture2-connect/standalone/apps/connect"
printf 'newer-dashboard\n' > "$TMP_ROOT/apps/dashboard/.next-deploy-fixture2-dashboard/standalone/apps/dashboard/server.js"
printf 'newer-connect\n' > "$TMP_ROOT/apps/connect/.next-deploy-fixture2-connect/standalone/apps/connect/server.js"
NEXT_DIST_DIR_DASHBOARD=".next-deploy-fixture2-dashboard"
NEXT_DIST_DIR_CONNECT=".next-deploy-fixture2-connect"
activate_next_builds
test -L "$TMP_ROOT/apps/dashboard/.next"
test "$(cat "$TMP_ROOT/apps/dashboard/.next/standalone/apps/dashboard/server.js")" = 'newer-dashboard'
test "$(cat "$TMP_ROOT/apps/connect/.next/standalone/apps/connect/server.js")" = 'newer-connect'
test "$(cat "$NEXT_PREVIOUS_DIR_DASHBOARD/standalone/apps/dashboard/server.js")" = 'new-dashboard'
test "$(cat "$NEXT_PREVIOUS_DIR_CONNECT/standalone/apps/connect/server.js")" = 'new-connect'
restore_activated_next_builds
test "$(cat "$TMP_ROOT/apps/dashboard/.next/standalone/apps/dashboard/server.js")" = 'new-dashboard'
test "$(cat "$TMP_ROOT/apps/connect/.next/standalone/apps/connect/server.js")" = 'new-connect'

echo 'deploy-common release activation/rollback: OK'
