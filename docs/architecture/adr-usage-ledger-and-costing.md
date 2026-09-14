# ADR — Ledger d'usage et calcul des coûts

> **Statut** : accepté, implémentation partielle
> **Date** : 2026-09-13 (mise à jour le 14 septembre 2026)
> **Périmètre livré** : schéma, recorder idempotent, projection mensuelle recalculable, routes de lecture, collecte Telnyx, compteurs STT/TTS/LLM, outbox, résolution tarifaire versionnée, import contrôlé de tarifs, rapprochement de facture, ajustements soumis à décision opérateur et export comptable CSV borné

## Contexte

Sokar promet une consommation sans quota client dans les offres Essential 199 € et Pro 299 €. Le
ledger sert à mesurer la qualité de service et le coût opérationnel réel par restaurant afin que
l'équipe Sokar puisse piloter sa marge. Les webhooks fournisseurs et les jobs BullMQ peuvent être
rejoués, arriver dans le désordre ou manquer temporairement. Un compteur mutable mis à jour
directement depuis ces sources rendrait les doublons et les corrections difficiles à auditer.

## Décision

La source de vérité est un ledger append-only `UsageEvent`. Chaque événement porte une quantité,
une unité, un coût estimé en EUR et une clé métier globale `sourceEventKey`. Cette clé est unique en
base et doit identifier un résultat fournisseur final, par exemple
`telnyx:call:<callLegId>:final`.

Le recorder applique les règles suivantes :

- une quantité ou un coût négatif, non fini ou invalide est refusé ;
- les identifiants et unités sont normalisés et bornés avant écriture ;
- le premier traitement crée l'événement ;
- le rejeu de la même clé avec la même consommation retourne la ligne existante ;
- la même clé avec une quantité, une unité, une source ou un coût différent produit
  `USAGE_EVENT_KEY_CONFLICT` ;
- `occurredAt` et les métadonnées descriptives ne participent pas à l'égalité du rejeu, car leur
  valeur peut différer entre deux livraisons du même webhook ;
- une collision concurrente Prisma `P2002` relit la ligne gagnante et applique la même comparaison.

`UsageMonthlyRollup` est une projection reconstructible par restaurant, mois UTC et catégorie. Le
recalcul supprime puis recrée la projection du mois dans une transaction. Le ledger brut reste
inchangé.

## Frontière de données

Les routes client `GET /usage/current` et `GET /usage/history` retournent uniquement les quantités
observées. Elles n'exposent jamais le fournisseur, le coût estimé ni la marge. `GET /usage/current`
annonce explicitement `customerUsagePolicy=UNLIMITED` ; les champs historiques `included`,
`limitsEnforced` et `quotas` restent présents pour compatibilité, avec des limites nulles et aucune
application de seuil.
La période d'historique est limitée à 24 mois et toutes les lectures utilisent le `restaurantId`
résolu par Clerk côté serveur.

Les coûts demeurent internes. Une collecte dont le tarif n'est pas encore modélisé écrit un coût
à zéro avec `metadata.costStatus = UNPRICED`. Cette valeur signifie « coût à rapprocher » et ne doit
pas être interprétée comme un service fournisseur gratuit.

## Première source intégrée

Le webhook Telnyx `call.hangup` enregistre `TELEPHONY_SECONDS` après la mise à jour de l'appel. La
clé utilise `call_leg_id`, déjà stable dans le pipeline. Une panne du ledger est journalisée mais
ne fait pas échouer l'acquittement du webhook Telnyx.

## Mesure des providers voix

Le flux Media Stream compte les échantillons réellement envoyés à ElevenLabs après conversion de
codec, puis convertit ces échantillons en secondes à 8 kHz. Cartesia compte les caractères d'une
requête acceptée après un cache miss ; les réponses natives Telnyx et les hits de cache ne sont pas
facturés comme Cartesia. Le LLM conserve des compteurs par provider et par tour. Les providers qui
supportent `stream_options.include_usage` renvoient leurs tokens dans le dernier chunk ; les
providers qui exposent déjà `usage` dans ce chunk sont lus directement. Dans les deux cas, Sokar
applique sinon une estimation documentée d'environ quatre caractères par token et marque
`countMethod = estimated_chars`.

À la fermeture d'une session, ces mesures sont sérialisées en intentions outbox idempotentes. Le
worker de livraison les tarifera et les écrira dans `UsageEvent`. Une clôture Telnyx finale continue
d'écrire directement le ledger, avec le même résolveur tarifaire, car son webhook est déjà une
source finale et autonome.

## Mesure de la messagerie

