#!/bin/bash
# Sokar Deploy — avec injection Doppler
# Usage: bash scripts/deploy.sh [stg|prd]
set -euo pipefail
cd /opt/sokar

CONFIG="${1:-prd}"

# Token Doppler pour cet environnement
case "$CONFIG" in
  stg) TOKEN="dp.st.stg.1zjgQmOCN1ocitLHvdEd5h77Cy5NzHR7zKVD52fog3a" ;;
  prd) TOKEN="dp.st.prd.bJU83Bz0ENuyCyROo9EPvup6p6Nbq8CXGNwYbwGZ90Y" ;;
  *) echo "Usage: $0 [stg|prd]" && exit 1 ;;
esac

echo "🚀 Déploiement $CONFIG — Sokar"

# 1. Pull latest
echo "📦 Git pull..."
git pull origin main

# 2. Install
echo "📦 pnpm install..."
pnpm install --frozen-lockfile

# 3. Prisma generate
echo "🗄️  Prisma generate..."
pnpm --filter @sokar/database generate

# 4. Build
echo "🔨 Build..."
pnpm build

# 4.1 Copy public and static assets for Next.js standalone
echo "📦 Copying public & static folders for Next.js standalone..."
cp -r apps/dashboard/public apps/dashboard/.next/standalone/apps/dashboard/
mkdir -p apps/dashboard/.next/standalone/apps/dashboard/.next
cp -r apps/dashboard/.next/static apps/dashboard/.next/standalone/apps/dashboard/.next/

# 5. Migrations
echo "🗄️  Migrations..."
pnpm --filter @sokar/database prisma migrate deploy

# 6. Config token Doppler scoped (one-time setup, idempotent)
echo "🔑 Config token Doppler..."
doppler configure set token "$TOKEN" --scope /opt/sokar 2>/dev/null || true

# 7. Restart — les wrapper scripts bin/doppler-run-*.sh gèrent l'injection
echo "🔄 Restart apps..."
pm2 restart sokar-api --update-env
pm2 restart sokar-dashboard --update-env

echo "✅ $CONFIG déployé"
