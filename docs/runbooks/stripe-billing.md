# Runbook — Stripe Billing (abonnements Sokar)

> **Statut : ACTIF — réconcilié le 22 septembre 2026.**
> Le catalogue applicatif et les pages publiques affichent Essential 199 €/mois et Pro 299 €/mois.
> Multi-site reste à 249 €/mois + 99 €/site supplémentaire. Les huit prix Stripe live sont
> réconciliés avec cette grille et le checkout Essential est ouvert en production. La preuve de
> l'ouverture et le seul bloqueur restant (deux pilotes Essential sur sept jours) sont dans
> [`../release/evidence/essential-checkout-opening-2026-09-22.md`](../release/evidence/essential-checkout-opening-2026-09-22.md).

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

Les valeurs doivent être des identifiants Stripe `price_...`. Pour la migration cible, les montants
attendus sont :

| Prix                             | Mensuel HT | Annuel HT (-20 %) |
| -------------------------------- | ---------: | ----------------: |
| Essential                        |   199,00 € |        1 910,40 € |
| Pro                              |   299,00 € |        2 870,40 € |
| Multi-site (base)                |   249,00 € |        2 390,40 € |
| Multi-site (site supplémentaire) |    99,00 € |          950,40 € |

Les prix `MULTI_SITE` couvrent la base ; les prix `MULTI_SITE_ADDON` couvrent chaque établissement
supplémentaire. Le checkout reçoit `siteCount` (2 par défaut, maximum 100) et ajoute une ligne
Stripe par établissement supplémentaire. Tant qu'une valeur manque, l'API renvoie
`503 BILLING_NOT_CONFIGURED` et aucune session n'est créée. La commande
`scripts/ops/sync-stripe-prices.sh` ne crée pas ces prix et ne valide pas leur montant : elle ne
recopie que des `priceId` déjà créés et vérifiés dans Stripe.

Les identifiants de prix sont conservés comme variables GitHub Actions non secrètes (`STRIPE_STAGING_*` et `STRIPE_PRODUCTION_*`). Chaque déploiement les synchronise dans le fichier `.env` du VPS avant le build ; une variable manquante ou invalide bloque le déploiement au lieu de publier une API partiellement configurée. La clé Stripe (`STRIPE_SECRET_KEY`) reste, elle, un secret géré séparément.

### Contrôle automatique du catalogue

`scripts/ops/verify-stripe-catalog.mjs` lit chaque `price_...` côté Stripe et compare montant, devise,
cadence et état au catalogue produit (199/299/249 + 99 €, annuel −20 %). Il est en **lecture seule**
côté Stripe. `scripts/ops/sync-stripe-prices.sh` propage toujours les `priceId`, y compris quand le
checkout reste fermé : cette synchronisation ne crée pas de session et évite qu'une activation future
ne redémarre avec les anciens tarifs. Dès que `BILLING_CHECKOUT_ENABLED=true`, le script vérifie le
catalogue dans un fichier temporaire et échoue avant toute publication si un `priceId` pointe vers
l'ancien tarif 149/249 €, si le script de contrôle est absent ou si Stripe est indisponible.

```zsh
node --env-file=apps/api/.env scripts/ops/verify-stripe-catalog.mjs
# → tableau des huit prix, puis « N prix non conformes » et code retour 1 en cas d'écart
```

Les montants annuels sont contrôlés eux aussi ; `STRIPE_EXPECTED_<SUFFIXE>` (par exemple
`STRIPE_EXPECTED_PRO_ANNUAL=287040`) permet de les surcharger le jour où la grille change, sans
toucher au script.

### Provisionnement idempotent de la grille v2

Les prix Stripe étant immuables, `scripts/ops/provision-stripe-catalog.mjs` crée la grille v2 sur
les produits existants, avec une `lookup_key` stable, sans modifier ni archiver les anciens prix.
Les souscriptions historiques conservent donc leur prix ; seules les nouvelles souscriptions
utilisent les nouveaux `priceId` après synchronisation. La commande lit les huit
`STRIPE_PRICE_*` actuels pour retrouver les produits sources et exige des prix EUR, HT
(`tax_behavior=exclusive`) et récurrents à l'intervalle attendu.

```zsh
# Aperçu sans mutation (avec les priceId source dans l'environnement)
node --env-file=apps/api/.env scripts/ops/provision-stripe-catalog.mjs

# Compte test : crée ou réutilise les huit prix, puis affiche les variables à synchroniser
node --env-file=apps/api/.env scripts/ops/provision-stripe-catalog.mjs --apply --env
```

La création est protégée par `--apply`. Avec une clé `sk_live_`, elle exige en plus
`--allow-live` et `STRIPE_ALLOW_LIVE_CATALOG_MUTATION=CREATE_SOKAR_CATALOG_V2`; cette double
garde évite de créer un catalogue live par erreur. Reporter ensuite les huit valeurs dans les
variables GitHub de l'environnement concerné, lancer `verify-stripe-catalog.mjs`, puis seulement
déployer. Ne jamais archiver les prix historiques tant qu'une souscription peut encore les référencer.

## Réconciliation du catalogue — porte P1_ESSENTIAL

**Livré le 22 septembre 2026.** Le catalogue live contient huit prix conformes
à la grille 199/299/249 + 99 €, avec cadence mensuelle et annuelle. La commande
de contrôle a retourné `8/8 conformes` avant l'ouverture du checkout.

Pour une nouvelle grille, conserver la séquence ci-dessous en lecture seule puis
mettre à jour la preuve de release ; ne jamais modifier un Price existant.

