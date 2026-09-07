# Matrice de sortie — multi-site

Date : 7 septembre 2026
Statut : **fondation, staging et portail Stripe validés ; isolation réelle et cycle Checkout signé restent ouverts**

## Ce qui est maintenant couvert

| Surface                 | Preuve locale                                                                                           | Reste à fermer                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Compte → établissements | Modèles Prisma `RestaurantAccount`, `Restaurant`, facturation compte et migration additive              | Migration déployée ; backfill staging documenté : dry-run 10, apply 10         |
| Isolation serveur       | Resolver account/site/rôle, refus d'un site étranger, site suspendu ou compte suspendu                  | Deux identités Clerk réelles et deux organisations à rejouer sur staging       |
| Provisioning            | Sync Clerk transactionnel : compte, propriétaire et site principal                                      | Rejouer le sync en concurrence sur staging                                     |
| Administration          | Ajout de site avec quota, suspension/réactivation, protection du site principal, membres par site       | Invitation Clerk réelle, suspension/réactivation et quota au-delà de la limite |
| Facturation compte      | Checkout/portail réservés au propriétaire, idempotence et client Stripe ancrés au compte/site principal | Rejeu Checkout/webhook signé, annuel/taxes/prorata et changement de quota      |
| Dashboard               | `GET /restaurants/sites`, sélecteur persistant, en-tête `X-Sokar-Site-ID`, settings de gestion          | Vérifier chaque écran et la largeur iPad avec un compte membre limité          |
| Backfill                | Script idempotent en dry-run par défaut et runbook ; staging : 10 candidats, 10 migrés                  | Normaliser la source `.env` database sur le VPS et joindre le rapport/backup   |

## Règles de sortie

Le module ne peut être présenté comme activé que lorsque :

1. la migration est appliquée sur staging et la simulation puis l'application du backfill sont documentées ;
2. un compte de test possède deux établissements, un utilisateur propriétaire et un utilisateur limité à un site ;
3. un appel dashboard sur chaque écran reste isolé après changement de site ;
4. l'entitlement Stripe crée le quota attendu et bloque le site supplémentaire au-delà de ce quota ;
5. la suspension, la réactivation et l'archivage du principal (avec garde-fou) sont rejoués ;
6. le rollback applicatif et la restauration de la base sont testés sur staging.

La projection Stripe du `siteCount`, du statut et des identifiants existe désormais dans `RestaurantAccountBilling`. Le Checkout est réservé au propriétaire et ancré sur le compte/site principal même depuis un site secondaire. Le portail a été ouvert depuis le secondaire en sandbox et a montré la facture Multi-site active à 447 €/mois. Le parcours payant reste à fermer avec un rejeu Checkout/webhook signé sans nouveau débit, un changement de quota au-delà de la limite et les droits d'un membre limité.
