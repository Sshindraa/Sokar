# Audit de la release candidate — 3 septembre 2026

## Portée

Cet audit est réalisé sur le diff cumulé non commité des Phases 1 à 3E et de
l'alignement produit du 3 septembre. Il ne modifie ni le schéma Prisma, ni les
migrations, ni les entrypoints, ni PM2.

- 62 fichiers suivis modifiés.
- 25 fichiers nouveaux non suivis.
- 86 entrées dans `git status`.
- `infra/sudoers.d/deploy` est une modification préexistante et doit rester
  hors de toute release candidate.

Les validations déjà réalisées sont vertes : suite API standard (164 fichiers,
1 709 tests passés, 22 ignorés), suite API CI équivalente avec Postgres/Redis
éphémères (165 fichiers, 1 731 tests), lint Turbo (16/16), build Turbo (16/16), typechecks et
`git diff --check`.

## Découpe proposée

### RC-01 — Configuration et voice

Périmètre : configuration Zod voice, defaults/fallbacks, lecture par le manager
et le provider, tests de configuration et documentation d'architecture
progressive.

Fichiers principaux :

- `apps/api/src/env.ts`
- `apps/api/src/modules/voice/stream/manager.ts`
- `apps/api/src/modules/voice/llm-provider.ts`
- `apps/api/src/modules/voice/__tests__/stream-manager.test.ts`
- `apps/api/src/test/env.test.ts`
- `apps/api/.env.example`

Risque : faible après typecheck et suite voice verte.

### RC-02 — Contrat réservation, capacité et dashboard

Périmètre : `state` comme référence, capacité hybride conservatrice,
verrouillage par restaurant, timezone, audits de mutations, `releaseTable`,
lecteurs dashboard/analytics/health/rapports et tests Postgres.

Fichiers principaux :

- `apps/api/src/shared/reservations/capacity.ts`
- `apps/api/src/shared/timezone/restaurant-time.ts`
- `apps/api/src/modules/agentic-reservations/core/{reservation,hold,waiting-list}.service.ts`
- `apps/api/src/modules/reservations/reservation.service.ts`
- `apps/api/src/modules/floor-plan/{availability-capacity-aware,table-allocation,floor-plan}.service.ts`
- `apps/api/src/modules/connect/connect.routes.ts`
- `apps/dashboard/src/app/dashboard/reservations/page.tsx`
- `apps/api/src/modules/agentic-reservations/__tests__/concurrency.test.ts`

Risque : élevé ; cette slice doit être revue avant staging.

### RC-03 — Notifications et réconciliation provider

Périmètre : claims tokenisées, résultats `success`/`failure_certain`/`unknown`,
réconciliation, réparation des audits/marqueurs, retry borné et garde-fou
`state=CONFIRMED`.

Fichiers principaux :

- `apps/api/src/shared/queue/notification-idempotency.ts`
- `apps/api/src/shared/queue/notification-repair.ts`
- `apps/api/src/shared/queue/workers/reconciliation.worker.ts`
- `apps/api/src/shared/messaging/sender.ts`
- les cinq workers concernés et leurs tests
- adaptateurs Telnyx, WhatsApp et Resend

Risque : moyen à élevé ; validation réelle staging indispensable.

### RC-04 — CI, runbooks et décisions

Périmètre : job CI Postgres/Redis éphémère, runbook de test, ADR, matrices de
contrats/queues/readiness et vault Obsidian.

Fichiers principaux :

- `.github/workflows/ci.yml`
- `docs/runbooks/testing.md`
- `docs/architecture/adr-*.md`
- `docs/architecture/*matrix*.md`
- `docs/architecture/reservation-commercial-readiness.md`
- `docs/obsidian/Context.md`
- `docs/obsidian/Journal.md`

Risque : faible techniquement, mais la CI doit être exécutée sur la branche de
release.

## Blockers identifiés avant staging

### B-01 — Suppression physique incompatible avec l'audit append-only (résolu)

