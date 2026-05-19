# Hermes Agent for Callyx

Configuration Hermes CLI pour le monorepo Callyx.

## Architecture 2 niveaux

- **Planner (cerveau)** : délégué via `delegate_task` — kimi-k2.6-precision (Crof AI)
- **Executor (principal)** : deepseek/deepseek-v4-flash (OpenRouter) - modèle par défaut

Cette architecture économise les tokens du modèle le plus cher (kimi-k2.6-precision)
en ne l'utilisant que pour le planning, tandis que les modèles moins chers exécutent.

## Structure

```
agent/
├── config/
│   ├── hermes-config.yaml      # Configuration Hermes CLI (LLM providers)
│   └── mcp-config.json         # Configuration MCP (Windsurf integration)
├── scripts/
│   ├── setup.sh                # Installation et setup initial
│   ├── start-hermes.sh         # Lancement Hermes CLI
│   └── check-hermes.sh         # Healthcheck
└── README.md                   # Ce fichier
```

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

### Via MCP Windsurf (IDE)
Les MCP servers configurés :
- **hermes** : Orchestrateur Callyx
- **callyx-postgres** : PostgreSQL
- **callyx-github** : GitHub

## Configuration

### Variables d'environnement
Les API keys sont configurées directement dans `agent/config/hermes-config.yaml` :
- `CROF_API_KEY` : Pour kimi-k2.6-precision (planner)
- `OPENROUTER_API_KEY` : Pour deepseek/deepseek-v4-flash (executor)

### Fichiers de configuration
- `~/.hermes/config.yaml` : Copié depuis `agent/config/hermes-config.yaml`
- `agent/config/mcp-config.json` : Configuration MCP pour Windsurf

## Stack Callyx reconnu

- **apps/api** : Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx
- **apps/dashboard** : Next.js 14 + React 18 + Tailwind 3
- **packages/database** : Prisma schema + client
- **packages/config** : Shared config
- **packages/types** : Shared TypeScript types
- **packages/shared** : Shared utilities

## Commandes utiles

```zsh
hermes -z "tâche"              # Exécuter une tâche
hermes status                  # Vérifier le status
hermes doctor                  # Diagnostics détaillés
zsh agent/scripts/check-hermes.sh  # Healthcheck
```

## Healthcheck

```zsh
zsh agent/scripts/check-hermes.sh
```

Vérifie :
- Installation Hermes
- Configuration
- Variables d'environnement
- MCP servers
