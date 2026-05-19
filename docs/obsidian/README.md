# Callyx — Guide de Démarrage

Bienvenue dans le vault Obsidian Callyx. Ce vault centralise la documentation, les objectifs de sprint, les décisions d'architecture et les notes de réunion du projet.

---

## Architecture

Callyx est un monorepo (pnpm workspace + Turborepo) dédié à la gestion de réservations de restaurants avec un assistant vocal IA.

- **Backend API** : Fastify 5 + Prisma 6 + Redis + BullMQ + Telnyx → [[Architecture#API]]
- **Dashboard** : Next.js 14 (App Router) + React 18 + Tailwind 3 → [[Architecture#Dashboard]]
- **Voice Pipeline** : Telnyx (carrier), Deepgram (STT), LLM via OpenRouter, ElevenLabs/Cartesia (TTS) → [[Architecture#Voice]]
- **Jobs Queue** : BullMQ (evening report, SMS confirmation, outbound confirm)
- **Agent IA** : Hermes CLI (deepseek/deepseek-v4-flash) pour automatisation dev

Voir [[Architecture]] pour les détails complets.

## API Endpoints

L'API Fastify expose les modules suivants :

| Module | Routes | Description |
|--------|--------|-------------|
| Restaurants | `restaurant.routes.ts` | CRUD restaurants, quotas, availability |
| Calls | `call.routes.ts` | Historique des appels, transcripts |
| Reservations | `reservation.routes.ts` | Création, confirmation, annulation |
| Customers | `customer.routes.ts` | Profil clients, VIP, loyalty |
| Analytics | `analytics.routes.ts` | ROI, KPIs, reports |
| Dashboard | `dashboard.routes.ts` | Métriques temps réel |
| Voice (Telnyx) | `telnyx.pipeline.ts` | Webhooks, pipeline STT/LLM/TTS |

Voir [[API Endpoints]] pour la documentation complète des routes et schémas Zod.

## Database Schema

Prisma 6 avec PostgreSQL. Modèles principaux :

- **User** / **Session** / **Account** — Auth Clerk (multi-tenant)
- **Restaurant** — Établissement avec plan (STARTER/PRO/PREMIUM), opening hours, carrier (vapi/telnyx)
- **Call** — Appel vocal avec transcript, intent, outcome, latencies
- **Reservation** — Réservation liée à un call et/ou customer
- **Customer** — Client restaurant avec loyalty score, isVip
- **AgentPersonality** — Configuration vocale (profile type, speaking rate, filler style)
- **CallQuota** — Quotas mensuels par restaurant
- **LatencyTrace** — Métriques de latence STT → LLM → TTS

Voir [[Database Schema]] pour le schema complet et les indexes.

## TODOs

- [[Sprint 1]] — MVP en cours (Vapi voice, Clerk auth, dashboard minimal, evening report)
- [[Sprint 2]] — Telnyx migration, memory client cache, TTS Redis cache, VIP mode
- [[Sprint 3]] — Revenue tracking, Hermes post-call analysis, LocalStack AWS
- [[Figma Design]] — UI/UX design system
- [[Testing Strategy]] — Vitest, test coverage, integration tests

## Meeting Notes

- [[Meeting Notes Template]]
- [[2025-05-15 Sprint Planning]]
- [[2025-05-19 Architecture Review]]