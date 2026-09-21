# Rejeu Stripe Essential — 21 septembre 2026

Cette fiche conserve les preuves du rejeu sandbox de la boucle commerciale et de la
réconciliation des catalogues. Aucun paiement réel n'a été effectué.

## Catalogues et webhooks

- Le catalogue **test** et le catalogue **live** contiennent chacun huit prix v2
  conformes : Essential 199 €, Pro 299 €, Multi-site 249 €, add-on 99 €, avec
  l'annuel à −20 %, en EUR, récurrents et `tax_behavior=exclusive`.
- Les variables GitHub `STRIPE_STAGING_*` et `STRIPE_PRODUCTION_*` pointent vers ces
  prix. Les anciens prix restent actifs pour les abonnements historiques et ne sont
  pas archivés.
- Les endpoints Stripe staging et live ont les événements
  `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `invoice.paid`, `invoice.payment_failed` et `invoice.payment_succeeded`, en plus
  des événements déjà utilisés par les paiements.

## Rejeu staging

Le bac à sable utilisait le compte de démonstration staging, avec le checkout ouvert
temporairement. Les identifiants ci-dessous sont des identifiants Stripe de test, pas
des secrets.

| Étape            | Résultat observé                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Checkout         | `cs_test_a1IOZvKvWQbeQM0XKHntBPowEgghs3dDDMU7x3GyiuY6KKk4wSnLW3KTzO`, état `complete`, paiement `paid`, total `19900 EUR`                                                     |
| Souscription     | `sub_1UICjXHCZZuqZF0hNjQpVmvG`, prix Essential mensuel v2, état `active`, cadence `monthly`, `entitledSiteCount=1`                                                            |
| Facture initiale | `in_1UICjXHCZZuqZF0hEWNI81Tr`, état `paid`, `amount_paid=19900`                                                                                                               |
| Webhook initial  | `checkout.session.completed`, `customer.subscription.created                                                                                                                  | updated`, `invoice.paid`, `invoice.payment_succeeded`: tous`processed`dans`StripeWebhookEvent` |
| Portail          | `POST /billing/portal-session` → `200`, URL Stripe Billing générée                                                                                                            |
| Échec contrôlé   | Facture probe `in_1UICnlHCZZuqZF0hk5mwz4Jr`, `amount_due=100`, carte test nécessitant une action : `invoice.payment_failed` traité, souscription `past_due`, droits conservés |
| Récupération     | La facture probe passe `paid`, `invoice.paid` et `invoice.payment_succeeded` sont `processed`, la souscription revient `active`                                               |
| Nettoyage        | `customer.subscription.deleted` `evt_1UICuQHCZZuqZF0hekDoTUIZ` traité, l'abonnement sandbox est annulé et le fichier `.env` staging temporaire restauré                       |

Les réponses `GET /billing/status` ont confirmé les transitions `active → past_due →
active`, avec `billingInterval=monthly`, `accountScoped=true` et une entitlement
réduite à un site pour Essential.

## Suite nécessaire avant ouverture commerciale

- Déployer la migration additive `20260921164000_subscription_billing_interval`, puis
  exécuter le backfill en dry-run et avec `--apply` sur chaque base qui contient des
  prix historiques.
- Déployer le code et les prix synchronisés avant de passer
  `BILLING_CHECKOUT_ENABLED=true` en production.
- Conduire deux pilotes Essential réels pendant sept jours et joindre leurs fiches
  GO/NO-GO à la porte `P1_ESSENTIAL`.
