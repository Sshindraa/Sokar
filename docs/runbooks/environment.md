# Runbook — Environment

## Node version

- Repo constraint: `>=20.0.0 <23.0.0` (root `package.json` engines).
- `.nvmrc` = `22`.
- `.npmrc` has `engine-strict=true` — `pnpm` refuses to run under Node 26+.
- Local Mac (post-migration 2026-07-01): Node 22.23.1 is the default at `~/.local/bin/node` (symlink to `~/.hermes/node/bin/node`). No PATH prefix needed for `pnpm`.
- pnpm 10.33.3 installed via `npm i -g pnpm@10.33.3`, symlinked at `~/.local/bin/pnpm`.

## Convention

- One `.env` file per app, sourced at startup. No `.env.prod`.
- `NEXT_PUBLIC_*` is baked at build time — must be present during `next build`, not only at runtime.
- Deploy scripts fail-fast if a critical `.env` is missing (API, dashboard, connect).
- `packages/database/.env` is the only intentional duplicate: Prisma CLI does not follow symlinks and does not read `.env.local` from the root.

## Files

| File                         | Role                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `.env.local` (root)          | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD`                  |
| `packages/database/.env`     | `DATABASE_URL` for Prisma CLI (`db:push`, `db:seed`, `db:studio`) |
| `apps/connect/.env`          | Connect dev vars (`SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`)   |
| `apps/api/.env` (prod)       | All API vars (Telnyx, Deepgram, Cartesia, DB, Redis, etc.)        |
| `apps/dashboard/.env` (prod) | Clerk keys, `API_URL`, Sentry                                     |
| `apps/connect/.env` (prod)   | `SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `DASHBOARD_URL`     |

Pour la télémétrie Service Copilot, définir `SERVICE_COPILOT_TELEMETRY_SECRET` dans l’environnement
de l’API (valeur aléatoire d’au moins 32 caractères). Elle signe les jetons de recommandation ; ne pas
la réutiliser pour un autre usage et ne jamais la mettre dans une variable `NEXT_PUBLIC_*`.

## Demo restaurant

The seed creates a fictional `Chez Sokar` (slug `chez-sokar-demo`):

- Number: `+331****0405`
- MCP + OpenAI Reserve opt-in enabled
- Hours, personality, test customers (including a VIP)

Used for local voice / MCP tests before a real pilot.
