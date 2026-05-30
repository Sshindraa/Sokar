# Sprint 1 — MVP Vocal

**Période** : Mai 2025 — 1 semaine 🚀 (accéléré par agent IA kimi-k2.6 + Hermes)  
**Statut** : En cours  
**Stack cible** : Vapi (carrier vocal), Clerk (auth), Fastify 5, Prisma 6, Next.js 14, BullMQ

> ⚡ **Accélération agent** : Avec Cascade (kimi-k2.6) pour la planification et Hermes (deepseek-v4-flash) pour l'exécution, les edge cases vocaux (bruit, accent, interruptions, silence) sont gérés en parallèle par l'IA. Pas de dilatation temporelle. 1 semaine = build complet.

---

## Mode Agent

Ce sprint est exécuté en mode **dual-agent** :

- **Cascade (kimi-k2.6)** — planification, architecture, raisonnement, design review
- **Hermes (deepseek-v4-flash)** — exécution via terminal, écriture de code, tests, déploiement

**Workflow** : Cascade planifie → Hermes exécute → Obsidian logue.

Chaque tâche est automatiquement loguée dans `Journal.md` (journal d'exécution horodaté) et `Context.md` (état courant du projet). Le wrapper `hermes -z "task"` est utilisé pour lancer toute commande depuis le terminal.

---

## Objectifs

### 1. API Fastify (apps/api)

- [x] Structure modulaire (restaurants, calls, reservations, customers, analytics)
- [x] Prisma client + migrations PostgreSQL
- [x] Auth Clerk multi-tenant (JWT verification)
- [x] Rate limiting + CORS
- [x] Webhook Telnyx guard (signature validation)
- [ ] Endpoints REST complets pour tous les modules
- [ ] Schémas Zod validation sur toutes les routes
- [ ] Tests unitaires (Vitest) — [[Testing Strategy]]

Voir [[API Endpoints]] pour la liste complète.

### 2. Dashboard Next.js (apps/dashboard)

- [x] App Router (layout.tsx, login, register)
- [x] Tailwind CSS + globals.css
- [ ] Page login/register Clerk
- [ ] Dashboard métriques temps réel
- [ ] Liste des appels avec transcripts
- [ ] Gestion des réservations

Voir [[Dashboard]] pour le plan UI/UX.

### 3. Base de données (packages/database)

- [x] Schéma Prisma : User, Session, Account, Verification
- [x] Schéma Prisma : Restaurant, Call, Reservation, Customer
- [x] Schéma Prisma : AgentPersonality, CallQuota, LatencyTrace
- [ ] Indexes & contraintes supplémentaires
- [ ] Seed data pour développement

**Enums Prisma** (dans `packages/database/prisma/schema.prisma`) :

| Enum | Valeurs |
|------|---------|
| `Plan` | `STARTER` \| `PRO` \| `PREMIUM` |
| `CallIntent` | `RESERVATION` \| `HOURS` \| `MENU` \| `CANCEL` \| `OTHER` |
| `CallOutcome` | `RESERVED` \| `INFO` \| `NO_ACTION` \| `HANDOFF` \| `ERROR` |
| `ReservationStatus` | `CONFIRMED` \| `CANCELLED` \| `NO_SHOW` \| `SEATED` |
| `ProfileType` | `BISTROT_BRASSERIE` \| `GASTRONOMIQUE` \| `SEMI_GASTRO` |
| `FillerStyle` | `CASUAL` \| `FORMAL` \| `WARM` |

Voir [[Database Schema]] pour le schéma complet.

### 4. Voice Pipeline (Vapi → Telnyx)

- [x] Agent state machine (idle → listening → thinking → speaking)
- [x] Fillers (CASUAL / FORMAL / WARM)
- [x] Prompts système par profile type
- [ ] Intégration Vapi (Sprint 1)
- [ ] Migration Telnyx (Sprint 2)

**Modules voice** (`apps/api/src/modules/voice/`) :

| Fichier | Rôle |
|---------|------|
| `pipeline.ts` | Orchestrateur : 3 endpoints ci-dessous |
| `outcome.ts` | Détection de l'outcome (RESERVED, INFO, NO_ACTION, HANDOFF, ERROR) basée sur transcript + endedReason |
| `tools.ts` | Définition des fonctions Vapi (createReservation, checkAvailability, getOpeningHours, handoffToManager) |
| `prompts.ts` | Prompts système par ProfileType |
| `fillers.ts` | Fillers vocaux (CASUAL / FORMAL / WARM) |

**3 endpoints Pipeline** :

| Endpoint | Rôle |
|----------|------|
| `POST /voice/incoming` | Charge contexte restaurant, vérifie circuit breaker, retourne config assistant Vapi |
| `POST /voice/function-call` | Exécute createReservation \| checkAvailability \| getOpeningHours \| handoffToManager |
| `POST /voice/end` | Persiste durée + transcript + outcome en base |

**Détails outcome detection** (`voice/outcome.ts`) :

```
- "réservation confirmée" ou "numéro de réservation" dans transcript → RESERVED
- endedReason === "transfer" → HANDOFF
- endedReason === "error" → ERROR
- "horaire", "ouvert", "fermé" dans transcript → INFO
- Sinon → NO_ACTION
```

**Tools Vapi** (`voice/tools.ts`) :

| Tool | Déclencheur |
|------|-------------|
| `createReservation` | Date/heure/couverts/nom confirmés |
| `checkAvailability` | Vérification créneau |
| `getOpeningHours` | Demande d'horaires |
| `handoffToManager` | Groupe ≥8, demande complexe, client mécontent, 2 incompréhensions |

Voir [[Voice Pipeline]] pour l'architecture vocale.

### 5. Jobs Queue (BullMQ)

- [ ] Evening report worker
- [ ] SMS confirmation worker
- [ ] Outbound confirm worker
- [ ] Redis call caps

**Scheduler** : `0 23 * * *` — recréé au démarrage pour chaque restaurant existant (via `setImmediate` dans `main.ts`).

Voir [[BullMQ Jobs]] pour la config des workers.

### 6. Constants & Config

- [ ] Définir `packages/config/src/constants.ts`

```typescript
PLANS = { STARTER: { label: 'Starter' }, PRO: { label: 'Pro' }, PREMIUM: { label: 'Premium' } }
INTERNAL_CALL_ALERT_THRESHOLD = 3000
CIRCUIT_BREAKER_HOURLY_LIMIT  = 200
REDIS_CTX_TTL_SECONDS         = 300
SMS_RATE_LIMIT_SECONDS        = 900
DEFAULT_VOICE_ID              = '21m00Tcm4TlvDq8ikWAM'
```

---

## Main Entry Point — points clés

- [ ] Graceful shutdown `SIGTERM` / `SIGINT`
- [ ] Au démarrage : `setImmediate` recrée tous les schedulers BullMQ `0 23 * * *` pour chaque restaurant existant
- [ ] `GET /health` vérifie PostgreSQL + Redis
- [ ] `POST /auth/*` délègué à [[Better Auth]] via `toNodeHandler`

---

## Sécurité

- [x] Webhook guard (`x-vapi-secret` validation)
- [ ] Auth guard (session Better Auth)

---

## Arborescence du Monorepo

```
sokar/
├── apps/
│   ├── api/
│   │   ├── src/modules/voice/          pipeline.ts | outcome.ts | tools.ts | prompts.ts | fillers.ts
│   │   ├── src/modules/reservations/    reservation.service.ts | reservation.schema.ts
│   │   ├── src/modules/restaurants/     restaurant.service.ts | restaurant.routes.ts
│   │   ├── src/modules/analytics/       report.service.ts
│   │   ├── src/shared/db/               schema.prisma | client.ts
│   │   ├── src/shared/queue/            queues.ts | workers/evening-report.worker.ts | workers/sms-confirmation.worker.ts
│   │   ├── src/shared/redis/            client.ts
│   │   ├── src/shared/email/            index.ts
│   │   ├── src/shared/security/         webhook.guard.ts | auth.guard.ts
│   │   └── src/main.ts
│   └── dashboard/ ...
├── packages/
│   ├── database/prisma/schema.prisma
│   ├── types/src/call-event.ts
│   └── config/src/constants.ts
├── assets/technical-issue.mp3
├── infra/ docker-compose.yml | railway.toml
├── turbo.json
└── .env.example
```

---

## Routes API Complètes

| Méthode | Route |
|---------|-------|
| POST | `/voice/incoming` |
| POST | `/voice/end` |
| POST | `/voice/function-call` |
| POST | `/restaurants` |
| GET | `/restaurants/:id` |
| PATCH | `/restaurants/:id` |
| GET | `/calls?restaurantId=&limit=&offset=` |
| GET | `/calls/:id` |
| GET | `/reservations?restaurantId=&date=` |
| POST | `/reservations` |
| PATCH | `/reservations/:id` |
| DELETE | `/reservations/:id` |
| GET | `/analytics/overview?restaurantId=&period=` |
| GET | `/health` |
| POST | `/auth/*` |

---

## Dépendances Externes

| Service | Usage | Statut |
|---------|-------|--------|
| Clerk | Auth + Stripe billing | Configuré |
| Vapi | Carrier vocal Sprint 1 | En attente |
| Telnyx | Carrier vocal Sprint 2 | SDK intégré |
| Redis | Cache + BullMQ | Configuré |
| PostgreSQL | Base de données | Configuré |
| ConfigCat | Feature flags | Configuré |
| Requestly | Mock webhooks | Configuré |
| Doppler | Secrets | Configuré |
| PostHog | Analytics | Configuré |
| Datadog | APM/Logs | Configuré |

---

## Variables d'Environnement

```
DATABASE_URL="postgresql://callyx:***@localhost:5432/callyx_dev"
REDIS_URL="redis://localhost:***@sokar.fr"
PUBLIC_URL="https://api.sokar.fr"
NODE_ENV="development"
LOG_LEVEL="info"
TZ="Europe/Paris"
BETTER_AUTH_SECRET="***"
BETTER_AUTH_URL="https://api.sokar.fr"
```

---

## Liens

- [[Architecture]]
- [[README]]
- [[API Endpoints]]
- [[Database Schema]]
- [[Better Auth]]
