---
description: Callyx Autonomous Agent System powered by Hermes CLI
---

# Callyx Autonomous Agent System

L'agent Callyx utilise Hermes CLI pour automatiser les tâches de développement dans ce monorepo.

## Architecture

- **Backend** : Hermes CLI — modèle unique
- **Modèle principal** : deepseek/deepseek-v4-flash (OpenRouter) — fait planification + exécution. Fallback: Crof AI deepseek-v4-flash
- **Windsurf Cascade** : kimi-k2.6 (Windsurf Pro gratuit) — planification/raisonnement uniquement, communique via MCP. Toute execution est deleguee a Hermes via l'outil MCP `execute_task`.
- **Crof AI kimi-k2.6** : plus utilisé (credits épuisés). Pas de rechargement prévu.
- **Config** : `agent/config/hermes-config.yaml` - Configuration LLM
- **MCP** : `agent/config/mcp-config.json` - Integration MCP pour Windsurf (hermes, postgres, github)
- **Contexte** : `AGENTS.md` - Contexte du projet pour Hermes CLI

## Stack Callyx

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

### Via MCP Windsurf (IDE) — Workflow enforce

Le MCP serveur `hermes` n'expose QU'UN SEUL outil : `execute_task`.

```
Cascade (kimi-k2.6)                    Hermes (deepseek-v4-flash)
      │ planifie                             │ execute
      │── execute_task("fais X") ──────────→│
      │←── resultat de l'execution ─────────│
```

- **Cascade** : planification uniquement, zéro execution directe
- **Hermes** : execution via `hermes -z "task"` avec timeout 600s et retry 2x
- **Logs** : `~/.hermes/logs/cascade_hermes_bridge.md` (trace complète)
- **Fichiers** : `.windsurfrules` = contrat de comportement pour Cascade
            `agent/scripts/mcp_serve.py` = MCP serveur (1 seul outil)

Les autres outils MCP (run_shell, read_file, search_files, git_status) ont
ete supprimes pour empecher Cascade de tricher.

Les MCP servers configurés :
- **hermes** : Orchestrateur Callyx
- **callyx-postgres** : PostgreSQL
- **callyx-github** : GitHub

## Providers LLM

Modèle unique :
- **deepseek/deepseek-v4-flash** (OpenRouter) — planification + exécution, 100% du travail dans Hermes
- **Fallback** : deepseek-v4-flash (Crof AI) — utilisé si OpenRouter 429/500/401

Windsurf Cascade :
- **kimi-k2.6** (Windsurf Pro gratuit) — planification uniquement, communique via Hermes MCP

Crof AI kimi-k2.6 : désactivé, crédits épuisés.

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