Les adaptateurs d'envoi acceptent un contexte métier optionnel contenant uniquement le restaurant,
le type et l'identifiant de la source. Après une réponse fournisseur acceptée, ils appellent le
collecteur `messaging-usage.service.ts`, qui crée une intention outbox `usage.messaging.accepted`.
Les SMS sont comptés en segments GSM-7 ou UCS-2 (160/153 et 70/67 unités), WhatsApp et email en
messages acceptés. La clé `messaging:<canal>:<sourceType>:<sourceId>:accepted` est partagée par
l'outbox et le ledger afin qu'un retry du worker ne double pas la consommation. Le corps du message,
le téléphone et l'adresse email ne quittent jamais le processus d'envoi.

`GET /api/internal/usage/margin` expose aux opérations, derrière le secret
`SOKAR_INTERNAL_USAGE_TOKEN`, les quantités et coûts par restaurant et catégorie ainsi que le statut
`PRICED`, `UNPRICED` ou `MIXED`. La projection opérateur `/admin/usage/margin` applique les
corrections `APPROVED` ayant une portée `restaurant:<id>` et dont la période est entièrement comprise dans le mois :
`estimatedCostEur` reste le coût issu des événements, `adjustedCostEur` ajoute le delta approuvé,
et la marge est calculée sur ce coût ajusté uniquement lorsque les événements de base sont tous
tarifés. Une correction `global` n'est jamais répartie implicitement entre les établissements ;
elle reste dans la file opérateur jusqu'à l'enregistrement d'une portée explicite. Les routes client
ne reçoivent que les quantités et la politique `UNLIMITED` ; les coûts et marges restent internes.

`UsageTariff` contient le prix par unité, sa fenêtre d'effet, sa version et sa source. Tant qu'une
ligne fournisseur/unité n'est pas renseignée, le coût reste `0` avec `UNPRICED` ; aucune valeur de
catalogue n'est inventée dans le code.

### Import des tarifs validés

Les premières lignes de facture sont chargées par
`apps/api/scripts/import-usage-tariffs.ts`, en CSV ou JSON. Le contrat d'entrée est volontairement
étroit : `category`, `provider`, `unit`, `pricePerUnit`, `currency`, `effectiveFrom`, `effectiveTo`,
`version` et `source`. Les dimensions sont normalisées en minuscules, les prix sont conservés avec
neuf décimales maximum et seule la devise EUR est acceptée. Une date doit être ISO (`YYYY-MM-DD` ou
UTC explicite) et la fenêtre doit être strictement positive.

Le script est en dry-run par défaut. Il relit le catalogue avant d'écrire, ignore une ligne
strictement identique déjà présente, et bloque l'import si une version existante diverge, si une
ligne apparaît deux fois ou si deux fenêtres d'effet se chevauchent. L'écriture `--apply` se fait
dans une transaction unique ; une course `P2002` fait échouer l'import afin qu'il soit relancé avec
un catalogue à jour. `source` doit pointer vers une facture ou un relevé conservé dans le coffre
opérations ; aucun tarif ne doit être déduit d'une page publique ou d'une estimation.

Exemple de contrôle (sans taux réel dans le dépôt) :

```zsh
pnpm --filter @sokar/api exec tsx apps/api/scripts/import-usage-tariffs.ts \
  --file ./private/provider-tariffs-2026-09.csv --dry-run
pnpm --filter @sokar/api exec tsx apps/api/scripts/import-usage-tariffs.ts \
  --file ./private/provider-tariffs-2026-09.csv --apply
```

Le contrôle de chevauchement est intentionnellement bloquant : pour changer un tarif à une date
future, la fenêtre précédente doit être clôturée dans le lot de données validé avant de relancer
l'import. Cette étape évite que `resolveUsageTariff()` choisisse silencieusement une ligne
ambiguë.

### Rapprochement de facture

`apps/api/scripts/reconcile-usage-invoice.ts` compare un export de facture aux événements du ledger
sur une fenêtre bornée. Le fichier suit le contrat
`category`, `provider`, `unit`, `periodStart`, `periodEnd` (borne exclusive), `billedQuantity`,
`billedCostEur`, `currency` et `source`. Les lignes de même dimension, période et facture sont
agrégées avant comparaison. L'observation est faite par quantité et coût ; une tolérance doit être
passée explicitement lorsque le fournisseur arrondit (`--quantity-tolerance` ou
`--cost-tolerance`).

