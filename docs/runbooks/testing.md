# Runbook — Testing

> **Statut : ACTIF — audité le 14 septembre 2026.** La matrice locale/CI/staging correspond au
> dépôt. Les validations qui contactent un fournisseur ou modifient une donnée métier doivent
> conserver une preuve datée. Voir [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md).

## Unit / integration

```zsh
pnpm test       # Vitest
pnpm lint       # turbo lint + stylelint
pnpm typecheck  # per-app tsc --noEmit
```

## Catalogue prix et usage — contrôles locaux

Ces suites vérifient que la grille Essential 199 € / Pro 299 € reste cohérente entre la
configuration, le calcul de marge et les surfaces publiques. Elles ne créent ni prix Stripe ni
abonnement. Le test ROI charge le `dist` de `@sokar/config` dans le workspace actuel ; reconstruire
ce package avant la suite si le dossier a été nettoyé.

```zsh
pnpm --filter @sokar/config run build
pnpm --filter @sokar/shared exec vitest run src/__tests__/plan.test.ts
pnpm --filter @sokar/api exec vitest run \
  src/modules/analytics/__tests__/roi.service.test.ts \
  src/modules/billing/__tests__/billing.routes.test.ts \
  src/modules/billing/__tests__/billing.service.test.ts
pnpm --filter @sokar/dashboard exec vitest run src/app/PricingSection.test.tsx
```

La promesse client Essential/Pro est sans quota. `/usage/current` affiche donc uniquement la
quantité observée et annonce `customerUsagePolicy=UNLIMITED`, sans coût ni marge. Le feed de coût et
de marge reste réservé aux opérations via `SOKAR_INTERNAL_USAGE_TOKEN`.

L'import du catalogue fournisseur est vérifiable sans provider ni écriture en base en exécutant la
suite dédiée :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/usage/__tests__/usage-tariff-import.service.test.ts
```

Le script `apps/api/scripts/import-usage-tariffs.ts` reste en dry-run par défaut. Il refuse les
devises autres qu'EUR, les prix au-delà de `DECIMAL(18,9)`, les fenêtres invalides, les conflits de
version et les chevauchements. Pour appliquer un fichier fourni par les opérations, lancer d'abord
le dry-run et conserver sa sortie avec la facture, puis ajouter `--apply` dans une base locale ou
un environnement contrôlé. Aucun fichier de facture ou taux réel ne doit être ajouté au dépôt.

Le rapprochement d'un export de facture avec le ledger est également local et en lecture seule :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/usage/__tests__/usage-reconciliation.service.test.ts
pnpm --filter @sokar/api exec tsx apps/api/scripts/reconcile-usage-invoice.ts \
  --file ./private/provider-invoice-2026-09.csv \
  --cost-tolerance 0.01 \
  --output ./private/reports/provider-invoice-2026-09.json
```

Les périodes de facture sont en UTC avec une borne de fin exclusive. La commande retourne un statut
par dimension et échoue si une ligne est `MISMATCH`, `INVOICE_ONLY`, `USAGE_ONLY` ou
`UNPRICED_USAGE`. Les tolérances ne sont jamais implicites ; leur justification doit rester avec la
facture. Avec `--output`, le rapport JSON est écrit avant le code de sortie, y compris lorsque la
commande échoue sur un écart. Le script ne réécrit pas les événements ni les rollups. Le fichier de
sortie contient `reportHash`, un SHA-256 des bornes, tolérances, compteurs et lignes ; il peut être
repris comme référence immuable lors de la création d'un ajustement.

Après revue, un opérateur peut conserver un delta dans `UsageReconciliationAdjustment` via
`POST /admin/usage/reconciliation-adjustments`, puis le valider ou le refuser via
`POST /admin/usage/reconciliation-adjustments/:id/decision`. La création est idempotente par hash
du rapport, portée, dimension et période ; la décision utilise la condition `status = OPEN` et ne
réécrit jamais le ledger. La file se consulte avec `GET /admin/usage/reconciliation-adjustments`.

La concurrence réelle se vérifie dans une base PostgreSQL jetable après application des migrations :

