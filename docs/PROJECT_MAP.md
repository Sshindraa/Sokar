# Sokar Project Map

Carte d'orientation haut niveau. Ce n'est pas une source de vérité absolue. Pour le détail, voir `docs/runbooks/` et `docs/architecture/`.

## Ce qu'est Sokar

Sokar est un SaaS français de gestion de réservations et d'appels pour restaurants, avec une IA vocale.

- **Dashboard** : espace privé restaurateur (Next.js + Clerk).
- **Sokar Connect** : site public et widget de réservation (Next.js).
- **Voice** : agent téléphonique (Telnyx + Deepgram + Cartesia TTS).
- **MCP / OpenAI Reserve** : couche agentic pour ChatGPT, Claude, etc.

## Layout du monorepo

```text
apps/
  api/            # Fastify backend (routes, workers, voice, MCP)
  dashboard/      # Next.js dashboard restaurateur (Clerk)
  connect/        # Next.js site public (SEO, fiches resto, widget)
  widget/         # Next.js widget embeddable (export)
packages/
  database/       # Prisma schema, seed, migrations
  config/         # Config partagée (ESLint, TS, Tailwind)
  shared/         # Utilitaires partagés
```

## Modules API (`apps/api/src/modules/`)

| Module                 | Rôle                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `restaurants`          | CRUD resto, onboarding, personnalité, images, score Connect, slug.                  |
| `reservations`         | CRUD réservations legacy.                                                           |
| `agentic-reservations` | MCP server, OAuth, OpenAI Reserve, holds, devis, state-machine, audit log, workers. |
| `calls`                | Historique et transcripts d'appels.                                                 |
| `customers`            | CRM, VIP, consentements.                                                            |
| `floor-plan`           | Plan de salle, sections, tables, disponibilité capacitaire.                         |
| `gift-cards`           | Cartes cadeaux, packs, redeem, contributions, Stripe.                               |
| `connect`              | API publique Connect, disponibilités, Google Places, JSON-LD.                       |
| `dashboard`            | Métriques dashboard, réactivation.                                                  |
| `analytics`            | Événements, ROI, rapports.                                                          |
| `voice`                | Pipeline Telnyx, media stream, session manager, LLM, TTS, fillers.                  |
| `sms` / `whatsapp`     | Webhooks entrants SMS / WhatsApp.                                                   |
| `auth`                 | Sync Clerk / provisionnement org.                                                   |
| `rgpd`                 | Effacement et export des données.                                                   |
| `admin`                | Feature flags et onboarding funnel.                                                 |
| `integrations`         | Routes Google.                                                                      |
| `pilot`                | Gestion des pilotes.                                                                |
| `test`                 | Helpers dev-only (non chargés en prod).                                             |

## Points d'entrée publics

- **Dashboard** : `https://sokar.tech` (Next.js App Router, Clerk).
- **Connect** : `https://sokar.tech/restaurant/<slug>`, `/restaurants/<city>`, `/widget/<slug>`.
- **Widget** : `apps/widget/src/app/restaurant-reservation/`.
- **API** : `https://api.sokar.tech`.
- **Versioning API public** : `main.ts` réécrit `/public/v1/*` vers `/public/*` (transition progressive). Les routes publiques sont dans `connect.routes.ts`.

## Pages Dashboard (`apps/dashboard/src/app/`)

- `/` — landing/marketing.
- `/login`, `/register` — Clerk auth.
- `/onboarding/[step]` — onboarding restaurateur.
- `/dashboard` — métriques, graphiques, sync org.
- `/dashboard/reservations` — liste réservations.
- `/dashboard/calls` — appels.
- `/dashboard/customers` — CRM.
- `/dashboard/floor-plan` — plan de salle.
- `/dashboard/gift-cards`, `/dashboard/gift-card-packs` — cartes cadeaux.
- `/dashboard/connect` — publication Connect.
- `/dashboard/agentic` — agentic reservations.
- `/dashboard/reactivation` — campagnes VIP.
- `/dashboard/settings` — paramètres.
- `/dashboard/widget` — widget embarqué.
- `/mcp` — page MCP OAuth.
- `/api/auth/sync` — sync Clerk.
- `/api/proxy/[...path]` — proxy vers l'API.

## Pages Connect (`apps/connect/src/app/`)

- `page.tsx` — homepage.
- `restaurant/[slug]/` — fiche restaurant (ISR prod, `force-dynamic` staging).
- `restaurants/[city]/` — listing ville.
- `widget/[slug]/` — widget standalone (réservation + cartes cadeaux).
- `assistant/` — page assistant.
- `.well-known/ai-plugin/` — discovery MCP/OpenAI.
- `llms.txt` — context LLM.
- `privacy/` — privacy policy.

## Flux de réservation

### Legacy (téléphone / web dashboard)

- Appel entrant → Telnyx → `voice/telnyx.pipeline.ts` → LLM/Deepgram → `reservations`.
- Dashboard → `reservations/reservation.routes.ts` → `reservation.service.ts`.

### Agentic / MCP

- Agent IA → `agentic-reservations/mcp/server.ts`.
- Tools : availability, hold, quote, confirm, cancel.
- State-machine : `agentic-reservations/core/state-machine.ts`.
- Expiration des holds/devis : `agentic-reservations/workers/`.
- Feed OpenAI Reserve : `agentic-reservations/openai-reserve/`.
- Spec détaillée : `docs/sokar-mcp-agentic-reservations-v3.2.md`.

### Connect / widget

