#!/bin/bash
set -e

# ─── Sokar Test Runner ───────────────────────────────────────────────────────
# Usage: zsh scripts/test.sh [filter]
# Run API tests (vitest)

cd "$(dirname "$0")/../apps/api"
exec npx vitest run "$@"
