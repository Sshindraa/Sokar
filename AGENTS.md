---
description: Sokar Autonomous Agent System powered by Hermes CLI
---

# Sokar Autonomous Agent System

L'agent Sokar utilise Hermes CLI pour automatiser les tâches de développement dans ce monorepo.

## Architecture

- **Orchestrateur (planification)** : Crof AI — modèle `deepseek/deepseek-v4-pro`
- **Executeur** : Hermes CLI — modèle `deepseek-v4-flash` (OpenCode Go, fallback OpenRouter)
- **Communication** : Hermes `delegate_task` → subagents Crof AI pour la planification
- **Plus de Windsurf Cascade** — tout passe par Hermes CLI directement
- **Config** : `agent/config/hermes-config.yaml` — Configuration LLM
- **Contexte** : `AGENTS.md` - Contexte du projet pour Hermes CLI

## Stack Sokar

- **apps/api** : Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx
- **apps/dashboard** : Next.js 14 + React 18 + Tailwind 3
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

Exemples :
- "Add Zod validation to contact routes"
- "Create KPI latency component in dashboard"
- "Refactor Telnyx webhook handler with retry logic"

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
