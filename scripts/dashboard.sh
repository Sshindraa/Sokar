#!/bin/bash
set -e
cd /Users/hamza/Desktop/Sokar/apps/dashboard
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_..."
export CLERK_SECRET_KEY="sk_..."
export NEXT_PUBLIC_CLERK_SIGN_IN_URL="/login"
export NEXT_PUBLIC_CLERK_SIGN_UP_URL="/register"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/dashboard"
npx next dev -p 3000
