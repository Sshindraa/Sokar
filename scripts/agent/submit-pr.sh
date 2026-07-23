#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE_BRANCH="${PR_BASE:-main}"
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"

if [ -z "$CURRENT_BRANCH" ]; then
  echo "submit-pr: HEAD detached; checkout a working branch first" >&2
  exit 2
fi

if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  echo "submit-pr: refusing to submit the protected branch $BASE_BRANCH" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "submit-pr: GitHub CLI (gh) is required" >&2
  exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "submit-pr: authenticate with gh auth login first" >&2
  exit 2
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "submit-pr: working tree is not clean; commit changes before submitting" >&2
  exit 2
fi

echo "→ Pushing $CURRENT_BRANCH"
git push --set-upstream origin "$CURRENT_BRANCH"

PR_NUMBER="$(gh pr list --base "$BASE_BRANCH" --head "$CURRENT_BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -z "$PR_NUMBER" ]; then
  echo "→ Creating pull request"
  gh pr create --base "$BASE_BRANCH" --head "$CURRENT_BRANCH" --fill >/dev/null
  PR_NUMBER="$(gh pr view "$CURRENT_BRANCH" --json number --jq '.number')"
else
  echo "→ Reusing open pull request #$PR_NUMBER"
fi

echo "→ Enabling squash auto-merge for pull request #$PR_NUMBER"
gh pr merge "$PR_NUMBER" --auto --squash
gh pr view "$PR_NUMBER" --json url,mergeStateStatus --jq '"PR: " + .url + " (" + .mergeStateStatus + ")"'
