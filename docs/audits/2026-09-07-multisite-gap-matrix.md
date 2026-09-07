# Matrice de sortie — multi-site

Date : 7 septembre 2026
Statut : **fondation, staging, portail Stripe, webhook signé, quota et statuts de site validés ; isolation réelle et cycle commercial complet restent ouverts**

## Ce qui est maintenant couvert

| Surface                 | Preuve locale                                                                                                                                                                                                                                            | Reste à fermer                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Compte → établissements | Modèles Prisma `RestaurantAccount`, `Restaurant`, facturation compte et migration additive                                                                                                                                                               | Migration déployée ; backfill staging documenté : dry-run 10, apply 10                   |
| Isolation serveur       | Resolver account/site/rôle, refus d'un site étranger, site suspendu ou compte suspendu                                                                                                                                                                   | Deux identités Clerk réelles et deux organisations à rejouer sur staging                 |
| Provisioning            | Sync Clerk transactionnel : compte, propriétaire et site principal                                                                                                                                                                                       | Rejouer le sync en concurrence sur staging                                               |
| Administration          | Ajout de site avec quota, suspension/réactivation, site suspendu exclu du sélecteur, protection du site principal ; l’écriture d’un membre vérifie désormais son appartenance à l’organisation Clerk et n’écrit rien si Clerk refuse ou est indisponible | Invitation Clerk réelle, deux identités isolées et archivage du principal avec garde-fou |
| Facturation compte      | Checkout/portail réservés au propriétaire, idempotence et client Stripe ancrés au compte/site principal ; rejeu signé du webhook validé deux fois avec réponse 200, signature invalide rejetée en 400 et quatrième site refusé hors quota                | Annuel/taxes/prorata et période de grâce                                                 |
| Dashboard               | `GET /restaurants/sites`, sélecteur persistant, en-tête `X-Sokar-Site-ID`, settings de gestion                                                                                                                                                           | Vérifier chaque écran et la largeur iPad avec un compte membre limité                    |
| Backfill                | Script idempotent en dry-run par défaut et runbook ; staging : 10 candidats, 10 migrés                                                                                                                                                                   | Normaliser la source `.env` database sur le VPS et joindre le rapport/backup             |

## Règles de sortie

Le module ne peut être présenté comme activé que lorsque :

1. la migration est appliquée sur staging et la simulation puis l'application du backfill sont documentées ;
2. un compte de test possède deux établissements, un utilisateur propriétaire et un utilisateur limité à un site ;
3. un appel dashboard sur chaque écran reste isolé après changement de site ;
4. l'entitlement Stripe crée le quota attendu et bloque le site supplémentaire au-delà de ce quota (staging : troisième créé, quatrième refusé) ;
5. la suspension et la réactivation sont rejouées ; l'archivage du principal reste soumis au garde-fou et à tester ;
6. le rollback applicatif et la restauration de la base sont testés sur staging.

La projection Stripe du `siteCount`, du statut et des identifiants existe désormais dans `RestaurantAccountBilling`. Le Checkout est réservé au propriétaire et ancré sur le compte/site principal même depuis un site secondaire. Le portail a été ouvert depuis le secondaire en sandbox et a montré la facture Multi-site active à 447 €/mois. Le webhook `customer.subscription.updated` a été rejoué deux fois avec une signature valide (200 à chaque fois) et le même payload avec une signature invalide a été rejeté en 400, sans nouveau paiement. Le staging a également créé un troisième site puis refusé le quatrième hors quota ; la suspension, la réactivation et l’exclusion du site suspendu dans le sélecteur sont validées. La route d’administration vérifie maintenant l’appartenance Clerk avant toute membership locale ; les tests couvrent l’acceptation, le refus sans écriture et l’indisponibilité du fournisseur. Le parcours commercial reste à fermer avec deux identités réelles, les droits d’un membre limité et les règles annuel/taxes/prorata/période de grâce.
