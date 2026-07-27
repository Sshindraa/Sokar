# Runbook — Deployment

## Policy

- **Staging:** deploys automatically after a green CI and its smoke tests.
- **Production:** deploys automatically once CI and staging are green (`.github/workflows/deploy-prod.yml` triggered on `Deploy Staging` success). The release snapshot, health checks and rollback path remain mandatory; DB migration, payment, auth, voice and critical configuration changes are flagged in the deployment report.
- Application rollback does not restore the database. See `docs/runbooks/rollback.md`.

## Unified deploy script

All deployments use `scripts/deploy.sh --env prod|staging`. The shared logic lives in `scripts/ops/deploy-common.sh` (sourced by `deploy.sh`).

## Staging deployment

- CI/CD: `.github/workflows/deploy-staging.yml` triggered on `main` push (after CI green).
- GitHub secrets: `STAGING_SSH_KEY`, `STAGING_HOST`, `STAGING_USER`.
- Script on VPS: `scripts/deploy.sh --env staging`.
- Dry-run (staging only): `bash scripts/deploy.sh --env staging --dry-run`.
- From Mac:
  ```zsh
  # Staging (automatique via CI)
  ssh deploy@sokar "cd /opt/sokar-staging && git pull origin main && bash scripts/deploy.sh --env staging"
  ```

## Production deployment

- CI/CD: `.github/workflows/deploy-prod.yml` triggered on `Deploy Staging` workflow success (branch `main`).
- GitHub secrets: `PROD_SSH_KEY`, `PROD_HOST`, `PROD_USER` (or reuse `STAGING_*` if same VPS).
- Script on VPS: `scripts/deploy.sh --env prod --confirm-production`.
- From Mac:
  ```zsh
  # Production (automatique via CI après staging green)
  # Manuel (fallback) :
  ssh deploy@sokar "cd /opt/sokar && git pull origin main && bash scripts/deploy.sh --env prod --confirm-production"
  ```
- Privileged wrapper: `/usr/local/sbin/sokar-deploy-root`.
- The `deploy` account is **not** in `sudo` or `docker` groups.

## Rollback

```zsh
# Production
ssh deploy@sokar "cd /opt/sokar && bash scripts/deploy.sh --env prod --confirm-production rollback"

# Staging
ssh deploy@sokar "cd /opt/sokar-staging && bash scripts/deploy.sh --env staging rollback"
```

## Dry-run (staging only)

```zsh
ssh deploy@sokar "cd /opt/sokar-staging && bash scripts/deploy.sh --env staging --dry-run"
```

## Smoke tests

- `curl /health` and `/livez` on `api-staging.sokar.tech` (staging) / `api.sokar.tech` (prod) → 200.
- `curl /dashboard` → 200 or 302 (Clerk redirect).
- `curl /` and `/restaurant/chez-sokar-demo` → 200.
- Playwright E2E functional tests on staging (best-effort, non-blocking).
- Production: no Playwright E2E (too risky); curl smoke tests only.

## Post-deploy notes (production)

- `deploy.sh --env prod` incremental clean only cleans `apps/{dashboard,connect}/.next/standalone` for apps that are actually rebuilt.
- If `apps/<app>/.next/standalone/apps/<app>/server.js` is missing, the script forces a rebuild of that app.
- `deploy.sh --env staging` also does incremental build detection (same logic as prod).
