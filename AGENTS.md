---
description: Sokar project context for Hermes CLI agents
---

# Sokar Agent Context

Sokar is a French-first restaurant reservation + call-management SaaS with AI voice.
Keep this file short. Detailed docs are in `docs/runbooks/` and `docs/architecture/`.

## Stack

- Monorepo: pnpm 10.8 + Turbo, Node 20+, TypeScript 5.8.
- API: `apps/api` — Fastify 5, Prisma 6, Redis, BullMQ, Telnyx.
- Dashboard: `apps/dashboard` — Next.js 15 App Router, React 19, Tailwind 3, Shadcn UI, Lucide.
- Connect / Widget: `apps/connect` + `apps/widget` — Next.js, standalone/export.
- Packages: `packages/database`, `packages/config`, `packages/shared`.
- Voice: Telnyx Media Stream, Deepgram Flux, Cartesia TTS.

## Structure

```text
sokar/
├── apps/
│   ├── api/              # Fastify backend
│   ├── dashboard/        # Next.js dashboard (Clerk)
│   ├── connect/          # Public site / widget
│   └── widget/           # Embeddable widget
├── packages/
│   ├── database/         # Prisma schema
│   ├── config/           # Shared config
│   └── shared/           # Shared utilities
├── docs/
│   ├── runbooks/         # Ops, deployment, env, tests
│   └── architecture/     # Domain architecture
└── scripts/              # Deployment & ops
```

## How to work

1. Check whether the feature/file already exists before adding new code.
2. Prefer boring explicit TypeScript over clever abstractions.
3. Never make breaking API/schema changes without explicit user confirmation.
4. Never commit secrets. Use env vars (`key_env` = secrets loaded from environment only, never from code), not plaintext keys.
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
pnpm lint       # turbo lint + stylelint
pnpm lint:css   # guard CSS dashboard
pnpm test:e2e   # Playwright dashboard
pnpm test:visual # visual regression

# Database
pnpm db:push    # sync schema
pnpm db:seed    # create demo restaurant "Chez Sokar"
pnpm db:studio  # Prisma Studio

# Agent
hermes          # interactive agent
hermes -z "task" # one-shot task
```

## Code conventions

- Prettier: `semi=true`, `singleQuote=true`, `trailingComma=all`, `printWidth=100`.
- API: Fastify plugins, Zod validation where applicable, typed Prisma calls.
- Prisma: keep migrations/schema changes explicit; verify generated client when schema changes.
- Queues/cache: BullMQ + Redis; make retries/idempotency explicit.
- French copy: `vous` everywhere, never `tu` (user-facing). Test `onboarding-tone.test.ts` enforces this.

## Dashboard constraints

- Tailwind colors must use design tokens (`bg-background`, `text-muted-foreground`, `border-border`). No arbitrary hex classes.
- Shadcn UI from `@/components/ui/*`; icons from `lucide-react`; class composition via `cn()`.
- Components must handle loading, empty, error, and data states.
- Layouts should be spacious (`p-6`/`p-8`) and responsive at iPad width.
- Interactive elements should include `transition-all duration-200`.
- Marketing pages should stay static when possible (`○`, not `ƒ`).
- See `docs/architecture/dashboard.md` for the full style and CSS rules.

## Security & deployment

- **Staging:** deploys automatically after a green CI and its smoke tests.
- **Production:** requires explicit confirmation before execution. Any DB migration, payment, auth, voice, or critical config change must be flagged.
- **Rollback:** application rollback restores artefacts only by default. Add `--with-db-rollback` to `scripts/deploy-vps.sh` or `scripts/deploy-staging.sh` to also restore the Postgres backup timestamped in the release directory. See `docs/runbooks/rollback.md`.
- **Deploy account:** privileged operations use `/usr/local/sbin/sokar-deploy-root`. The `deploy` account is not in `sudo` or `docker` groups.
- **Secrets:** never commit secrets. Use env vars (`key_env` convention = secrets live in environment variables, never in code).

## Where to look

- **Project map:** `docs/PROJECT_MAP.md` — architecture, flux, points sensibles.
- **Runbooks:** `docs/runbooks/` — staging, deployment, rollback, environment, tests, migration.
- **Architecture:** `docs/architecture/` — dashboard, voice, plus product specs in `docs/*.md`.
- **Specs:** `docs/gift-cards-spec.md`, `docs/floor-plan-spec.md`, `docs/connect-v1.1.md`, `docs/sokar-mcp-agentic-reservations-v3.2.md`.

## Environment

- **Dev:** `.env.local` (root), `packages/database/.env`, per-app `.env`.
- **Staging:** `https://staging.sokar.tech` / `api-staging.sokar.tech` on VPS `pmbtc`.
- **Prod:** `https://sokar.tech` / `api.sokar.tech` on VPS `pmbtc`.
- One `.env` per app, no `.env.prod`. `NEXT_PUBLIC_*` is baked at build time.
- See `docs/runbooks/environment.md` for details.