- Page publique → `connect.service.ts` / `availability.service.ts`.
- Widget : `apps/connect/src/components/booking-widget.tsx` et `apps/widget/src/app/restaurant-reservation/`.
- Cartes cadeaux : `widget/[slug]/gift-card/` et `gift-card-*` components.

## Paiements

- Seules les cartes cadeaux sont en P1 (pas de Stripe réel en P1, mode test/marquage).
- Module `gift-cards/` : routes, service, paiement, Stripe helper.
- Modèles : `GiftCard`, `GiftCardPack`, `GiftCardRedemption`, `GiftCardContribution`.
- Spec : `docs/gift-cards-spec.md`.

## Voice

- Carrier : Telnyx.
- Pipeline : `apps/api/src/modules/voice/telnyx.pipeline.ts`.
- WebSocket media stream : `modules/voice/stream/` (handler, session manager, LLM, TTS, fillers cache).
- TTS : Cartesia Sonic 3.5 (`voice/cartesia-synth.ts`, `fillers-cache.ts`).
- STT : Deepgram.
- Voir `docs/architecture/voice.md` et `docs/obsidian/Telnyx Pipeline.md`.

## Authentification

- Clerk JWT multi-tenant.
- Plugin Fastify : `apps/api/src/plugins/clerk.ts` (`requireOrg` pre-handler).
- Dashboard : middleware/pages Clerk dans `login/`, `register/`.
- MCP OAuth : `agentic-reservations/mcp/oauth.ts`.

## Base de données (Prisma)

Modèles clés (`packages/database/prisma/schema.prisma`) :

| Modèle                                                                   | Rôle                               |
| ------------------------------------------------------------------------ | ---------------------------------- |
| `Restaurant`, `RestaurantImage`, `RestaurantExposureSettings`            | Core resto et publication Connect. |
| `Call`, `Reservation`, `AgentPersonality`, `CallQuota`                   | Appels et réservations.            |
| `Customer`, `Message`, `CustomerConsent`, `ReactivationCampaign`         | CRM et marketing.                  |
| `FloorPlan`, `Section`, `Table`                                          | Plan de salle.                     |
| `AgenticHold`, `ReservationAuditLog`, `IdempotencyRecord`, `AgentClient` | Agentic layer.                     |
| `GiftCard`, `GiftCardPack`, `GiftCardRedemption`, `GiftCardContribution` | Paiements (cartes cadeaux).        |
| `IdentityVerificationOtp`, `SignedTokenUsage`                            | RGPD — vérification identité.      |
| `OnboardingEvent`                                                        | Analytics onboarding.              |
| `LatencyTrace`                                                           | Latence voice.                     |

## Jobs & queues (BullMQ)

Définitions de queues : `apps/api/src/shared/queue/queues.ts`. Workers : `apps/api/src/shared/queue/workers/`.

- `eveningReport` — rapport nocturne par restaurant.
- `confirmationSms` — SMS de rappel J-1 à 17h.
- `reconciliation` — reconciliation appels/SMS journalière.
- `reactivation` — réactivation VIP hebdomadaire.
- `analytics` / `connectAnalytics` — événements analytics.
- `telnyxWebhooks` — webhooks Telnyx entrants.
- `callRecovery` — recovery d'appels.
- `smsManager` / `smsClient` — envoi SMS.
- `googlePlacesSync` — sync Google Places.
- `alertEvaluation` — évaluation d'alertes Prometheus (toutes les 5 min).

## Tests

```zsh
pnpm test       # Vitest
pnpm lint       # turbo lint + stylelint
pnpm lint:css
pnpm test:e2e   # Playwright dashboard
pnpm test:visual # régression visuelle
```

- Tests API : `*.routes.test.ts` / `*.service.test.ts` dans les modules.
- Tests dashboard : `apps/dashboard/e2e/`.
- Tests Connect : `apps/connect/src/app/**/*.test.ts`.

## CI / déploiement

- GitHub Actions : `.github/workflows/`.
- Staging : auto-deploy sur `main` + smoke tests.
- Production : confirmation explicite requise. Voir `docs/runbooks/deployment.md` et `docs/runbooks/rollback.md`.

## Points sensibles / contraintes

- Ne jamais committer de secrets ; utiliser `key_env` et `.env`.
- `NEXT_PUBLIC_*` est baked au build time.
- Les webhooks Telnyx nécessitent le raw body pour vérifier la signature. Ne pas modifier le `contentTypeParser` de `main.ts` sans retester les signatures.
- Rate limiting et CORS : `apps/api/src/plugins/`.
- Agentic : expiration des holds/devis, index partiel sur l'idempotence.
- RGPD : erase/export via pattern OTP → verification token → one-shot action.
- Connect : pages publiques statiques/ISR ; staging force-dynamic pour `/restaurant/[slug]`.
- Dashboard : règles UI verrouillées par `stylelint` et `onboarding-tone.test.ts` (`vous` partout).
- Compte `deploy` restreint : `sokar-deploy-root` pour les opérations privilégiées.

## Docs connexes

- `AGENTS.md` — contexte court pour agents.
- `docs/runbooks/` — ops, déploiement, environnement, tests.
- `docs/architecture/` — dashboard, voice.
- `docs/obsidian/` — specs, pipelines, contexte produit.
- `docs/gift-cards-spec.md` — cartes cadeaux.
- `docs/sokar-mcp-agentic-reservations-v3.2.md` — agentic reservations.
- `docs/connect-v1.1.md` — Sokar Connect.
