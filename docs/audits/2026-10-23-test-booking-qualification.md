# Qualification de la réservation test — 23 octobre 2026

Statut : en cours ; activation production non autorisée tant que la recette fournisseur reste incomplète.
Périmètre : Chez Sokar de staging uniquement, destinataire de test fourni par Hamza (non conservé ici).

## Défaut découvert par la recette navigateur

Le bouton de la page en ligne ouvre correctement Connect avec `testBooking`, mais Nginx sert `/book/[slug]` et `/widget/[slug]` depuis le dashboard. Le widget dashboard utilisait encore la création historique `/reservations`, sans transmettre le jeton. Les tests Connect de #509 ne couvraient donc pas le composant réellement servi.

Correction : le widget dashboard utilise exclusivement les routes publiques `hold` puis `confirm` avec le jeton pour le mode test, conserve les retours vers la page publique et affiche le statut test / purge sous 24 h. Aucun clic d’attribution marketing ni accord WhatsApp n’est transmis dans ce mode. Le parcours normal est conservé. Un jeton présent mais invalide, vide ou trop long doit être refusé sans revenir à une réservation réelle ; Connect conserve un marqueur invalide pour les valeurs hors contrat.

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

Le portail Telnyx confirme que la clé dédiée `SOKAR_STAGING_VOICE01` a expiré le 21 octobre 2026. La clé de staging et les sauvegardes du 17 octobre répondent toutes 401 ; aucune n’a été restaurée. La clé de production reste intacte. Une nouvelle clé staging doit être créée puis stockée dans `TELNYX_API_KEY_STAGING` et l’environnement API staging, sans figurer dans les sorties ou le dépôt. Callback SMS staging distinct ; ne pas modifier le profil partagé.

## Validation du correctif

- API : 95 tests ciblés passent (jeton, routes Connect et génération du lien, gestion, exclusion des lectures/SQL, purge).
- Dashboard : 28 tests ciblés passent, dont transmission du jeton jusqu’à la confirmation et refus sans repli réel ; TypeScript vert, ESLint sans erreur.
- Connect : 20 tests ciblés passent, y compris les valeurs hors contrat qui restent en mode test.
- CI, staging et recette réelle : à compléter après livraison.

## Activation et retrait

Avant activation production : prouver la réception SMS, les parcours de gestion, l’isolation et la purge. Puis installer un secret dédié `TEST_BOOKING_SECRET` (32 octets hex, key_env), activer `TEST_BOOKING_ENABLED=true` et recharger l’API. Aucune modification des drapeaux de gestion de réservations n’est incluse : leur activation production relève de leur qualification existante. Retour arrière : couper uniquement `TEST_BOOKING_ENABLED` et recharger l’API.
