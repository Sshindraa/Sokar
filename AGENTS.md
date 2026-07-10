---
description: Sokar project context for Hermes CLI agents
---

# Sokar Agent Context

Sokar is a French-first restaurant reservation + call-management SaaS with AI voice.
Keep this file short: it is injected into every project session. Detailed history belongs in `docs/`, not here.

## Stack

- Monorepo: pnpm 10.8 + Turbo, Node 20+, TypeScript 5.8.
- API: `apps/api` — Fastify 5, Prisma 6, Redis, BullMQ, Telnyx.
- Dashboard: `apps/dashboard` — Next.js 15 App Router, React 19, Tailwind 3, Shadcn UI, Lucide.
- Packages: `packages/database`, `packages/config`, `packages/shared`.
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

# Dev / build / test
pnpm dev        # API + dashboard dev
pnpm build      # production build
pnpm test       # Vitest
pnpm lint       # turbo lint + stylelint (CSS)
pnpm lint:css   # stylelint sur apps/*/src/**/*.css (garde-fou CSS dashboard)
pnpm test:e2e   # Playwright dashboard (3 viewports : iPhone 14, iPad Mini, desktop)
pnpm test:visual # régression visuelle Playwright (6 pages x 3 viewports, seuil 0.2%)

# Base de données
pnpm db:push    # synchroniser le schema
pnpm db:seed    # créer le restaurant de démo "Chez Sokar"
pnpm db:studio  # Prisma Studio

# Agent
hermes          # interactive agent
hermes -z "task" # one-shot task
hermes doctor   # Hermes diagnostics
```

## Environnement de staging

L'environnement de staging déploie automatiquement `main` sur le VPS pmbtc et exécute des smoke tests.

**URLs :**

- Dashboard : `https://staging.sokar.tech`
- API directe : `https://api-staging.sokar.tech`
- Sokar Connect : `https://staging.sokar.tech/restaurant/chez-sokar-demo`

**Infrastructure (VPS pmbtc, isolée de la prod) :**

- Racine : `/opt/sokar-staging/`
- Ports : API=4100, Dashboard=3100, Connect=4102 (prod: 4000/3000/4002)
- DB Postgres : `sokar_staging` (séparée de la prod)
- Redis : db=2 (prod: db=0)
- PM2 : `sokar-staging-api`, `sokar-staging-dashboard`, `sokar-staging-connect`
- Nginx : `infra/nginx/sokar-staging.conf` (vhost `staging.sokar.tech` + `api-staging.sokar.tech`)

**Sécurité / isolement :**

- Clés Clerk staging (`pk_test` / `sk_test`) — JAMAIS de clés prod.
- Voice désactivée : `TELNYX_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` vides → pas d'appels sortants, webhooks Telnyx reçoivent 403 (signature vide).
- Stripe : clé publique de prod (publique par nature) pour que le widget/Connect se charge, clé secrète vide en l'absence de clés de test Stripe. Les paiements gift-card ne fonctionnent donc pas en staging tant qu'on n'a pas fourni de `sk_test_*`.
- `X-Robots-Tag: noindex, nofollow` sur tous les vhosts staging.

**Setup initial (one-time, sur le VPS pmbtc) :**

- Script : `scripts/ops/setup-staging.sh` — idempotent, prépare le répertoire, clone le repo, crée la DB `sokar_staging`, copie les `.env.staging.example` vers `.env`, installe le vhost Nginx et valide la config.
- Prérequis : DNS `staging.sokar.tech` + `api-staging.sokar.tech` pointés vers le VPS, swap configuré (`scripts/ops/setup-swap.sh` si besoin).
- Après le setup : remplir les `.env` avec les clés staging (Clerk test, Stripe test, pas de clés voice), puis lancer le premier deploy manuel.

**Déploiement :**