1. Créer dans Stripe (mode test d'abord, puis live) les huit prix récurrents aux montants du tableau
   ci-dessus, en EUR, intervalles `month`/`year` et `interval_count = 1`.
2. Renseigner les huit variables GitHub Actions (`STRIPE_STAGING_*`, `STRIPE_PRODUCTION_*`) avec les
   `priceId` obtenus — jamais la clé secrète.
3. Vérifier avant tout déploiement : `node --env-file=apps/api/.env scripts/ops/verify-stripe-catalog.mjs`.
4. Le déploiement refuse de synchroniser des prix non conformes, donc un catalogue à l'ancien tarif
   ne peut pas être activé par inadvertance.

## Rejeu du cycle complet en sandbox — porte P1_ESSENTIAL

**Livré le 21 septembre 2026.** Le rejeu sandbox complet est conservé dans
[`docs/audits/2026-09-21-billing-replay.md`](../audits/2026-09-21-billing-replay.md).
Le tableau reste la procédure de référence pour rejouer le parcours après une
modification Stripe ; conserver les preuves (captures, identifiants d'événements)
dans `docs/audits/`.

| Étape                      | Ce qui est vérifié                                                           | Preuve attendue                             |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| 1. Checkout Essential      | redirection, montant 199 €, client Stripe créé                               | capture + `checkout.session.completed`      |
| 2. Souscription active     | `GET /billing/status` renvoie `essential`, cadence et échéance               | réponse JSON                                |
| 3. Facture                 | facture au bon montant, `invoice.paid` traité                                | capture Stripe + ligne `StripeWebhookEvent` |
| 4. Portail                 | ouverture du portail, changement de formule                                  | capture                                     |
| 5. Échec de paiement       | `invoice.payment_failed` → `past_due`, droits conservés                      | réponse `/billing/status`                   |
| 6. Grâce puis recouvrement | paiement suivant → retour `active`                                           | captures                                    |
| 7. Annulation              | `cancel_at_period_end` puis `customer.subscription.deleted` → rétrogradation | réponses `/billing/status`                  |
| 8. Réactivation            | second Checkout possible après annulation                                    | capture                                     |

`BILLING_CHECKOUT_ENABLED` est à `true` en production depuis le 22 septembre
2026, après ces huit étapes et la vérification du catalogue.

Le dernier rejeu sandbox est archivé dans
[`docs/audits/2026-09-21-billing-replay.md`](../audits/2026-09-21-billing-replay.md), avec les
identifiants Stripe de test, les états `/billing/status` et le traitement du ledger webhook.

### Migration des abonnements historiques

Les abonnements restent sur leur `priceId` d'origine après une hausse de tarif : Stripe ne permet pas
de modifier un Price existant. La migration additive
`20260921164000_subscription_billing_interval` conserve donc leur cadence dans les projections
Sokar, au lieu de la déduire des seuls prix actuellement proposés. Après `prisma migrate deploy`,
exécuter le backfill en lecture seule puis avec `--apply` sur chaque environnement :

```zsh
pnpm --filter @sokar/api ops:billing-interval-backfill
pnpm --filter @sokar/api ops:billing-interval-backfill -- --apply
```

Le script lit les objets Price Stripe et ne modifie que les projections dont la cadence est absente.

### Événements webhook requis

L'endpoint Stripe de chaque environnement doit conserver les événements déjà utilisés par les cartes
cadeaux **et** recevoir `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
`invoice.paid`, `invoice.payment_failed` et `invoice.payment_succeeded`. Sans les trois événements de
facture, Checkout peut réussir tandis qu'un échec ou un recouvrement ne met jamais à jour les droits.

```zsh
STRIPE_WEBHOOK_ENDPOINT_URL=https://api-staging.sokar.tech/webhooks/stripe \
  node --env-file=apps/api/.env scripts/ops/ensure-stripe-webhook-events.mjs

# Compte test : ajoute seulement les événements manquants, en préservant les autres.
STRIPE_WEBHOOK_ENDPOINT_URL=https://api-staging.sokar.tech/webhooks/stripe \
  node --env-file=apps/api/.env scripts/ops/ensure-stripe-webhook-events.mjs --apply
```

Pour le compte live, la même commande exige aussi `--allow-live` et
`STRIPE_ALLOW_LIVE_WEBHOOK_MUTATION=ENSURE_SOKAR_BILLING_EVENTS`.

## Pilotes Essential — porte P1_ESSENTIAL

**Reste ouvert.** Deux restaurants, sept jours, avec au minimum : consentement
du restaurateur, captures des écrans clés, métriques (appels, réservations,
incidents, statut de paiement) et décision GO/NO-GO signée. La fiche de pilote
va dans `docs/audits/` et la porte `P1_ESSENTIAL` de
`docs/release/product-gates.json` ne passe à `CLOSED` qu'avec ces preuves.

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

Une lecture Stripe en mode read-only du 7 septembre 2026 confirme que les quatre prix annuels alors
actifs en production (mode live) et staging (mode test) restent ceux de l'ancien catalogue :
Essential 1 430,40 €/an, Pro 2 390,40 €/an, Multi-site 2 390,40 €/an et add-on Multi-site
950,40 €/an par établissement supplémentaire. Cette preuve historique ne valide pas la nouvelle
grille 199/299 ; elle doit être remplacée après création des nouveaux prix, synchronisation des
`priceId`, Checkout, facture, taxes, prorata, période de grâce et renouvellement en sandbox.

## Test sans paiement

En local, utiliser des clés `sk_test_...` et les huit prix de test. Les tests automatisés couvrent la validation du parcours, la création de Checkout, les transitions d'abonnement et la reprise après échec de paiement. Ne jamais mettre une clé live ou un prix live dans le dépôt.
