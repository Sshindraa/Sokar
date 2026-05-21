# Sokar — Autonomous SaaS Platform

Stack: Fastify 5 + Prisma 6 + Redis + BullMQ + Next.js 14 + Clerk Auth + Telnyx Voice

## Structure

```
sokar/
├── apps/
│   ├── api/              # Fastify API (port 4000)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── modules/       # Routes métier
│   │       ├── plugins/       # Clerk, CORS, rate-limit
│   │       ├── shared/        # DB, Redis, Queue, Telnyx, Email
│   │       └── types/         # Types globaux
│   └── dashboard/        # Next.js App Router (port 3000)
│       └── src/
│           ├── app/          # Pages + layouts
│           └── middleware.ts  # Clerk auth middleware
├── packages/
│   ├── database/         # Prisma schema + client
│   ├── config/           # Variables partagées
│   └── types/            # Types TypeScript partagés
├── scripts/             # Commandes de dev
│   ├── dev.sh           # Lancer l'environnement
│   ├── test.sh          # Tests
│   ├── db.sh            # Prisma DB commands
│   └── hermes.sh        # Hermes CLI wrapper
├── tools/
│   └── hermes/          # Hermes Agent (ex agent/)
│       ├── config/      # hermes-config.yaml
│       ├── scripts/     # setup, start, check, auto-commit
│       └── skills/      # Skills Hermes (obsidian, notion)
├── infra/              # Docker, Railway
├── docs/               # Documentation
│   └── obsidian/       # Vault Obsidian
├── .env.example
├── AGENTS.md
└── pnpm-workspace.yaml
```

## Commandes utiles

```zsh
zsh scripts/dev.sh                               # Dev (API + Dashboard)
zsh scripts/test.sh                              # Tests
zsh scripts/db.sh push                           # Push Prisma schema
zsh scripts/db.sh studio                         # Prisma Studio
zsh scripts/db.sh seed                           # Seed database
zsh scripts/hermes.sh -z "ta tâche"              # Hermes CLI
```

## Stack

- **API**: Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx
- **Dashboard**: Next.js 14 + React 18 + Tailwind 3
- **Auth**: Clerk Pro (multi-tenant, B2B)
- **Voice**: Telnyx Media Stream + Deepgram Flux + Cartesia TTS
- **Queue**: BullMQ (evening reports, confirmations)
- **Cache**: Redis (TTS, phone mapping)
- **Carrier**: Telnyx (primary)

## LLM Architecture

- **Executeur** : deepseek-v4-flash via OpenCode Go (fallback OpenRouter)
- **Orchestrateur** : deepseek-v4-pro via Crof AI (planification, delegation)

Voir `tools/hermes/config/hermes-config.yaml` pour la configuration détaillée.
