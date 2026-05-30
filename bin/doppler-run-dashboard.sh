#!/bin/bash
# Doppler-run wrapper for Dashboard
# Injects secrets via Doppler CLI, then starts Next.js from the dashboard dir
set -e
cd /opt/sokar/apps/dashboard
exec doppler run -- node node_modules/next/dist/bin/next start -p 3000
