#!/bin/bash
# Doppler-run wrapper for API
# Injects secrets via Doppler CLI, then starts the API server
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT/apps/api"
exec doppler run -- node dist/main.js
