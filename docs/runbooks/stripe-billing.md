# Runbook — Stripe Billing (abonnements Sokar)

## Parcours

1. Le visiteur choisit une formule dans `/pricing`.
2. Clerk crée le compte et l'organisation restaurant.
3. Le dashboard appelle `POST /billing/checkout-session` avec `plan` (`essential`, `pro`, `multi-site`) et `billing` (`monthly`, `annual`). Pour un compte multi-site, seul `OWNER` peut lancer le Checkout.
4. L'API crée (ou réutilise) le client Stripe au niveau du compte et renvoie l'URL Checkout hébergée. Une clé `Idempotency-Key` client est acceptée ; à défaut, Sokar en génère une au niveau du compte/formule/cadence sur une fenêtre de 24 heures. Les tentatives sont conservées sur le site principal.
5. `checkout.session.completed` puis `customer.subscription.*` mettent à jour le plan, `RestaurantBilling` et la projection `RestaurantAccountBilling` (`siteCount`).
6. Le propriétaire peut appeler `POST /billing/portal-session` pour ouvrir le portail Stripe hébergé et gérer la formule, les factures ou la résiliation.
7. Les événements Stripe sont inscrits dans `StripeWebhookEvent` avant mutation ; un doublon traité est ignoré, un événement ancien est ignoré et un traitement concurrent provoque un retry Stripe.

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

La migration additive `20260907110000_harden_stripe_billing` ajoute les tentatives Checkout, les checkpoints de séquencement et le ledger des événements. Elle doit être appliquée avant de publier l'API qui utilise ces colonnes :

```bash
pnpm --filter @sokar/database migrate:deploy
```

Le champ `Restaurant.plan` est une projection des événements Billing. Les routes restaurant ne l'acceptent plus en mutation ; un changement de formule doit venir de Stripe ou d'une opération Sokar explicitement autorisée.

Une signature absente ou invalide renvoie `400`. Une erreur après vérification de signature renvoie `500` afin que Stripe réessaie. Les événements inconnus sont acquittés après journalisation.

## Test sans paiement

En local, utiliser des clés `sk_test_...` et les huit prix de test. Les tests automatisés couvrent la validation du parcours, la création de Checkout et les quatre transitions webhook. Ne jamais mettre une clé live ou un prix live dans le dépôt.
