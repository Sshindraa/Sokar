# Architecture Sokar

**Dernière mise à jour** : 2026-06-24
**Stack** : Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx / Next.js 14 + React 18 + Tailwind 3 / Cartesia Sonic 3.5 + Deepgram Nova-3 / OpenRouter (deepseek-v4-flash / PRO)
**Carrier** : Telnyx (production) — Vapi legacy purgé
**TTS** : Cartesia Sonic 3.5 (depuis 2026-05-20)
**Model switch** : Hermes sur `glm-5.2` via `opencode-go` (depuis 2026-06-25)

> Note 2026-06-24 : rétro-référence aux changements majeurs depuis
> 2026-05-21 (agentic P0, MCP, OpenAI Reserve, Sokar Connect). Pour le
> détail des phases, voir [[Sokar Connect P0]] et `docs/sokar-mcp-agentic-reservations-v3.2.md`.

---

## Structure du Monorepo

```
sokar/
├── apps/
│   ├── api/              # Fastify 5 backend
│   │   └── src/
│   │       ├── modules/      # Domain modules (voice, agentic-reservations, mcp, connect, ...)
│   │       ├── plugins/      # Fastify plugins (cors, rate-limit)
│   │       ├── shared/       # Shared services (redis, queue, telnyx, observability, auth)
│   │       ├── lib/          # Auth helpers
│   │       └── types/        # TypeScript declarations
│   ├── dashboard/        # Next.js 14 dashboard (Clerk auth, privé restaurateur)
│   ├── widget/           # Next.js 14 widget B2B (port 4001, output:export, Cloudflare CDN)
│   └── connect/          # Next.js 14 app publique (port 4002, output:standalone, à venir T4)
│       └── src/
│           └── app/         # App Router pages
├── packages/
│   ├── database/         # Prisma schema + client
│   ├── config/           # Configuration partagée
│   ├── types/            # Types TypeScript partagés
│   └── shared/           # Utilitaires partagés
├── agent/               # Hermes CLI config + scripts
└── docs/obsidian/       # Ce vault
```

---

## Backend API

**Framework** : Fastify 5 avec plugins.
**Base de données** : PostgreSQL via Prisma 6.
**Cache** : Redis (sessions, TTS, call caps).
**Queue** : BullMQ (evening report, SMS, outbound confirm).
**Auth** : Clerk JWT multi-tenant.

### Modules

| Module       | Routes                  | Service                               | Description                            |
| ------------ | ----------------------- | ------------------------------------- | -------------------------------------- |
| Restaurants  | `restaurant.routes.ts`  | `restaurant.service.ts`               | CRUD, availability, cache invalidation |
| Calls        | `call.routes.ts`        | —                                     | Historique, transcripts                |
| Reservations | `reservation.routes.ts` | `reservation.service.ts`              | Réservation, confirmation              |
| Customers    | `customer.routes.ts`    | `customer.service.ts`                 | Profil, loyalty, VIP                   |
| Analytics    | `analytics.routes.ts`   | `roi.service.ts`, `report.service.ts` | ROI, KPIs                              |
| Dashboard    | `dashboard.routes.ts`   | —                                     | Métriques temps réel                   |
| Voice        | `telnyx.pipeline.ts`    | `pipeline.ts`, `agent-state.ts`       | Pipeline vocal complet                 |

### Sécurité

- `auth.guard.ts` — Vérification JWT Clerk
- `webhook.guard.ts` — Validation signature Telnyx
- `rate-limit.ts` — Rate limiting par IP

### Voice Pipeline

```
Appel entrant → Telnyx → Webhook → Agent State Machine
                                         │
                                    ┌────┴────┐
                                    │  STT    │  Deepgram
                                    ├─────────┤
                                    │  LLM    │  OpenRouter (deepseek)
                                    ├─────────┤
                                    │  TTS    │  ElevenLabs / Cartesia
                                    └─────────┘
                                         │
                                    Actions (outbound call, create reservation, etc.)
```

Voir [[Voice Pipeline]] pour le détail.

---

## Dashboard

**Framework** : Next.js 14 App Router.
**UI** : React 18 + Tailwind 3.
**Auth** : Clerk (login, register, middleware).

Pages :

- `/login` — Authentification
- `/register` — Inscription
- `/` — Dashboard métriques
- `/appels` — Liste des appels
- `/réservations` — Gestion des réservations
- `/clients` — Profils clients

Voir [[Dashboard]] pour le plan UI/UX.

---

## Agent IA (Hermes CLI)

- **Modèle unique** : glm-5.2 via opencode-go (chat_completions)
- **Workflow** : brain (glm-5.2) planifie/review → MiniMax M3 workers exécutent
- **Logs** : `~/.hermes/logs/cascade_hermes_bridge.md`

Voir [[Hermes Agent]] pour la configuration.

---

## Technologies Clés

| Technologie      | Version | Usage                                 |
| ---------------- | ------- | ------------------------------------- |
| Node.js          | 20+     | Runtime                               |
| pnpm             | 10.8    | Package manager                       |
| TypeScript       | 5.8     | Langage                               |
| Fastify          | 5       | API framework                         |
| Prisma           | 6       | ORM                                   |
| Redis            | 7       | Cache + Queue                         |
| BullMQ           | —       | Job queue                             |
| Telnyx           | —       | Carrier vocal (Phase 2)               |
| Vapi             | —       | Carrier vocal (Phase 1, legacy purgé) |
| Next.js          | 14      | Dashboard                             |
| React            | 18      | UI                                    |
| Tailwind         | 3       | CSS                                   |
| Clerk            | —       | Auth + Billing                        |
| ConfigCat        | —       | Feature flags                         |
| Datadog          | —       | APM/Logs                              |
| PostHog          | —       | Analytics                             |
| Doppler          | —       | Secrets                               |
| VPS + Docker/PM2 | —       | Hosting                               |
| LocalStack       | —       | AWS emulation (Phase 2)               |

---

## Liens

- [[README]] — Guide de démarrage
- [[Phase 1]] — Objectifs en cours
- [[API Endpoints]] — Documentation des routes
- [[Database Schema]] — Schéma Prisma complet
- [[Voice Pipeline]] — Architecture vocale
- [[Dashboard]] — Plan UI/UX
- [[BullMQ Jobs]] — Workers et queues
- [[Testing Strategy]] — Tests et coverage
- [[Hermes Agent]] — Configuration IA
  [[Context]]
