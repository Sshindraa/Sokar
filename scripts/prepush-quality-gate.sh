#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

export PATH="/usr/local/opt/node@22/bin:$PATH"
export TURBO_TELEMETRY_DISABLED=1
export NEXT_TELEMETRY_DISABLED=1

# Garde-fou : alerte si le système est sous pression mémoire avant le push.
# git pack-objects peut planter avec SIGBUS (signal 10) si le swap est saturé,
# même avec pack.threads=1. On warn, on ne fail pas (le fix est déjà en place
# via git config --global pack.threads 1).
if [ -x "$ROOT/scripts/check-memory.sh" ]; then
  bash "$ROOT/scripts/check-memory.sh" warn || true
fi

BASE_REF="${SOKAR_BASE_REF:-origin/main}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi

CHANGED=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD 2>/dev/null || true)
UNCOMMITTED=$(git diff --name-only --diff-filter=ACMR || true)
ALL_CHANGED=$(printf '%s\n%s\n' "$CHANGED" "$UNCOMMITTED" | sed '/^$/d' | sort -u)

if [ -z "$ALL_CHANGED" ]; then
  echo "prepush-quality-gate: no changed files detected; running node check only"
  pnpm node:check
  exit 0
fi

echo "prepush-quality-gate: changed files vs $BASE_REF"
echo "$ALL_CHANGED" | sed 's/^/  - /'

pnpm node:check

run_api=false
run_dashboard=false
run_packages=false
run_all=false

if printf '%s\n' "$ALL_CHANGED" | grep -Eq '^(package.json|pnpm-lock.yaml|turbo.json|tsconfig.json|\.github/workflows/)'; then
  run_all=true
fi
if printf '%s\n' "$ALL_CHANGED" | grep -Eq '^(apps/api|packages/database|packages/config|packages/types|packages/shared)/'; then
  run_api=true
fi
if printf '%s\n' "$ALL_CHANGED" | grep -Eq '^(apps/dashboard|packages/config|packages/types|packages/shared)/'; then
  run_dashboard=true
fi
if printf '%s\n' "$ALL_CHANGED" | grep -Eq '^packages/'; then
  run_packages=true
fi

if [ "$run_all" = true ]; then
  pnpm turbo typecheck
  pnpm turbo test
  pnpm lint
  exit 0
fi

if [ "$run_packages" = true ]; then
  pnpm turbo typecheck --filter=@sokar/config --filter=@sokar/database --filter=@sokar/shared
  pnpm turbo test --filter=@sokar/config --filter=@sokar/database --filter=@sokar/shared
fi

if [ "$run_api" = true ]; then
  # Un seul appel turbo pour typecheck + lint + test (économise 2 startups pnpm)
  pnpm turbo run typecheck lint --filter=@sokar/api...

  # On skip les tests voice si aucun fichier voice n'a changé
  # (119 tests voice, isolation pour gagner du temps prepush)
  if printf '%s\n' "$ALL_CHANGED" | grep -Eq '^apps/api/src/modules/voice/'; then
    pnpm turbo test --filter=@sokar/api...
  else
    echo "prepush-quality-gate: voice tests unchanged, running API tests without voice..."
    pnpm turbo test --filter=@sokar/api -- --exclude '**/voice/**'
  fi
fi

if [ "$run_dashboard" = true ]; then
  pnpm turbo typecheck --filter=@sokar/dashboard...
  pnpm --filter @sokar/dashboard lint
  pnpm turbo test --filter=@sokar/dashboard...
fi

echo "prepush-quality-gate: PASS"
