# ADR — Fondation feedback et récupération réputation

Date : 14 septembre 2026
Statut : accepté, fondation locale livrée ; activation commerciale et production gelées

## Décision — version privée ciblée (28 octobre 2026)

Pour les offres Pro et Multi-site, une réservation honorée avec adresse e-mail et client actif déclenche, après 24 heures, une demande de retour privé envoyée par Resend avec `EMAIL_FROM`. Le contenu est un message de service sans publicité ni lien vers Google ou une autre plateforme d'avis : aucune redirection conditionnée par la note. Une note de 1 ou 2 ouvre une tâche de récupération dans l'écran existant.

Le client reçoit au maximum une demande tous les 90 jours par restaurant. Un lien permet de refuser les demandes futures de ce restaurant, sans affecter les confirmations de réservation. Le refus et la date de demande suivent une fusion de profils. Les réservations de test ne déclenchent pas d'envoi. Les notifications entrent dans le suivi d'usage transactionnel existant.

Le plafond est de **10 tentatives par jour UTC pour toute la plateforme**, y compris les refus et les résultats incertains. Au-delà, la demande est reportée au jour suivant. Ce plafond propre aux retours ne constitue pas un plafond global de tous les messages Resend ; le budget et les autres usages doivent être surveillés ensemble. Un résultat de fournisseur incertain n'est pas renvoyé automatiquement.

La demande reste unique par réservation et le feedback unique par demande. Les listes et mutations opérateur sont filtrées par restaurant.

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

Les demandes manuelles utilisent un token aléatoire. Pour l’e-mail, un HMAC dérive un token opaque par réservation à partir de `REPUTATION_EMAIL_SECRET` ; seul `SHA-256("sokar:reputation-feedback:" + token)` est persisté. Le token est transmis dans le fragment du lien et retiré après soumission.
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

Elles exigent `requireOrg`, la capability `reputation.feedback`, un rôle `OWNER` ou `MANAGER`.

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

## Périmètre et exploitation

Aucun SMS, WhatsApp, avis public ou programme de points n'est envoyé par ce parcours. Le lien de désinscription reste valable après expiration du questionnaire. Les pages publiques ne sont pas indexées et ne transmettent pas le token dans les URL serveur.

La migration `20261028120000_reputation_private_email` est additive. Avant déploiement, configurer une valeur aléatoire d'au moins 32 caractères pour `REPUTATION_EMAIL_SECRET` dans l'environnement API, ainsi que `API_URL`, `EMAIL_FROM` et Resend ; ne jamais placer ce secret dans Git. Sans secret, l'envoi échoue. Un rollback applicatif conserve les tables ; la restauration de base suit le runbook dédié.
