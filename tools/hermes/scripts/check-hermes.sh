#!/usr/bin/env zsh

set -euo pipefail

REPO_ROOT="/Users/hamza/Desktop/Sokar"
HERMES_BIN_DIR="$HOME/Library/Python/3.14/bin"
export PATH="$HERMES_BIN_DIR:$PATH"

source "$REPO_ROOT/.env" 2>/dev/null || true

ok=0
fail=0

check() {
    local name="$1"
    local command="$2"
    if eval "$command" >/dev/null 2>&1; then
        echo "[OK] $name"
        ok=$((ok + 1))
    else
        echo "[MISSING] $name"
        fail=$((fail + 1))
    fi
}

check_env() {
    local name="$1"
    local value="${(P)name:-}"
    if [ -n "$value" ] && [[ "$value" != *"..."* ]] && [[ "$value" != *"ici"* ]]; then
        echo "[OK] $name"
        ok=$((ok + 1))
    else
        echo "[MISSING] $name"
        fail=$((fail + 1))
    fi
}

echo "=== Hermes Agent Sokar — Healthcheck ==="
echo ""

check "hermes CLI" "command -v hermes"
check "Docker daemon" "docker info"
check "Repo root" "test -d '$REPO_ROOT/tools/hermes'"

echo ""
echo "=== Variables ==="
check_env "DATABASE_URL"
check_env "WINDSURF_TOKEN"
check_env "GITHUB_TOKEN"

if [ -n "${OPENROUTER_API_KEY:-}" ] || [ -n "${CROF_API_KEY:-}" ]; then
  echo "[OK] LLM provider key"
  ok=$((ok + 1))
else
    echo "[MISSING] LLM provider key: OPENROUTER_API_KEY or CROF_API_KEY"
    fail=$((fail + 1))
fi

echo ""
echo "=== Résumé ==="
echo "[OK] $ok"
echo "[MISSING] $fail"

if [ "$fail" -gt 0 ]; then
    exit 1
fi
