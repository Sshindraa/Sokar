# Runbook — Staging

> **Statut : ACTIF — mis à jour le 23 septembre 2026.**
> La dernière preuve documentée confirme ElevenLabs et Cartesia fonctionnels en staging ; Telnyx
> reste absent et bloque un appel réel. Toujours contrôler `/health` (qui expose les dépendances)
> et les variables présentes sans afficher leur valeur avant un test voice. Voir
> [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md).

## URLs

- Dashboard: `https://staging.sokar.tech`
- API directe: `https://api-staging.sokar.tech`
- Sokar Connect: `https://staging.sokar.tech/restaurant/chez-sokar-demo`

## Infrastructure (VPS `sokar`, isolated from prod)

- Root: `/opt/sokar-staging/`
- Ports: API=4100, Dashboard=3100, Connect=4102 (prod: 4000/3000/4002)
- DB Postgres: `sokar_staging`
- Redis: db=3 (isolé de prod db=0/1/2)
- PM2: `sokar-staging-api`, `sokar-staging-dashboard`, `sokar-staging-connect`
- Nginx: `infra/nginx/sokar-staging.conf`

## Security / isolation

- Clerk staging keys (`pk_test` / `sk_test`) — **never** prod keys.
- La configuration voice est évolutive : `VOICE_DISABLED` doit refléter le but de la campagne.
  ElevenLabs et Cartesia peuvent être activés pour les tests de transcription/synthèse. Sans
  `TELNYX_API_KEY` et configuration Telnyx complète, aucun appel réel ne doit être tenté.
- Les emails sortants sont désactivés par défaut en staging (`RESEND_API_KEY` vide). Ne copiez
  pas la clé de production. Les rapports nocturnes doivent rester coupés via
  `EVENING_REPORTS_ENABLED=false`. Avant d'activer des tests email, prévoir une clé dédiée et une
  destination de test/allowlist. Un rejeu d'un ancien `evening-report` peut envoyer un rapport du
  jour courant (le scheduler ne fige pas `dayKey`) ; ne rejouez pas un rapport périmé.
- `CORS_ORIGINS` must be explicit in production.
- Stripe staging utilise exclusivement des clés et Price IDs de test.
- `X-Robots-Tag: noindex, nofollow` on all staging vhosts.

## Initial setup

- Script: `scripts/ops/setup-staging.sh` — idempotent, prepares directory, clones repo, creates `sokar_staging` DB, copies `.env.staging.example` to `.env`, installs Nginx vhost and validates config.
- Prerequisites: DNS `staging.sokar.tech` + `api-staging.sokar.tech` pointing to VPS, swap configured (`scripts/ops/setup-swap.sh` if needed).
- After setup: fill `.env` with staging keys. N'activer que les providers voice nécessaires à la
  campagne prévue, puis vérifier leur health check avant le premier déploiement.

## Manual commands

```zsh
ssh deploy@sokar
cd /opt/sokar-staging
bash scripts/deploy.sh --env staging              # full deploy
bash scripts/deploy.sh --env staging --dry-run    # simulation
bash scripts/deploy.sh --env staging rollback     # rollback
pm2 status                                   # see services
pm2 logs sokar-staging-api                   # API logs
```

## Notes

- TLS certificate: `/etc/letsencrypt/live/staging.sokar.tech/` (must cover `staging.sokar.tech` and `api-staging.sokar.tech`).
- Connect page `/restaurant/[slug]` is rendered dynamically (`force-dynamic`) in staging to avoid `DYNAMIC_SERVER_USAGE` during VPS build. In prod it stays ISR.