```zsh
AGENTIC_INT_TESTS=1 pnpm --filter @sokar/api exec vitest run \
  src/modules/usage/__tests__/usage-adjustment.concurrency.integration.test.ts
```

Le test crée une fixture isolée, vérifie l'unicité d'insertion et la décision atomique, puis la
supprime. Il reste ignoré dans la suite unitaire.

L'évaluateur local des seuils de suivi interne est vérifiable sans provider :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/usage/__tests__/usage-alerts.service.test.ts \
  src/modules/usage/__tests__/usage-alert-budget.service.test.ts \
  src/shared/queue/workers/__tests__/usage-alerts.worker.test.ts
```

Le worker ne contacte aucun canal tant que `USAGE_ALERTS_ENABLED=false` (valeur par défaut). Une
claim Redis `SET NX` est posée par mois, restaurant, métrique et seuil avant dispatch afin qu'un
rejeu horaire ou deux processus concurrents ne renvoient pas le même jalon. Ces seuils sont
strictement internes, facultatifs et sans effet sur le service du restaurant ; le suivi visuel de
référence reste `/dashboard/admin/margin`. Pour un test contrôlé, définir en plus
`USAGE_ALERT_VOICE_BUDGET_MINUTES` et/ou `USAGE_ALERT_SMS_BUDGET_SEGMENTS` ; ces budgets ne sont
jamais lus comme un quota client.

## E2E

```zsh
pnpm test:e2e   # Playwright dashboard
```

La CI exécute également le job `api-integration` sur Postgres 16 et Redis 7
éphémères. Il applique les migrations versionnées, active `AGENTIC_INT_TESTS=1`
et lance `pnpm --filter @sokar/api test:int`. Ce job ne contacte aucun provider
réel ; son objectif est de rendre la preuve transactionnelle reproductible à
chaque livraison.

Après une livraison sur `main`, le workflow staging exécute en outre les smoke
tests Playwright contre les URLs publiques : le Dashboard vérifie
`/widget/chez-sokar-demo` et ses disponibilités, et Connect vérifie
`/restaurant/chez-sokar-demo`. Tout échec de ces parcours bloque la conclusion
du workflow staging et donc la promotion production. La confirmation de
réservation et l'achat de carte cadeau restent des campagnes contrôlées, car
ils écrivent des données métier ou nécessitent l'activation commerciale du
restaurant de démo.

Le smoke du widget attend le DOM et les éléments métier plutôt que `networkidle` :
la page charge des images distantes qui peuvent rester en vol sur un runner CI.
Cette règle évite un faux timeout sans masquer une erreur de chargement, puisque
les données restaurant, l'état de disponibilité et le changement de date restent
assertés.

La porte de promotion peut être vérifiée sans modifier la production : lancer le
workflow `Deploy Staging` avec `force_smoke_failure=true`. Après les smoke tests,
le job échoue intentionnellement et le workflow `Deploy Production`, qui exige un
staging vert, doit rester absent.

## Visual regression

`pnpm test:visual` captures screenshots of 6 critical pages (`/dashboard`, `/dashboard/reservations`, `/dashboard/calls`, `/dashboard/gift-cards`, `/`, `/pricing`) on 3 viewports (iPhone 14, iPad Mini, desktop 1440px) and compares them to the baseline in `apps/dashboard/e2e/__snapshots__/`. Tolerance threshold: 0.2% pixel diff.

### Update baselines after intentional visual changes

```zsh
cd apps/dashboard
npx playwright test visual-regression --update-snapshots
git diff --stat apps/dashboard/e2e/__snapshots__/
git add apps/dashboard/e2e/__snapshots__/
git commit -m "feat(dashboard): update visual baselines for <description>"
```

### Screenshot stability

- Animations disabled (`animations: 'disabled'`).
- CSS transitions neutralized via `e2e/visual-stability.css` (also forces `-webkit-font-smoothing: antialiased`).
- Text caret hidden.
- For `/dashboard`, wait for `.recharts-surface` (async SVG charts) and use a `settleMs` of 3000 ms.
- Dashboard pages without Clerk display demo data or a skeleton — no random content.

### Cross-platform

Baselines are generated on macOS (suffix `-darwin`). In CI (Linux), a script copies `-darwin` baselines to `-linux` before running. The 0.2% threshold absorbs micro-differences (font anti-aliasing).

## Agentic Postgres integration (local-only)

Les tests de concurrence de réservation sont désactivés par défaut. Pour une
validation contrôlée, utiliser uniquement une base locale jetable avec un nom
dédié, appliquer les migrations déjà versionnées avec
`prisma migrate deploy`, puis vérifier la présence de
`reservation_audit_log_append_only` avant le test :

```zsh
DATABASE_URL='postgresql://<local-user>@127.0.0.1:5432/<dedicated-db>' \
  AGENTIC_INT_TESTS=1 \
  pnpm --filter @sokar/api test:int
