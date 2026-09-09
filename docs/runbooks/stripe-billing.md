# Runbook — Stripe Billing (abonnements Sokar)

## Parcours

1. Le visiteur choisit une formule dans `/pricing`.
2. Clerk crée le compte et l'organisation restaurant.
3. Le dashboard appelle `POST /billing/checkout-session` avec `plan` (`essential`, `pro`, `multi-site`) et `billing` (`monthly`, `annual`). Pour un compte multi-site, seul `OWNER` peut lancer le Checkout.
4. L'API crée (ou réutilise) le client Stripe au niveau du compte et renvoie l'URL Checkout hébergée. Une clé `Idempotency-Key` client est acceptée ; à défaut, Sokar en génère une au niveau du compte/formule/cadence sur une fenêtre de 24 heures. Les tentatives sont conservées sur le site principal.
5. `checkout.session.completed` puis `customer.subscription.*` mettent à jour le plan, `RestaurantBilling` et la projection `RestaurantAccountBilling` (`siteCount`).
6. Le propriétaire peut appeler `POST /billing/portal-session` pour ouvrir le portail Stripe hébergé et gérer la formule, les factures ou la résiliation.
7. Le dashboard appelle `GET /billing/status` pour afficher l'état de l'abonnement, la cadence, la prochaine échéance et une éventuelle période de grâce ou résiliation programmée. La réponse ne contient aucun identifiant Stripe.
8. Les événements Stripe sont inscrits dans `StripeWebhookEvent` avant mutation ; un doublon traité est ignoré, un événement ancien est ignoré et un traitement concurrent provoque un retry Stripe.

Les événements `invoice.payment_failed`, `invoice.paid` et
`invoice.payment_succeeded` synchronisent aussi le statut d'abonnement. Un
échec passe le compte en `past_due` et conserve ses droits pendant la période
de grâce configurée dans Stripe ; un paiement ultérieur repasse le compte en
`active`. Une annulation demandée depuis le portail conserve
`cancel_at_period_end` et le plan jusqu'à la fin de la période : seul
`customer.subscription.deleted` rétrograde le compte vers Essential. Aucun
remboursement automatique n'est déclenché pour une annulation en milieu de
période.

Les événements `invoice.payment_failed`, `invoice.paid` et
`invoice.payment_succeeded` synchronisent aussi le statut d'abonnement. Un
échec passe le compte en `past_due` et conserve ses droits pendant la période
de grâce configurée dans Stripe ; un paiement ultérieur repasse le compte en
`active`. Une annulation demandée depuis le portail conserve
`cancel_at_period_end` et le plan jusqu'à la fin de la période : seul
`customer.subscription.deleted` rétrograde le compte vers Essential. Aucun
remboursement automatique n'est déclenché pour une annulation en milieu de
période.

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
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_succeeded` (compatibilité avec les anciennes versions de l'API Stripe)

La migration additive `20260907110000_harden_stripe_billing` ajoute les tentatives Checkout, les checkpoints de séquencement et le ledger des événements. Elle doit être appliquée avant de publier l'API qui utilise ces colonnes :

```bash
pnpm --filter @sokar/database migrate:deploy
```

Le champ `Restaurant.plan` est une projection des événements Billing. Les routes restaurant ne l'acceptent plus en mutation ; un changement de formule doit venir de Stripe ou d'une opération Sokar explicitement autorisée.

Une signature absente ou invalide renvoie `400`. Une erreur après vérification de signature renvoie `500` afin que Stripe réessaie. Les événements inconnus sont acquittés après journalisation.

## Preuve staging du 7 septembre 2026

La release `main@d53916c` a été publiée après CI, smoke tests, rollback/restauration et E2E staging verts. Le dashboard staging a créé le site secondaire `Sokar Lyon Test`, conservé ce site dans le sélecteur et chargé ses paramètres après changement de contexte. Le portail Stripe sandbox ouvert depuis le secondaire a affiché la souscription Multi-site avec deux suppléments d'établissement (447 €/mois), la facture payée du 27 août et la carte de test `4242`. Aucun paiement ni résiliation n'a été déclenché pendant cette vérification.

Le backfill account/site staging a été exécuté après un dry-run : 10 candidats détectés, 10 restaurants migrés. Le script doit recevoir `DATABASE_URL` depuis `apps/api/.env` sur le VPS, car `packages/database/.env` n'y est pas présent :

```bash
cd /opt/sokar-staging
set -a
. apps/api/.env
set +a
pnpm --filter @sokar/database backfill:restaurant-accounts
```

La commande reste en dry-run par défaut ; ajouter `-- --apply` uniquement après vérification du rapport et de la sauvegarde de release.

La vérification du webhook signé a ensuite utilisé un événement test `customer.subscription.updated` récupéré depuis Stripe : le payload signé a été envoyé deux fois à `POST /webhooks/stripe` et les deux appels ont répondu HTTP 200 avec `received=true` et sans erreur. Le même payload avec une signature `v1` invalide a répondu HTTP 400 `Webhook signature verification failed`. Aucun Checkout, paiement ou débit supplémentaire n'a été créé pendant ce test. Cette preuve valide la vérification HMAC et l'acquittement idempotent observables au niveau HTTP ; elle ne remplace pas encore la qualification des règles annuel, taxes, prorata, période de grâce et dépassement de quota.

Une lecture Stripe en mode read-only du 7 septembre 2026 confirme que les quatre prix annuels sont actifs en production (mode live) et staging (mode test), récurrents en EUR avec `interval=year` : Essential 1 430,40 €/an, Pro 2 390,40 €/an, Multi-site 2 390,40 €/an et add-on Multi-site 950,40 €/an par établissement supplémentaire. Le test API dédié vérifie que `billing=annual` sélectionne le bon prix et transmet la cadence aux métadonnées Checkout. Cette preuve ne remplace pas encore la qualification de la facture annuelle, des taxes, du prorata, de la période de grâce et du renouvellement.

## Test sans paiement

En local, utiliser des clés `sk_test_...` et les huit prix de test. Les tests automatisés couvrent la validation du parcours, la création de Checkout, les transitions d'abonnement et la reprise après échec de paiement. Ne jamais mettre une clé live ou un prix live dans le dépôt.
