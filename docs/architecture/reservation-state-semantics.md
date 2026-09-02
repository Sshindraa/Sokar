# Sémantique `Reservation.status` / `Reservation.state`

## Statut de la note

Cette note conserve les preuves historiques des Phases 3A–3C. L'amendement
« Politique approuvée » en fin de document est désormais normatif pour le
runtime : il tranche la capacité globale conservatrice sans choisir de
`ReservationService` canonique. Les anciennes sections décrivent l'état au
moment de leur rédaction et ne doivent pas être relues comme des décisions
encore ouvertes.

## Modèle réellement présent

Le modèle Prisma impose deux colonnes non nulles :

- `status` : `CONFIRMED`, `CANCELLED`, `NO_SHOW`, `SEATED` ;
- `state` : `PENDING`, `CONFIRMED`, `SEATED`, `HONORED`, `CANCELLED`,
  `NO_SHOW`, `FAILED`, `EXPIRED`.

La state machine agentic déclare les transitions suivantes :

```text
PENDING   -> CONFIRMED | CANCELLED | EXPIRED | FAILED
CONFIRMED -> SEATED | CANCELLED | NO_SHOW | EXPIRED | FAILED
SEATED    -> HONORED | NO_SHOW
HONORED, CANCELLED, NO_SHOW, FAILED, EXPIRED -> terminal
```

`SEATED` n'est donc pas terminal. `HONORED`, `CANCELLED`, `NO_SHOW`, `FAILED`
et `EXPIRED` le sont selon la state machine. Les écritures directes de la
waiting list, du walk-in et du copilot ne passent pas toutes par cette machine.

## Point critique : `PENDING` avec `status=CONFIRMED`

| Point                                        | Comportement actuel                                                                                                                                                                                                    | Comportement souhaité                                                                                           | Risque                                                                                                                                       | Décision nécessaire                                                                                                        | Recommandation technique                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Création avec `requireManualValidation=true` | Le service agentic écrit `state=PENDING` et force `status=CONFIRMED`, car l'enum legacy ne contient pas `PENDING`. La ligne bloque la capacité car le moteur inclut `PENDING`.                                         | Exprimer sans ambiguïté « réservation reçue, validation manuelle requise » dans chaque lecture et chaque canal. | Les lecteurs historiques filtrant `status=CONFIRMED` peuvent afficher, rappeler ou compter une réservation comme confirmée avant validation. | Décider si `status` reste une projection de compatibilité ou si tous les lecteurs doivent migrer vers `state` pour ce cas. | Maintenir la paire actuelle pendant la décision, mesurer le mismatch et interdire toute interprétation silencieuse de `status=CONFIRMED` comme validation métier. |
| Nature du mismatch                           | Le mismatch est intentionnel dans l'implémentation actuelle, assimilable à une projection temporaire de compatibilité. Il n'est pas une donnée réparée ni une preuve que la réservation est confirmée au sens produit. | Avoir une règle explicitement documentée et testée.                                                             | Une correction automatique pourrait confirmer ou libérer à tort une table.                                                                   | Choisir le libellé et le contrat exposé aux clients, dashboard, voice et MCP.                                              | Ne pas backfiller ni réécrire les transitions en Phase 3A ; conserver la métrique `status_state_pending_projection`.                                              |

Conclusion actuelle : la paire `PENDING/CONFIRMED` est une représentation
volontaire du code agentic, mais elle présente un risque de bug fonctionnel dès
qu'un consommateur utilise `status` comme décision de confirmation. Ce constat
ne permet pas de désigner un service canonique.

## Relation des deux colonnes