Le rapport distingue `MATCH`, `MISMATCH`, `INVOICE_ONLY`, `USAGE_ONLY` et `UNPRICED_USAGE`, et le
script sort en erreur dès qu'une ligne n'est pas `MATCH`. Avec `--output`, le rapport complet est
conservé en JSON (hash déterministe, bornes, tolérances, compteurs et lignes) avant l'évaluation du code de sortie.
Il ne modifie ni `UsageEvent` ni `UsageMonthlyRollup` et ne crée pas de correction comptable
implicite. Les fenêtres qui se chevauchent pour une même dimension sont bloquées, y compris si la
source déclarée diffère ; des lignes découpées sur une même période sont agrégées.

Les écarts validés peuvent être conservés dans `UsageReconciliationAdjustment`, une table additive
qui porte le hash du rapport, la référence de preuve, la portée (`global` ou
`restaurant:<id>`), la dimension, la période, les deltas signés et les hashes d'acteurs. La clé
d'idempotence est dérivée du rapport, de la portée, de la dimension et de la période. Les routes
opérateur `GET/POST /admin/usage/reconciliation-adjustments` et
`POST /admin/usage/reconciliation-adjustments/:id/decision` permettent de créer une correction
`OPEN`, puis de l'`APPROVED` ou de la `REJECTED` avec un prédicat SQL `status = OPEN`. Une course ne
peut donc pas remplacer une décision déjà prise, et aucune de ces transitions ne réécrit le ledger.

### Export comptable

`GET /admin/usage/accounting-export.csv` construit un flux mensuel destiné à la comptabilité ou à
un rapprochement manuel. Le service agrège `UsageEvent` par établissement, catégorie, fournisseur
et unité ; il ajoute ensuite une ligne séparée pour chaque correction `APPROVED`. Les fenêtres des
corrections doivent être entièrement contenues dans le mois demandé, comme pour la projection de
marge. Une correction `global` est exportée avec `cost_status=UNALLOCATED` afin d'imposer une
affectation explicite en aval. Le CSV a un ordre de colonnes versionné, échappe les cellules et
n'inclut aucune donnée de contact ou de contenu de message. Le bouton « Export comptable CSV » du
cockpit `/dashboard/admin/margin` passe par le proxy authentifié ; il ne déclenche aucune écriture.

## Seuils de suivi interne

`evaluateUsageThresholds()` convertit les secondes téléphoniques en minutes, conserve la précision
du ledger et peut retourner les seuils 70 %, 90 % et 100 % pour un budget interne explicitement
configuré. Une limite `null` reste silencieuse : les plans clients sont sans quota. Le worker
horaire `usage-alerts` parcourt les établissements, réclame chaque couple
`mois UTC/restaurant/métrique/seuil` avec `SET NX` pendant 45 jours, puis passe l'alerte au
dispatcher ops. Ces messages servent au suivi des coûts de Sokar ; ils ne bloquent jamais un appel,
un SMS ou une réservation et ne sont pas envoyés au restaurateur.

Le flag `USAGE_ALERTS_ENABLED` est `false` par défaut dans tous les exemples d'environnement. Le
worker et son scheduler peuvent donc être déployés en shadow sans contacter un canal d'alerte ; la
claim Redis empêche les doublons lorsque plusieurs processus exécutent le même tick. En cas de
panne Redis, le worker ne dispatch pas le milestone afin d'éviter un spam répété.

Les budgets de ce cost-watch sont lus séparément via `USAGE_ALERT_VOICE_BUDGET_MINUTES` et
`USAGE_ALERT_SMS_BUDGET_SEGMENTS`. Ils sont optionnels, globaux au suivi opérateur et ne sont pas
les limites d'une formule ; en leur absence, le système reste silencieux et le cockpit de marge
reste la seule surface nécessaire.

## Travail restant pour le suivi opérationnel

- fournir au script les premières lignes de tarifs validées par facture et documenter les règles d'arrondi fournisseur ;
- écrire le coût téléphonie réel au lieu de `UNPRICED` ;
- brancher l'outbox aux mutations métier CRM/réservation qui doivent être atomiques ;
- fournir les premières lignes de facture réelles et brancher ce CSV à l'export comptable aval ;
- affecter explicitement les corrections `global` avant de les inclure dans une marge par établissement ;
- ajouter les tests Postgres de concurrence, panne Redis et comparaison d'un appel réel de bout en bout ;
- si nécessaire, définir un budget interne de pilotage séparé des entitlements clients ; il ne devra
  jamais devenir une limite ou une facturation automatique pour le restaurant.

L'évaluateur et le worker de seuil sont livrés localement et couverts par des tests unitaires. Leur
activation est facultative et ne constitue pas une gate commerciale. La projection de marge
opérateur `/dashboard/admin/margin` est la surface de référence pour suivre le coût par restaurant.
