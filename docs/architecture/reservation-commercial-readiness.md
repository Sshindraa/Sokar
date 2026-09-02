# Phase 4 — Matrice go/no-go commerciale

Cette matrice est une décision de lancement, pas une décision de service
canonique. Elle se fonde sur les preuves locales Phases 2/3A/3B/3C/3D/3E/4,
les tests d'intégrité Postgres exécutés sur une base dédiée et les garde-fous
de notification. Les décisions produit `state`, capacité hybride,
`releaseTable` et holds ont été approuvées le 3 septembre 2026 ; les
restrictions ci-dessous sont désormais des gates d'exploitation et de parcours,
pas des décisions encore à prendre.

| Surface            | Vendable maintenant ? | Restrictions nécessaires                                                                                                                       | Couverture disponible                                                                                                                               | Intervention humaine restante                                               |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Connect/widget     | **Non**               | Afficher `PENDING` comme « en attente » ; valider le timeout provider en staging avant tout pilote client.                                     | Holds, confirm, conflits, timezone, gift card et idempotence couverts localement ; parcours métier complet encore à valider.                        | Support pour les annulations et les conflits jusqu'à validation du contrat. |
| Dashboard          | **Non**               | `PENDING` est affiché comme « en attente » ; `releaseTable` ne vaut pas libération commerciale ; le retrait conserve l'historique.             | Tests dashboard/floor-plan et clôture DELETE terminale testée.                                                                                      | Manager pour validation manuelle, allocation et correction des cas ambigus. |
| Voice              | **Non**               | Conserver le flux legacy ; identité `callId` requise pour un retry fiable ; valider les providers et timeouts en staging.                      | Tests voice unitaires ; aucun test réel provider encore exécuté dans cette campagne.                                                                | Validation humaine des demandes pending et des timeouts SMS.                |
| MCP/OpenAI Reserve | **Non**               | MCP peut rester en observation ; OpenAI Reserve limité au widget existant ; annulation et timeout à confirmer.                                 | Registry MCP, state machine, holds, idempotence et audit unitaires ; tests Postgres d'intégrité passés, adaptation OpenAI d'annulation non exposée. | Support pour annulation OpenAI et conflits d'idempotence.                   |
| Waiting list       | **Non**               | Promotion uniquement avec claim/job ID ; vérifier état de la réservation avant chaque notification.                                            | Tests de promotion, concurrence de notification et capacité unitaires.                                                                              | Confirmation humaine si la capacité change entre promotion et notification. |
| Gift cards         | **Non**               | Aucun pilote commercial avant décision sur l'échec de redemption après création et la notification.                                            | Tests de réservation liée et rappel gift card mocké.                                                                                                | Réconciliation paiement/redemption et support client.                       |
| Notifications      | **Non**               | Les cinq workers protégés restent soumis au timeout provider ; rapports, réactivation, reengagement et alertes manager restent hors périmètre. | Claims Redis, job IDs, pré-contrôles et retries unitaires ; aucun provider réel.                                                                    | Réconciliation des résultats inconnus et traitement des DLQ.                |
| Multi-restaurant   | **Non**               | Une timezone et une capacité doivent être isolées par restaurant ; la concurrence validée ne couvre qu'un restaurant jetable.                  | Scopes restaurant et tests unitaires ; tests Postgres passés sur un restaurant isolé, pas de preuve multi-tenant.                                   | Opération d'onboarding et surveillance restaurant par restaurant.           |

## Gate de sortie

Le pilote commercial reste **NO-GO** tant que les preuves opérationnelles ne
sont pas réunies : staging Telnyx/Resend isolé et réversible, parcours
end-to-end Connect/dashboard/voice, crash-restart réel, disponibilité Redis et
queue, réconciliation observée avec SLA de revue manuelle, et rollback vérifié.
Les tests unitaires et les tests Postgres locaux prouvent l'intégrité contrôlée,
mais ne constituent pas à eux seuls une validation client/provider.

La prochaine étape est donc une campagne de validation limitée et traçable,
centrée sur les providers staging, les crash/restart réels, la reprise
Redis/BullMQ, la revue manuelle et le rollback. B-01 (clôture DELETE) et B-02
(revalidation des holds avec `tableId` explicite) sont résolus au niveau runtime,
mais cette campagne doit encore produire les artefacts de go/no-go ou maintenir
explicitement le NO-GO par surface.
