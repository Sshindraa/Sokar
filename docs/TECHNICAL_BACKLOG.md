# Technical Backlog — Phase 3

Ce fichier consolide les audits de Phase 3 : 4 audits en lecture seule (sécurité, réservations/paiements, déploiement/infra, qualité/tests).  
Il est priorisé et n'est pas une source de vérité absolue : chaque finding doit être re-vérifié avant toute exécution.

## Méthodologie

- **Mode** : analyse lecture seule, aucun code métier modifié.
- **Angles** : sécurité, réservations/paiements, déploiement/infra, qualité/tests.
- **Niveaux de risque** : Critical / High / Medium / Low / Info.

## Top 10 des priorités cross-audits

1. **[Critical] Webhook WhatsApp sans vérification de signature** — `apps/api/src/modules/whatsapp/whatsapp-webhook.routes.ts` : ajouter `telnyxWebhookGuard` ou équivalent.
2. **[Critical] Workers d'expiration des holds/quotes non enregistrés** — `apps/api/src/main.ts` : importer `expire-hold.worker.ts` / `expire-quote.worker.ts` et appeler `scheduleHoldExpiration()` / `scheduleQuoteExpiration()`.
3. **[Critical] Race condition dans l'allocation de tables** — `apps/api/src/modules/floor-plan/table-allocation.service.ts` : `SELECT FOR UPDATE SKIP LOCKED` ou contrainte unique partielle.
4. **[Critical] Aucun mécanisme de remboursement cartes cadeaux** — `apps/api/src/modules/gift-cards/` : implémenter Stripe Refunds + audit trail.
5. **[Critical] Pas de backup automatisé de la base `sokar_staging`** — `scripts/backup-postgres.sh` : ajouter un backup staging + cron.
6. **[Critical] Password par défaut dans `.env.staging.example`** — `apps/api/.env.staging.example` : remplacer `password` par un placeholder et valider au setup.
7. **[High] Transaction de création de réservation sans verrou sur le hold** — `agentic-reservations/core/reservation.service.ts` : `SELECT FOR UPDATE` sur le hold avant consommation.
8. **[High] Rate limiting OAuth en Map mémoire** — `agentic-reservations/mcp/oauth.ts` : migrer `oauthRateMap` vers Redis.
9. **[High] `trustProxy: true` sans validation des IPs proxy** — `apps/api/src/main.ts` : restreindre aux IPs Nginx/VPS.
10. **[Critical] Duplication `buildPublicRestaurantJsonLd` entre API et Connect** — `apps/api/src/modules/connect/jsonld.service.ts` + `apps/connect/src/lib/jsonld.tsx` : extraire dans `@sokar/shared`.

---

## 1. Audit Sécurité

**Résumé** : architecture solide, validation Zod, gestion des secrets via env, raw body pour webhooks. Points critiques sur WhatsApp, rate limiting, trustProxy.

### Findings

