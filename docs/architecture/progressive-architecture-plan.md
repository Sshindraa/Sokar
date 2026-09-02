# Plan d’architecture progressive

Cette note décrit les prochaines étapes sans les implémenter. Le monolithe
structuré, les contrats API, les flux vocaux, les réservations, les workers et
les déploiements restent les invariants de la migration.

## Topologie future server / worker / scheduler

La cible progressive est composée de trois rôles dans le même monorepo et
avec la même base PostgreSQL/Redis :

- `server` : HTTP Fastify, WebSocket, webhooks et routes publiques ;
- `worker` : consommateurs BullMQ et traitements asynchrones ;
- `scheduler` : enregistrement et déclenchement des jobs périodiques, sans
  dupliquer les consommateurs ni déplacer la logique métier hors des services.

Aujourd’hui, `apps/api/src/main.ts` charge des workers et des schedulers dans le
même processus que le serveur. La séparation devra donc commencer par une
cartographie queue-par-queue, un propriétaire unique par consumer/scheduler,
des arrêts gracieux et des signaux de readiness/health. Aucun nouveau
processus n’est introduit dans cette phase.

## Déploiement PM2 sur un seul VPS

Le VPS conserve PostgreSQL et Redis via l’infrastructure existante, et PM2
continue de gérer les applications natives. Une phase ultérieure pourra
ajouter des entrées dédiées `sokar-worker` et `sokar-scheduler` (ainsi que leurs
équivalents staging) dans les ecosystem files, avec limites mémoire, logs,
readiness et `kill_timeout` adaptés.

Le déploiement restera une release atomique construite avant redémarrage,
`pm2 save`, reload Nginx et rollback vers le snapshot précédent. Les processus
partageront le même `.env` de l’environnement et les mêmes secrets injectés ;
aucun secret ne sera ajouté au dépôt. Avant d’activer la séparation, il faudra
prouver qu’un job périodique et un consumer ne peuvent pas être exécutés deux
fois par erreur pendant un restart ou un rollback.

## Cartographie des deux `ReservationService`

Il n’est pas décidé ici lequel devient la source de vérité. Les invariants et
les callers doivent être mesurés avant toute convergence.

| Service                                                                                              | Callers observés                                                             | Contrat / comportement distinctif                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/reservations/reservation.service.ts` (legacy, classe statique)                 | routes `/reservations`, `CallSessionManager`, `sms/reply-handler.ts`         | création orientée `status`, replay par `callId`, allocation et invalidation legacy, synchronisation Google Calendar et SMS ; mise à jour qui projette un `status` reconnu vers `state` |
| `apps/api/src/modules/agentic-reservations/core/reservation.service.ts` (agentic, instance injectée) | routes Connect, outils MCP agentic, routes floor-plan, `GiftCardBookService` | policies, holds, idempotence, audit, allocation transactionnelle et machine à états ; création pouvant être `PENDING`, transitions explicites et libération des holds                  |

Les invariants à formaliser sont notamment l’isolation restaurant, les
intervalles et la taille de groupe, l’absence de double allocation,
l’idempotence/rejeu, la libération de capacité lors d’une annulation, la
cohérence audit/notifications et l’invalidation des disponibilités.

La comparaison devra couvrir les snapshots de contrats, les tests de
comportement, les appels réels et les métriques d’audit/notifications. Les
différences Google Calendar/SMS, holds, `callId`, gift cards et politiques ne
doivent pas être effacées par un simple renommage.

## Dualité `status` / `state`

Le dashboard, les routes legacy et certains flux SMS lisent principalement
`status`. Les flux agentic et floor-plan utilisent `state`. La projection
actuelle ne couvre que `CONFIRMED`, `SEATED`, `CANCELLED` et `NO_SHOW` ; les
états `PENDING`, `HONORED`, `FAILED` et `EXPIRED` n’ont pas tous une valeur
`status` équivalente. Une réservation agentic peut donc avoir `state=PENDING`
avec `status=CONFIRMED`, tandis que le legacy part d’un contrat `status`.

La phase suivante devra définir un modèle canonique, des adaptateurs de lecture,
une stratégie de backfill et des garde-fous de dual-write avec métriques de
divergence. Cette phase ne modifie ni le schéma Prisma ni les contrats.

## Extraction progressive de `manager.ts`

Les extractions se feront avec tests de caractérisation et seams stables, dans
cet ordre :

1. `VoiceConfig` — centralisé dans `apps/api/src/env.ts` pendant cette phase ;
2. client/provider LLM ;
3. parser SSE ;
4. `VoiceToolExecutor` ;
5. orchestration de session.

Chaque étape doit conserver le streaming, les timeouts, le fallback, les
circuits, les tool calls et les signaux d’abandon avant de supprimer l’ancien
chemin.

## Hotspot dashboard à traiter ensuite

`apps/dashboard/src/app/dashboard/floor-plan/_components/FloorPlanCanvas.tsx`
fait environ 6 151 lignes et regroupe géométrie, rendu tables/murs,
drag-and-drop, polling/état, panneaux, dialogs et logique Service Copilot. Son
découpage est prioritaire par rapport aux composants marketing : helpers de
géométrie purs, rendu tables/murs, interactions DnD, panneaux/dialogs et
polling/état pourront devenir des unités testables. Aucun découpage de ce
composant n’est inclus ici.

## Entrées de la phase 2

La phase 2 commencera par produire la matrice callers/contrats des deux
réservations, l’inventaire queue/scheduler et les métriques de divergence
`status/state`. Elle pourra ensuite introduire un premier seam isolé (client
LLM ou parser SSE) avec tests de non-régression, sans migration de schéma ni
changement de topologie de production par défaut.