`apps/api/src/modules/reservations/reservation.service.ts` écrit un audit
`reservation_deleted`, puis supprime la réservation. La FK
`reservation_audit_log.reservation_id` est `ON DELETE SET NULL`, tandis que le
trigger append-only interdit l'UPDATE induit par cette action. La suppression
échoue donc dès qu'un audit référence la réservation.

Preuve : le test Postgres a échoué avec `reservation_audit_log is append-only`
lorsqu'une réservation ayant reçu l'audit `releaseTable` a été supprimée.

La décision d'état terminal a été appliquée en Phase 4 ; aucun contournement par
désactivation du trigger ni migration relationnelle n'a été introduit.

### B-02 — Hold explicite avec `tableId` (résolu)

Le chemin `HoldService.createHold` qui reçoit déjà un `tableId` réexécute
désormais, dans la même transaction, le verrou de capacité du restaurant, le
masque global des réservations/holds sans table, la validation de la table et
le conflit physique du créneau. Une préférence de table fournie par un caller
ne constitue donc plus une preuve de disponibilité.

### B-03 — Preuves opérationnelles absentes

Les tests locaux et les fakes ne prouvent pas encore :

- l'acceptation réelle Telnyx/Resend en staging isolé ;
- un arrêt/redémarrage réel entre provider et Redis ;
- une panne réelle Redis/BullMQ et la reprise ;
- le SLA de revue manuelle/DLQ et le rollback.

## Séquence de livraison

1. Vérifier les clôtures terminales B-01 et la revalidation B-02 sur la branche
   de release ; ne pas pousser RC-02 sans ces tests Postgres.
2. Découper les fichiers par RC sans inclure `infra/sudoers.d/deploy`.
3. Exécuter CI et tests sur chaque slice regroupée avec ses tests.
4. Déployer RC-01/RC-02/RC-03 ensemble uniquement sur staging dédié, avec un
   restaurant de test et des providers sandbox.
5. Exécuter les parcours E2E et les scénarios d'incident, puis mettre à jour la
   matrice go/no-go.

Statut actuel : **NO-GO commercial** malgré la résolution runtime de B-01 et
B-02, jusqu'aux preuves staging et incident.

## Résolution B-01 — Phase 4

La décision retenue est l'état terminal conservant l'historique. Le contrat
HTTP `DELETE /reservations/:id` reste disponible pour les callers historiques,
mais `ReservationService.delete` n'exécute plus de suppression physique :

- `status` et `state` passent atomiquement à `CANCELLED` ;
- un audit `reservation_deleted` est ajouté avec `fromState`, `toState` et le
  mode `terminal_state` ;
- la réservation reste en base, ce qui protège la FK et le trigger append-only ;
- l'audit `reservation_deleted` masque la ligne de la liste opérationnelle
  legacy, sans masquer l'historique aux contrôles internes ;
- la synchronisation Google Calendar reste best-effort et idempotente ;
- un second DELETE sur une ligne déjà clôturée ne crée pas de nouvel audit.

Aucun schéma Prisma ni migration n'est nécessaire pour cette variante. Les
tests ciblés réservation passent (50/50), le scénario Postgres dédié passe
(18/18) et le typecheck API est vert.

B-01 et B-02 sont donc résolus au niveau runtime. B-03 (preuves staging et
scénarios d'incident réels) reste la gate avant commercialisation.

## Résolution B-02 — Phase 5

Un `tableId` explicite est maintenant traité comme une entrée à revalider, et
non comme un bypass de capacité. `HoldService.createHold` appelle le contrôle
transactionnel partagé qui :

- verrouille la capacité du restaurant ;
- refuse une réservation ou un hold actif sans table qui masque le créneau ;
- vérifie l'appartenance, l'activation et les bornes de capacité de la table ;
- verrouille la table et refuse tout chevauchement physique ;
- traduit les conflits en `HoldConflictError` (HTTP 409 côté Connect).

La branche d'allocation automatique conserve exactement le même contrôle. Aucun
schéma Prisma, migration ou endpoint n'a été ajouté. Les tests unitaires
régressifs et quatre scénarios Postgres couvrent les blockers globaux et
physiques ; les preuves staging et incident B-03 restent indépendantes.