- CI/CD : `.github/workflows/deploy-staging.yml` — déclenché sur push de `main`.
- Secrets GitHub : `STAGING_SSH_KEY` (clé SSH privée du compte `deploy`), `STAGING_HOST` (hostname VPS, ex. `pmbtc`), `STAGING_USER` (`deploy`).
- Script : `scripts/deploy-staging.sh` (sur le VPS).
- Dry-run : `bash scripts/deploy-staging.sh --dry-run` (build sans restart ni migrations).
- Rollback : `bash scripts/deploy-staging.sh rollback`.

**Smoke tests post-déploiement (CI) :**

- `curl /health` et `/livez` sur `api-staging.sokar.tech` → 200.
- `curl /dashboard` → 200 ou 302 (redirect Clerk).
- `curl /` et `/restaurant/chez-sokar-demo` → 200.
- Playwright E2E fonctionnels (best-effort, non-bloquant).

**Fichiers de config staging :**

- `infra/ecosystem.staging.config.js` — PM2 config.
- `infra/nginx/sokar-staging.conf` — Nginx vhost.
- `apps/api/.env.staging.example` — template env API.
- `apps/dashboard/.env.staging.example` — template env dashboard.
- `apps/connect/.env.staging.example` — template env connect.

**Notes post-setup (état actuel) :**

