#!/bin/bash
# Sokar Deploy — avec injection Doppler
# Usage: bash scripts/deploy.sh [stg|prd]
set -euo pipefail
cd /opt/sokar

CONFIG="${1:-prd}"

# Token Doppler pour cet environnement (injecté via variable d'environnement)
case "$CONFIG" in
  stg)
    TOKEN="${DOPPLER_TOKEN_STG:-}"
    if [[ -z "$TOKEN" ]]; then
      echo "❌ Erreur: DOPPLER_TOKEN_STG n'est pas défini. Exportez-la avant de lancer le déploiement." >&2
      exit 1
    fi
    ;;
  prd)
    TOKEN="${DOPPLER_TOKEN_PRD:-}"
    if [[ -z "$TOKEN" ]]; then
      echo "❌ Erreur: DOPPLER_TOKEN_PRD n'est pas défini. Exportez-la avant de lancer le déploiement." >&2
      exit 1
    fi
    ;;
  *) echo "Usage: $0 [stg|prd]" && exit 1 ;;
esac

echo "🚀 Déploiement $CONFIG — Sokar"

# 1. Pull latest
echo "📦 Git pull..."
git pull origin main

# 1.1 Copy env files to package directories
echo "🔑 Copying env files..."
cp /opt/sokar/.env /opt/sokar/apps/api/.env
cp /opt/sokar/.env /opt/sokar/apps/dashboard/.env

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
# Copy to sub-app folder (just in case)
cp -r apps/dashboard/public apps/dashboard/.next/standalone/apps/dashboard/
mkdir -p apps/dashboard/.next/standalone/apps/dashboard/.next
cp -r apps/dashboard/.next/static apps/dashboard/.next/standalone/apps/dashboard/.next/

# Copy to root of standalone directory (required by Next.js standalone runner)
cp -r apps/dashboard/public apps/dashboard/.next/standalone/
mkdir -p apps/dashboard/.next/standalone/.next
cp -r apps/dashboard/.next/static apps/dashboard/.next/standalone/.next/

# 5. Migrations
echo "🗄️  Migrations..."
pnpm --filter @sokar/database prisma migrate deploy

# 6. Config token Doppler scoped (one-time setup, idempotent)
echo "🔑 Config token Doppler..."
doppler configure set token "$TOKEN" --scope /opt/sokar 2>/dev/null || true

# 7. Restart — les wrapper scripts bin/doppler-run-*.sh gèrent l'injection
echo "🔄 Restart apps..."
sudo pm2 restart sokar-api --update-env
sudo pm2 restart sokar-dashboard --update-env

echo "✅ $CONFIG déployé"
