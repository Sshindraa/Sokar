# API Endpoints

> **Dernière mise à jour** : 2026-06-24
> **Base URL dev** : `http://localhost:3001` (port configuré dans `apps/api/src/main.ts`)
> **Auth globale** : Clerk (sauf routes explicitement publiques — MCP, voice webhook, public Sokar Connect, RGPD `request-verification`, `confirm-link`, `privacy-policy`)
> **Génération** : inventaire auto depuis les fichiers `*.routes.ts` / `*.pipeline.ts`

Documentation exhaustive des **~57 routes** exposées par Fastify.

---

## Restaurants

Module : `apps/api/src/modules/restaurants/restaurant.routes.ts`

### POST /restaurants

Crée un restaurant. (probablement utilisé en onboarding initial — à confirmer)

### GET /restaurants/:id

Récupère un restaurant par ID (auth Clerk requise).

### PATCH /restaurants/:id

Met à jour un restaurant.

### GET /restaurants/:id/public

Profil public basique (auth Clerk requise). **Note** : ne pas confondre avec
les futures routes `/public/r/:slug` de Sokar Connect qui seront **anonymes**.

### GET /restaurants/:id/availability

Disponibilités d'un restaurant. Réutilisée par les canaux agentic.

### GET /restaurants/:id/personality / PATCH /restaurants/:id/personality

Configuration de la personnalité vocale (AgentPersonality).

### Onboarding

| Méthode | Route                                                                        | Description        |
| ------- | ---------------------------------------------------------------------------- | ------------------ |
| GET     | `/restaurant/onboarding` ou `/api/restaurant/onboarding`                     | État d'onboarding  |
| PATCH   | `/restaurant/onboarding` ou `/api/restaurant/onboarding`                     | Mise à jour état   |
| POST    | `/restaurant/onboarding/test-call` ou `/api/restaurant/onboarding/test-call` | Test outbound call |

Les routes existent en double préfixe (`/restaurant` et `/api/restaurant`)
probablement pour des raisons de compat historique.

---

## Reservations

Module : `apps/api/src/modules/reservations/reservation.routes.ts`

### GET /reservations

Liste les réservations d'un restaurant, filtrées par date.

### POST /reservations

Crée une réservation (canal legacy `phone`).

### PATCH /reservations/:id / DELETE /reservations/:id

Mise à jour / suppression.

> **⚠️ Smell documenté** : le `GET /reservations` exige `restaurantId`
> en query param alors que `req.restaurantId` est injecté par `requireOrg`.
> Voir `apps/api/src/modules/reservations/__tests__/reservation.routes.test.ts`
> (TODO cleanup-call-and-reservation-routes).

---

## Calls

Module : `apps/api/src/modules/calls/call.routes.ts`

### GET /calls / GET /calls/:id / DELETE /calls/:id

Historique des appels, transcripts, durées.

---

## Customers

Module : `apps/api/src/modules/customers/customer.routes.ts`

### GET /customers / POST /customers

Liste et création.

### PATCH /customers/:id / DELETE /customers/:id

Mise à jour / suppression.

### POST /customers/:id/vip

Passe un client en VIP (notification gérée côté worker BullMQ).

---

## Dashboard

Module : `apps/api/src/modules/dashboard/dashboard.routes.ts`

### GET /dashboard/stats

KPIs temps réel : `total_calls`, `total_reservations`, `covers`,
`conversion_rate`, `answered_rate`, `estimated_revenue`.

### GET /dashboard/analytics

Timeseries (24h/7j/30j) : `calls`, `reservations`, `revenue`.

### GET /dashboard/weekly-calls / GET /dashboard/recent-activity

Widgets annexes.

---

## Analytics

Module : `apps/api/src/modules/analytics/analytics.routes.ts`

### GET /analytics/roi

ROI consolidé (revenue recovered vs coût Telnyx).

### GET /analytics/latency

Latences p50/p95/p99 STT/LLM/TTS.

---

## Voice (Telnyx)

Module : `apps/api/src/modules/voice/telnyx.pipeline.ts`

Voir [[Telnyx Pipeline]] pour le détail.

### POST /voice/telnyx

Webhook `call.initiated`. Retourne `ai_config` à Telnyx.
**Public** (signature Ed25519 vérifiée par `telnyx.guard.ts`).

### POST /voice/telnyx/end

Webhook fin d'appel. Met à jour Call record + transcript + outcome.

---

## Auth

Module : `apps/api/src/modules/auth/auth.routes.ts`

### POST /api/auth/sync

Sync Clerk → DB (création/mise à jour restaurant + onboarding state).

---

## Agentic Reservations (Admin)

Module : `apps/api/src/modules/agentic-reservations/admin/admin.routes.ts`

### GET/POST /api/agentic/opt-in

Toggle opt-in agentic par restaurant.

### GET/PUT /api/agentic/exposure-settings

Édition des exposure settings (mcpEnabled, openaiReserveEnabled,
`connectPublished`, `connectAgentic`, etc.).

### GET/POST/DELETE /api/agentic/mcp-clients

CRUD des clients MCP (API keys, scopes, allowedOrigins).

---

## Agentic Reservations (MCP Server)

Module : `apps/api/src/modules/agentic-reservations/mcp/server.ts`

### GET/POST /mcp

Endpoint JSON-RPC MCP. **Public** via OAuth 2.0 (RFC 8414 discovery,
RFC 7591 DCR) ou API key. Sert les tools :
`search_restaurants`, `check_availability`, `create_hold`,
`confirm_reservation`, `cancel_reservation`.