```

La base doit être isolée d'une base de développement/staging/production. Après
le test, contrôler l'absence de restaurant, hold, réservation et record
d'idempotence, puis supprimer explicitement la base dédiée. Ne jamais utiliser
les données staging existantes pour activer `AGENTIC_INT_TESTS`.

Le même harnais contient aussi les tests de capacité : 17 cas sont exécutés
en mode intégration. Les six tests historiques de concurrence, idempotence et
append-only sont complétés par 11 cas sur les états actifs avec/sans
`tableId`, les holds actifs, `releaseTable` et le blocage global du chemin agentic. Les cinq
logs d'audit append-only résiduels de la fixture sont attendus avant la
suppression de la base ; ils ne doivent pas être supprimés par contournement du
trigger.

## Résultats inconnus des notifications — Phase 3D

Les tests des cinq workers protégés par claim utilisent exclusivement des
providers et un Redis fakes. Ils ne nécessitent ni Telnyx, ni WhatsApp, ni
Resend, ni une base staging/production :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/shared/queue/__tests__/notification-idempotency.test.ts \
  src/shared/queue/workers/__tests__/outbound-confirm.worker.test.ts \
  src/shared/queue/workers/__tests__/confirmation-sms.worker.test.ts \
  src/shared/queue/workers/__tests__/call-recovery.worker.test.ts \
  src/shared/queue/workers/__tests__/reconciliation.worker.test.ts \
  src/modules/agentic-reservations/workers/__tests__/waiting-list-promote.worker.test.ts \
  src/modules/gift-cards/workers/__tests__/gift-card-reminder.worker.test.ts \
  src/shared/messaging/__tests__/sender.test.ts
```

Le contrat testé est :

- `success` conserve la claim et permet au worker de poser son marqueur/audit
  existant ;
- `failure_certain` libère la claim pour le retry déjà prévu ;
- `unknown` conserve la claim, interdit un nouvel appel provider immédiat et
  ajoute un `notification-status` à la queue `reconciliation` avec un job ID
  déterministe ;
- une consultation impossible ou sans identifiant provider reste `unknown` et
  rejoint `dead-letter` pour revue manuelle, sans nouvel envoi.

Les assertions de concurrence dédupliquent les jobs de réconciliation par leur
`jobId` stable. Elles ne promettent pas exactly-once chez le provider externe.
Un crash avant la transition locale du claim est traité conservativement comme
une tentative en cours ; il ne déclenche pas de renvoi aveugle. Les tests
vérifient également que le fallback WhatsApp→SMS n'a lieu qu'après un échec
certain, jamais après `unknown`.

## Clôture opérationnelle des notifications — Phase 3E

La campagne Phase 3E reste entièrement déterministe et sans appel externe :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/shared/queue/__tests__/notification-idempotency.test.ts \
  src/shared/queue/__tests__/notification-repair.test.ts \
  src/shared/queue/__tests__/provider-adapters.contract.test.ts \
  src/shared/queue/workers/__tests__/reconciliation.worker.test.ts \
  src/shared/queue/workers/__tests__/outbound-confirm.worker.test.ts \
  src/shared/queue/workers/__tests__/confirmation-sms.worker.test.ts \
  src/shared/queue/workers/__tests__/call-recovery.worker.test.ts \
  src/shared/observability/__tests__/metrics.test.ts \
  src/shared/messaging/__tests__/sender.test.ts \
  src/modules/agentic-reservations/workers/__tests__/waiting-list-promote.worker.test.ts \
  src/modules/gift-cards/workers/__tests__/gift-card-reminder.worker.test.ts
