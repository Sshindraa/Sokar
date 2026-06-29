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

## Hermes/model notes

- Live model/provider state is not documented here. Check `/model` or `~/.hermes/config.yaml` when it matters.
- Current preferred direction: use a strong model briefly for architecture/context optimization, then run daily work on MiniMax M3 via OpenCode Go when configured.
- Old IDE-orchestration/provider notes are historical only; do not resurrect them unless the user asks.
