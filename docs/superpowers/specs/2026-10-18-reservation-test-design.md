# Réservation test : l'expérience client réelle, sans effet pour le restaurant

Date : 18 octobre 2026. Statut : design validé en conversation, spec à relire.

## Objectif

Le restaurateur doit voir exactement ce que voit son client quand il réserve en ligne :
widget, écran de confirmation, SMS, WhatsApp ou e-mail de confirmation, page « Ma réservation »,
modification et annulation. La réservation test ne doit avoir aucun effet côté restaurant :
ni table bloquée, ni planning, ni statistiques, ni CRM, ni alerte au service.

Aujourd'hui, l'étape « Règles et diffusion » de l'onboarding fait créer une vraie réservation
que le restaurateur doit annuler à la main. La première version de la PR #509 simulait la
confirmation dans le widget sans rien envoyer ; elle ne montrait ni les messages ni la page
« Ma réservation ». Cette spec la remplace.

## Décisions

| Sujet                         | Décision                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Messages au client            | Envoyés pour de vrai (confirmation, modification, annulation)                      |
| Visibilité côté restaurant    | Aucune : ni dashboard, ni planning, ni stats, ni CRM, ni alerte                    |
| Rappel de la veille           | Non envoyé                                                                         |
| Durée de vie                  | Purge 24 h après la création                                                       |
| Points d'entrée               | Onboarding (« Règles et diffusion ») et page « Page en ligne » du dashboard        |
| Paiement (empreinte, acompte) | Hors périmètre : le widget Connect n'a pas d'étape de paiement                     |
| Approche                      | Colonne `is_test` sur `reservations`, exclue automatiquement des lectures en masse |

Approches écartées : une table séparée (dupliquerait confirmation, messages et page
« Ma réservation », donc divergence) ; un filtre écrit à la main dans chaque requête
(environ 90 endroits, oubli probable dans les requêtes futures).

## 1. Lancement et lien de test

- Nouvelle route authentifiée `POST /restaurants/:id/test-booking-link` (Clerk, accès au
  restaurant vérifié comme les autres routes du dashboard). Elle renvoie
  `{ url }` vers `/restaurant/<slug>?testBooking=<jeton>`.
- Jeton : identifiant du restaurant et expiration à 1 h, signé HMAC côté serveur sur le
  modèle de `reservation-management.ts`, avec une clé dédiée lue dans l'environnement
  (`TEST_BOOKING_SECRET`, documentée dans `docs/runbooks/environment.md`).
- Dashboard : le bouton « Réserver sur ma page » de `ConnectActivationStep` et une nouvelle
  carte « Tester ma page comme un client » dans `/dashboard/connect` appellent la route puis
  ouvrent le lien dans un nouvel onglet. Si l'appel échoue, un message d'erreur s'affiche ;
  aucun repli vers une réservation réelle.
- Connect : `restaurant/[slug]/page.tsx` et `widget/[slug]/page.tsx` transmettent le jeton
  dans les liens et au `BookingWidget`, affichent le bandeau « Réservation test », et ne
  comptent ni `page_view`, ni `widget_page_view`, ni clic CTA, ni sélection de créneau.
- Le widget envoie le jeton dans `hold` et `confirm` via un champ optionnel
  `testBookingToken` (ajout ; les appels existants ne changent pas). L'attribution marketing
  n'est pas envoyée en mode test.
- API (`connect.routes.ts`) : jeton absent, comportement actuel. Jeton présent mais invalide,
  expiré ou d'un autre restaurant : `403` avec « Ce lien de test a expiré. Relancez-le depuis
  votre tableau de bord. », sans jamais créer de réservation réelle.
- Quotas : au plus 5 réservations test par restaurant sur 24 h (compteur Redis, refus clair
  au-delà). La limite de 5 confirmations par heure et par numéro (`canConfirm`) ne compte pas
  les réservations test.

## 2. Création et isolation

