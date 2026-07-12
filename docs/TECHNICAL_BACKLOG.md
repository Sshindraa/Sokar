# Technical Backlog

> Phase 4 — Priorisation des résultats des audits (Sécurité, Réservations/Paiements, Déploiement/Infra, Qualité/Tests).

## Règles de priorité

- **P0 — Bloquant ou risque critique** : perte de données, fuite de secrets, paiement incorrect, faille d'autorisation, production instable.
- **P1 — Important** : bug important, absence de test sur un parcours critique, déploiement fragile.
- **P2 — Amélioration** : dette technique, refactor, UX, optimisation non urgente.

**Légende des statuts :**

- `Corrigé` — le fix est dans `main`.
- `Non corrigé` — à traiter.

_Classification proposée, chaque item doit être re-vérifié avant exécution._

---

## P0 — Bloquant ou risque critique

| ID      | Fichiers                                                                             | Problème                                                              | Correction recommandée                                                                     | Test attendu                                                                                      | Statut  |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------- |
| SEC-001 | `apps/api/src/modules/whatsapp/whatsapp-webhook.routes.ts`                           | Webhook WhatsApp sans vérification de signature                       | `telnyxWebhookGuard` en preHandler                                                         | Test unitaire payload signé / invalidé                                                            | Corrigé |
| SEC-002 | `apps/api/src/modules/agentic-reservations/mcp/oauth.ts`                             | Rate limiting OAuth en `Map` mémoire (non distribué)                  | Migrer `oauthRateMap` vers Redis avec TTL                                                  | `oauth.integration.test.ts`                                                                       | Corrigé |
| SEC-003 | `apps/api/src/main.ts`                                                               | `trustProxy: true` sans validation des IPs proxy                      | `TRUSTED_PROXY_IPS` limité à `127.0.0.1`, `::1`, IP VPS                                    | Test de `req.ip` avec proxy non fiable                                                            | Corrigé |
| RES-001 | `apps/api/src/main.ts` + `agentic-reservations/workers/expire-*`                     | Workers d'expiration non importés / scheduling non appelé             | Importer workers, appeler `scheduleHoldExpiration` / `scheduleQuoteExpiration`             | Test expiration end-to-end                                                                        | Corrigé |
| RES-002 | `apps/api/src/modules/floor-plan/table-allocation.service.ts`                        | Allocation de tables non atomique                                     | `SELECT FOR UPDATE SKIP LOCKED` sur `floor_plan_tables`                                    | Test d'allocation concurrente                                                                     | Corrigé |
| RES-003 | `apps/api/src/modules/gift-cards/gift-card.service.ts`                               | Aucun remboursement cartes cadeaux                                    | Endpoint admin + Stripe Refunds + audit log                                                | Test de remboursement                                                                             | Corrigé |
| RES-004 | `apps/api/src/modules/agentic-reservations/core/reservation.service.ts`              | Consommation du hold sans `SELECT FOR UPDATE`                         | Verrouiller le hold dans la transaction                                                    | `reservation.service.test.ts`                                                                     | Corrigé |
| DEP-001 | `scripts/backup-postgres.sh` + `infra/cron`                                          | Pas de backup automatisé de `sokar_staging`                           | Script + cron staging + rétention 7 jours                                                  | Test end-to-end backup                                                                            | Corrigé |
| DEP-002 | `apps/api/.env.staging.example` + `scripts/ops/setup-staging.sh`                     | Password `password` par défaut                                        | `CHANGE_ME_PASSWORD` + validation setup                                                    | `setup-staging.sh` dry-run                                                                        | Corrigé |
| QUA-001 | `apps/api/src/modules/connect/jsonld.service.ts` + `apps/connect/src/lib/jsonld.tsx` | `buildPublicRestaurantJsonLd` dupliqué                                | Extraire dans `@sokar/shared`                                                              | `packages/shared/src/__tests__/jsonld.test.ts` + `apps/connect/src/lib/__tests__/jsonld.test.tsx` | Corrigé |
| RES-006 | `apps/api/src/modules/gift-cards/gift-card.service.ts`                               | Application carte cadeau sans verrou (possibilité de sur-utilisation) | `SELECT FOR UPDATE` sur `GiftCard` + `CHECK remainingAmount >= 0`                          | `gift-card.service.test.ts`                                                                       | Corrigé |
| DEP-005 | `infra/ecosystem*.config.js`                                                         | PM2 sans health checks                                                | `min_uptime`, `wait_ready` + `listen_timeout`, `kill_timeout`, `exp_backoff_restart_delay` | `node -e` + `apps/api` tests                                                                      | Corrigé |

---

## P1 — Important

