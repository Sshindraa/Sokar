#!/bin/bash
set -e
cd /opt/sokar/apps/dashboard

# 🔴 CRITICAL: Copy static + public to standalone (Next.js 14 pitfall #29)
if [ -f scripts/copy-static.sh ]; then
    bash scripts/copy-static.sh
fi

exec node .next/standalone/apps/dashboard/server.js
