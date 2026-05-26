#!/bin/bash
# Doppler-run wrapper for Dashboard
# Injects secrets via Doppler CLI, then starts Next.js
set -e
cd /opt/sokar
exec doppler run -- node apps/dashboard/node_modules/next/dist/bin/next start -p 3000
