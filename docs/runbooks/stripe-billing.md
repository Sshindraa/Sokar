# Runbook — Stripe Billing (abonnements Sokar)

## Parcours

1. Le visiteur choisit une formule dans `/pricing`.
2. Clerk crée le compte et l'organisation restaurant.
3. Le dashboard appelle `POST /billing/checkout-session` avec `plan` (`essential`, `pro`, `multi-site`) et `billing` (`monthly`, `annual`).
4. L'API crée (ou réutilise) le client Stripe et renvoie l'URL Checkout hébergée.
5. `checkout.session.completed` puis `customer.subscription.*` mettent à jour le plan et `RestaurantBilling`.

La carte bancaire n'est jamais collectée par le dashboard Sokar. Les URLs de retour sont dérivées de `DASHBOARD_URL`.

## Configuration

Créer les six prix récurrents dans le compte Stripe correspondant à l'environnement, puis renseigner dans `apps/api/.env` :

```text
STRIPE_PRICE_ESSENTIAL_MONTHLY=price_...
STRIPE_PRICE_ESSENTIAL_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_MULTI_SITE_MONTHLY=price_...
STRIPE_PRICE_MULTI_SITE_ANNUAL=price_...
```

Les valeurs doivent être des identifiants Stripe `price_...`. Tant qu'une valeur manque, l'API renvoie `503 BILLING_NOT_CONFIGURED` et aucune session n'est créée.

Le secret `STRIPE_WEBHOOK_SECRET` existant doit rester configuré sur le même endpoint `POST /webhooks/stripe`. Les événements d'abonnement à activer sont :

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Test sans paiement

En local, utiliser des clés `sk_test_...` et les six prix de test. Les tests automatisés couvrent la validation du parcours, la création de Checkout et les quatre transitions webhook. Ne jamais mettre une clé live ou un prix live dans le dépôt.
