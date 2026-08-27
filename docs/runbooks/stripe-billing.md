# Runbook — Stripe Billing (abonnements Sokar)

## Parcours

1. Le visiteur choisit une formule dans `/pricing`.
2. Clerk crée le compte et l'organisation restaurant.
3. Le dashboard appelle `POST /billing/checkout-session` avec `plan` (`essential`, `pro`, `multi-site`) et `billing` (`monthly`, `annual`).
4. L'API crée (ou réutilise) le client Stripe et renvoie l'URL Checkout hébergée.
5. `checkout.session.completed` puis `customer.subscription.*` mettent à jour le plan et `RestaurantBilling`.

La carte bancaire n'est jamais collectée par le dashboard Sokar. Les URLs de retour sont dérivées de `DASHBOARD_URL`.

## Configuration

Créer les huit prix récurrents dans le compte Stripe correspondant à l'environnement (six prix de base et deux add-ons Multi-site), puis renseigner dans `apps/api/.env` :

```text
STRIPE_PRICE_ESSENTIAL_MONTHLY=price_...
STRIPE_PRICE_ESSENTIAL_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_MULTI_SITE_MONTHLY=price_...
STRIPE_PRICE_MULTI_SITE_ANNUAL=price_...
STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY=price_...
STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL=price_...
```

Les valeurs doivent être des identifiants Stripe `price_...`. Les prix `MULTI_SITE` couvrent la base (249€/mois) ; les prix `MULTI_SITE_ADDON` couvrent chaque établissement supplémentaire (99€/mois). Le checkout reçoit `siteCount` (2 par défaut, maximum 100) et ajoute une ligne Stripe par établissement supplémentaire. Tant qu'une valeur manque, l'API renvoie `503 BILLING_NOT_CONFIGURED` et aucune session n'est créée.

Les identifiants de prix sont conservés comme variables GitHub Actions non secrètes (`STRIPE_STAGING_*` et `STRIPE_PRODUCTION_*`). Chaque déploiement les synchronise dans le fichier `.env` du VPS avant le build ; une variable manquante ou invalide bloque le déploiement au lieu de publier une API partiellement configurée. La clé Stripe (`STRIPE_SECRET_KEY`) reste, elle, un secret géré séparément.

Sur staging uniquement, le workflow injecte au build `NEXT_PUBLIC_DEMO_RESTAURANT_ID` (l'identifiant du restaurant de démonstration `chez-sokar-demo`) et `NEXT_PUBLIC_DEMO_STAGING=1`. Le dashboard peut ainsi charger les données de démo sans session Clerk pendant les tests Checkout. Ces variables ne sont jamais injectées en production ; le dashboard de production reste toujours derrière l'authentification.

Le secret `STRIPE_WEBHOOK_SECRET` existant doit rester configuré sur le même endpoint `POST /webhooks/stripe`. Les événements d'abonnement à activer sont :

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Test sans paiement

En local, utiliser des clés `sk_test_...` et les huit prix de test. Les tests automatisés couvrent la validation du parcours, la création de Checkout et les quatre transitions webhook. Ne jamais mettre une clé live ou un prix live dans le dépôt.
