#!/bin/bash
set -e

# ─── Sokar Dev Environment ───────────────────────────────────────────────────
# Usage: zsh scripts/dev.sh
# Démarre l'API (port 4000) et le Dashboard (port 3000)

echo "🚀 Starting Sokar dev environment..."

# Export Clerk env vars for Next.js Edge Runtime
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_c2hpbmluZy1raXR0ZW4tOTIuY2xlcmsuYWNjb3VudHMuZGV2JA"
export CLERK_SECRET_KEY="sk_test_9Bpi18Yx05eSobby8dQ3MhtSLzja2ZEpx2IiMGBG5H"
export NEXT_PUBLIC_CLERK_SIGN_IN_URL="/login"
export NEXT_PUBLIC_CLERK_SIGN_UP_URL="/register"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/dashboard"

# Kill any existing processes
lsof -ti :4000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true

# Start API
cd "$(dirname "$0")/../apps/api"
npx tsx src/main.ts &
API_PID=$!

# Start Dashboard
cd "$(dirname "$0")/../apps/dashboard"
npx next dev -p 3000 &
DASH_PID=$!

echo "📡 API (PID $API_PID)      → http://localhost:4000"
echo "🖥  Dashboard (PID $DASH_PID) → http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all"

trap "kill $API_PID $DASH_PID 2>/dev/null; exit" INT TERM
wait
