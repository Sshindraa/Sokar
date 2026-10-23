# Qualification de la réservation test — 23 octobre 2026

Statut : en cours ; activation production bloquée tant que la recette fournisseur reste incomplète.
Périmètre : Chez Sokar de staging uniquement, destinataire de test fourni par Hamza (non conservé ici).

## Défaut découvert par la recette navigateur

Le bouton de la page en ligne ouvre correctement Connect avec `testBooking`, mais Nginx sert `/book/[slug]` et `/widget/[slug]` depuis le dashboard. Le widget dashboard utilisait encore la création historique `/reservations`, sans transmettre le jeton. Les tests Connect de #509 ne couvraient donc pas le composant réellement servi.

Correction : le widget dashboard utilise exclusivement les routes publiques `hold` puis `confirm` avec le jeton pour le mode test, conserve les retours vers la page publique et affiche le statut test / purge sous 24 h. Aucun clic d’attribution marketing ni accord WhatsApp n’est transmis dans ce mode. Le parcours normal est conservé. Un jeton présent mais invalide, vide ou trop long doit être refusé sans revenir à une réservation réelle ; Connect conserve un marqueur invalide pour les valeurs hors contrat.

## Défaut de contrainte PostgreSQL

La première réservation test a été confirmée sans SMS (option SMS du restaurant démo initialement coupée), avec `isTest=true`, `customerId=null` et aucun client ajouté. Un deuxième test au même créneau a révélé un rejet PostgreSQL `23P01` : la contrainte historique `reservations_no_overlap_active` ne filtrait pas `is_test`. L’exclusion applicative seule ne suffisait donc pas.

La migration `20261023180000_reservation_test_overlap_exclusion` installe d’abord une contrainte équivalente limitée aux réservations normales, puis remplace l’ancienne dans la même transaction (verrou borné à 5 secondes). Aucune donnée n’est modifiée ou supprimée ; les réservations normales gardent la même protection. Le test PostgreSQL réel vérifie deux tests superposés, la modification d’une réservation normale sur leur table et le refus d’un vrai doublon. Les 10 tests de modification sur une base locale isolée passent après application de toutes les migrations.

## Matrice de recette

| Contrôle                                  | Preuve / état                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Bouton page en ligne → page publique test | Observé en staging, bandeau présent                                                                 |
| Jeton invalide                            | POST hold retourne 403, sans réservation                                                            |
| Widget réellement servi par /book         | Défaut reproduit avant confirmation ; correctif en cours de livraison                               |
| Bouton onboarding                         | Tests automatisés existants ; vérification navigateur restante                                      |
| SMS reçu et lien ouvert sur téléphone     | En attente de clé Telnyx valide et de confirmation du testeur                                       |
| Page Ma réservation : mention test        | Recette réelle restante                                                                             |
| Modification et annulation                | Recette réelle restante                                                                             |
| Planning / statistiques / CRM inchangés   | État initial relevé en staging : 18 réservations normales, 0 test, 4 clients ; comparaison restante |
| Réservation normale voisine modifiable    | Recette réelle restante                                                                             |
| Purge après 24 h avec audit et outbox     | Tests unitaires verts ; preuve base de données restante                                             |

## Blocage fournisseur

Le portail Telnyx confirme que la clé dédiée `SOKAR_STAGING_VOICE01` a expiré le 21 octobre 2026. La clé de staging et les sauvegardes du 17 octobre répondent toutes 401 ; aucune n’a été restaurée. La clé de production reste intacte. Une nouvelle clé `SOKAR_STAGING_TEST_BOOKING`, sans expiration automatique, a été créée sur demande explicite de Hamza ; elle est stockée dans `TELNYX_API_KEY_STAGING` et l’environnement API staging, avec sauvegarde privée préalable. Fichier temporaire supprimé et presse-papiers nettoyé. Telnyx retourne HTTP 200. PM2 conservait la clé expirée dans son environnement : API/workers staging rechargés avec la nouvelle valeur, santé de tous les fournisseurs verte. Callback SMS staging distinct ; ne pas modifier le profil partagé.

## Validation du correctif

- API : 95 tests ciblés passent (jeton, routes Connect et génération du lien, gestion, exclusion des lectures/SQL, purge).
- Dashboard : 28 tests ciblés passent, dont transmission du jeton jusqu’à la confirmation et refus sans repli réel ; TypeScript vert, ESLint sans erreur.
- Connect : 20 tests ciblés passent, y compris les valeurs hors contrat qui restent en mode test.
- PostgreSQL réel : 10 tests de modification passent sur une base locale isolée, y compris les chevauchements test/test et test/réservation normale.
- CI de la première version widget verte ; nouvelle CI requise pour inclure la migration avant livraison.
- Recette réelle : à compléter après livraison. L’option SMS de Chez Sokar staging a été activée pour la recette (initialement false), sans modification d’autre restaurant ni de production.

## Activation et retrait

Avant activation production : prouver la réception SMS, les parcours de gestion, l’isolation et la purge. Puis installer un secret dédié `TEST_BOOKING_SECRET` (32 octets hex, key_env), activer `TEST_BOOKING_ENABLED=true` et recharger l’API. Aucune modification des drapeaux de gestion de réservations n’est incluse : leur activation production relève de leur qualification existante. Retour arrière : couper uniquement `TEST_BOOKING_ENABLED` et recharger l’API.
