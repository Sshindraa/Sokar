# Réservation test — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le restaurateur réserve sur sa propre page publique et vit le vrai parcours client (widget, SMS, page « Ma réservation »), sans aucun effet côté restaurant.

**Architecture:** Un lien signé émis par le dashboard active le mode test sur Connect. L'API crée une vraie ligne `reservations` avec `is_test = true` par le circuit normal, en sautant CRM, statistiques et marketing. Une extension Prisma exclut ces lignes de toutes les lectures en masse ; une tâche horaire les purge après 24 h.

**Tech Stack:** Fastify 5, Prisma 6 (`$extends`), BullMQ, Redis, Next.js 15 (Connect, dashboard), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-reservation-test-design.md`

**Branche :** `feat/onboarding-test-booking-dry-run` (PR #509). Le commit `565e02c1` (simulation `?testBooking=1`) est remplacé par la tâche 9.

## Global Constraints

- Drapeau `TEST_BOOKING_ENABLED`, `false` par défaut ; désactivé, les deux boutons ouvrent la page publique comme aujourd'hui.
- Secret `TEST_BOOKING_SECRET` : 32 octets aléatoires en 64 caractères hexadécimaux, `key_env` uniquement, jamais dans le code ni les tests (les tests génèrent une valeur).
- Jeton : restaurant + expiration 1 h, HMAC-SHA256, comparaison `timingSafeEqual`.
- Quota : 5 réservations test par restaurant sur 24 h glissantes.
- Purge : réservations `isTest` créées il y a plus de 24 h, toutes les heures.
- Migration additive uniquement (colonne `is_test BOOLEAN NOT NULL DEFAULT false`, index partiel).
- Changements d'API additifs : `testBookingToken` optionnel dans `hold` et `confirm`, `test` dans la réponse de `/public/reservation-management`, nouvelle route `POST /restaurant/test-booking-link` (au lieu de `/restaurants/:id/...` dans la spec : le dashboard utilise le restaurant courant, comme `/restaurant/onboarding/test-call`).
- Textes : « vous », jamais « tu ». Aucune donnée personnelle dans les journaux.
- Messages exacts :
  - jeton refusé : « Ce lien de test a expiré. Relancez-le depuis votre tableau de bord. »
  - quota atteint : « Vous avez atteint la limite de 5 réservations test sur 24 heures. »
  - bandeau Connect : « Réservation test : vous voyez ce que voient vos clients. Les messages sont envoyés, mais rien n’apparaît dans votre restaurant. »
  - mention `/r` : « Réservation test · supprimée automatiquement sous 24 h »

## Review Focus

1. Lectures par relation (`include: { reservations }`, `_count: { reservations }`, `restaurant.reservations`) : elles contournent l'extension Prisma. Tâche 3 les audite et les pin par un garde-fou.
2. Page publique non publiée ou drapeau coupé : le bouton doit ouvrir la page publique comme aujourd'hui (drapeau) ou expliquer pourquoi le test est impossible (non publiée), jamais échouer en silence. Tâche 10.
3. Fenêtre bloquée par le navigateur : l'onglet est ouvert avant l'appel réseau, puis redirigé. Tâche 10.
4. Purge et clés étrangères : `ReservationAuditLog` n'a pas de `onDelete` ; la purge supprime d'abord ces lignes, puis les événements d'outbox (`aggregateId`), puis la réservation. Tâche 8.
5. Jeton valide utilisé pour un autre restaurant (copie d'URL entre fiches) : refus 403 sans création. Tâche 6.

Limite acceptée (à signaler au relecteur, pas à corriger) : le `hold` d'une réservation test garde une table jusqu'à 5 minutes pendant que le restaurateur remplit le formulaire, comme un vrai client.

---

### Task 1: Colonne `is_test`

**Files:**

- Modify: `packages/database/prisma/schema.prisma` (modèle `Reservation`, ligne 463)
- Create: `packages/database/prisma/migrations/20261019120000_reservation_is_test/migration.sql`

**Interfaces:**

- Produces: champ Prisma `Reservation.isTest: boolean` (`@default(false) @map("is_test")`).

- [ ] **Step 1:** Ajouter `isTest Boolean @default(false) @map("is_test")` au modèle `Reservation`.
- [ ] **Step 2:** Écrire la migration, commentée en français comme les migrations voisines :

```sql
ALTER TABLE "reservations" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "reservations_test_created_at_idx" ON "reservations" ("created_at") WHERE "is_test";
```

- [ ] **Step 3:** Vérifier : `pnpm --filter @sokar/database exec prisma validate` puis `prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --script` → sortie vide hors index partiel (que Prisma ne modélise pas). Aucun `DROP`.
- [ ] **Step 4:** `pnpm --filter @sokar/database exec prisma generate` ; typecheck API vert.
- [ ] **Step 5:** Commit `feat(db): colonne is_test sur les réservations`.

### Task 2: Extension Prisma d'exclusion

**Files:**

- Create: `apps/api/src/shared/db/test-reservation-scope.ts`
- Create: `apps/api/src/shared/db/__tests__/test-reservation-scope.test.ts`
- Modify: `apps/api/src/shared/db/client.ts:27-30`

**Interfaces:**

- Produces: `scopeReservationArgs(operation: string, args: unknown): unknown` (pure) et `testReservationScopeExtension` (objet `$extends`).
- Opérations filtrées : `findMany`, `findFirst`, `findFirstOrThrow`, `count`, `groupBy`, `aggregate`, `updateMany`, `deleteMany`.

- [ ] **Step 1: Tests**

```ts
it('ajoute isTest:false aux lectures en masse', () => {
  expect(scopeReservationArgs('findMany', { where: { restaurantId: 'r' } })).toEqual({
    where: { AND: [{ restaurantId: 'r' }, { isTest: false }] },
  });
  expect(scopeReservationArgs('count', undefined)).toEqual({ where: { isTest: false } });
});
it('laisse passer une requête ciblée par id', () => {
  const args = { where: { id: 'x', restaurantId: 'r' } };
  expect(scopeReservationArgs('updateMany', args)).toBe(args);
});
it('laisse passer une requête qui mentionne isTest', () => {
  const args = { where: { isTest: true } };
  expect(scopeReservationArgs('deleteMany', args)).toBe(args);
});
it('ne touche pas findUnique ni create', () => {
  const args = { where: { id: 'x' } };
  expect(scopeReservationArgs('findUnique', args)).toBe(args);
});
```

- [ ] **Step 2:** `pnpm --filter @sokar/api exec vitest run src/shared/db/__tests__/test-reservation-scope.test.ts` → FAIL (module absent).
- [ ] **Step 3:** Implémenter. L'extension : `{ query: { reservation: { $allOperations({ operation, args, query }) { return query(scopeReservationArgs(operation, args)); } } } }`. Dans `client.ts`, chaîner après `slowQueryExtension`, en gardant le garde `typeof $extends === 'function'` et le cast existant ; ajouter au commentaire une phrase sur l'exclusion des réservations test.
- [ ] **Step 4:** Test vert ; `pnpm --filter @sokar/api test` vert.
- [ ] **Step 5:** Commit `feat(api): exclure les réservations test des lectures en masse`.

### Task 3: Audit SQL brut et lectures par relation

**Files:**

- Modify (selon audit) : les 13 fichiers à SQL brut sur `reservations` (`table-allocation.service.ts`, `reservation.service.ts`, `waiting-list.service.ts`, `reservation-lifecycle.service.ts`, `reservation-management.routes.ts`, `customer-merge.service.ts`, `gift-card*.service.ts`, `experience*.service.ts`, `service-copilot-delay-recovery.service.ts`, `voice-reservation-quality.ts`, `health/checks.ts`) et les lectures `include`/`select`/`_count` de `reservations` via une relation.
- Create: `apps/api/src/shared/db/__tests__/test-reservation-raw-sql.test.ts`

**Interfaces:**

- Produces: constante `RAW_SQL_RESERVATION_EXCEPTIONS: Record<string, string>` (fichier → raison) dans le test.

- [ ] **Step 1: Garde-fou** — le test parcourt `apps/api/src` (hors tests), repère chaque appel `$queryRaw`/`$executeRaw`/`Prisma.sql` dont le texte contient `reservations`, et échoue si le fichier ne contient ni `is_test` ni d'entrée dans `RAW_SQL_RESERVATION_EXCEPTIONS`. Un second bloc fait de même pour `reservations: {`, `reservations: true` et `_count: { select: { reservations`.
- [ ] **Step 2:** Lancer → FAIL avec la liste des fichiers.
- [ ] **Step 3:** Pour chaque requête : si elle compte, liste ou vérifie la capacité, ajouter `AND r.is_test = false` (ou `isTest: false` dans le `where` de la relation) ; si elle cible une réservation par `id` (verrou `FOR UPDATE`, mise à jour unitaire), l'inscrire en exception avec la raison.
- [ ] **Step 4:** Garde-fou vert ; `pnpm --filter @sokar/api test` vert.
- [ ] **Step 5:** Commit `fix(api): exclure les réservations test du SQL brut et des relations`.

### Task 4: Jeton, drapeau et quota

**Files:**

- Create: `apps/api/src/modules/connect/test-booking.ts`
- Create: `apps/api/src/modules/connect/__tests__/test-booking.test.ts`
- Modify: `docs/runbooks/environment.md` (tableau près de `RESERVATION_MANAGEMENT_SECRET`, ligne 237)

**Interfaces:**

- Produces:
  - `isTestBookingEnabled(): boolean` — `TEST_BOOKING_ENABLED === 'true'` et secret valide.
  - `issueTestBookingToken(restaurantId: string, now?: Date): string`
  - `verifyTestBookingToken(token: string, restaurantId: string, now?: Date): boolean`
  - `consumeTestBookingQuota(restaurantId: string): Promise<boolean>` — Redis `INCR` sur `test-booking:quota:<restaurantId>`, `EXPIRE` 86 400 s au premier incrément, `true` si ≤ 5 ; repli mémoire comme `connect-rate-limit.ts`.
  - `TEST_BOOKING_TOKEN_PATTERN: RegExp` (pour la validation Zod côté routes).

- [ ] **Step 1: Tests** — jeton émis vérifié pour son restaurant ; refusé pour un autre restaurant, après 1 h, modifié d'un caractère, ou si le secret change ; `isTestBookingEnabled()` faux sans drapeau ou avec un secret mal formé ; sixième `consumeTestBookingQuota` du même restaurant → `false`, celui d'un autre restaurant → `true`.
- [ ] **Step 2:** Lancer → FAIL.
- [ ] **Step 3:** Implémenter sur le modèle de `reservation-management.ts` : charge utile UUID (16 octets) + expiration (uint32), domaine HMAC `test-booking-v1\0`, encodage `base64url` `payload.signature`.
- [ ] **Step 4:** Tests verts.
- [ ] **Step 5:** Documenter les deux variables dans `environment.md` (FR, même format que les lignes 236-237).
- [ ] **Step 6:** Commit `feat(api): jeton signé et quota des réservations test`.

### Task 5: Route `POST /restaurant/test-booking-link`

**Files:**

- Modify: `apps/api/src/modules/restaurants/restaurant.routes.ts` (près de `postTestCall`, ligne 1494)
- Test: `apps/api/src/modules/restaurants/__tests__/test-booking-link.routes.test.ts`

**Interfaces:**

- Consumes: `isTestBookingEnabled`, `issueTestBookingToken` (tâche 4).
- Produces: `POST /restaurant/test-booking-link` (`preHandler: requireOrg()`, rate limit 10/min) →
  - `200 { url: string }` avec `url = <SITE_URL Connect>/restaurant/<slug>?testBooking=<jeton>` ;
  - `404 { code: 'TEST_BOOKING_DISABLED' }` si le drapeau est coupé ;
  - `409 { code: 'PAGE_NOT_PUBLISHED', error: 'Publiez d’abord votre page pour la tester.' }` si la page Connect n'est pas publiée.

- [ ] **Step 1: Tests** — les trois réponses ci-dessus ; l'URL contient le slug du restaurant de la session et un jeton vérifiable par `verifyTestBookingToken` ; sans session → 401.
- [ ] **Step 2:** Lancer → FAIL. **Step 3:** Implémenter (base de l'URL : même variable que celle qui construit les liens publics Connect dans l'API ; la réutiliser, ne pas en créer une). **Step 4:** Vert.
- [ ] **Step 5:** Commit `feat(api): lien de réservation test pour le restaurateur`.

### Task 6: Création d'une réservation test par le circuit Connect

**Files:**

- Modify: `apps/api/src/modules/connect/connect.routes.ts` (`HoldInputSchema`, `ConfirmInputSchema`, routes `/public/r/:slug/hold` l. 505 et `/confirm` l. 635)
- Modify: `apps/api/src/modules/agentic-reservations/core/reservation.service.ts` (`CreateReservationInput` l. 102, `createReservation` l. 183)
- Test: `apps/api/src/modules/connect/__tests__/connect.routes.test.ts`, `apps/api/src/modules/agentic-reservations/core/__tests__/` (fichier de tests existant de `createReservation`)

**Interfaces:**

- Consumes: `verifyTestBookingToken`, `consumeTestBookingQuota`, `TEST_BOOKING_TOKEN_PATTERN`.
- Produces: `CreateReservationInput.isTest?: boolean` ; champ optionnel `testBookingToken` dans les corps `hold` et `confirm`.

- [ ] **Step 1: Tests (routes)**
  - jeton invalide, expiré ou d'un autre restaurant sur `hold` ou `confirm` → `403` avec le message exact, `createReservation` jamais appelé ;
  - drapeau coupé + jeton → `403` même message ;
  - quota épuisé → `429` avec le message exact, sans création ;
  - jeton valide → `createReservation` appelé avec `isTest: true`, sans `marketingAttributionToken` ni `giftCardCode` ; `consents.recordConsent`, `canConfirm`, `recordFailedConfirm` et tous les `emitConnectEvent` non appelés ;
  - sans jeton → comportement actuel inchangé (tests existants verts).
- [ ] **Step 2: Tests (service)** — `isTest: true` : `CustomerService.lookupOrCreate`, `recordReservationEvent`, attribution et carte cadeau non appelés ; `tx.reservation.create` reçoit `isTest: true` et pas de `customerId` ; `enqueueReservationConfirmation` toujours appelé.
- [ ] **Step 3:** Lancer → FAIL.
- [ ] **Step 4:** Implémenter. Vérifier le jeton juste après `getPublishedBySlug` (avant tout effet). Consommer le quota dans `confirm` seulement, après le contrôle du hold.
- [ ] **Step 5:** Tests verts ; `pnpm --filter @sokar/api test` vert.
- [ ] **Step 6:** Commit `feat(api): créer une réservation test par le circuit Connect`.

### Task 7: Page « Ma réservation » d'une réservation test

**Files:**

- Modify: `apps/api/src/modules/reservations/reservation-management.routes.ts` (réponse l. 226-250)
- Modify: `apps/dashboard/src/app/r/reservation-view.tsx` (type l. 34, en-tête l. 249)
- Test: tests existants des deux fichiers (`reservation-management.routes` côté API, `apps/dashboard/src/app/r/page.test.tsx`)

**Interfaces:**

- Produces: champ de réponse `test: boolean` (toujours présent, `row.isTest`).

- [ ] **Step 1: Tests** — l'API renvoie `test: true` pour une ligne `isTest`, `false` sinon ; la vue affiche « Réservation test · supprimée automatiquement sous 24 h » seulement si `test` est vrai.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (mention avec le style de `styles.demo`). **Step 4:** Vert.
- [ ] **Step 5:** Commit `feat(reservations): signaler une réservation test sur sa page`.

### Task 8: Purge horaire

**Files:**

- Create: `apps/api/src/modules/reservations/test-reservation-purge.ts`
- Modify: `apps/api/src/shared/queue/workers/reconciliation.worker.ts` (union `kind` l. 37, `processReconciliationJob` l. 434)
- Modify: `apps/api/src/shared/queue/schedulers.ts` (après `reconciliation/voice-finalization`)
- Test: `apps/api/src/modules/reservations/__tests__/test-reservation-purge.test.ts`

**Interfaces:**

- Produces: `purgeTestReservations(db: PrismaClient, now?: Date): Promise<number>` ; kind `'test-reservation-purge'` ; scheduler `test-reservation-purge`, `{ pattern: '5 * * * *', tz: 'Europe/Paris' }`.

- [ ] **Step 1: Tests** — sélection `where: { isTest: true, createdAt: { lt: now - 24 h } }` ; suppression dans une transaction, dans l'ordre `reservationAuditLog.deleteMany({ reservationId: { in } })`, `outboxEvent.deleteMany({ aggregateType: 'reservation', aggregateId: { in } })`, `reservation.deleteMany({ id: { in }, isTest: true })` ; aucune requête sans `isTest: true` ; retourne le nombre supprimé ; ne fait rien si la liste est vide. Lots de 200 au plus.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter et brancher le kind + le scheduler (journaliser seulement le nombre). **Step 4:** Vert, avec les tests existants de `schedulers` et `reconciliation.worker`.
- [ ] **Step 5:** Commit `feat(api): purger les réservations test après 24 h`.

### Task 9: Connect transmet le jeton

**Files:**

- Modify: `apps/connect/src/app/restaurant/[slug]/page.tsx`, `apps/connect/src/app/widget/[slug]/page.tsx`, `apps/connect/src/components/booking-widget.tsx`, `apps/connect/src/components/booking/confirmation-view.tsx`, `apps/connect/src/components/book-cta-link.tsx`
- Test: `apps/connect/src/app/restaurant/[slug]/__tests__/page.test.tsx`, `apps/connect/src/app/widget/[slug]/page.test.tsx`, `apps/connect/src/components/__tests__/booking-widget.test.tsx`

**Interfaces:**

- Consumes: champ `testBookingToken` (tâche 6).
- Produces: prop `BookingWidget.testBookingToken?: string` (remplace `testBooking?: boolean`) ; `ConfirmationView` revient à l'affichage réel (suppression de la prop `testBooking`).

- [ ] **Step 1: Tests** — adapter ceux du commit `565e02c1` :
  - page restaurant : avec `testBooking=<jeton>` (motif `TEST_BOOKING_TOKEN_PATTERN` recopié côté client), tous les liens `/book` portent `testBooking=<jeton>` encodé, bandeau exact présent, pas de `PageViewTracker` ; une valeur qui ne respecte pas le motif est ignorée (page normale) ;
  - page widget : jeton transmis au widget, pas de `widget_page_view`, lien retour conservant le jeton ;
  - widget : `hold` et `confirm` sont envoyés et portent `testBookingToken`, sans `marketingAttributionToken` ; bandeau exact ; écran de confirmation = réponse réelle de l'API (code et lien « Gérer ma réservation » si présents) ; une réponse `403` ou `429` affiche le message de l'API.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (retirer la confirmation simulée du commit `565e02c1`). **Step 4:** `pnpm --filter @sokar/connect test`, `tsc`, `lint` verts.
- [ ] **Step 5:** Commit `feat(connect): parcours de réservation test par lien signé`.

### Task 10: Dashboard — onboarding et « Page en ligne »

**Files:**

- Create: `apps/dashboard/src/lib/test-booking.ts`, `apps/dashboard/src/lib/test-booking.test.ts`
- Create: `apps/dashboard/src/app/dashboard/connect/test-booking-card.tsx`
- Modify: `apps/dashboard/src/features/onboarding/steps/ConnectActivationStep.tsx` (panneau l. 432-442), `apps/dashboard/src/app/dashboard/connect/page.tsx`
- Test: `ConnectActivationStep.test.tsx`, `apps/dashboard/src/app/dashboard/connect/page.test.tsx`

**Interfaces:**

- Consumes: `POST /restaurant/test-booking-link` (tâche 5).
- Produces: `openTestBooking(api: { post: (path: string) => Promise<unknown> }, publicUrl: string): Promise<string | null>` — ouvre `about:blank` dans un nouvel onglet **avant** l'appel (puis `opener = null`), y charge `url` en cas de succès, `publicUrl` sur `TEST_BOOKING_DISABLED` ; sinon ferme l'onglet et renvoie le message d'erreur (celui de `PAGE_NOT_PUBLISHED`, ou « Le lien de test n’a pas pu être créé. Réessayez. »). Retourne `null` en cas de succès.

- [ ] **Step 1: Tests** — `openTestBooking` : succès, drapeau coupé (ouvre `publicUrl`), page non publiée (message), erreur réseau (message, onglet fermé), onglet bloqué (`window.open` renvoie `null` → message « Autorisez l’ouverture d’un nouvel onglet pour lancer le test. ») ; onboarding : le bouton appelle l'API ; description du panneau exacte : « Faites le parcours d’un client, jusqu’à la confirmation. Les messages vous sont envoyés comme à un client ; rien n’apparaît dans votre restaurant. » ; page Connect : carte « Tester ma page comme un client » avec le même comportement, états chargement et erreur.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (composants `@/components/ui/*`, `cn()`, `transition-all duration-200`, tokens Tailwind). **Step 4:** Tests dashboard, `tsc`, `lint` verts ; `onboarding-tone.test.ts` vert.
- [ ] **Step 5:** Commit `feat(dashboard): lancer une réservation test depuis l'onboarding et la page en ligne`.

### Task 11: Vérification de bout en bout et documentation

**Files:**

- Modify: `docs/runbooks/reservation-management.md` (section réservation test), `docs/obsidian/Journal.md`, `docs/obsidian/Context.md` (TODO de qualification staging), description de la PR #509.

- [ ] **Step 1:** En local, avec `TEST_BOOKING_ENABLED=true` et un secret généré : lancer le test depuis l'onboarding, réserver sur un créneau libre, vérifier en base `is_test = true`, l'outbox de confirmation, l'absence de client créé, l'absence dans le planning et les stats du dashboard, puis la page `/r` si `RESERVATION_MANAGEMENT_ENABLED=true`. Exécuter `purgeTestReservations` avec une date simulée et vérifier la suppression.
- [ ] **Step 2:** `pnpm test`, `pnpm lint`, typechecks verts.
- [ ] **Step 3:** Runbook : activation, quota, purge, qualification staging (SMS reçu, page « Ma réservation », modification, annulation, purge), retour arrière (drapeau à `false`). Vault : entrée Journal ; TODO Context « qualifier la réservation test en staging puis activer en prod ».
- [ ] **Step 4:** Commit `docs: réservation test`, push, mise à jour de la description de la PR #509 (migration de base signalée).
