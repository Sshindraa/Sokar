#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/opt/node@22/bin:$PATH"

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  DIFF_RANGE=(--cached)
else
  DIFF_RANGE=(--cached)
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR || true)
if [ -z "$STAGED_FILES" ]; then
  echo "precommit-review: no staged files"
  exit 0
fi

echo "precommit-review: staged files"
echo "$STAGED_FILES" | sed 's/^/  - /'

fail() {
  echo "\nprecommit-review: FAIL — $1" >&2
  exit 1
}

# 1) Secret / dangerous-code scan on added lines only.
ADDED=$(git diff --cached --unified=0 -- . ':(exclude)pnpm-lock.yaml' || true)

SECRET_HITS=$(printf '%s\n' "$ADDED" | grep '^+' | grep -v '^+++' | grep -Ei "(api[_-]?key|secret|password|passwd|token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['\"][^'\"]{8,}['\"]" || true)
[ -z "$SECRET_HITS" ] || { echo "$SECRET_HITS"; fail "possible hardcoded secret in staged diff"; }

CODE_ADDED=$(git diff --cached --unified=0 -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' ':(exclude)scripts/smoke/*' ':(exclude)scripts/precommit-review.sh' || true)

DANGEROUS_HITS=$(printf '%s\n' "$CODE_ADDED" | grep '^+' | grep -v '^+++' | grep -E "\beval\(|\bFunction\(|child_process\.(exec|execSync)\(|shell:\s*true|innerHTML\s*=" || true)
[ -z "$DANGEROUS_HITS" ] || { echo "$DANGEROUS_HITS"; fail "dangerous construct found in staged code diff"; }

# Autorise console.log si précédé de "// eslint-disable-next-line no-console"
# (marqueur explicite = intentionnel, pas du debug oublié).
CONSOLE_HITS=$(printf '%s\n' "$CODE_ADDED" | awk '
/no-console/ { skip_next=1; next }
/^\+.*console\.(log|debug)\(/ {
  if (skip_next) { skip_next=0; next }
  print
}
{ skip_next=0 }
' || true)
[ -z "$CONSOLE_HITS" ] || { echo "$CONSOLE_HITS"; fail "debug console.log/debug left in staged code diff (use // eslint-disable-next-line no-console to allow intentional logging)"; }

# 2) UI token discipline: no arbitrary hex Tailwind classes in dashboard code.
UI_HITS=$(git diff --cached -- apps/dashboard ':(exclude)**/*.md' | grep '^+' | grep -v '^+++' | grep -E "(bg|text|border|from|to|via)-\[#[0-9A-Fa-f]{3,8}\]" || true)
[ -z "$UI_HITS" ] || { echo "$UI_HITS"; fail "dashboard must use design tokens, not arbitrary hex Tailwind classes"; }

# 3) Formatting on staged files — un seul appel prettier au lieu de lint-staged.
FORMAT_FILES=()
while IFS= read -r -d '' file; do
  case "$file" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.md | *.json | *.yml | *.yaml)
      FORMAT_FILES+=("$file")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

if [ "${#FORMAT_FILES[@]}" -gt 0 ]; then
  pnpm exec prettier --write -- "${FORMAT_FILES[@]}"
fi

# Re-stage files rewritten by lint-staged.
git diff --cached --name-only --diff-filter=ACMR -z | xargs -0 git add -- 2>/dev/null || true

echo "precommit-review: PASS"
