#!/bin/bash
# Doppler-run wrapper for Dashboard
# Injects secrets via Doppler CLI, then starts Next.js from the dashboard dir
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT/apps/dashboard"
exec doppler run -- node node_modules/next/dist/bin/next start -p 3000
