#!/bin/bash
# Doppler-run wrapper for API
# Injects secrets via Doppler CLI, then starts the API server
set -e
cd /opt/sokar/apps/api
exec doppler run -- node dist/main.js
