# Runbook — Testing

## Unit / integration

```zsh
pnpm test       # Vitest
pnpm lint       # turbo lint + stylelint
pnpm typecheck  # per-app tsc --noEmit
```

## E2E

```zsh
pnpm test:e2e   # Playwright dashboard
```

La CI exécute également le job `api-integration` sur Postgres 16 et Redis 7
éphémères. Il applique les migrations versionnées, active `AGENTIC_INT_TESTS=1`
et lance `pnpm --filter @sokar/api test:int`. Ce job ne contacte aucun provider
réel ; son objectif est de rendre la preuve transactionnelle reproductible à
chaque livraison.

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