```

Les fixtures Telnyx/Resend testent les normaliseurs d'adapter : identifiant
provider, acceptation, refus certain et résultat inconnu. Elles ne valident pas
les réponses d'un compte staging. `success` signifie acceptation de la requête,
pas livraison au destinataire.

Le contrôle marketing ajoute les suites ciblées suivantes :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/marketing/__tests__/marketing-provider.service.test.ts \
  src/modules/marketing/__tests__/marketing-provider.routes.test.ts \
  src/modules/marketing/__tests__/marketing-provider-reconciliation.worker.test.ts
```

Un callback signé dont l'identifiant n'est pas encore connu crée une ligne
`MarketingProviderReconciliation` idempotente. Le worker planifié
`marketing-provider-reconciliation/5min` la rattache dès que la
`CampaignMessage` existe ; le feed opérateur peut lister ou ignorer une ligne
avec `SOKAR_INTERNAL_MARKETING_TOKEN`. Aucun de ces contrôles n'envoie un
message et le flag `MARKETING_SENDS_ENABLED` n'est pas requis.

Les fondations POS, paiement de réservation et CRM groupe se vérifient de la même façon sans
contacter de fournisseur :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/pos/__tests__ \
  src/modules/reservation-payments/__tests__ \
  src/modules/customer-groups/__tests__
```

Ces suites vérifient notamment le dry-run et l'absence d'appel externe, l'idempotence des écritures,
les transitions et signatures, l'isolation compte/site, le consentement inter-sites et le masquage
des téléphones. Les flags `POS_CONNECTORS_ENABLED`, `RESERVATION_PAYMENTS_ENABLED` et
`CUSTOMER_GROUPS_ENABLED` restent `false` pendant les tests de promotion ; l'ouverture d'un pilote
nécessite ensuite une preuve sandbox séparée.

La fondation réputation se vérifie sans provider ni Redis réel :

```zsh
pnpm --filter @sokar/api exec vitest run \
  src/modules/reputation/__tests__/reputation.service.test.ts \
  src/modules/reputation/__tests__/reputation.routes.test.ts \
  src/modules/reputation/__tests__/reputation-feedback-expiry.worker.test.ts
```

Ces tests couvrent l'exigence `HONORED`, le token haché et expirant, le rejeu public, la transaction
score faible → tâche de récupération, l'isolation tenant et les transitions de résolution. Le flag
`REPUTATION_ENABLED` reste `false` ; aucun SMS, email, WhatsApp ou appel de plateforme d'avis n'est
effectué.

La récupération quotidienne réutilise le job existant `reconciliation/sms` :
une claim `in_progress` âgée de 15 minutes devient `unknown` par CAS Redis et
est replanifiée avec un ID stable ; une claim legacy sans token va en revue
manuelle. Une panne Redis/queue conserve la protection et n'appelle pas le
provider. Le test de crash arrête volontairement le scénario entre l'appel
provider simulé et l'écriture Redis ; il ne remplace pas encore un test de
processus réellement tué en staging.

Après `failure_certain`, le worker relance le même job BullMQ déterministe,
avec les bornes existantes : 5 tentatives/backoff 5 s pour les queues fiables
principales, 3 tentatives/backoff 5 s pour waiting-list, et 3 tentatives/backoff
60 s pour gift-card. `unknown` n'est jamais relancé automatiquement vers le
provider. Après épuisement, le listener commun alimente la DLQ existante ; la
procédure de revue humaine et la validation staging restent à approuver. Si
une lecture de réconciliation transforme ensuite un `unknown` en
`failure_certain`, elle ne reconstitue pas le payload source absent de la
claim : le cas reste en revue manuelle jusqu'à décision sur une référence de
rejeu sûre.