| #   | Risque   | Fichier(s)                                          | Problème                                                               | Recommandation                                                    |
| --- | -------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Critical | `whatsapp/whatsapp-webhook.routes.ts`               | Webhook WhatsApp sans vérification de signature                        | Ajouter `telnyxWebhookGuard` ou vérification signature spécifique |
| 2   | High     | `agentic-reservations/mcp/oauth.ts`                 | Rate limiting OAuth en `Map` mémoire (non distribué)                   | Migrer `oauthRateMap` vers Redis avec TTL                         |
| 3   | High     | `main.ts`                                           | `trustProxy: true` sans validation des IPs proxy                       | Limiter à `['127.0.0.1', '::1', IP_VPS_NGINX]`                    |
| 4   | High     | `plugins/rate-limit.ts`                             | Rate limit global 100 req/min sans distinction des endpoints sensibles | Rate limiting multi-niveaux (hold/confirm/erase plus stricts)     |
| 5   | Medium   | `main.ts` + `test/test.routes.ts`                   | Routes de test protégées uniquement par `NODE_ENV`                     | Variable `ENABLE_TEST_ROUTES=false` explicite                     |
| 6   | Medium   | `main.ts` + `observability/observability.routes.ts` | `/metrics` public sans auth                                            | Auth basique ou allowlist IP Prometheus                           |
| 7   | Medium   | `agentic-reservations/mcp/auth.ts`                  | Fallback `AGENT_DEV_KEY` basé sur `NODE_ENV`                           | Vérification explicite `ENABLE_DEV_AUTH`                          |
| 8   | Medium   | `connect/connect.routes.ts`                         | Mix `.parse()` et `.safeParse()`                                       | Standardiser sur `.safeParse()` + gestion 400                     |
| 9   | Low      | `rgpd/identity-verification.service.ts`             | OTP RGPD sans captcha                                                  | Captcha / détection d'anomalies brute force                       |
| 10  | Low      | `env.ts`                                            | `localhost` dans `PROD_HOST_ALLOWLIST`                                 | Retirer ou exiger `ALLOW_LOCALHOST_IN_PROD=true`                  |
| 11  | Low      | `rgpd/rgpd.routes.ts`                               | Champs `string` sans `max()`                                           | `z.string().max(N)` sur les inputs libres                         |
| 12  | Low      | `main.ts`                                           | Logger redaction : secrets Stripe/SMTP/Google manquants                | Ajouter `STRIPE_SECRET_KEY`, `SMTP_PASS`, `GOOGLE_CLIENT_SECRET`  |
| 13  | Low      | `sms/sms-inbound.routes.ts`                         | Validation minimale du payload Telnyx                                  | Schéma Zod complet du payload                                     |
| 14  | Low      | `plugins/cors.ts`                                   | Origines CORS non validées comme URLs                                  | `z.string().url()` sur chaque origine                             |
| 15  | Info     | `AGENTS.md`                                         | Mention de `key_env` sans contexte                                     | Clarifier que `key_env` est pour config Hermes, pas app secrets   |

### Top 5 priorités

1. Webhook WhatsApp sans signature (Critical)
2. Rate limiting OAuth en Map (High)
3. `trustProxy` sans validation (High)
4. Rate limit global trop permissif (High)
5. Routes de test protégées par `NODE_ENV` (Medium)

---

## 2. Audit Réservations / Paiements

**Résumé** : state machine, idempotence, audit log bien conçus. Risques critiques sur l'expiration des holds, l'allocation de tables, et les remboursements.

### Findings

| #   | Risque   | Fichier(s)                                          | Problème                                                  | Recommandation                                                                     |
| --- | -------- | --------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Critical | `main.ts` + `agentic-reservations/workers/expire-*` | Workers d'expiration non importés / scheduling non appelé | Importer les workers, appeler `scheduleHoldExpiration` / `scheduleQuoteExpiration` |
| 2   | Critical | `floor-plan/table-allocation.service.ts`            | Allocation de tables non atomique                         | `SELECT FOR UPDATE SKIP LOCKED` ou contrainte unique partielle                     |
| 3   | Critical | `gift-cards/gift-card.service.ts`                   | Aucun remboursement (même manuel)                         | Endpoint admin + Stripe Refunds + audit log                                        |
| 4   | High     | `agentic-reservations/core/reservation.service.ts`  | Consommation du hold sans `SELECT FOR UPDATE`             | Verrouiller le hold dans la transaction                                            |
| 5   | High     | `agentic-reservations/core/idempotency.service.ts`  | `purgeExpired()` non appelé                               | Cron BullMQ de purge quotidienne                                                   |
| 6   | High     | `gift-cards/gift-card.service.ts`                   | Application carte cadeau sans verrou                      | `SELECT FOR UPDATE` sur `GiftCard` + `CHECK remainingAmount >= 0`                  |
| 7   | High     | `openai-reserve/openai-reserve.routes.ts`           | Feed `/v1/businesses` public sans signature               | HMAC partagé + rate limiting plus strict                                           |
| 8   | Medium   | `agentic-reservations/core/hold.service.ts`         | Cleanup des holds expirés non systématique                | Worker cron + index `(status, expiresAt)`                                          |
| 9   | Medium   | `packages/database/prisma/schema.prisma`            | Pas d'index sur `actorHash` dans `ReservationAuditLog`    | `@@index([actorHash])` + `(event, createdAt)`                                      |
| 10  | Medium   | `agentic-reservations/core/state-machine.ts`        | Transitions sans validation d'invariants                  | Vérifier `tableId` non null pour `SEATED`, `startsAt` passé, etc.                  |
| 11  | Medium   | `packages/database/prisma/schema.prisma`            | Index partiel idempotence non visible dans Prisma         | Commentaire dans `schema.prisma` + test de migration                               |
| 12  | Medium   | `gift-cards/gift-card.service.ts`                   | `generateUniqueShortCode` sans retry P2002                | `try/catch` + retry sur violation unique                                           |
| 13  | Medium   | `floor-plan/availability-capacity-aware.service.ts` | Pas de cache Redis pour disponibilité                     | Cache TTL court + invalidation sur mutation                                        |
| 14  | Low      | `shared/db/transaction-options.ts`                  | Timeout de transaction 10s peut être court                | Profils `MEDIUM`/`LONG` + métriques                                                |
| 15  | Low      | `packages/database/prisma/schema.prisma`            | `ReservationAuditLog` sans `correlationId`                | Champ optionnel + index + propagation `request_id`                                 |