| ID      | Fichiers                                                                                              | Problème                                                               | Correction recommandée                                                                                                      | Test attendu                                   | Statut      |
| ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- |
| SEC-004 | `apps/api/src/plugins/rate-limit.ts` + `modules/rgpd/rgpd.routes.ts`                                  | Rate limit global 100 req/min sans distinction des endpoints sensibles | `config.rateLimit` sur `/api/rgpd/{request-verification,confirm-verification,confirm-link,erase,export,withdraw-marketing}` | `rgpd.rate-limit.test.ts`                      | Corrigé     |
| SEC-005 | `apps/api/src/main.ts` + `env.ts` + `test/test.routes.ts`                                             | Routes de test protégées uniquement par `NODE_ENV`                     | `ENABLE_TEST_ROUTES` explicite + default false                                                                              | `test.routes.guard.test.ts`                    | Corrigé     |
| SEC-006 | `apps/api/src/shared/observability/observability.routes.ts` + `env.ts`                                | `/metrics` public sans auth                                            | Auth basique (METRICS*BASIC_AUTH*\*) ou allowlist IP (METRICS_ALLOWLIST_IPS)                                                | `observability.routes.test.ts`                 | Corrigé     |
| SEC-007 | `apps/api/src/modules/agentic-reservations/mcp/auth.ts`                                               | Fallback `AGENT_DEV_KEY` basé sur `NODE_ENV`                           | Vérification explicite `ENABLE_DEV_AUTH`                                                                                    | Test activation `AGENT_DEV_KEY` en prod        | Non corrigé |
| SEC-008 | `apps/api/src/modules/connect/connect.routes.ts`                                                      | Mix `.parse()` et `.safeParse()`                                       | Standardiser sur `.safeParse()` + gestion 400                                                                               | Tests de réponses 400                          | Non corrigé |
| RES-005 | `apps/api/src/modules/agentic-reservations/core/idempotency.service.ts`                               | `purgeExpired()` non appelé                                            | Cron BullMQ de purge quotidienne                                                                                            | Test de purge                                  | Non corrigé |
| RES-007 | `apps/api/src/modules/agentic-reservations/openai-reserve/openai-reserve.routes.ts`                   | Feed `/v1/businesses` public sans signature                            | HMAC partagé + rate limiting plus strict                                                                                    | Test de signature / rate limit                 | Non corrigé |
| RES-008 | `apps/api/src/modules/agentic-reservations/core/hold.service.ts`                                      | Cleanup des holds expirés non systématique                             | Worker cron + index `(status, expiresAt)`                                                                                   | Test de cleanup                                | Non corrigé |
| RES-009 | `packages/database/prisma/schema.prisma`                                                              | Pas d'index sur `actorHash` dans `ReservationAuditLog`                 | `@@index([actorHash])` + `(event, createdAt)`                                                                               | Vérifier requêtes d'audit                      | Non corrigé |
| RES-010 | `apps/api/src/modules/agentic-reservations/core/state-machine.ts`                                     | Transitions sans validation d'invariants                               | Vérifier `tableId` non null pour `SEATED`, `startsAt` passé, etc.                                                           | Tests de transitions invalides                 | Non corrigé |
| RES-011 | `packages/database/prisma/schema.prisma`                                                              | Index partiel idempotence non visible dans Prisma                      | Commentaire dans `schema.prisma` + test de migration                                                                        | Vérifier migration                             | Non corrigé |
| RES-012 | `apps/api/src/modules/gift-cards/gift-card.service.ts`                                                | `generateUniqueShortCode` sans retry P2002                             | `try/catch` + retry sur violation unique                                                                                    | Test de collision de code                      | Non corrigé |
| RES-013 | `apps/api/src/modules/floor-plan/availability-capacity-aware.service.ts`                              | Pas de cache Redis pour disponibilité                                  | Cache TTL court + invalidation sur mutation                                                                                 | Tests de cache                                 | Non corrigé |
| DEP-003 | `scripts/deploy-vps.sh` / `deploy-staging.sh`                                                         | Rollback sans restauration DB                                          | Option `--with-db-rollback` + backup timestampé                                                                             | Test de rollback DB                            | Non corrigé |
| DEP-004 | `scripts/deploy-staging.sh`                                                                           | Vérification `git diff` après `git pull`                               | Vérifier avant le pull, option `--force`                                                                                    | Test de déploiement avec modifications locales | Non corrigé |
| DEP-007 | `scripts/deploy-vps.sh` / `deploy-staging.sh`                                                         | `sleep 8` après `pm2 restart`                                          | Boucle `/health` + `/livez` avec timeout configurable                                                                       | Test de déploiement                            | Non corrigé |
| DEP-008 | `scripts/ops/setup-staging.sh`                                                                        | `.env` copiés sans validation des placeholders                         | `validate_env_files()` dans `deploy-staging.sh`                                                                             | Test de validation `.env`                      | Non corrigé |
| DEP-009 | `infra/nginx/sokar-staging.conf`                                                                      | Pas de `limit_req` en staging                                          | Copier/adapter les zones de prod                                                                                            | Test de rate limit Nginx                       | Non corrigé |
| QUA-002 | `apps/api/src/modules/voice/__tests__/`                                                               | 17 tests voice cassés (mocks obsolètes)                                | Session dédiée pour mettre à jour les mocks                                                                                 | Voice tests passants                           | Non corrigé |
| QUA-003 | `apps/dashboard/src/app/dashboard/reservations/page.tsx` + `components/gift-cards/gift-card-list.tsx` | `@ts-ignore` date-fns                                                  | Résoudre résolution types date-fns                                                                                          | Typecheck dashboard                            | Non corrigé |
| QUA-004 | `apps/api/src/modules/rgpd/erasure.service.ts`                                                        | `@ts-expect-error` sur `Call.customerPhone`                            | Vérifier schema Prisma + type guard                                                                                         | Typecheck API                                  | Non corrigé |
| QUA-005 | `apps/api/src/modules/connect/connect.routes.ts`                                                      | `slugifyCity` / `slugifyCuisine` locales                               | Extraire dans `@sokar/shared` si Connect en a besoin                                                                        | Tests unitaires                                | Non corrigé |

