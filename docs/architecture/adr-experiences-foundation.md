# ADR — fondation locale des expériences et sessions

Date : 14 septembre 2026
Statut : livré localement, flag fermé (`EXPERIENCES_ENABLED=false`)
Portée commerciale : Pro et Multi-site (`experiences.manage`)

## Décision

Sokar possède un catalogue d'expériences provider-neutral et des sessions à capacité contrôlée.
Une expérience décrit le produit vendu (nom, durée, prix EUR, capacité par défaut) ; une session
décrit une occurrence datée ; une réservation de session conserve la quantité et le prix au moment
de la réservation. Le socle est exploitable depuis le dashboard et l'API interne, mais il ne prend
aucun paiement, ne publie aucun événement externe et n'envoie aucun message.

## Modèle de données

- `Experience` : clé technique unique par restaurant, statut `DRAFT | ACTIVE | ARCHIVED`, prix en
  centimes EUR, durée de 15 à 1 440 minutes et capacité de 1 à 1 000.
- `ExperienceSession` : `startsAt < endsAt`, statut `OPEN | CLOSED | CANCELLED`, capacité
  optionnelle qui surcharge celle du catalogue, unicité `(experienceId, startsAt)`.
- `ExperienceReservation` : quantité de 1 à 1 000, snapshot `unitPriceCents`/`totalPriceCents`,
  statut `CONFIRMED | CANCELLED`, rattachement optionnel à `Customer` et `Reservation`.

Les contraintes SQL bornent les montants, dates, devises et longueurs. Les relations restent
tenant-scoped par `restaurantId` et les suppressions suivent les règles explicites du schéma.
Les téléphones ne sortent jamais en clair : les vues API ne renvoient que les quatre derniers
chiffres.

## Réservation concurrente et idempotence

`POST /experiences/:id/sessions/:sessionId/reservations` prend une clé `Idempotency-Key` optionnelle.
La clé est hachée avec le restaurant avant stockage. La transaction acquiert
`pg_advisory_xact_lock(hashtext('experience:<restaurant>:<session>'))`, relit la session, additionne
les quantités `CONFIRMED`, vérifie la capacité puis écrit le snapshot de prix. Une collision unique
rejoue la réservation existante si l'expérience, la session et la quantité correspondent ; une
réutilisation différente renvoie `EXPERIENCE_IDEMPOTENCY_CONFLICT`.

Les annulations utilisent `updateMany` conditionnel (`CONFIRMED → CANCELLED`). Une répétition est
retournée comme replay et ne libère pas deux fois la capacité. Un worker ferme les sessions OPEN
dont `endsAt` est passé ; la réservation refuse aussi les sessions passées, fermées ou les fiches
qui ne sont pas ACTIVE.

## Contrat API et rôles

Les routes sont protégées par `requireOrg`, `experiences.manage` et `EXPERIENCES_ENABLED`.
Owner/Manager peuvent créer ou modifier les fiches et sessions. Owner/Manager/Staff peuvent lire,
réserver et annuler pendant le service. L'opérateur Sokar dispose uniquement de l'endpoint interne
d'expiration du worker.

Routes livrées :

- `GET/POST /experiences`, `PATCH /experiences/:id` ;
- `GET/POST /experiences/:id/sessions`, `PATCH /experiences/:id/sessions/:sessionId` ;
- `GET /experience-reservations` ;
- `POST /experiences/:id/sessions/:sessionId/reservations` ;
- `POST /experience-reservations/:id/cancel` ;
- `POST /api/internal/experiences/sessions/expire`.

Les erreurs d'entrée sont en 400, les ressources absentes en 404 et les conflits de capacité,
d'état ou d'idempotence en 409. Les dates sont converties en `Date` côté validation Zod, puis
ré-encodées ISO par le client dashboard.

## Exécution et rollback

La migration additive `20260914190000_experiences_foundation` crée les trois tables, enums,
index, contraintes et clés étrangères. Le scheduler BullMQ `experience-session-expiry-15min` et
le worker `experience-session-expiry` sont importés par `main.ts` avec une concurrence de 1.
Le flag et la capability permettent un canary sans exposer la fonctionnalité aux restaurants.
Pour retirer le canary, remettre le flag à `false` et arrêter le scheduler ; aucune donnée de
réservation n'est supprimée. La suppression de tables nécessite une migration dédiée et une preuve
d'export/effacement RGPD.

## Hors périmètre volontaire

Paiements, acomptes, remboursements, billets, codes promotionnels, liste d'attente, inventaire
partagé avec les tables, widget/téléphone, Google Reserve/Meta, CRM groupe et reporting de revenu
encaissé restent des portes P5, P7, P9 et pilotes. Leur implémentation devra réutiliser ce snapshot
de prix et ajouter ses propres contrats d'idempotence et de réconciliation.

## Preuves locales

- API : `experience.service.test.ts`, `experience.routes.test.ts` (19 tests) ;
- worker : `experience-session-expiry.worker.test.ts` (2 tests) ;
- dashboard : `/dashboard/experiences` et `page.test.tsx` (5 tests) ;
- typecheck API/dashboard, lint API/dashboard et `prisma validate` passent localement.
