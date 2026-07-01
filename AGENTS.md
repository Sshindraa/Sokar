---
description: Sokar project context for Hermes CLI agents
---

# Sokar Agent Context

Sokar is a French-first restaurant reservation + call-management SaaS with AI voice.
Keep this file short: it is injected into every project session. Detailed history belongs in `docs/`, not here.

## Stack

- Monorepo: pnpm 10.8 + Turbo, Node 20+, TypeScript 5.8.
- API: `apps/api` — Fastify 5, Prisma 6, Redis, BullMQ, Telnyx.
- Dashboard: `apps/dashboard` — Next.js 14 App Router, React 18, Tailwind 3, Shadcn UI, Lucide.
- Packages: `packages/database`, `packages/config`, `packages/types`.
- Voice: Telnyx Media Stream, Deepgram Flux, Cartesia TTS.

## How to work

1. Check whether the feature/file already exists before adding new code.
2. Prefer boring explicit TypeScript over clever abstractions.
3. Never make breaking API/schema changes without explicit user confirmation.
4. Never commit secrets. Use env vars and `key_env`, not plaintext keys.
5. Before saying done, run the smallest relevant verification: tests, build, lint, curl, or typecheck.
6. Git can be unstable on this Mac when multiple IDEs are open. Before bulk git ops, inspect active git/IDE processes and prefer scoped staging.

## Commands

```zsh
# Node (>=20 <23, strict via .npmrc)
pnpm node:check

# Switch rapide vers Node 22 (Homebrew installé côte à côte)
PATH="/usr/local/opt/node@22/bin:$PATH" pnpm node:check

# Dev / build / test
pnpm dev        # API + dashboard dev
pnpm build      # production build
pnpm test       # Vitest
pnpm lint       # lint

# Base de données
pnpm db:push    # synchroniser le schema
pnpm db:seed    # créer le restaurant de démo "Chez Sokar"
pnpm db:studio  # Prisma Studio

# Agent
hermes          # interactive agent
hermes -z "task" # one-shot task
hermes doctor   # Hermes diagnostics
```

## Demo restaurant

Le seed crée un restaurant fictif `Chez Sokar` (slug `chez-sokar-demo`) :

- Numéro : `+331****0405`
- Opt-in MCP + OpenAI Reserve activés
- Horaires, personnalité, clients de test (dont un VIP)

Utilisé pour les tests voice / MCP en local avant d'avoir un vrai pilote.

## Node version

- Repo constraint: `>=20.0.0 <23.0.0` (root `package.json` engines).
- `.nvmrc` = `22`.
- `.npmrc` has `engine-strict=true` — `pnpm` refuses to run under Node 26+.
- Local Mac: Node 26 is the default, Node 22 is available at `/usr/local/opt/node@22/bin`.
- Prefix any `pnpm` command with `PATH="/usr/local/opt/node@22/bin:$PATH"` until the default Node is switched.

## Code style

- Prettier: `semi=true`, `singleQuote=true`, `trailingComma=all`, `printWidth=100`.
- API routes: Fastify plugins, Zod validation where applicable, typed Prisma calls.
- Prisma: keep migrations/schema changes explicit; verify generated client when schema changes.
- Queues/cache: BullMQ + Redis; make retries/idempotency explicit.

## Dashboard UI rules

- French-first copy.
- Tailwind colors must use design tokens/Shadcn CSS vars (`bg-background`, `text-muted-foreground`, `border-border`). No arbitrary hex classes.
- Shadcn UI from `@/components/ui/*`; icons from `lucide-react`; class composition via `cn()`.
- Components must handle loading, empty, error, and data states.
- Interactive elements should include `transition-all duration-200`.
- Layouts should be spacious (`p-6`/`p-8`) and responsive at iPad width.
- Marketing pages should stay static when possible (`○`, not `ƒ`).
- **Ton copy : `vous` partout, jamais `tu`.** Sokar est un SaaS B2B facturé mensuellement à des gérants de restaurant (40-60 ans, non-dev). Le `tu` sent le consumer/developer-tool. Inclut : onboarding (steps, modal, guard, dashboard), tooltips, messages d'erreur, bannières, copy marketing. Le pronom indéfini `on` → `nous` dans le copy user-facing (OK dans les commentaires de code). Un test Vitest (`onboarding-tone.test.ts`) verrouille la convention.

## Mac migration (one-off)

Procédure chiffrée pour cloner l'environnement d'un Mac vers un autre (Hermes config + profils, clés SSH, `.env` Sokar, alias `.zshrc`). Pas pour usage quotidien.

```zsh
# Sur le Mac SOURCE :
cd /Users/hamza/Desktop/Sokar/scripts/migrate/mac-migration-<DATE>
./bundle.sh
# → produit ./out/sokar-mac-migration-<TS>.tar.gz.enc + .sha256 + PASSPHRASE-<TS>.txt

# Transporte l'archive + la passphrase (canal séparé) sur le Mac CIBLE,
# puis après avoir cloné ce repo (pour avoir install.sh) :
cd scripts/migrate/mac-migration-<DATE>
./install.sh /chemin/vers/sokar-mac-migration-*.tar.gz.enc
# → déchiffre, restaure, vérifie (config.yaml, auth.json, SSH pmbtc, profils)
source ~/.zshrc
hermes doctor && ssh pmbtc 'hostname && pwd'
```

Détails, contenu, et ce qui N'est PAS dans le bundle (sessions de debug, `node_modules`, DB locales) : `scripts/migrate/mac-migration-<DATE>/README.md`.

## Hermes/model notes

- Live model/provider state is not documented here. Check `/model` or `~/.hermes/config.yaml` when it matters.
- Current preferred direction: use a strong model briefly for architecture/context optimization, then run daily work on MiniMax M3 via OpenCode Go when configured.
- Old IDE-orchestration/provider notes are historical only; do not resurrect them unless the user asks.

## Environment variables

Convention : un seul fichier `.env` par app, sourcé au démarrage. Pas de `.env.prod`.

### Dev local

| Fichier                  | Rôle                                                                | Chargé par                                                       |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `.env.local` (racine)    | Source de vérité : `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD` | `apps/api/src/env.ts` (fallback), `pnpm infra:up` (`--env-file`) |
| `packages/database/.env` | `DATABASE_URL` pour Prisma CLI (db:push, db:seed, db:studio)        | Prisma auto (depuis `packages/database/`)                        |
| `apps/connect/.env`      | Vars Connect en dev (`SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`)  | `next dev` auto                                                  |

### Prod (VPS `/opt/sokar/`)

| Fichier               | Rôle                                                              | Chargé par                           |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `apps/api/.env`       | Toutes les vars API (Telnyx, Deepgram, Cartesia, DB, Redis, etc.) | PM2 `--env-file=.env` + `src/env.ts` |
| `apps/dashboard/.env` | Clerk keys, `API_URL`, Sentry                                     | `bin/run-dashboard.sh` source `.env` |
| `apps/connect/.env`   | `SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `DASHBOARD_URL`     | `bin/run-connect.sh` source `.env`   |

### Règles

- `NEXT_PUBLIC_*` est baked au build time — doit être présent lors de `next build`, pas seulement au runtime.
- Le deploy script fail-fast si un `.env` critique manque (API, dashboard, connect).
- Ne pas créer de `.env.prod` — convention uniformisée sur `.env`.
- `packages/database/.env` est le seul doublon intentionnel : Prisma CLI ne suit pas les symlinks et ne lit pas `.env.local` depuis la racine.
