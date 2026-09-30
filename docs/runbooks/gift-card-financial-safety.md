# Cartes cadeaux — activation du lot A

## Décisions adoptées

Le restaurant encaisse sur son compte Stripe Connect ; Sokar prélève une commission
avec `application_fee_amount`. La réservation associe une carte sans consommer son
solde. Seul un appel authentifié par le restaurant débite le montant réel de l'addition.
Le bénéficiaire consulte son solde sur `/gift-card/:code`, avec lien depuis les emails et le PDF, et réserve avec son code prérempli. La valeur offerte reste le montant payé : la commission est supportée par le restaurant.

## Configuration et mise en service

1. Déployer la migration additive `20260930170000_gift_card_financial_safety` avant
   l'API et son worker. Elle ajoute trois tables financières et deux colonnes ;
   aucune suppression ou modification de soldes historiques.
2. Déployer API, workers, Connect et dashboard ensemble : les nouveaux paiements
   Connect utilisent un `checkoutId` et un `accessToken` opaque. Les anciens paiements
   sur le compte plateforme gardent leur chemin de finalisation.
3. Configurer `STRIPE_SECRET_KEY` (API), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (Connect),
   `DASHBOARD_URL` (origine HTTPS du dashboard), `CONNECT_URL` (origine publique de Connect).
   Les clés restent dans l'environnement, jamais dans le dépôt.
4. Dans Stripe, activer Connect et enregistrer un endpoint **événements des comptes
   connectés** vers `POST /webhooks/stripe`. Inclure : `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`,
   `refund.failed`, `charge.dispute.created`, `charge.dispute.closed`.
   Ajouter son secret à `STRIPE_WEBHOOK_SECRET` (liste séparée par des virgules,
   compatible avec l'endpoint billing existant). Contrôler les signatures et `event.account`.
5. Le propriétaire clique « Connecter Stripe » dans le dashboard cartes cadeaux.
   La vente reste bloquée tant que les encaissements ET les versements ne sont pas activés.
6. Facultatif : `GIFT_CARD_IMAGE_ORIGINS` contient uniquement les origines HTTPS de
   CDN maîtrisés, séparées par des virgules. Vide : les images personnalisées sont
   ignorées dans les PDF. Redirections interdites, téléchargement limité à 4 Mio.
7. Vérifier le worker `gift-card-finance` et sa planification toutes les cinq minutes.

## Qualification Stripe avant ouverture des ventes

En mode test, avec un restaurant pilote : onboarding, achat libre et pack, livraison,
rechargement du navigateur après paiement, webhook avant/après retour client,
rejeu simultané, réservation sans débit, débit réel partiel puis solde intégral,
annulation et remboursement partiel externe. Vérifier dans Stripe : compte marchand,
montant capturé, commission réellement prélevée, remboursement de commission,
versement et corrélation avec le registre Sokar. Tester une contribution arrivant après
clôture : aucune valeur créditée, demande de remboursement persistée.

La qualification locale utilise PostgreSQL réel mais Stripe simulé ; elle ne prouve
pas l'onboarding, le virement bancaire ou les notifications réelles.

## Réconciliation et support

- `GiftCardCheckout` fige montant, pack, destinataire et message avant encaissement.
  Stripe ne reçoit que les références opaques. `accessToken` est stocké sous forme de hash.
- `GiftCardPaymentEntry.paymentIntentId` est unique pour achat ET contribution.
  Le verrou transactionnel sur ce paiement empêche le double crédit et la réutilisation
  entre les deux circuits ; les lignes historiques sont aussi vérifiées.
- `GiftCardRefundRequest` est persistée avant l'appel Stripe et porte une clé
  d'idempotence stable. La carte passe à `REFUND_PENDING` avant toute requête distante.
  Un succès confirmé annule le solde ; un échec la laisse bloquée (`REFUND_FAILED`).
- Les événements de remboursement lisent l'état Stripe actuel et appliquent seulement
  l'écart cumulé. Un remboursement externe en attente bloque la carte (`REFUND_REVIEW`) ;
  un litige la bloque en `PAYMENT_REVIEW`. La levée d'un litige nécessite le support.
- La réconciliation reprend les checkouts OPEN et les remboursements en attente,
  par lots de 50 avec rotation sur `updatedAt`. Un échec n'empêche pas les autres
  éléments du lot d'être examinés. Les erreurs remontent dans la queue et les logs
  ne contiennent que des identifiants techniques.
- `RECOVERY_REQUIRED` : création Stripe possiblement acceptée mais référence non
  enregistrée depuis plus de 23 heures. Vérifier Stripe avec la référence checkout,
  rattacher le paiement existant via une procédure de support revue ; ne pas recréer
  une charge après expiration de la garantie d'idempotence Stripe.
- Une cagnotte déjà partiellement consommée exige un remboursement contrôlé : le lot A
  ne choisit pas arbitrairement quels contributeurs rembourser.
- Les notifications sont persistées dans la transaction financière et traitées via outbox.
  Voir `gift-card-delivery.md` pour l’activation coordonnée des workers et la résolution
  des résultats incertains. La caisse et l’export sont décrits dans `gift-card-operations.md`.
  La qualification providers/Stripe et le rapprochement financier restent à effectuer.

## Test local isolé

Créer une base PostgreSQL nommée `sokar_gift_card_finance` sur localhost,
appliquer le schéma de référence puis la migration et lancer :

```sh
GIFT_CARD_FINANCE_TEST_DATABASE_URL=postgresql://sokar_test@127.0.0.1:55439/sokar_gift_card_finance \
  pnpm --filter @sokar/api exec vitest run src/modules/gift-cards
```

La suite transactionnelle refuse tout autre hôte/nom de base. Sans cette variable,
elle est ignorée ; les tests unitaires continuent de s'exécuter.

## Retour arrière

Utiliser le rollback des artefacts décrit dans `rollback.md`. Garder les tables
financières et arrêter les nouvelles ventes avant de revenir à une version qui ignore
les soldes bloqués et Stripe Connect. Ne pas supprimer le registre ni restaurer une DB
ancienne après encaissements sans rapprochement Stripe : les paiements réels persistent
chez le fournisseur. Les cartes historiques débitées à la réservation ne sont pas
recréditées automatiquement ; les corriger seulement après examen de leurs redemptions.
