#!/bin/bash
set -e

# ─── Sokar Database ──────────────────────────────────────────────────────────
# Usage: zsh scripts/db.sh push    → push schema to DB
#        zsh scripts/db.sh studio  → open Prisma Studio
#        zsh scripts/db.sh seed    → seed database

cd "$(dirname "$0")/../packages/database"

case "${1:-help}" in
  push)
    echo "📦 Pushing Prisma schema..."
    npx prisma db push
    ;;
  studio)
    echo "📊 Opening Prisma Studio..."
    npx prisma studio
    ;;
  seed)
    echo "🌱 Seeding database..."
    cd "$(dirname "$0")/../apps/api"
    npx tsx seed.ts
    ;;
  *)
    echo "Usage: zsh scripts/db.sh {push|studio|seed}"
    ;;
esac