| Paire observée                       | Interprétation actuelle                                                                                                                              | Risque / décision                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED/CONFIRMED`                | Réservation active normalement confirmée dans les chemins legacy, agentic, Connect, gift card, waiting list et copilot.                              | Vérifier si une réservation issue d'un hold doit toujours être considérée confirmée à la consommation du hold.               |
| `PENDING/CONFIRMED`                  | Projection agentic de validation manuelle ; active pour la capacité.                                                                                 | Décider quels endpoints et notifications doivent la traiter comme pending.                                                   |
| `SEATED/SEATED`                      | État actif de service ; créé directement par `createWalkIn`, ou obtenu par transition agentic.                                                       | Le walk-in écrit directement sans state machine et son audit de création porte désormais `fromState=null`, `toState=SEATED`. |
| `CANCELLED/CANCELLED`                | Projection alignée d'une annulation legacy ou agentic.                                                                                               | L'annulation agentic audite le hold consommé mais ne passe pas son statut de `CONSUMED` à `RELEASED`.                        |
| `NO_SHOW/NO_SHOW`                    | Projection alignée lorsque la transition agentic est `CONFIRMED -> NO_SHOW`.                                                                         | Les lecteurs `status` et `state` ne sont pas homogènes pour les autres états terminaux.                                      |
| `HONORED/*`, `FAILED/*`, `EXPIRED/*` | `status` n'a pas d'équivalent ; `statusForState` conserve le statut précédent. Une expiration de hold ne change pas automatiquement une réservation. | Décider si une nouvelle projection est requise, ou si `state` devient explicitement la colonne de décision pour ces états.   |

Le service legacy mappe les quatre valeurs de `status` vers le même `state` lors
d'un `update`, sans valider le graphe agentic. Les chemins de lecture sont donc
déjà mixtes : le dashboard historique et le worker de rappel utilisent
`status`, tandis que la disponibilité capacity-aware et les routes floor-plan
utilisent `state`.

## Transitions autorisées et annulation

| Sujet              | Comportement actuel                                                                                                                                                              | Comportement souhaité                                                                                    | Risque                                                                                                                                 | Décision nécessaire                                                                                   | Recommandation technique                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Transition agentic | `assertCanTransition` valide le graphe ; `SEATED` exige une table ; `HONORED`/`NO_SHOW` exigent un début dans le passé ; chaque transition écrit un audit.                       | Conserver un graphe unique pour les transitions métier.                                                  | Les écritures directes contournent le graphe et peuvent créer un historique incomplet.                                                 | Décider si walk-in et copilot doivent être des transitions ou rester des opérations spécialisées.     | Ajouter des tests de caractérisation et instrumenter les bypass avant toute façade commune. |
| Update legacy      | `status` est converti en `state`; l'annulation écrit un audit uniquement si l'ancien état n'était pas déjà `CANCELLED`. Les autres updates n'écrivent pas d'audit de transition. | Définir les événements minimaux obligatoires pour chaque mutation.                                       | Un update direct peut contourner les invariants et l'audit.                                                                            | Choisir si l'audit est obligatoire pour toute mutation ou seulement pour les transitions visibles.    | Ne pas modifier le mapping en Phase 3A ; mesurer `audit_missing`.                           |
| Annulation agentic | Vérifie la transition, écrit `state/status=CANCELLED`, écrit `reservation_cancelled`, et écrit `hold_released` si le hold lié est `CONSUMED`; elle invalide la disponibilité.    | Annulation idempotente, auditée, libérant la capacité et laissant une preuve de la consommation du hold. | La répétition d'une annulation agentic sur un état terminal est refusée par la state machine ; le hold reste techniquement `CONSUMED`. | Décider si le hold consommé doit avoir un statut historique immuable ou un état de libération séparé. | Tester séparément « réservation annulée » et « hold libéré », sans modifier le schéma.      |
| Suppression legacy | `delete` clôture désormais `status/state=CANCELLED`, écrit `reservation_deleted` et conserve la ligne ; la liste opérationnelle masque cet événement.                            | Conserver l'historique et réserver toute purge physique à une politique séparée.                         | Un hard-delete contournerait l'audit append-only et échouerait sur PostgreSQL.                                                         | Définir ultérieurement une purge RGPD/comptable distincte si nécessaire.                              | Garder le DELETE HTTP comme alias de clôture terminale, sans désactiver le trigger.         |

## Capacité et libération

Le moteur capacity-aware considère comme bloquants les états `PENDING`,
`CONFIRMED` et `SEATED`. Il vérifie aussi les holds actifs non expirés. Cette
règle est confirmée par les requêtes de disponibilité, d'allocation et de
`findBlockingReservation`.

| Chemin                                                      | Réservation / hold                                                                                                         | Libération actuelle                                                                                                                                                           | Observation                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Legacy create                                               | Allocation de table dans la transaction ; `status/state` viennent des valeurs par défaut `CONFIRMED`.                      | La réservation bloque immédiatement.                                                                                                                                          | Pas de hold ni d'audit de réservation.                                                                                       |
| Agentic create sans token                                   | Crée un hold synthétique puis le consomme dans la transaction ; écrit deux audits.                                         | L'état créé bloque immédiatement.                                                                                                                                             | L'idempotence et le rollback d'un conflit sont DB-backed.                                                                    |
| Connect hold puis confirm                                   | Le hold actif bloque ; confirm le consomme et crée la réservation agentic avec table.                                      | La réservation bloque après confirm.                                                                                                                                          | L'analytics est post-commit et ne fait pas partie de l'état métier.                                                          |
| Annulation legacy / agentic                                 | Les deux chemins écrivent `CANCELLED/CANCELLED` lorsqu'ils réussissent.                                                    | Le filtre par `state` ne bloque plus ; les services invalident le cache après annulation.                                                                                     | Le comportement de hold diffère : legacy n'en a pas, agentic garde le hold `CONSUMED`.                                       |
| Transition vers `HONORED`, `NO_SHOW`, `FAILED` ou `EXPIRED` | Agentic peut rendre l'état non bloquant ; `status` peut rester ancien pour les états sans projection.                      | Libération logique par `state`; `transitionState` invalide désormais le cache après commit lorsque l'effet de capacité change.                                                | La divergence `status/state` reste présente pour les états sans projection. Décision sur les lecteurs legacy encore requise. |
| `releaseTable` / `reallocate`                               | Mutation directe de `tableId`, sans state/status ni audit.                                                                 | La ligne n'est plus rattachée à une table ; le moteur capacity-aware exige `tableId` non nul, alors que `findBlockingReservation` peut encore bloquer par créneau/party size. | « Table libérée » ne signifie pas nécessairement « réservation libérée ». Décision produit nécessaire.                       |
| Waiting list promotion                                      | Crée directement `CONFIRMED/CONFIRMED`, alloue une table et promeut l'entrée.                                              | La nouvelle réservation bloque ; la route invalide la disponibilité.                                                                                                          | Pas de `IdempotencyService`, mais le statut `PROMOTED` et la clé de job rendent le retry généralement réutilisable.          |
| Walk-in                                                     | Crée directement `SEATED/SEATED` après verrouillage de la table ; clé `walk-in`.                                           | Bloque la table jusqu'à sa fin de service. L'audit de création porte `fromState=null`, `toState=SEATED`.                                                                      | L'opération reste un bypass spécialisé de la state machine.                                                                  |
| Conflit de capacité                                         | Legacy échoue avant ou dans la transaction ; agentic traduit certains `P2002` en conflit et marque l'idempotence en échec. | Aucun état de réservation ne doit être commité ; le hold synthétique est rollbacké avec la transaction.                                                                       | Les chemins n'ont pas exactement les mêmes erreurs ni la même télémétrie.                                                    |

Comportement souhaité commun : une réservation annulée ou un état terminal
non-présent ne doit plus réduire la capacité, une tentative concurrente doit
être rejetée sans réservation orpheline, et l'invalidation du cache doit suivre
toute mutation de capacité. Ces phrases sont des invariants proposés, pas une
correction appliquée ici.

## Idempotence, audit et notifications

| Point                            | Comportement actuel                                                                                                                                                                                                                                                                                                                                     | Comportement souhaité                                                                                                                                                           | Risque                                                                                                                      | Décision nécessaire                                                                        | Recommandation technique                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Idempotence voice                | `callId` est recherché avant et dans la transaction ; un replay retourne la première réservation sans recréer ni remettre le SMS.                                                                                                                                                                                                                       | Même `callId` = même résultat, sans nouvelle allocation ni notification.                                                                                                        | Un appel sans `callId` n'a pas cette garantie.                                                                              | Décider si l'identité d'appel doit être obligatoire sur tous les retries voice.            | Conserver le contrat actuel et mesurer les créations sans clé.                               |
| Idempotence agentic / MCP        | `scope/key/payloadHash` sont réservés avant création ; un replay attend ou retourne le résultat ; un payload différent est un conflit.                                                                                                                                                                                                                  | Rejouer une requête identique doit être sans doublon ; un payload différent doit rester un conflit.                                                                             | Les holds et la réservation sont coordonnés, mais les notifications ne sont pas universellement dans la même transaction.   | Définir le contrat d'un retry après timeout provider.                                      | Tester séparément réservation, hold et notification.                                         |
| Waiting list / walk-in / copilot | Waiting list réutilise une entrée promue ; walk-in utilise `scope=walk-in` et une contrainte ; copilot utilise `operationId`/snapshot.                                                                                                                                                                                                                  | Chaque opération rejouable doit avoir une identité stable et un résultat observable.                                                                                            | La waiting list n'utilise pas `IdempotencyService`; les opérations copilot mutent plusieurs réservations.                   | Décider si la garantie doit être un service commun ou rester spécialisée.                  | Comparer les résultats normalisés avant toute extraction.                                    |
| Audit                            | Agentic crée `reservation_created`, `hold_consumed` et les transitions ; legacy annule seulement dans un cas ; waiting list/walk-in/copilot écrivent des événements spécifiques ; `delete`, allocations et confirmations SMS n'auditent pas de transition.                                                                                              | Toute mutation de l'état métier et toute libération doivent avoir un événement minimum ; les mises à jour PII/confirmation doivent être explicitement hors ce contrat.          | Les audits actuels ne sont pas comparables directement et certains événements ne correspondent pas à une transition réelle. | Définir le minimum légal/produit et la granularité par canal.                              | Conserver l'append-only existant et utiliser la métrique `audit_missing` pour la visibilité. |
| Notifications                    | Legacy queue un SMS client post-commit ; agentic reservation n'envoie pas de SMS/email ; Connect queue surtout de l'analytics ; waiting list queue SMS/email après commit ; confirmation worker envoie directement et marque `confirmationStatus=PENDING`. Les cinq workers de notifications couverts en 3B ont maintenant des claims et pré-contrôles. | Les notifications couvertes en 3B utilisent un job ID/claim déterministe, une vérification d'état et un marqueur/audit existant ; un échec ne doit pas inverser la réservation. | Un timeout provider reste ambigu ; les campagnes marketing et rapports n'ont pas encore de claim métier.                    | Décider quelles notifications sont obligatoires et si un doublon est acceptable par canal. | Mesurer succès/échec/claim et étendre seulement après décision de garantie.                  |

## Fuseaux horaires

| Point                        | Comportement actuel                                                                                                                                     | Comportement souhaité                                                                            | Risque                                                                                                                     | Décision nécessaire                                                                     | Recommandation technique                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Disponibilité capacity-aware | Convertit la date et l'heure locales avec le fuseau du restaurant, puis compare les intervalles UTC.                                                    | Une seule conversion explicite « date/heure du restaurant → instant UTC » pour tous les callers. | Les chemins qui construisent d'abord une `Date` peuvent décaler le jour autour d'un changement de fuseau ou d'heure d'été. | Décider si le contrat entrant est toujours local restaurant ou toujours un instant UTC. | Ajouter des cas de caractérisation aux frontières DST et minuit, sans modifier le parseur en Phase 3A. |
| Legacy / voice               | `ReservationService` extrait `dateKey`/`timeKey` avec le fuseau du processus ; le voice calcule par ailleurs les slots à partir du fuseau restaurant.   | Aligner le calcul de jour, d'heure et de créneau sur le fuseau restaurant.                       | Une même demande peut consulter un jour et créer sur un autre selon l'instance/runtime.                                    | Décider si cette divergence est acceptée pour le flux voice historique.                 | Mesurer les dates locales et l'offset dans des logs bornés, jamais comme labels Prometheus.            |
| Connect hold / waiting list  | Le hold Connect utilise désormais `zonedTimeToUtc` avec `restaurant.timezone` (défaut `Europe/Paris`); la waiting list utilisait déjà cette conversion. | Le hold, la disponibilité et la waiting list partagent le helper local→UTC.                      | Les frontières voice/legacy qui construisent une `Date` restent sensibles à la timezone du processus.                      | Décider le contrat public de date/heure pour voice/legacy.                              | Étendre le helper aux frontières restantes après décision et tests de compatibilité.                   |

## Différences acceptables par canal, à confirmer

| Canal                  | Différence actuellement observée                                                                                                                    | Acceptable provisoirement ?                                                     | Décision / garde-fou                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Voice                  | Utilise le service legacy : `callId`, allocation immédiate, Google Calendar et SMS ; recherche et annulation fondées sur `status`.                  | Oui pour préserver le flux Telnyx, tant que les mismatches sont visibles.       | Confirmer le contrat de validation manuelle et de cancellation voice.        |
| Connect / widget       | Hold puis confirm agentic ; source patchée après création ; analytics asynchrone ; pas de SMS/email client dans ce chemin.                          | Oui si le hold, le confirm, le 409 de conflit et l'idempotence restent stables. | Décider si une confirmation Connect doit notifier le client.                 |
| Dashboard              | `/dashboard/reservations` lit et annule via legacy/status ; floor-plan lit state, transitionne via agentic, et alloue/realloue/walk-in directement. | Oui comme compatibilité d'interface, pas comme sémantique silencieuse.          | Décider quel état est affiché dans chaque vue et quel audit est attendu.     |
| Gift card              | Utilise agentic avec actor `gift-card:web`; l'application de carte et son snapshot sont post-création et best-effort.                               | Oui si une réservation ne devient pas partiellement impayée sans visibilité.    | Décider le comportement produit lorsque la redemption échoue après création. |
| MCP                    | Utilise agentic, scope/key/hash, hold et audit ; le statut public est dérivé de `state`.                                                            | Oui.                                                                            | Formaliser le contrat des états terminaux exposés à l'agent.                 |
| OpenAI Reserve         | Le feed et l'adapter ne créent pas directement de réservation ; le parcours rejoint Connect/widget.                                                 | Oui.                                                                            | Garder cette frontière et tester le contrat d'adaptation séparément.         |
| Waiting list / walk-in | Créations directes spécialisées avec audits et idempotence différents.                                                                              | Oui uniquement en phase d'observation.                                          | Décider si ces opérations doivent partager des invariants supplémentaires.   |

## Écritures directes à surveiller

Les écritures `Reservation` hors des deux classes de service sont :

- `apps/api/src/modules/agentic-reservations/core/waiting-list.service.ts` :
  création de promotion `CONFIRMED/CONFIRMED` ;
- `apps/api/src/modules/floor-plan/floor-plan.service.ts` : création walk-in
  `SEATED/SEATED` ;
- `apps/api/src/modules/floor-plan/service-copilot-delay-recovery.service.ts` :
  déplacement, création et annulation de la réservation promue ;
- `apps/api/src/modules/floor-plan/table-allocation.service.ts` : mutation de
  `tableId` ;
- `apps/api/src/modules/connect/connect.routes.ts` : patch post-confirm de
  `source` ;
- `apps/api/src/modules/sms/reply-handler.ts` (handler direct des webhooks) et
  `apps/api/src/shared/queue/workers/confirmation-sms.worker.ts` : mise à jour
  de `confirmationStatus` ;
- `apps/api/src/modules/rgpd/erasure.service.ts` et
  `apps/api/src/modules/rgpd/anonymization.worker.ts` : anonymisation PII sans
  changement de `status/state`.

Les écritures de `apps/api/seed.ts` et de
`apps/api/scripts/backfill-reservation-tables.ts` restent des opérations
maintenance/fixture, non des callers runtime. Aucune écriture SQL brute sur
`reservations` n'a été trouvée dans `apps` ou `packages`.

## Six tests d'intégration de concurrence

Les six tests Vitest suivants appartiennent à `concurrency.test.ts` et sont
encapsulés par `describe.skip` tant que `AGENTIC_INT_TESTS=1` n'est pas défini :

1. 1000 holds concurrents sur un même créneau ;
2. nouveau hold après expiration ;
3. 50 réservations avec même `scope+key` ;
4. conflit lorsque le payload d'idempotence diffère ;
5. refus d'un `UPDATE` sur `reservation_audit_log` append-only ;
6. refus d'un `DELETE` sur `reservation_audit_log` append-only.

Ils requièrent Postgres réel, les migrations et des tables de test. En Phase
3C, ils ont été activés avec `AGENTIC_INT_TESTS=1` sur la base locale jetable
`sokar_phase3c_int_20260902` : les six tests ont passé. La fixture crée un floor
plan et une table dédiés, et les hooks nettoient le restaurant, les holds, les
réservations et les records d'idempotence. Les logs d'audit laissés par les
tests restent non modifiables conformément au trigger append-only ; la base
dédiée est supprimée après validation. Aucun nouveau test ignoré n'a été
ajouté. Le test Playwright du widget possède en outre un `test.skip`
conditionnel si aucun créneau n'est disponible ; il dépend de l'API et de la
base seedée et n'est pas inclus dans les six tests Vitest du périmètre
réservation.

## Décisions bloquantes avant correction

1. `PENDING` est-il un état client visible, une validation interne, ou une
   projection temporaire vers `status=CONFIRMED` ?
2. `state` devient-il la décision de capacité et de notification pour tous les
   canaux, ou `status` reste-t-il une projection legacy documentée ?
3. Quels événements d'audit sont obligatoires pour annulation, allocation,
   promotion, walk-in, suppression et notification ?
4. Une annulation libère-t-elle uniquement la capacité, ou doit-elle aussi
   changer l'état historique du hold consommé ?
5. Quels jobs SMS/email sont obligatoires, quels doublons sont acceptables et
   quelle clé doit rendre chaque retry idempotent ?
6. Les opérations waiting list, walk-in et copilot doivent-elles partager des
   invariants de service, sans imposer pour autant une fusion de classes ?

Tant que ces décisions ne sont pas prises, la recommandation est de conserver
les deux services séparés, d'utiliser l'instrumentation read-only et le
comparateur shadow sur des fixtures, puis de soumettre un petit RFC de
convergence. Aucune extraction `VoiceLlmClient` n'est incluse dans cette phase.

## Décisions Phase 3B — sécurité commerciale

La formalisation normative de la Phase 3C se trouve dans
[`adr-reservation-integrity-3c.md`](adr-reservation-integrity-3c.md). Elle
sépare les décisions techniques retenues des décisions produit encore ouvertes
et ne remplace pas cette note de preuves.

Cette section formalise les décisions techniques qui peuvent être prises à
partir des preuves du code et des tests, sans choisir de service canonique. Elle
ne transforme pas les décisions produit encore manquantes en règles implicites.

| Sujet                                      | Comportement actuel                                                                                                                                                                                                                                         | Décision technique retenue                                                                                                                                                                                                                                                                          | Risque restant                                                                                                                           | Décision produit requise                                                                                                                 | Recommandation technique suivante                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Signification de `state=PENDING`           | Le service agentic l'écrit quand `requireManualValidation=true`. Il force alors `status=CONFIRMED` pour rester compatible avec l'enum historique. La ligne et un hold actif bloquent la capacité.                                                           | `PENDING` signifie « demande enregistrée, validation manuelle encore requise ». Il ne signifie pas « confirmation client acquise ». Toute nouvelle lecture doit examiner `state`, et non déduire la confirmation de `status` seul.                                                                  | Les lecteurs legacy, les rappels et certains compteurs filtrent encore `status=CONFIRMED`.                                               | Choisir le libellé public, les droits d'annulation et le moment de notification pour une demande pending.                                | Conserver la paire actuelle et mesurer `status_state_pending_projection`; ne pas backfiller ni ajouter une enum en 3B.                 |
| Relation `status` / `state`                | `state` porte huit états du cycle agentic; `status` n'en représente que quatre. Les chemins legacy projettent un `status` vers le même `state`; `HONORED`, `FAILED` et `EXPIRED` peuvent laisser `status` inchangé.                                         | `state` est l'autorité technique pour le cycle de vie et la capacité agentic. `status` reste une projection legacy obligatoire jusqu'à une décision de compatibilité; `PENDING/CONFIRMED` est explicitement une projection et non une paire homogène.                                               | Un endpoint ou worker ancien peut afficher ou notifier trop tôt une réservation pending.                                                 | Définir si `status` peut rester incohérent pour les états sans équivalent ou si un contrat public doit exposer uniquement `state`.       | Ajouter des adaptateurs de lecture ciblés après validation produit; aucune modification d'endpoint en 3B.                              |
| États terminaux                            | La state machine rend `HONORED`, `CANCELLED`, `NO_SHOW`, `FAILED` et `EXPIRED` terminaux. `SEATED` reste actif et peut aller vers `HONORED` ou `NO_SHOW`.                                                                                                   | Cette liste est la référence technique actuelle. Une mutation terminale ne doit pas recréer de capacité, de hold ou de notification de confirmation.                                                                                                                                                | Les écritures directes contournent parfois la state machine et certains états terminaux n'ont pas de projection `status`.                | Confirmer l'affichage et les opérations autorisées pour chaque état terminal, notamment `FAILED` et `EXPIRED`.                           | Interdire progressivement les écritures directes par instrumentation et tests; ne pas ajouter d'état Prisma sans RFC de compatibilité. |
| Moment où la capacité est bloquée          | Les réservations `PENDING`, `CONFIRMED` et `SEATED` bloquent; un hold `ACTIVE` non expiré bloque également.                                                                                                                                                 | Une réservation bloque dès son insertion réussie dans un état actif; la capacité est libérée logiquement au passage vers un état terminal ou à l'expiration/libération d'un hold actif. Les transitions ayant un effet de capacité invalident désormais le cache après commit.                      | Les moteurs ne traitent pas tous une réservation active avec `tableId=null` de la même façon.                                            | Décider si une réservation sans table assignée bloque une capacité globale, une table seulement, ou doit être rejetée.                   | Garder le filtre conservateur et shadower les deux moteurs avant toute harmonisation.                                                  |
| `releaseTable`                             | La méthode met uniquement `tableId` à `null`; elle ne change ni `status`, ni `state`, ni hold et n'écrit pas d'audit. `findBlockingReservation` peut encore la considérer active alors que le moteur capacity-aware ne voit plus de table attachée.         | `releaseTable` est documenté comme un détachement physique, pas comme une annulation ni une libération logique. La télémétrie indique `capacity=not_released`. Aucun changement métier n'est appliqué.                                                                                              | Le nom de méthode et les deux moteurs peuvent faire croire à une libération commerciale effective.                                       | Décider entre détachement/reallocation interne, libération du créneau, ou opération d'annulation distincte.                              | Renommer ou séparer les opérations seulement après un contrat produit; ajouter un test d'intégration de capacité avant correction.     |
| Libération des holds                       | `ACTIVE` est bloquant; `confirm` le passe à `CONSUMED`. Une annulation agentic écrit `hold_released` lorsque le hold est consommé mais conserve `status=CONSUMED`.                                                                                          | `CONSUMED` est conservé comme preuve historique de consommation. L'annulation libère la capacité de la réservation, sans prétendre rendre le token consommable.                                                                                                                                     | L'événement `hold_released` peut être interprété comme un remboursement ou une réutilisation alors qu'aucune de ces opérations n'existe. | Décider si un hold consommé doit être réutilisable, remboursable, ou seulement audité comme historique.                                  | Ne pas modifier `HoldStatus`, le schéma ou les tokens en 3B; préciser le vocabulaire d'audit dans le RFC produit.                      |
| Obligations d'audit                        | Agentic audite les holds, créations et transitions; legacy n'a pas d'audit à la création et audite l'annulation conditionnellement. Le walk-in crée directement `SEATED`.                                                                                   | Une transition validée doit avoir `fromState` et `toState`. Une création directe n'est pas une transition: le walk-in utilise maintenant `fromState=null`, `toState=SEATED`. Les suppressions, allocations et patches PII restent hors de ce minimum.                                               | Les historiques des chemins restent non comparables et certaines mutations directes n'ont pas de trace métier.                           | Définir le minimum légal/produit pour allocation, suppression, patch de confirmation et notifications.                                   | Conserver les audits append-only; faire évoluer les événements par source, sans fusion de services.                                    |
| Retries et déduplication des notifications | Les queues fiables retryent; certains producteurs avaient déjà un `jobId`, mais les workers pouvaient renvoyer après succès provider avant leur marqueur/audit.                                                                                             | Les envois couverts utilisent un `jobId` déterministe lorsqu'un job est créé, une clé métier stable Redis avec claim atomique, une vérification d'état avant envoi et un marqueur/audit existant quand disponible. La claim est conservée après succès provider et libérée uniquement avant succès. | Un timeout provider est ambigu: conserver la claim peut éviter un doublon mais retarder un message qui n'est jamais arrivé jusqu'au TTL. | Choisir une garantie « au moins une fois » ou une priorité stricte anti-doublon, et définir la conduite après timeout inconnu par canal. | Mesurer les claims, succès, échecs et expirations; prévoir un statut de livraison provider avant une garantie plus forte.              |
| Timezone canonique                         | Les disponibilités et Connect waiting list convertissent la date/heure locale avec la timezone du restaurant; l'ancien hold Connect construisait une date UTC explicite; legacy/voice construisent encore parfois une `Date` dans la timezone du processus. | À la frontière locale, la timezone canonique est celle du restaurant; les instants persistés restent UTC. `Europe/Paris` est le défaut historique. Le helper partagé est utilisé par availability et le hold Connect; les contrats legacy/voice existants ne sont pas réinterprétés en 3B.          | Une même demande voice/legacy peut encore différer autour du changement de jour ou de DST selon le processus.                            | Décider si chaque entrée publique de date/heure est locale restaurant ou un instant UTC, et si le voice historique peut changer.         | Instrumenter les offsets sans PII puis migrer les frontières une par une; ne pas modifier les contrats publics maintenant.             |

### Invariants confirmés et limites

Les invariants techniques retenus pour la suite sont les suivants :

- un hold actif ou une réservation dans `PENDING`, `CONFIRMED` ou `SEATED` ne
  doit pas être compté comme libre par le moteur qui l'évalue;
- une transition terminale réussie ne doit pas laisser le cache de
  disponibilité annoncer une capacité obsolète;
- un rejeu avec la même identité métier ne crée ni nouvelle réservation, ni
  nouveau hold, ni nouvelle notification;
- un conflit de capacité ne doit pas laisser une réservation partiellement
  committée;
- une notification ne doit pas inverser la réservation, et un retry provider
  doit être observable sans exposer de PII dans les labels;
- le fuseau du restaurant gouverne la conversion d'une date/heure locale, mais
  cette règle n'autorise pas à changer rétroactivement les `Date` déjà
  construites par le voice/legacy.

Ces invariants ne désignent aucun `ReservationService` canonique. Le conflit
`releaseTable`/`findBlockingReservation` reste volontairement ouvert: une
correction unilatérale changerait la disponibilité publique dans un sens qui
n'est pas déduit des preuves.

### Corrections appliquées en Phase 3B

- invalidation post-commit du cache après les transitions agentic qui changent
  l'effet de capacité;
- `fromState=null` pour l'audit de création walk-in;
- métrique `releaseTable` corrigée pour ne pas présenter un détachement de
  table comme une libération logique;
- conversion timezone centralisée, et hold Connect aligné sur la timezone du
  restaurant;
- protections idempotentes des SMS de confirmation, rappels, waiting list,
  recovery voice et rappel d'expiration gift card, sans appel provider dans les
  tests;
- aucun endpoint, enum, schéma Prisma, migration, worker entrypoint, PM2 ou
  donnée de production n'a été modifié.

La mention historique « tests ignorés » de la Phase 3B décrivait leur
activation conditionnelle et l'absence de Postgres autorisé à cette étape. En
Phase 3C, ils ont été activés et les six ont passé sur une base locale dédiée.
Cette mention concerne uniquement la Phase 3C ; la campagne de caractérisation
de capacité ci-dessous ajoute des tests Postgres opt-in, exécutables sur la
même base jetable.

## Décisions et validation Phase 3C

L'ADR normatif est
[`adr-reservation-integrity-3c.md`](adr-reservation-integrity-3c.md). Il retient
`state` comme référence agentic de capacité, fixe `PENDING` comme demande non
confirmée, conserve `status` comme projection legacy, interdit la réutilisation
d'un hold `CONSUMED` et définit la frontière timezone restaurant→UTC. Il laisse
explicitement ouverts la projection publique de `PENDING`, le contrat métier
de `releaseTable`, le timeout provider et l'UX d'annulation OpenAI Reserve.

Les six tests Postgres de concurrence et d'append-only ont passé, ainsi que la
suite API complète en mode intégration (161 fichiers, 1 640 tests). La seule
correction de code de cette phase complète la fixture d'intégration avec un
floor plan et une table isolés ; aucune incohérence runtime de réservation n'a
été corrigée sans décision produit correspondante.

## Preuve de capacité avec `tableId=null`

Une campagne Postgres complémentaire a été exécutée le 2 septembre 2026 sur
`sokar_phase3d_capacity_20260902`, base locale dédiée ensuite supprimée. Les
onze cas ajoutés dans
`apps/api/src/modules/agentic-reservations/__tests__/concurrency.test.ts`
ont passé ; ils portent le total de ce fichier à 17 tests opt-in.

La matrice observée est la suivante :

| Fixture                  | `CapacityAwareAvailabilityService` | `TableAllocationService.isTableAvailable` | `ReservationService.findBlockingReservation`                             |
| ------------------------ | ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `PENDING` avec table     | Bloque                             | Bloque la table                           | Bloque le créneau exact                                                  |
| `PENDING` sans table     | Ignorée                            | N'affecte aucune table                    | Bloque le créneau exact                                                  |
| `CONFIRMED` avec table   | Bloque                             | Bloque la table                           | Bloque le créneau exact                                                  |
| `CONFIRMED` sans table   | Ignorée                            | N'affecte aucune table                    | Bloque le créneau exact                                                  |
| `SEATED` avec table      | Bloque                             | Bloque la table                           | Bloque le créneau exact                                                  |
| `SEATED` sans table      | Ignorée                            | N'affecte aucune table                    | Bloque le créneau exact                                                  |
| hold `ACTIVE` avec table | Bloque                             | Bloque la table                           | Contrainte globale du hold selon `(restaurant, slot, partySize)`         |
| hold `ACTIVE` sans table | Ignoré                             | N'affecte aucune table                    | La création d'un second hold identique reste refusée par l'index partiel |

Le cas `SEATED/tableId=null` est une fixture de lecture volontairement
incohérente : la state machine refuse une transition vers `SEATED` sans table,
mais la base et certains lecteurs peuvent encore représenter cette ligne.

`releaseTable` confirme une troisième sémantique : pour chacun des trois états
actifs, il met `tableId` à `null` sans changer `status` ou `state`. La table
devient disponible pour le prédicat physique et le moteur capacity-aware, mais
le chemin agentic continue de bloquer le créneau exact. Ce résultat ne permet
pas de qualifier `releaseTable` de libération commerciale.

### Décision produit encore requise

Ces preuves ne choisissent pas silencieusement une politique. Trois options
restent ouvertes :

1. **Capacité globale** : toute réservation/hold actif sans table consomme une
   unité de capacité du restaurant ; risque d'under-utilisation tant qu'une
   allocation globale fiable n'est pas définie.
2. **Capacité physique uniquement** : seul un `tableId` attribué bloque une
   table ; risque de sur-réservation lorsqu'une ligne active sans table existe.
3. **Modèle hybride** : les holds sans table consomment une capacité globale et
   les réservations sans table restent dans une file d'allocation ; il faut
   définir le décompte, l'expiration et la concurrence avant toute correction.

La recommandation technique est de ne modifier aucun prédicat tant que le
produit n'a pas choisi l'option, le contrat de `releaseTable` et la règle pour
les holds sans table. Les tests doivent rester la référence de caractérisation
jusqu'à cette décision ; aucune API, migration, enum ou fusion de service n'est
requise pour l'obtenir.

## Amendement — politique approuvée (3 septembre 2026)

Les décisions produit ont été validées pour la prochaine livraison :

- `state` est la référence métier ; seul `state=CONFIRMED` constitue une
  confirmation client exploitable par les notifications et les indicateurs.
- La capacité suit un modèle hybride conservateur : `PENDING`, `CONFIRMED` et
  `SEATED` avec table bloquent cette table ; une réservation ou un hold actif
  sans `tableId` masque tout le créneau du restaurant. Les créations et
  allocations sérialisent cette décision avec un verrou advisory par
  restaurant.
- `releaseTable` détache uniquement la table. La réservation reste active et
  continue donc à masquer le créneau global ; une libération commerciale passe
  par une annulation ou une transition métier explicite.
- Un hold `CONSUMED` reste historique et n'est jamais réutilisé.
- Un résultat provider `success` signifie acceptation, `failure_certain` permet
  le retry borné existant, et `unknown` conserve la claim sans renvoi aveugle
  et passe par la réconciliation.

Ces choix n'impliquent toujours pas de `ReservationService` canonique et ne
changent ni l'enum Prisma ni les contrats publics. Les preuves restantes
(staging providers, crash réel, SLA de revue manuelle et parcours end-to-end)
restent des gates de commercialisation.

## Amendement Phase 4 — suppression legacy

Le DELETE historique est désormais une clôture terminale compatible avec
l'audit : `ReservationService.delete` met atomiquement `status=CANCELLED` et
`state=CANCELLED`, écrit l'événement append-only `reservation_deleted`, puis
conserve la ligne en base. La liste opérationnelle legacy exclut les lignes
portant cet événement ; les lecteurs internes et les audits conservent la
preuve complète. La synchronisation Google Calendar reste best-effort et une
répétition sur une ligne déjà clôturée n'ajoute pas d'audit supplémentaire. La
route HTTP DELETE est préservée pour compatibilité, mais elle ne signifie plus
une suppression SQL.
