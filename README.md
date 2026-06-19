# Sokar

French-first restaurant reservation and AI call-management platform.

## Stack

- API: Fastify 5, Prisma 6, Redis, BullMQ, Telnyx.
- Dashboard: Next.js 14 App Router, React 18, Tailwind 3, Shadcn UI.
- Voice: Telnyx Media Stream, Deepgram Flux, Cartesia TTS.
- Monorepo: pnpm 10.8, Turbo, TypeScript 5.8.

## Repository layout

```text
apps/api            Fastify API
apps/dashboard      Next.js dashboard/marketing app
packages/database   Prisma schema/client
packages/config     shared config
packages/types      shared TypeScript types
tools/hermes        Hermes project-local docs/config/templates
docs                product and implementation notes
```

## Commands

```zsh
pnpm dev        # API + dashboard dev
pnpm build      # production build
pnpm test       # Vitest
pnpm lint       # lint
pnpm db:push    # Prisma db push
pnpm db:studio  # Prisma Studio
hermes          # interactive agent
hermes -z "task" # one-shot agent task
```

## Agent context

`AGENTS.md` is the only project markdown intended to be injected into every Hermes session. Keep it compact and stable.
Detailed historical notes stay under `docs/`; old provider/IDE-orchestration notes are historical unless explicitly re-enabled.

For Hermes model/provider setup, use the live config as source of truth:

```zsh
hermes config
hermes model
hermes doctor
```
