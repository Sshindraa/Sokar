# ADR — Ledger d'usage et calcul des coûts

> **Statut** : accepté, implémentation partielle
> **Date** : 2026-09-13
> **Périmètre livré** : schéma, recorder idempotent, projection mensuelle recalculable, routes de lecture et première collecte Telnyx

## Contexte

Sokar doit mesurer les ressources variables avant d'engager les quotas des offres Essential 199 €
et Pro 299 €. Les webhooks fournisseurs et les jobs BullMQ peuvent être rejoués, arriver dans le
désordre ou manquer temporairement. Un compteur mutable mis à jour directement depuis ces sources
rendrait les doublons et les corrections difficiles à auditer.

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
et les limites commerciales. Elles n'exposent jamais le fournisseur, le coût estimé ni la marge.
La période d'historique est limitée à 24 mois et toutes les lectures utilisent le `restaurantId`
résolu par Clerk côté serveur.

Les coûts demeurent internes. Une collecte dont le tarif n'est pas encore modélisé écrit un coût
à zéro avec `metadata.costStatus = UNPRICED`. Cette valeur signifie « coût à rapprocher » et ne doit
pas être interprétée comme un service fournisseur gratuit.

## Première source intégrée

Le webhook Telnyx `call.hangup` enregistre `TELEPHONY_SECONDS` après la mise à jour de l'appel. La
clé utilise `call_leg_id`, déjà stable dans le pipeline. Une panne du ledger est journalisée mais
ne fait pas échouer l'acquittement du webhook Telnyx.

## Travail restant avant quotas commerciaux

- produire les événements ElevenLabs STT, Cartesia TTS, LLM, SMS et email ;
- définir une table de tarifs versionnée et les règles d'arrondi fournisseur ;
- écrire le coût téléphonie réel au lieu de `UNPRICED` ;
- déclencher les collecteurs via une outbox transactionnelle quand l'événement dépend d'une
  écriture métier ;
- planifier le recalcul des rollups et ajouter un rapprochement borné ;
- ajouter les tests Postgres de concurrence et la comparaison d'un appel réel de bout en bout ;
- calculer les p50/p90/p99 avant de fixer les minutes et SMS inclus dans les offres.

Tant que ces points restent ouverts, les limites de plan restent `null` et ne sont pas appliquées.
