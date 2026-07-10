# Runbook — Deployment

## Policy

- **Staging:** deploys automatically after a green CI and its smoke tests.
- **Production:** requires explicit confirmation before execution. Any DB migration, payment, auth, voice, or critical config change must be flagged.
- Application rollback does not restore the database. See `docs/runbooks/rollback.md`.

## Staging deployment

- CI/CD: `.github/workflows/deploy-staging.yml` triggered on `main` push.
- GitHub secrets: `STAGING_SSH_KEY`, `STAGING_HOST`, `STAGING_USER`.
- Script on VPS: `scripts/deploy-staging.sh`.
- Dry-run: `bash scripts/deploy-staging.sh --dry-run`.
- From Mac:
  ```zsh
  ssh deploy@pmbtc "cd /opt/sokar-staging && git pull origin main && bash scripts/deploy-staging.sh"
  ```

## Production deployment

- Script: `scripts/deploy-vps.sh`.
- From Mac:
  ```zsh
  ssh deploy@pmbtc "cd /opt/sokar && git pull origin main && bash scripts/deploy-vps.sh --confirm-production"
  ```
- Rollback:
  ```zsh
  ssh deploy@pmbtc "cd /opt/sokar && bash scripts/deploy-vps.sh --confirm-production rollback"
  ```
- Privileged wrapper: `/usr/local/sbin/sokar-deploy-root`.
- The `deploy` account is **not** in `sudo` or `docker` groups.

## Smoke tests

- `curl /health` and `/livez` on `api-staging.sokar.tech` → 200.
- `curl /dashboard` → 200 or 302 (Clerk redirect).
- `curl /` and `/restaurant/chez-sokar-demo` → 200.
- Playwright E2E functional tests (best-effort, non-blocking).

## Post-deploy notes (production)

- `deploy-vps.sh` incremental clean only cleans `apps/{dashboard,connect}/.next/standalone` for apps that are actually rebuilt.
- If `apps/<app>/.next/standalone/apps/<app>/server.js` is missing, the script forces a rebuild of that app.
- `deploy-staging.sh` does not do incremental build; it rebuilds dashboard and connect every time.
