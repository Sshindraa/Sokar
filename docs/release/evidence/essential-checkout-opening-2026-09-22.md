# Ouverture du checkout Essential — 22 septembre 2026

## Décision

`BILLING_CHECKOUT_ENABLED` passe à `true` en production et sort de la liste
`productionRelease.disabledFeatureFlags`. La porte `P1_ESSENTIAL` reste `OPEN` :
ses deux autres bloqueurs sont levés, le troisième (deux pilotes signés sur sept
jours) ne peut l'être qu'après l'ouverture, puisque les pilotes sont des
abonnements réels.

C'est la porte technique du gel 199/299 qui s'ouvre, pas la porte commerciale :
la formule devient achetable, et les pilotes restent à conduire et à documenter.

## Prérequis vérifiés

| Prérequis                                           | État    | Preuve                                                                      |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Code et migration additive déployés                 | fait    | `Deploy Production` vert sur `b00e326`, 79/79 migrations appliquées         |
| Backfill des projections historiques                | fait    | production 0 projection ; staging 1 résolue et modifiée                     |
| Smoke test de la release                            | fait    | job `Deploy Staging` vert puis promotion production                         |
| Catalogue Stripe live (huit prix, EUR, HT, cadence) | fait    | `verify-stripe-catalog.mjs` : 8/8 conformes, montants et annuel −20 %       |
| Événements webhook live                             | fait    | `ensure-stripe-webhook-events.mjs` : « Événements billing : conformes »     |
| Cycle complet rejoué en sandbox                     | fait    | [`2026-09-21-billing-replay.md`](../../audits/2026-09-21-billing-replay.md) |
| Deux pilotes Essential signés sur sept jours        | à faire | bloqueur restant de `P1_ESSENTIAL`                                          |

## Portée

- Formules ouvertes à l'achat : Essential 199 €/mois ou 1 910,40 €/an.
- Pro, Multi-site et les add-ons restent hors périmètre de cette décision : ils
  sont vendus par le même catalogue, mais la porte `P1_ESSENTIAL` ne couvre que
  Essential. Toute ouverture commerciale au-delà doit être documentée ici.
- Le checkout reste fermé si `STRIPE_PRICE_*` manque : l'API renvoie
  `503 BILLING_NOT_CONFIGURED` plutôt que de créer une session incomplète.

## Retour arrière

`BILLING_CHECKOUT_ENABLED=false` dans `/opt/sokar/apps/api/.env` puis
`pm2 restart sokar-api` : la route de checkout redevient indisponible, les
abonnements existants continuent d'être servis et les webhooks continuent d'être
traités. Le retour arrière n'annule aucun abonnement en cours.
