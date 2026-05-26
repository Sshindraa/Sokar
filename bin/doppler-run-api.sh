#!/bin/bash
# Doppler-run wrapper for API
# Injects secrets via Doppler CLI, then starts the API server
set -e
cd /opt/sokar
exec doppler run -- node apps/api/dist/main.js
