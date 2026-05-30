---
description: Sokar Autonomous Agent System powered by Hermes CLI
---

# Sokar Autonomous Agent System

L'agent Sokar utilise Hermes CLI pour automatiser les tâches de développement dans ce monorepo.

## Hermes Front-End Architecture Skill

### Tech Stack Target
- Framework: Next.js (App Router), TypeScript.
- Styling: Tailwind CSS (Strictly token-based via Shadcn CSS variables — `bg-background`, `text-muted-foreground`, `border-border`). No arbitrary hex values (`bg-[#...]`).
- UI Components: **Shadcn UI** (`@/components/ui/*`), Radix Primitives.
- Icons: **Lucide React** only (`import { X } from 'lucide-react'`).
- Utility: `cn()` from `@/lib/utils` for className composition.

### UI/UX Rules for Premium Dashboard Design
1. **Embrace negative space**: Use layout padding of at least `p-6` to `p-8`. Never cram elements.
2. **Micro-animations**: Every interactive element (buttons, tabs, rows) must have smooth transitions (`transition-all duration-200`).
3. **Async awareness**: Every data-fetching card must include a tailored **Skeleton** loader (`@/components/ui/skeleton`).
4. **Empty states**: Every list/table must have an illustrated empty state with a Lucide icon (opacity-30) and a helpful message when there's no data.
5. **Error states**: API errors must be displayed in a Card with `border-destructive/50` and an `AlertCircle` icon.
6. **Data viz**: Keep charts minimalist (when added). Hide grid lines, use thin strokes, style custom Tooltips with rounded corners and soft shadows.
7. **Self-evaluation checklist** before saving any component:
   - Is it responsive (works on iPad)?
   - Are hover/focus transitions smooth (`duration-200`)?
   - Does it handle loading → empty → error → data states?
   - Are all colors from CSS variables (no hardcoded hex)?

## Architecture

- **Orchestrateur (planification)** : `deepseek-v4-flash` via OpenCode Go (`https://opencode.ai/zen/go/v1`)
  - Fallback : `deepseek-v4-pro` via OpenCode Go (`https://opencode.ai/zen/go/v1`)
- **Executeur** : `deepseek-v4-flash` via OpenCode Go (`delegate_task`)
- **Communication** : L'agent principal (OpenCode Go deepseek-v4-flash) planifie → subagents (OpenCode Go deepseek-v4-flash) exécutent via `delegate_task`
- **Plus de Windsurf Cascade** — tout passe par Hermes CLI directement
- **Config** : `agent/config/hermes-config.yaml` — Configuration LLM
- **Contexte** : `AGENTS.md` - Contexte du projet pour Hermes CLI

## Stack Sokar

- **apps/api** : Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx
- **apps/dashboard** : Next.js 14 + React 18 + Tailwind 3 + Shadcn UI + Lucide
- **packages/database** : Prisma schema + client
- **packages/config** : Shared config
- **packages/types** : Shared TypeScript types
- **packages/shared** : Shared utilities

## Utilisation

### Mode terminal (principal)
```zsh
hermes -z "ta tâche ici"
```

Exemples :
- "Add Zod validation to contact routes"
- "Create KPI latency component in dashboard"
- "Refactor Telnyx webhook handler with retry logic"

### Via script
```zsh
zsh agent/scripts/start-hermes.sh
```

### Mode orchestré (recommandé)
```zsh
hermes -z "ta tâche ici" --mode delegate
```

- L'orchestrateur (Crof AI deepseek-v4-pro) planifie la tâche
- Les sous-agents (deepseek-v4-flash OpenCode Go) exécutent
- Résultat consolidé retourné automatiquement

## Providers LLM

Architecture dual-model :

- **Executeur** : `deepseek-v4-flash` via **OpenCode Go** (OpenAI-compatible, `https://opencode.ai/zen/go/v1`) — 100% de l'exécution dans Hermes
  - Fallback : `deepseek/deepseek-v4-flash` via **OpenRouter**

- **Orchestrateur** : `deepseek/deepseek-v4-pro` via **Crof AI** (`https://crof.ai/v1`) — planification, découpage de tâches, coordination des subagents
  - Utilisé par Hermes `delegate_task` (section `delegation` dans la config)

Windsurf Cascade : abandonné — plus utilisé.

## Règles de style

- Prettier : semi=true, singleQuote=true, trailingComma=all, printWidth=100
- Runtime : Node 20+, TypeScript 5.8, pnpm 10.8

## Commandes utiles

```zsh
hermes -z "tâche"              # Exécuter une tâche
hermes status                  # Vérifier le status Hermes
hermes doctor                  # Diagnostics détaillés
zsh agent/scripts/check-hermes.sh  # Healthcheck
pnpm dev       → dev mode (api + dashboard)
pnpm build     → production build
pnpm test      → vitest run
pnpm db:push   → prisma db push
pnpm db:studio → prisma studio
pnpm lint      → lint
```

## Healthcheck

```zsh
zsh agent/scripts/check-hermes.sh
```