Voir `docs/sokar-mcp-integrator-guide.md` pour le détail intégrateur.

---

## OpenAI Reserve (Apps SDK)

Module : `apps/api/src/modules/agentic-reservations/openai-reserve/openai-reserve.routes.ts`

### GET /v1/businesses / GET /v1/tools

Business feed (référencé par l'Apps SDK).

### POST /v1/tools/restaurant_reservation

Tool execution (widget OpenAI).

---

## RGPD

Module : `apps/api/src/modules/rgpd/rgpd.routes.ts`

### POST /api/rgpd/request-verification

Demande OTP (SMS/email) — three-token pattern.

### POST /api/rgpd/confirm-verification

Confirme l'OTP et retourne un verification token.

### GET /api/rgpd/confirm-link

Lien signé one-shot (alternative à OTP pour web).

### POST /api/rgpd/erase

Effacement données sujet (vérification token requis).

### POST /api/rgpd/export

Export données sujet (vérification token requis).

### POST /api/rgpd/withdraw-marketing

Retrait consentement marketing.

### GET /api/rgpd/privacy-policy

Page privacy policy publique (RGPD Article 13).

---

## Integrations (Google Calendar)

Module : `apps/api/src/modules/integrations/google.routes.ts`

### GET /integrations/google-calendar/auth

Initie OAuth Google.

### GET /integrations/google-calendar/callback

Callback OAuth.

### POST /integrations/google-calendar/disconnect

Déconnecte le calendrier Google du restaurant.

---

## Admin / Flags

Module : `apps/api/src/modules/admin/flags.routes.ts`

### GET /admin/flags

Liste des feature flags (ConfigCat).

---

## Pilot (interne)

Module : `apps/api/src/modules/pilot/pilot.routes.ts`

### GET /api/internal/pilot-kpis

KPIs internes pilote (VPN only). Cf. `docs/runbook.md`.

---

## Test (dev only)

Module : `apps/api/src/modules/test/test.routes.ts`

### POST /api/test/simulate-call

Simule un appel Telnyx entrant (dev/test).

### POST /api/test/simulate-utterance

Injecte une utterance dans une session vocale.

### GET /api/test/simulate-call/:callControlId/reservations

Liste les résas créées par un appel simulé.

### GET /api/test/restaurants / DELETE /api/test/restaurants

CRUD restos de test.

> ⚠️ **Dev only** — ne jamais exposer en prod.

---

## Health / Observability (en shared/, pas dans modules/)

Modules : `apps/api/src/shared/observability/`

### GET /health

Health check agrégé (db, redis, queues, telnyx, deepgram, cartesia).
Pattern multi-check parallèle avec timeout individuel (cf. `sokar-fastify-testing` §health).

### GET /metrics

Exposition Prometheus (texte brut, scrape par Grafana).

### GET /health/observability

Smoke test Sentry + metrics.

---

## Sokar Connect (à venir T2)

Module : `apps/api/src/modules/connect/` (à créer)

Endpoints prévus, **tous publics** (no Clerk) :

| Méthode | Route                          | Description                            |
| ------- | ------------------------------ | -------------------------------------- |
| GET     | `/public/r/:slug`              | Fiche restaurant publique              |
| GET     | `/public/r/:slug/availability` | Slots dispo temps réel                 |
| POST    | `/public/r/:slug/hold`         | Crée hold 5min (TTL)                   |
| POST    | `/public/r/:slug/confirm`      | Confirme résa (Idempotency-Key requis) |

Voir [[Sokar Connect P0]] et `docs/connect-v1.1.md` pour le détail.

---

## Récapitulatif par préfixe

| Préfixe                             | # routes        | Auth                           | Module         |
| ----------------------------------- | --------------- | ------------------------------ | -------------- |
| `/restaurant*`                      | 4 (×2 préfixes) | Clerk                          | restaurants    |
| `/restaurants/:id`                  | 3               | Clerk                          | restaurants    |
| `/reservations`                     | 4               | Clerk                          | reservations   |
| `/calls`                            | 3               | Clerk                          | calls          |
| `/customers`                        | 5               | Clerk                          | customers      |
| `/dashboard`                        | 4               | Clerk                          | dashboard      |
| `/analytics`                        | 2               | Clerk                          | analytics      |
| `/voice/*`                          | 2               | Public (Ed25519)               | voice          |
| `/api/auth/*`                       | 1               | Public                         | auth           |
| `/api/agentic/*`                    | 7               | Clerk                          | agentic admin  |
| `/mcp`                              | 1               | OAuth 2.0 / API key            | MCP            |
| `/v1/*` (OpenAI)                    | 3               | OAuth Apps SDK                 | openai-reserve |
| `/api/rgpd/*`                       | 7               | Mix (verify public, ops Clerk) | rgpd           |
| `/integrations/*`                   | 3               | Clerk                          | integrations   |
| `/admin/flags`                      | 1               | Clerk                          | admin          |
| `/api/internal/*`                   | 1               | VPN                            | pilot          |
| `/api/test/*`                       | 5               | Dev only                       | test           |
| `/health`, `/metrics`               | 3               | Public                         | shared         |
| `/public/r/:slug/*` (Sokar Connect) | 4               | **Public**                     | connect (T2)   |

Total : **~57 routes** actives + 4 à venir.
