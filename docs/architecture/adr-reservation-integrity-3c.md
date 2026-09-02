# ADR-3C — Invariants et intégrité des réservations

- **Date** : 2026-09-02
- **Statut** : décisions techniques et produit validées ; gates opérationnelles restantes
- **Périmètre** : Phase 3C, sans fusion des deux `ReservationService`
- **Références** : `reservation-state-semantics.md`, `reservation-service-contract-matrix.md`, `queue-runtime-map.md`

## Contexte

Le modèle contient deux colonnes d'état (`status` et `state`) et plusieurs
entrées opérationnelles : legacy, agentic/MCP, Connect, OpenAI Reserve,
dashboard, voice, waiting list, walk-in et copilot. Les preuves de Phase 3A/3B
montrent que les invariants de capacité et d'idempotence sont proches, mais
que les projections, audits, holds et notifications ne sont pas encore
uniformes.

Cet ADR fixe les garde-fous qui peuvent être appliqués sans changer l'API ni
le schéma. Il ne désigne pas de service canonique.

## Décisions

| ID  | Sujet                        | Décision Phase 3C                                                                                                                                                                                                                                                                                                                                               | Statut                                                     | Conséquence immédiate                                                                                                                                       |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Référence de capacité        | `state` est la référence de capacité pour tous les chemins. `PENDING`, `CONFIRMED` et `SEATED` sont actifs ; les états terminaux ne bloquent plus. Les holds `ACTIVE` non expirés bloquent. Une ligne active sans table masque globalement le créneau.                                                                                                          | Retenue                                                    | Les lecteurs et allocations utilisent `state`, le statut du hold et le masque global conservateur.                                                          |
| D2  | `PENDING`                    | `PENDING` signifie « demande reçue mais non confirmée ». Il peut bloquer la capacité si la réservation ou le hold a déjà réservé une ressource.                                                                                                                                                                                                                 | Retenue                                                    | `status=CONFIRMED` ne doit jamais être interprété seul comme une confirmation client.                                                                       |
| D3  | Relation `status/state`      | `state` porte le cycle agentic. `status` est une projection legacy de compatibilité jusqu'à une décision de migration séparée.                                                                                                                                                                                                                                  | Retenue transitoire                                        | Aucun backfill, nouvel enum ou réécriture de service en 3C. Les mismatches restent observables.                                                             |
| D4  | Notification de confirmation | Une notification de confirmation client ne peut partir qu'après une confirmation métier réussie (`state=CONFIRMED` ou contrat legacy explicitement confirmé). Une paire `PENDING/CONFIRMED` ne suffit pas.                                                                                                                                                      | Retenue de sécurité ; accusé de réception `PENDING` ouvert | Les workers doivent faire un pré-contrôle d'état et dédupliquer ; aucune nouvelle notification `PENDING` n'est introduite.                                  |
| D5  | `releaseTable`               | `releaseTable` détache `tableId` uniquement. Il ne signifie ni annulation, ni transition d'état, ni libération commerciale. Une libération métier passe par une transition explicite ou une opération de réallocation atomique.                                                                                                                                 | Retenue                                                    | La table redevient physiquement disponible, mais la réservation active sans table reste un blocker global.                                                  |
| D6  | Hold `CONSUMED`              | Un hold consommé n'est pas réutilisable. Une annulation libère la capacité de la réservation, mais conserve le hold comme preuve historique.                                                                                                                                                                                                                    | Retenue                                                    | Ne pas convertir automatiquement `CONSUMED` en `RELEASED` et ne pas ajouter de valeur d'enum.                                                               |
| D7  | Timeout provider             | Un timeout après émission possible est un résultat inconnu, pas un échec certain. La réservation ne doit pas être annulée automatiquement et l'envoi ne doit pas être relancé aveuglément. Le runtime conserve la claim et tente une consultation read-only lorsque le provider expose un identifiant et une API de lecture ; sinon il crée une revue manuelle. | Retenue                                                    | Les adapters Telnyx/Resend exposent un résultat borné ; aucun envoi de compensation automatique n'est déclenché. Le SLA staging reste à mesurer.            |
| D8  | Retry et réconciliation      | Les claims distinguent `in_progress`, `unknown` et `success`. Un succès conserve la claim et le marqueur/audit existant ; un échec certain libère la claim ; `unknown` la conserve, interdit le renvoi et crée un job `reconciliation` à job ID déterministe.                                                                                                   | Retenue                                                    | Les métriques `success`, `failure_certain`, `unknown` et `reconciled_*` sont bornées et sans PII ; aucune garantie exactly-once provider n'est revendiquée. |
| D9  | Timezone                     | La timezone canonique d'une date/heure locale est celle du restaurant ; les instants persistés sont UTC. `Europe/Paris` reste le fallback historique.                                                                                                                                                                                                           | Retenue                                                    | Centraliser les conversions aux frontières sans modifier les contrats publics existants.                                                                    |
| D10 | Annulation OpenAI Reserve    | Le parcours OpenAI Reserve actuel ouvre le widget via `restaurant_reservation`. L'annulation n'est pas exposée par cette route ; lorsqu'elle est demandée via le transport agentic/OpenAI compatible, elle doit passer par `cancel_reservation` puis `ReservationService` agentic, avec contrôle d'accès, state machine et audit.                               | Retenue de frontière ; UX produit à confirmer              | Ne pas ajouter d'endpoint public d'annulation dans cet ADR. Tester séparément l'adaptation OpenAI et l'annulation agentic.                                  |

