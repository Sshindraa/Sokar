---
name: smoke-test
description: Run post-deploy smoke checks for Sokar (PM2, health endpoints, public URLs, logs).
agent: smoke-tester
---

Run the post-deploy smoke checks for Sokar.

Connect to the VPS `pmbtc` via `ssh deploy@pmbtc` and verify:

1. `pm2 status` for all processes (prod and staging).
2. API health endpoints `/health` and `/livez` on `127.0.0.1:4000`.
3. Dashboard on `127.0.0.1:3000` and Connect on `127.0.0.1:4002/restaurant/chez-sokar-demo`.
4. Public endpoints through Nginx with `Host` headers: `api.sokar.tech/health`, `sokar.tech/`, `sokar.tech/restaurant/chez-sokar-demo`.
5. Recent logs for critical errors.

Do not modify any file or service.
Produce a structured report with the status of each check and a final PASS/FAIL verdict.
