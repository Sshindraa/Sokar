# ADR — Fondation feedback et récupération réputation

Date : 14 septembre 2026
Statut : accepté, fondation locale livrée ; activation commerciale et production gelées

## Contexte

SevenRooms et les suites restaurant comparables combinent collecte d'avis, suivi des clients
insatisfaits et actions de récupération. Sokar ne doit pas annoncer cette couverture à partir d'un
simple bouton « avis » : il faut d'abord garantir qu'un retour provient d'une visite réellement
honorée, qu'il ne peut être soumis qu'une fois, qu'un score faible crée une action opérateur
traçable et qu'aucune donnée sensible n'est exposée par un lien public.

La première unité utile peut fonctionner sans choisir un fournisseur d'envoi ou une plateforme
d'avis. Elle doit donc fournir un contrat provider-neutral et rester désactivée tant que les
parcours SMS/email/WhatsApp, les plateformes externes et le pilote n'ont pas été qualifiés. La
fondation d'avantages fidélité est suivie séparément dans
[`adr-loyalty-benefits-foundation.md`](./adr-loyalty-benefits-foundation.md).

## Décision

Nous livrons une fondation locale en quatre étapes :

1. créer une demande de feedback pour une réservation `HONORED` et un client actif ;
2. remettre au client un token opaque à durée limitée, sans contacter de provider ;
3. accepter une note 1–5 et un commentaire borné, de façon idempotente ;
4. créer dans la même transaction une tâche de récupération pour les notes ≤ 2.

La demande est unique par réservation. Le feedback est unique par demande. Les listes et les
mutations opérateur sont toujours filtrées par `restaurantId` résolu côté serveur.

## Modèle de données

La migration additive `20260914170000_reputation_feedback_foundation` ajoute les enums et tables
suivants dans `packages/database/prisma/schema.prisma` :

- `ReputationFeedbackRequest` : réservation, client, canal (`SMS`, `EMAIL`, `WHATSAPP`), statut
  (`PENDING`, `SENT`, `SUBMITTED`, `EXPIRED`, `CANCELLED`), hash du token, expiration et dates de
  cycle de vie. Une contrainte unique sur `reservation_id` empêche plusieurs invitations pour une
  même visite.
- `ReputationFeedback` : demande, réservation, client, score entier 1–5, commentaire optionnel et
  date de soumission. `request_id` est unique et la base impose `CHECK (score BETWEEN 1 AND 5)`.
- `ReputationRecoveryTask` : feedback, réservation, client, statut (`OPEN`, `IN_PROGRESS`,
  `RESOLVED`, `DISMISSED`), priorité (`HIGH` pour 1, `NORMAL` pour 2), acteur haché, code/note de
  résolution bornés et date de résolution. `feedback_id` est unique.

Les clés étrangères sont tenant-scoped par les identifiants de restaurant, réservation et client.
Les suppressions suivent le parent avec `ON DELETE CASCADE`, ce qui évite de laisser une tâche
orpheline après un effacement RGPD du profil.

## Token et endpoint public

`reputation.service.ts` génère 32 octets aléatoires encodés en base64url. Le token brut n'est
retourné qu'à la création ; seul `SHA-256("sokar:reputation-feedback:" + token)` est persisté.
Le token n'est jamais écrit dans les logs, les réponses de liste ou le dashboard.

Le endpoint `POST /reputation/feedback/submit` accepte le token, la note et un commentaire de
2 000 caractères maximum. Une clé inconnue, expirée ou associée à une réservation non exploitable
retourne un `404 REPUTATION_FEEDBACK_NOT_FOUND` générique afin de ne pas révéler l'existence d'un
client ou d'une réservation. La réponse publique ne contient que `feedbackId`,
`recoveryTaskCreated` et `replayed` ; elle ne renvoie pas le commentaire ni les coordonnées.

Les routes protégées sont :

- `POST /reputation/feedback-requests` ;
- `GET /reputation/feedback-requests` et `GET /reputation/feedback-requests/:id` ;
- `GET /reputation/feedback` ;
- `GET /reputation/recovery-tasks` ;
- `PATCH /reputation/recovery-tasks/:id`.

Elles exigent `requireOrg`, la capability `reputation.feedback`, un rôle `OWNER` ou `MANAGER` et
`REPUTATION_ENABLED=true`.

## Invariants et concurrence

- La création vérifie le restaurant actif, la réservation dans le même tenant, l'état
  `ReservationState.HONORED` et l'existence d'un client actif.
- Un rejeu de création relit la demande existante et ne renvoie jamais un nouveau token brut.
- La soumission relit le hash du token puis exécute la création du feedback et le passage à
  `SUBMITTED` dans une transaction Prisma.
- Une course d'insertion sur le feedback ou la tâche de récupération est absorbée par la contrainte
  unique et relue comme un rejeu ; elle ne crée ni deuxième avis ni deuxième tâche.
- Une demande `PENDING` ou `SENT` dont `expiresAt` est dépassé passe à `EXPIRED` avant le rejet.
- Une tâche `RESOLVED` ou `DISMISSED` est terminale. `RESOLVED` et `DISMISSED` exigent un
  `resolutionCode` correspondant à `^[A-Z][A-Z0-9_.-]{1,31}$` ; le code et la note sont normalisés
  avant écriture.

## Expiration et observabilité

`reputation-feedback-expiry.worker.ts` consomme la queue BullMQ
`reputation-feedback-expiry`. Le scheduler l'exécute toutes les 15 minutes avec une limite de
500 lignes ; l'opération est un `updateMany` borné sur les statuts `PENDING`/`SENT` et la date
d'expiration. Le worker ne contacte aucun fournisseur et peut être rejoué sans effet secondaire.

Les tests de service et de routes couvrent création uniquement après `HONORED`, replay, score faible
atomique, token public générique, expiration, isolation tenant et clôture avec résolution. La
fonction de traitement du worker est volontairement séparée pour permettre un test sans Redis. La
page `/dashboard/reputation` couvre les états loading/empty/error, le calcul de score et les
transitions opérateur ; elle ne déverrouille aucun provider.

## Ce qui n'est pas livré par cet ADR

Cette fondation ne fournit pas encore :

- l'envoi SMS/email/WhatsApp, les templates, consentements par canal et limites de fréquence ;
- le raccordement Google, Tripadvisor ou une autre plateforme, ni la réponse/publication d'avis ;
- un programme de points, des coupons ou une reconnaissance temps réel au service ; les avantages
  opérationnels simples sont décrits dans l'ADR fidélité dédié ;
- un score agrégé public ou une promesse d'amélioration de note ;
- la qualification d'un pilote avec données réelles.

Ces éléments restent des gates externes dans `docs/release/product-gates.json`. Le flag
`REPUTATION_ENABLED` vaut `false` par défaut dans les exemples d'environnement et ne doit pas être
ouvert en production pendant le gel des offres 199/299 €.

## Migration, rollback et activation

La migration est additive et doit être appliquée avant toute activation future. Un rollback
applicatif désactive `REPUTATION_ENABLED` et laisse les tables en place. Une restauration de base ne
se fait qu'avec le runbook de rollback et une sauvegarde horodatée. L'ouverture d'un pilote devra
apporter un secret de lien, un fournisseur d'envoi qualifié, des callbacks testés, une preuve de
limitation de fréquence et un plan d'effacement avant de changer le manifest de gates. L'écran
opérateur local doit être validé avec ces parcours avant toute activation.