## Décisions produit validées le 3 septembre 2026

Les choix qui bloquaient une correction de sémantique sont désormais approuvés :

1. `state` est la référence métier. `PENDING` est exposé comme « en attente »
   et ne déclenche jamais une confirmation client ; `status` reste une
   projection legacy transitoire.
2. Le modèle de capacité est hybride conservateur : les états actifs avec
   table bloquent la table, tandis qu'une réservation ou un hold actif sans
   table masque le créneau global du restaurant. Toute allocation respecte ce
   masque et se sérialise par restaurant.
3. `releaseTable` détache uniquement la table ; il ne libère ni la réservation
   ni le créneau. L'annulation ou une transition métier explicite porte la
   libération commerciale.
4. Un hold `CONSUMED` est une preuve historique immuable et n'est pas réutilisé.
5. `success`, `failure_certain` et `unknown` suivent respectivement acceptation,
   retry borné et réconciliation sans renvoi aveugle. Les claims et audits sont
   réparables idempotemment.
6. Les mutations de réservation significatives (création, transition,
   annulation, suppression, allocation, réallocation et détachement) écrivent
   un audit append-only. L'annulation OpenAI Reserve emprunte l'adapter
   agentic existant ; aucun endpoint public supplémentaire n'est créé.

Ces décisions n'autorisent toujours pas un provider réel ou un déploiement sans
procédure staging isolée et rollback vérifiable.

## Critères de validation d'intégrité

La validation Postgres doit démontrer, sur une base locale jetable et isolée :

- une seule réservation/hold gagnant lors d'une concurrence contrôlée ;
- réutilisation du résultat pour une même clé d'idempotence ;
- conflit explicite pour un payload différent ;
- absence de réservation partiellement committée après conflit ;
- refus SQL d'`UPDATE` et `DELETE` sur `reservation_audit_log` ;
- nettoyage contrôlé sans toucher une base partagée.

## Validation réalisée le 2 septembre 2026

Les six tests ont été activés avec `AGENTIC_INT_TESTS=1` contre une base
Postgres locale dédiée (`sokar_phase3c_int_20260902`). Les migrations présentes
ont été appliquées sans modification, le trigger
`reservation_audit_log_append_only` a été vérifié, puis les six tests ont
réussi. La fixture a été complétée avec un floor plan et une table isolés :
`HoldService` ne peut pas créer un hold sans table lorsqu'aucune table n'est
fournie par l'appelant.

La suite API complète en mode intégration a ensuite réussi : 161 fichiers et
1 640 tests passés. La base dédiée ne contenait plus de restaurant, hold,
réservation ou record d'idempotence après les hooks de nettoyage ; les logs
d'audit restaient append-only, conformément au contrat. Aucune correction
runtime de `status/state`, de capacité ou de hold n'a été appliquée : les
divergences correspondantes restent bloquées par les décisions produit
ouvertes ci-dessus.

## Preuve complémentaire de capacité — 2 septembre 2026

Une campagne ciblée a exécuté 17 tests dans le même harnais Postgres : les six
tests d'intégrité historiques et onze tests de capacité. Sur la base jetable
`sokar_phase3d_capacity_20260902`, les migrations existantes et le trigger
append-only ont été appliqués puis vérifiés ; la base a été nettoyée et
supprimée après le run.

