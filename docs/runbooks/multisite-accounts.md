# Runbook — backfill des comptes multi-site

Ce runbook prépare les restaurants historiques à la relation compte → établissement après application de la migration `20260907140000_add_restaurant_accounts`.

Le script ne modifie rien par défaut. Il utilise l'identifiant historique du restaurant comme `clerkOrganizationId`, conserve l'ID du restaurant et marque ce restaurant comme établissement principal.

## Préparation

1. Vérifier le backup PostgreSQL et la possibilité de restauration sur staging.
2. Vérifier que la migration multi-site est appliquée et que `prisma validate` passe.
3. Exécuter la simulation sur l'environnement ciblé :

```sh
pnpm --filter @sokar/database backfill:restaurant-accounts
```

Pour limiter la simulation à quelques lignes :

```sh
pnpm --filter @sokar/database backfill:restaurant-accounts -- --limit=2
```

## Application

L'application est une action séparée, effectuée après revue du nombre de candidats :

```sh
pnpm --filter @sokar/database backfill:restaurant-accounts -- --apply
```

Le script traite chaque restaurant dans une transaction et affiche uniquement le mode, le nombre de candidats et le nombre migré. Il est relançable : les restaurants déjà rattachés sont ignorés.

## Parcours dashboard et API

- `GET /restaurants/sites` retourne uniquement les établissements accessibles au membre courant et le site actif recommandé ; le dashboard conserve ce choix dans un stockage local par organisation.
- Le proxy dashboard transmet `X-Sokar-Site-ID` à chaque requête API. Le serveur résout toujours le compte, le site et le rôle avant d'exécuter une route.
- Un membre `READ_ONLY` peut consulter son périmètre mais reçoit `READ_ONLY_ACCESS` sur toute mutation HTTP ; les opérations de cycle de vie restent réservées à `OWNER`.
- Le propriétaire peut ajouter un site via `POST /restaurants/sites`, modifier son nom ou son statut via `PATCH /restaurants/sites/:id`, et gérer un membre via `/restaurants/sites/:id/members`.
- Le Checkout de souscription est réservé au rôle `OWNER`. Depuis un site secondaire, il réutilise le client Stripe et la clé d'idempotence du compte, enregistre le site courant dans les métadonnées et conserve les tentatives sur le site principal.
- Le bouton de paramètres appelle `POST /billing/portal-session` pour ouvrir le portail Stripe hébergé ; il permet de changer de formule, consulter les factures ou résilier sans exposer de données de paiement au dashboard.
- Un ajout est refusé avec `MULTI_SITE_SUBSCRIPTION_REQUIRED` lorsque le quota `RestaurantAccountBilling.entitledSiteCount` est atteint. Les webhooks Stripe projettent le `siteCount` au niveau du compte ; staging a créé un troisième site puis refusé le quatrième hors quota.
- Le site principal ne peut pas être suspendu ou archivé s'il est le dernier établissement actif. Une suspension/archivage n'efface aucune donnée et les requêtes d'un site indisponible sont refusées par le resolver.

## Contrôles après application

- vérifier que le nombre de restaurants avec `account_id IS NULL` est nul ou documenté ;
- vérifier qu'un compte possède exactement un établissement principal pendant la transition ;
- appeler `GET /restaurants/sites` avec deux organisations Clerk de test ;
- vérifier qu'une requête avec `X-Sokar-Site-ID` vers un site non attribué est refusée ;
- vérifier qu'un site suspendu est absent du sélecteur puis réapparaît après réactivation ;
- conserver le backup et le rapport de migration dans la release ;
- ne pas activer la facturation multi-site sans preuve d'entitlement Stripe, provisioning de deux sites et test d'un membre Clerk limité à un site ; les deux premiers sont maintenant validés sur staging.