- Création par le vrai circuit : vrai `hold`, vrai `confirm`, `reservation.service.ts`
  avec `isTest: true`. La vérification de disponibilité est la vraie.
- Sautés pour une réservation test : `CustomerService.lookupOrCreate` et
  `recordReservationEvent`, `emitConnectEvent`, attribution et conversion marketing,
  association de carte cadeau, alerte « nouvelle réservation » au restaurant,
  enregistrement dans le registre global des consentements (`consents.recordConsent`).
  Les accords restent sur la ligne `reservations.consents`.
- Conservés : `enqueueReservationConfirmation` (message au client selon les réglages du
  restaurant), lien « Ma réservation », journal d'audit de la réservation.
- Extension Prisma sur le modèle `Reservation` (dans `apps/api/src/shared/db/client.ts`) :
  ajoute `isTest: false` au `where` de `findMany`, `findFirst`, `count`, `groupBy`,
  `aggregate` et `updateMany`, sauf si le `where` contient `id` ou mentionne `isTest`.
  `findUnique`, `findUniqueOrThrow`, `create`, `update` et `delete` ne sont pas modifiés.
- Effets attendus : une réservation test ne bloque aucune table ni créneau ; elle n'apparaît
  dans aucune liste, statistique, export ou relance ; aucun rappel ne part.
- Les 28 requêtes SQL brutes portant sur `reservations` sont relues ; chacune filtre
  `is_test = false` ou figure dans une liste d'exceptions commentée.

## 3. Schéma, page « Ma réservation » et purge

- Schéma : `isTest Boolean @default(false) @map("is_test")` sur `Reservation`, index partiel
  `ON reservations (created_at) WHERE is_test`. Migration additive, aucune donnée modifiée.
  À signaler comme migration de base au déploiement.
- `/public/reservation-management` renvoie un champ additif `test: true` pour une
  réservation test. La page `/r` reste identique, avec une mention discrète dans l'en-tête :
  « Réservation test · supprimée automatiquement sous 24 h ».
- Modification et annulation : réelles, mêmes messages que pour un client ; la réservation
  reste `isTest: true`.
- Purge : tâche planifiée toutes les heures (`schedulers.ts`) qui supprime les réservations
  `isTest` créées il y a plus de 24 h et leurs lignes liées (audit, notifications,
  idempotence). Elle ne cible jamais une ligne `isTest = false`. Après purge, le lien
  « Ma réservation » affiche « Lien invalide ou expiré. ».

## 4. Tests, activation et livraison

Tests automatiques :

- Jeton : accepté s'il est valide ; refusé s'il est expiré, falsifié ou d'un autre
  restaurant, sans création de réservation ; quota de 5 par 24 h.
- Création : `isTest` enregistré ; pas de client, pas d'événement Connect, pas
  d'attribution, pas d'alerte au restaurant ; confirmation au client mise en file.
- Extension : listes et comptages excluent les tests ; lecture par `id` et `isTest`
  explicite les trouvent ; une réservation test ne bloque pas un créneau réel.
- SQL brut : garde-fou sur les requêtes `reservations` (filtre ou exception listée).
- Purge : seules les réservations test de plus de 24 h sont supprimées.
- Dashboard et Connect : bouton de l'onboarding, carte « Tester ma page », transmission
  du jeton, bandeaux, absence de suivi statistique en mode test.

Activation : drapeau `TEST_BOOKING_ENABLED`, `false` par défaut. Désactivé, les deux
boutons ouvrent la page publique comme aujourd'hui. Qualification en staging (réservation
test, SMS reçu, page « Ma réservation », modification, annulation, purge), puis activation
en production.

Livraison : dans la PR #509, dont la description sera mise à jour. La simulation
`?testBooking=1` sans envoi est remplacée par le jeton.

## Hors périmètre

- Paiement à la réservation (empreinte, acompte).
- Rappel de la veille.
- Visibilité de la réservation test dans le dashboard du restaurant.
- Réservation par téléphone (agent vocal) et par MCP.
