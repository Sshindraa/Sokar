# Matrice de sortie — multi-site

Date : 7 septembre 2026
Statut : **fondation et parcours d'administration implémentés dans le worktree ; validation de release ouverte**

## Ce qui est maintenant couvert

| Surface                 | Preuve locale                                                                                           | Reste à fermer                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Compte → établissements | Modèles Prisma `RestaurantAccount`, `Restaurant`, facturation compte et migration additive              | Appliquer la migration sur staging puis exécuter le dry-run/backfill            |
| Isolation serveur       | Resolver account/site/rôle, refus d'un site étranger, site suspendu ou compte suspendu                  | Deux organisations et deux sites réels sur staging                              |
| Provisioning            | Sync Clerk transactionnel : compte, propriétaire et site principal                                      | Rejouer le sync en concurrence sur staging                                      |
| Administration          | Ajout de site avec quota, suspension/réactivation, protection du site principal, membres par site       | Parcours d'invitation Clerk et staging                                          |
| Facturation compte      | Checkout/portail réservés au propriétaire, idempotence et client Stripe ancrés au compte/site principal | Cycle signé staging, facture et changement de quota après paiement              |
| Dashboard               | `GET /restaurants/sites`, sélecteur persistant, en-tête `X-Sokar-Site-ID`, settings de gestion          | Test navigateur desktop/iPad et parcours de changement de site sur chaque écran |
| Backfill                | Script idempotent en dry-run par défaut et runbook                                                      | Backup, rapport et application contrôlée                                        |

## Règles de sortie

Le module ne peut être présenté comme activé que lorsque :

1. la migration est appliquée sur staging et la simulation puis l'application du backfill sont documentées ;
2. un compte de test possède deux établissements, un utilisateur propriétaire et un utilisateur limité à un site ;
3. un appel dashboard sur chaque écran reste isolé après changement de site ;
4. l'entitlement Stripe crée le quota attendu et bloque le site supplémentaire au-delà de ce quota ;
5. la suspension, la réactivation et l'archivage du principal (avec garde-fou) sont rejoués ;
6. le rollback applicatif et la restauration de la base sont testés sur staging.

La projection Stripe du `siteCount`, du statut et des identifiants existe désormais dans `RestaurantAccountBilling`. Le Checkout est maintenant réservé au propriétaire et ancré sur le compte/site principal même depuis un site secondaire. Il reste à prouver sur staging avec un cycle Checkout/webhook signé, une facture et un ajout de site au-delà du quota avant l'ouverture commerciale du parcours payant.