Les tests confirment que `CapacityAwareAvailabilityService` et
`TableAllocationService.isTableAvailable` ne voient pas une réservation ou un
hold actif lorsque `tableId` est `null`, alors que `ReservationService` bloque
une réservation active sans table sur le créneau exact. `releaseTable` détache
la table et conserve `status/state`, ce qui libère le prédicat physique sans
libérer le prédicat agentic global. Il s'agit d'une preuve de divergence, pas
d'une nouvelle décision D1/D5.

Le choix entre capacité globale, capacité physique et modèle hybride reste
explicitement produit. Aucun correctif runtime n'est autorisé sur cette seule
preuve.

## Amendement Phase 3D — résultats provider des notifications

L'amendement porte uniquement sur les cinq workers déjà protégés par claim :
confirmation outbound, rappel J-1, récupération d'appel, promotion de waiting
list et rappel d'expiration gift card. Il ne modifie ni le cycle de réservation,
ni la capacité, ni le schéma Prisma.

| Résultat          | Preuve attendue                                                                                           | Claim et retry                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success`         | Réponse provider explicitement acceptée ; les adapters conservent l'identifiant lorsqu'il est fourni.     | Claim conservée. Le marqueur ou l'audit existant est écrit selon le worker ; aucune nouvelle tentative provider.                                    |
| `failure_certain` | Refus explicite 4xx/validation/configuration, sans preuve d'acceptation.                                  | Claim libérée. Le worker conserve son contrat de retry existant ; aucun fallback n'est déclenché sauf le fallback WhatsApp→SMS autorisé ci-dessous. |
| `unknown`         | Timeout, abort, reset réseau, 5xx, réponse perdue, ou crash après l'appel provider avant la trace locale. | Claim conservée. Le job d'origine ne rappelle pas le provider ; un job `notification-status` déterministe est ajouté à la queue `reconciliation`.   |

Le worker de réconciliation ne fait qu'une consultation read-only. Un statut
provider qui prouve l'acceptation conserve la claim en `success`; un statut qui
prouve le refus la supprime afin de permettre une reprise contrôlée. Une
consultation encore inconnue, une claim sans identifiant provider ou un provider
sans API de lecture restent dans l'état inconnu et sont envoyés vers la queue
`dead-letter` pour revue manuelle. Aucun SMS, email ou message WhatsApp n'est
émis par cette branche.

Telnyx permet de consulter un message par son identifiant ; les états acceptés
(`queued`, `sending`, `sent`, `delivered` et `delivery_failed`) sont considérés
comme une acceptation du provider et ne déclenchent pas de renvoi aveugle.
Resend permet de consulter un email par son identifiant ; les événements
`failed`, `canceled` et `suppressed` sont des refus certains, les autres
événements connus prouvent l'acceptation. Une erreur de consultation reste
`unknown`. Ces mappings ne constituent pas une preuve de livraison sur le
téléphone ou dans la boîte du client.

Pour `sendReminder`, le fallback SMS n'est autorisé qu'après un échec certain
WhatsApp. Un résultat WhatsApp `unknown` arrête le chemin et ne crée pas de
claim SMS ; un résultat SMS `unknown` conserve uniquement sa claim. Les clés
`reservation-reminder-whatsapp` et `reservation-reminder-sms` sont distinctes.

Limites explicites : les anciennes valeurs Redis littérales `claimed` sont
interprétées comme `in_progress` et ne sont jamais rejouées ; un crash avant la
transition locale du claim reste donc bloqué conservativement jusqu'à
expiration/revue. La déduplication est bornée par Redis et BullMQ ; elle ne
transforme pas un provider externe en système exactly-once.

## Amendement Phase 4 — clôture du DELETE legacy

La suppression physique d'une réservation auditée est interdite par la
combinaison FK `ON DELETE SET NULL` et trigger append-only. Le contrat DELETE
legacy est donc implémenté comme une clôture terminale : transaction atomique
vers `status/state=CANCELLED`, audit `reservation_deleted` conservant
`fromState/toState`, puis conservation de la ligne. La liste opérationnelle
filtre cet événement d'archive ; la route et les callers existants restent
compatibles. Aucun changement de schéma ou de migration n'est requis et aucun
bypass du trigger n'est autorisé.