### Top 5 priorités

1. Enregistrer les workers d'expiration holds/quotes (Critical)
2. Verrouiller l'allocation de tables (Critical)
3. Implémenter les remboursements cartes cadeaux (Critical)
4. Verrouiller la consommation du hold (High)
5. Purger les records d'idempotence expirés (High)

---

## 3. Audit Déploiement / Infra

**Résumé** : séparation staging/prod, wrapper sudo, scripts idempotents. Gaps critiques sur backups, secrets, rollback DB, health checks.

### Findings

| #   | Risque   | Fichier(s)                                             | Problème                                       | Recommandation                                                |
| --- | -------- | ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------- |
| 1   | Critical | `scripts/backup-postgres.sh` + `infra/cron`            | Pas de backup automatisé de `sokar_staging`    | Script/cron séparé pour staging, rétention 7 jours            |
| 2   | Critical | `apps/api/.env.staging.example`                        | Password `password` par défaut                 | Placeholder `CHANGE_ME_PASSWORD` + validation setup           |
| 3   | High     | `scripts/deploy-vps.sh` / `deploy-staging.sh`          | Rollback sans restauration DB                  | Option `--with-db-rollback` + backup timestampé               |
| 4   | High     | `scripts/deploy-staging.sh`                            | Vérification `git diff` après `git pull`       | Vérifier avant le pull, option `--force`                      |
| 5   | High     | `infra/ecosystem*.config.js`                           | PM2 sans health checks                         | `min_uptime`, health check `/health`, alertes                 |
| 6   | Medium   | `infra/nginx/snippets/sokar-cloudflare-real-ip.conf`   | IPs Cloudflare hardcodées                      | Script de mise à jour automatique via API Cloudflare          |
| 7   | Medium   | `scripts/deploy-vps.sh` / `deploy-staging.sh`          | `sleep 8` après `pm2 restart`                  | Boucle `/health` + `/livez` avec timeout configurable         |
| 8   | Medium   | `scripts/ops/setup-staging.sh`                         | `.env` copiés sans validation des placeholders | `validate_env_files()` dans `deploy-staging.sh`               |
| 9   | Medium   | `infra/nginx/sokar-staging.conf`                       | Pas de `limit_req` en staging                  | Copier/adapter les zones de prod                              |
| 10  | Low      | `.env.staging.example` (API, dashboard)                | Patterns `pk_test_...` / `sk_test_...`         | Placeholders explicites `CHANGE_ME`                           |
| 11  | Low      | `scripts/backup-postgres.sh` / `backup-postgres-r2.sh` | Pas de vérification d'espace disque            | `df -k` + seuil avant dump                                    |
| 12  | Low      | `scripts/deploy-*.sh` + workflows                      | Pas de notification d'échec                    | `DEPLOY_WEBHOOK_URL` optionnel + trap ERR                     |
| 13  | Low      | `scripts/ops/sokar-deploy-root.sh`                     | Restauration nginx non garantie                | `restore_nginx` dans trap ERR + vérification post-déploiement |
| 14  | Low      | `scripts/deploy-vps.sh` / `deploy-staging.sh`          | Logs non structurés                            | Format JSON/key-value + timestamps                            |
| 15  | Low      | `scripts/deploy-*.sh`                                  | Pas de vérification de version Node            | `node --version` vs `package.json` engines                    |

### Top 5 priorités

