#!/bin/bash
set -e
cd /Users/hamza/Desktop/Sokar/apps/dashboard
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_c2hpbmluZy1raXR0ZW4tOTIuY2xlcmsuYWNjb3VudHMuZGV2JA"
export CLERK_SECRET_KEY="sk_test_9Bpi18Yx05eSobby8dQ3MhtSLzja2ZEpx2IiMGBG5H"
export NEXT_PUBLIC_CLERK_SIGN_IN_URL="/login"
export NEXT_PUBLIC_CLERK_SIGN_UP_URL="/register"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
export NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/dashboard"
npx next dev -p 3000
