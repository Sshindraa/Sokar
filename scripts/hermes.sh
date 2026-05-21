#!/bin/bash
set -e

# ─── Sokar Hermes Agent ──────────────────────────────────────────────────────
# Usage: zsh scripts/hermes.sh "your task"
# Wrapper pour lancer Hermes CLI depuis le projet

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v hermes &>/dev/null; then
  echo "❌ Hermes CLI not found. Install it first:"
  echo "   curl -fsSL https://hermes-agent.ai/install.sh | sh"
  exit 1
fi

cd "$REPO_ROOT"
exec hermes "$@"
