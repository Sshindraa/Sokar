# Runbook — Staging

## URLs

- Dashboard: `https://staging.sokar.tech`
- API directe: `https://api-staging.sokar.tech`
- Sokar Connect: `https://staging.sokar.tech/restaurant/chez-sokar-demo`

## Infrastructure (VPS `pmbtc`, isolated from prod)

- Root: `/opt/sokar-staging/`
- Ports: API=4100, Dashboard=3100, Connect=4102 (prod: 4000/3000/4002)
- DB Postgres: `sokar_staging`
- Redis: db=2
- PM2: `sokar-staging-api`, `sokar-staging-dashboard`, `sokar-staging-connect`
- Nginx: `infra/nginx/sokar-staging.conf`

## Security / isolation

- Clerk staging keys (`pk_test` / `sk_test`) — **never** prod keys.
- Voice disabled: `VOICE_DISABLED=true` is required. `TELNYX_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` are empty → no outbound calls, Telnyx webhooks get 403.
- `CORS_ORIGINS` must be explicit in production.
- Stripe public key is prod, secret empty unless `sk_test_*` is provided.
- `X-Robots-Tag: noindex, nofollow` on all staging vhosts.

## Initial setup

- Script: `scripts/ops/setup-staging.sh` — idempotent, prepares directory, clones repo, creates `sokar_staging` DB, copies `.env.staging.example` to `.env`, installs Nginx vhost and validates config.
- Prerequisites: DNS `staging.sokar.tech` + `api-staging.sokar.tech` pointing to VPS, swap configured (`scripts/ops/setup-swap.sh` if needed).
- After setup: fill `.env` with staging keys (Clerk test, Stripe test, no voice keys), then run the first manual deploy.

## Manual commands

```zsh
ssh deploy@pmbtc
cd /opt/sokar-staging
bash scripts/deploy-staging.sh              # full deploy
bash scripts/deploy-staging.sh --dry-run    # simulation
bash scripts/deploy-staging.sh rollback     # rollback
pm2 status                                   # see services
pm2 logs sokar-staging-api                   # API logs
```

## Notes

- TLS certificate: `/etc/letsencrypt/live/staging.sokar.tech/` (must cover `staging.sokar.tech` and `api-staging.sokar.tech`).
- Connect page `/restaurant/[slug]` is rendered dynamically (`force-dynamic`) in staging to avoid `DYNAMIC_SERVER_USAGE` during VPS build. In prod it stays ISR.