---

## P2 — Amélioration

| ID      | Fichiers                                                                  | Problème                                                | Statut      |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------- | ----------- |
| SEC-009 | `apps/api/src/modules/rgpd/identity-verification.service.ts`              | OTP RGPD sans captcha                                   | Non corrigé |
| SEC-010 | `apps/api/src/env.ts`                                                     | `localhost` dans `PROD_HOST_ALLOWLIST`                  | Non corrigé |
| SEC-011 | `apps/api/src/modules/rgpd/rgpd.routes.ts`                                | Champs `string` sans `max()`                            | Non corrigé |
| SEC-012 | `apps/api/src/main.ts`                                                    | Logger redaction : secrets Stripe/SMTP/Google manquants | Non corrigé |
| SEC-013 | `apps/api/src/modules/sms/sms-inbound.routes.ts`                          | Validation minimale du payload Telnyx                   | Non corrigé |
| SEC-014 | `apps/api/src/plugins/cors.ts`                                            | Origines CORS non validées comme URLs                   | Non corrigé |
| SEC-015 | `AGENTS.md`                                                               | Mention de `key_env` sans contexte                      | Non corrigé |
| RES-014 | `apps/api/src/shared/db/transaction-options.ts`                           | Timeout de transaction 10s peut être court              | Non corrigé |
| RES-015 | `packages/database/prisma/schema.prisma`                                  | `ReservationAuditLog` sans `correlationId`              | Non corrigé |
| DEP-006 | `infra/nginx/snippets/sokar-cloudflare-real-ip.conf`                      | IPs Cloudflare hardcodées                               | Non corrigé |
| DEP-010 | `.env.staging.example` (API, dashboard)                                   | Patterns `pk_test_...` / `sk_test_...`                  | Non corrigé |
| DEP-011 | `scripts/backup-postgres.sh` / `backup-postgres-r2.sh`                    | Pas de vérification d'espace disque                     | Non corrigé |
| DEP-012 | `scripts/deploy-*.sh` + workflows                                         | Pas de notification d'échec                             | Non corrigé |
| DEP-013 | `scripts/ops/sokar-deploy-root.sh`                                        | Restauration nginx non garantie                         | Non corrigé |
| DEP-014 | `scripts/deploy-vps.sh` / `deploy-staging.sh`                             | Logs non structurés                                     | Non corrigé |
| DEP-015 | `scripts/deploy-*.sh`                                                     | Pas de vérification de version Node                     | Non corrigé |
| QUA-006 | `apps/connect/e2e/*.spec.ts`                                              | E2E Connect skippés si API down                         | Non corrigé |
| QUA-007 | `apps/api/src/modules/agentic-reservations/__tests__/concurrency.test.ts` | `describe.skip` conditionnel `AGENTIC_INT_TESTS`        | Non corrigé |
| QUA-008 | `apps/api/src`                                                            | 559 occurrences de `any`                                | Non corrigé |
| QUA-009 | `apps/connect/src/components/gift-card/use-gift-card-flow.ts`             | `err: any` dans catch                                   | Non corrigé |
| QUA-010 | `apps/api/vitest.config.ts`                                               | Monkey-patch `fs.readFileSync`                          | Non corrigé |
| QUA-011 | `apps/api/eslint.config.mjs` vs `apps/*/.eslintrc.json`                   | ESLint incohérent (flat vs legacy)                      | Non corrigé |
| QUA-012 | `.stylelintrc.json`                                                       | Config stylelint non centralisée                        | Non corrigé |
| QUA-013 | `package.json`                                                            | Prettier config dans `package.json`                     | Non corrigé |
| QUA-014 | `apps/dashboard/src`                                                      | Un seul test unitaire (`proxy.test.ts`)                 | Non corrigé |
| QUA-015 | `docs/obsidian/Context.md`                                                | tsserver lock 100% CPU                                  | Non corrigé |

---

## Prochaines étapes

1. Tous les P0 sont corrigés.
2. **Valider les P1** avec le product owner / pilote avant implémentation.
3. **Ne pas traiter les P2** avant que P0 et P1 soient résolus.
4. **Mettre à jour ce fichier** à chaque correction (changer `Statut` en `Corrigé` et ajouter le test/PR).
5. **Re-auditer** après les corrections pour vérifier les non-régressions.