1. Backup automatisé staging (Critical)
2. Password par défaut `.env.staging.example` (Critical)
3. Rollback DB automatisé (High)
4. Race condition `git diff` dans `deploy-staging.sh` (High)
5. Health checks PM2 (High)

---

## 4. Audit Qualité / Tests

**Résumé** : bonne couverture API (93 tests), configs cohérentes. Dette critique sur `buildPublicRestaurantJsonLd` dupliqué, 17 tests voice cassés, contournements TypeScript.

### Findings

| #   | Risque   | Fichier(s)                                                                                       | Problème                                         | Recommandation                                        |
| --- | -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------- | --------------------- |
| 1   | Critical | `api/src/modules/connect/jsonld.service.ts` + `connect/src/lib/jsonld.tsx`                       | `buildPublicRestaurantJsonLd` dupliqué           | Extraire dans `@sokar/shared/src/jsonld.ts`           |
| 2   | High     | `api/src/modules/voice/__tests__/`                                                               | 17 tests voice cassés (mocks obsolètes)          | Session dédiée pour mettre à jour les mocks           |
| 3   | High     | `dashboard/src/app/dashboard/reservations/page.tsx` + `components/gift-cards/gift-card-list.tsx` | `@ts-ignore` date-fns                            | Résoudre résolution types date-fns                    |
| 4   | High     | `api/src/modules/rgpd/erasure.service.ts`                                                        | `@ts-expect-error` sur `Call.customerPhone`      | Vérifier schema Prisma + type guard                   |
| 5   | Medium   | `api/src/modules/connect/connect.routes.ts`                                                      | `slugifyCity` / `slugifyCuisine` locales         | Extraire dans `@sokar/shared` si Connect en a besoin  |
| 6   | Medium   | `connect/e2e/*.spec.ts`                                                                          | E2E Connect skippés si API down                  | Infra CI docker-compose pour E2E                      |
| 7   | Medium   | `agentic-reservations/__tests__/concurrency.test.ts`                                             | `describe.skip` conditionnel `AGENTIC_INT_TESTS` | Activer en CI avec la variable                        |
| 8   | Medium   | `apps/api/src`                                                                                   | 559 occurrences de `any`                         | Audit ciblé des `any` dans retours/paramètres publics |
| 9   | Medium   | `connect/src/components/gift-card/use-gift-card-flow.ts`                                         | `err: any` dans catch                            | Typer `Error                                          | unknown` + type guard |
| 10  | Low      | `apps/api/vitest.config.ts`                                                                      | Monkey-patch `fs.readFileSync`                   | Documenter / migrer vers `env.loadEnv`                |
| 11  | Low      | `apps/api/eslint.config.mjs` vs `apps/*/.eslintrc.json`                                          | ESLint incohérent (flat vs legacy)               | Uniformiser vers flat config                          |
| 12  | Low      | `.stylelintrc.json`                                                                              | Config stylelint non centralisée                 | Déplacer dans `packages/config/`                      |
| 13  | Low      | `package.json`                                                                                   | Prettier config dans `package.json`              | Extraire dans `packages/config/prettier.config.js`    |
| 14  | Low      | `apps/dashboard/src`                                                                             | Un seul test unitaire (`proxy.test.ts`)          | Ajouter tests unitaires composants critiques          |
| 15  | Low      | `docs/obsidian/Context.md`                                                                       | tsserver lock 100% CPU                           | Désactiver TS server VSCode / settings workspace      |

### Top 5 priorités

1. Extraire `buildPublicRestaurantJsonLd` dans `@sokar/shared` (Critical)
2. Corriger les 17 tests voice cassés (High)
3. Résoudre `@ts-ignore` date-fns (High)
4. Activer E2E Connect en CI (Medium)
5. Uniformiser ESLint / centraliser configs (Low-Medium)

---

## Prochaines étapes

1. **Valider les findings critiques à la main** avant d'ouvrir des PRs (`whatsapp/webhook`, `expire-*` workers, `table-allocation`, gift-card refunds, staging backups, `.env` placeholder).
2. **Décider avec le product owner** des items P0 (pilote) vs P1 (post-pilote).
3. **Créer des tickets/PR** par domaine pour éviter les PRs géantes.
4. **Mettre à jour ce backlog** quand un item est résolu ou invalidé.
5. **Re-auditer** après les corrections pour vérifier les non-régressions.