- Certificat TLS : `/etc/letsencrypt/live/staging.sokar.tech/` (chemin Let's Encrypt). Le vhost staging pointe sur ce certificat, qui doit couvrir `staging.sokar.tech` et `api-staging.sokar.tech`.
- DNS requis : `staging.sokar.tech` + `api-staging.sokar.tech` en A vers le VPS.
- Connect : la page `/restaurant/[slug]` est rendue dynamiquement en staging (`force-dynamic`) pour éviter une erreur `DYNAMIC_SERVER_USAGE` liée à la génération statique sur le build VPS. En prod elle reste ISR.

**Commandes manuelles (sur le VPS) :**

```zsh
ssh deploy@pmbtc
cd /opt/sokar-staging
bash scripts/deploy-staging.sh              # déploiement complet
bash scripts/deploy-staging.sh --dry-run    # simulation
bash scripts/deploy-staging.sh rollback     # rollback
pm2 status                                  # voir les services staging
pm2 logs sokar-staging-api                  # logs API staging
```

## Déploiement production

**Tout déploiement production nécessite une confirmation explicite juste avant l'exécution.** Staging peut être déployé automatiquement après une CI verte et ses smoke tests. Toute migration DB production, modification des paiements, de l'authentification, de la voice ou de la configuration critique doit être signalée avant exécution. Un rollback applicatif ne restaure pas automatiquement la base de données.

**Sécurité du compte deploy :**

- Les opérations privilégiées (Nginx, Docker, logrotate, backups, certificats) passent par le wrapper `/usr/local/sbin/sokar-deploy-root`.
- Le compte `deploy` n'est **plus** dans les groupes `sudo` ni `docker`.
- `sudo -n` n'autorise plus que `sokar-deploy-root` ; tout autre `sudo` exige un mot de passe root.
- `deploy` ne peut plus lancer de commandes `docker` directement ; seul le wrapper `sokar-deploy-root` gère les conteneurs.

\*\*Infrastructure (VPS pmbtc, même machine que le staging) :

- Racine : `/opt/sokar/`
- Ports : API=4000, Dashboard=3000, Connect=4002
- DB Postgres : `sokar` (séparée de `sokar_staging`)
- Redis : db=0
- PM2 : `sokar-api`, `sokar-dashboard`, `sokar-connect`
- Nginx : `infra/nginx/sokar.conf` (vhost `sokar.tech` + `api.sokar.tech`)

**Commandes (depuis le Mac, via SSH) :**

```zsh
# Déployer la prod (depuis le Mac — l'agent fait ça directement)
ssh deploy@pmbtc "cd /opt/sokar && git pull origin main && bash scripts/deploy-vps.sh --confirm-production"

# Rollback prod (confirmation explicite requise)
ssh deploy@pmbtc "cd /opt/sokar && bash scripts/deploy-vps.sh --confirm-production rollback"

# Voir les services prod
ssh deploy@pmbtc "pm2 list | grep sokar"

# Logs prod
ssh deploy@pmbtc "pm2 logs sokar-api --lines 50"
```

**Déploiement staging (depuis le Mac) :**

```zsh
ssh deploy@pmbtc "cd /opt/sokar-staging && git pull origin main && bash scripts/deploy-staging.sh"
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
- Local Mac (post-migration 2026-07-01): Node 22.23.1 is the default at `~/.local/bin/node` (symlink to `~/.hermes/node/bin/node`). No PATH prefix needed for `pnpm`.
- pnpm 10.33.3 installed via `npm i -g pnpm@10.33.3`, symlinked at `~/.local/bin/pnpm`.

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
- **Garde-fou CSS (stylelint)** : `pnpm lint:css` verrouille les règles ci-dessous dans `apps/*/src/**/*.css` (config `.stylelintrc.json` racine). Pas de sélecteurs d'éléments structurels bruts (`header`, `main`, `section`, `nav`, `footer`, `aside`, `article`, `button`, `div`) — ils causent des bugs globaux quand ils sont stylés dans `globals.css` (incident `header { position: fixed }` de juillet 2026). Pas de couleurs hex (`#fff`), pas de `!important` (sauf exemption commentée `stylelint-disable-next-line` pour l'accessibilité), pas de z-index arbitraires (échelle 0-50 ou `var(--z-*)`), `font-size` en `rem`/`em` uniquement.
- **Ton copy : `vous` partout, jamais `tu`.** Sokar est un SaaS B2B facturé mensuellement à des gérants de restaurant (40-60 ans, non-dev). Le `tu` sent le consumer/developer-tool. Inclut : onboarding (steps, modal, guard, dashboard), tooltips, messages d'erreur, bannières, copy marketing. Le pronom indéfini `on` → `nous` dans le copy user-facing (OK dans les commentaires de code). Un test Vitest (`onboarding-tone.test.ts`) verrouille la convention.

## Régression visuelle (Playwright)

`pnpm test:visual` capture un screenshot de 6 pages critiques (`/dashboard`, `/dashboard/reservations`, `/dashboard/calls`, `/dashboard/gift-cards`, `/`, `/pricing`) sur 3 viewports (iPhone 14, iPad Mini, desktop 1440px) et le compare au baseline stocké dans `apps/dashboard/e2e/__snapshots__/`. Seuil de tolérance : 0.2 % de diff pixel.

**Mettre à jour les baselines après un changement visuel intentionnel :**

```zsh
# 1. Régénérer les baselines localement (macOS)
cd apps/dashboard
npx playwright test visual-regression --update-snapshots

# 2. Reviewer le diff git (les PNG modifiés)
git diff --stat apps/dashboard/e2e/__snapshots__/

# 3. Committer les nouveaux baselines
git add apps/dashboard/e2e/__snapshots__/
git commit -m "feat(dashboard): update visual baselines for <description>"
```

**Stabilité des screenshots :** les animations sont désactivées (`animations: 'disabled'`), les transitions CSS neutralisées via `e2e/visual-stability.css` (qui force aussi `-webkit-font-smoothing: antialiased`), et le caret texte masqué. Pour `/dashboard`, on attend `.recharts-surface` (graphiques SVG rendus) en plus du `h1`, puis un `settleMs` de 3000 ms pour laisser recharts stabiliser son rendu asynchrone. Les pages dashboard sans Clerk affichent les données de démo ou un skeleton — pas de contenu aléatoire.

**Cross-plateforme :** les baselines sont générés sur macOS (suffixe `-darwin`). En CI (Linux), un script copie les baselines `-darwin` vers `-linux` avant l'exécution. Le seuil de 0.2 % absorbe les micro-différences de rendu (anti-aliasing des fonts).

## Mac migration (one-off)

Procédure chiffrée pour cloner l'environnement d'un Mac vers un autre (Hermes config + profils, clés SSH, `.env` Sokar, alias `.zshrc`). Pas pour usage quotidien.

```zsh
# Sur le Mac SOURCE :
cd ~/Projects/Sokar/scripts/migrate/mac-migration-<DATE>
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
