#!/bin/zsh
# Callyx Auto-Commit Daemon
# S'exécute via cron toutes les 15 minutes
# Commit + push automatiquement si des fichiers ont changé

set -e

REPO="/Users/hamza/Desktop/Callyx"
LOG="$REPO/.git/auto-commit.log"

cd "$REPO"

# Vérifie s'il y a des changements (staged ou unstaged)
if git diff --quiet && git diff --cached --quiet; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Rien à commiter" >> "$LOG"
  exit 0
fi

# Détecte le scope et le type des changements
SCOPE="general"
TYPE="chore"
FILES_CHANGED=$(git diff --name-only; git diff --cached --name-only)

if echo "$FILES_CHANGED" | grep -q "apps/api"; then SCOPE="api"; TYPE="feat"; fi
if echo "$FILES_CHANGED" | grep -q "apps/dashboard"; then SCOPE="dashboard"; TYPE="feat"; fi
if echo "$FILES_CHANGED" | grep -q "packages/database"; then SCOPE="database"; TYPE="feat"; fi
if echo "$FILES_CHANGED" | grep -q "agent/"; then SCOPE="agent"; TYPE="feat"; fi
if echo "$FILES_CHANGED" | grep -q "docs/"; then SCOPE="docs"; TYPE="docs"; fi
if echo "$FILES_CHANGED" | grep -q "test"; then TYPE="test"; fi
if echo "$FILES_CHANGED" | grep -q "fix\|bug"; then TYPE="fix"; fi

# Compte les fichiers
COUNT=$(echo "$FILES_CHANGED" | sort -u | wc -l | tr -d ' ')
MSG="${TYPE}(${SCOPE}): auto-commit $(date '+%H:%M') — ${COUNT} fichier(s) modifié(s)"

# Stage, commit, push
git add -A
git commit -m "$MSG" || { echo "$(date) — Commit échoué" >> "$LOG"; exit 1; }
git push origin main >> "$LOG" 2>&1 || { echo "$(date) — Push échoué" >> "$LOG"; exit 1; }

echo "$(date '+%Y-%m-%d %H:%M:%S') — ✅ $MSG" >> "$LOG"
