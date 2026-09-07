# Backlog de lancement — phase 0

Date : 7 septembre 2026
Statut : **EN COURS**
Référence de départ : `b7d14da15777e8aab074859b519387bffdc32687`
Worktree de travail : `/Users/hamza/Projects/Sokar/.worktrees/sokar-billing-10`
Branche actuelle : `codex/phase-0-ops`

Ce backlog transforme l’[audit de lancement](/Users/hamza/Projects/Sokar/docs/audits/2026-09-06-launch-readiness.md) et le [plan phase par phase](/Users/hamza/Projects/Sokar/docs/audits/2026-09-06-launch-plan.md) en unités de travail vérifiables. Les responsables indiqués sont les rôles de réalisation ; Hamza reste décisionnaire GO/NO-GO et valide les changements qui touchent le produit ou le contrat.

Registre commercial associé : [propriétaires, prix et portes d’activation](/Users/hamza/Projects/Sokar/docs/audits/2026-09-07-phase-0-commercial-register.md).

## Tickets prioritaires

| ID           | Responsable                             | Objectif                                                               | Première action                                                                   | Preuve de sortie                                                                  | Statut                                                                                                                     |
| ------------ | --------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| LAUNCH-P0-01 | Codex — API/sécurité, revue Hamza       | Bloquer l’accès inter-restaurant aux routes provisioning et santé      | ajouter un guard opérateur serveur et des tests de refus                          | deux organisations de test : aucun accès croisé, opérateur autorisé conservé      | Implémenté, validation ciblée                                                                                              |
| LAUNCH-P0-02 | Codex — API/réservations, revue Hamza   | Empêcher le rejeu d’un `callId` rattaché à un autre restaurant         | vérifier le tenant avant tout retour replay-safe et ajouter une réponse générique | le `callId` d’un restaurant B ne retourne aucune donnée à A, y compris en retry   | Implémenté, validation ciblée                                                                                              |
| LAUNCH-P1-03 | Codex — API/billing                     | Empêcher l’auto-attribution d’un plan et aligner les droits sur Stripe | retirer `plan` des mutations client et tester les droits serveur                  | un membre ne peut pas obtenir PREMIUM sans événement Stripe valide                | Implémenté, migration et staging validés                                                                                   |
| LAUNCH-P1-04 | Codex — API/billing                     | Rendre Checkout et les webhooks idempotents et ordonnés                | journaliser les événements traités, contraintes uniques et portail                | un abonnement, un droit, un cancel et un événement ancien rejoués sans divergence | Implémenté, staging Stripe validé                                                                                          |
| LAUNCH-P1-05 | Codex — voice/SMS, validation Hamza     | Rendre le SMS et le parcours voix exploitables                         | valider profil messagerie Telnyx, expéditeur, livraison et fallback               | appel réel réservé, SMS livré ou fallback tracé, dead-letter vide                 | À faire                                                                                                                    |
| LAUNCH-P1-06 | Codex — infra/ops                       | Rendre les incidents visibles et récupérables                          | configurer Sentry, uptime, canaux d’alerte, watchdog et exercice restore          | alerte volontaire reçue, backup restauré, RPO/RTO mesurés                         | Restore vierge répété ; RPO observable 20 h 05 et restore/contrôles 4 s mesurés ; canal externe et RTO production à fermer |
| LAUNCH-P1-07 | Hamza + conseil RGPD                    | Compléter effacement, conservation, contrats et identité légale        | valider la cartographie et les données à effacer                                  | export/effacement prouvés, DPA/CGV/mentions publiés                               | Externe                                                                                                                    |
| LAUNCH-P1-08 | Codex — voice/product, validation Hamza | Qualifier le dialogue et l’onboarding sur dix restaurants              | écrire scripts d’appels, critères d’acceptation et support                        | dix appels internes puis deux pilotes sans incident critique                      | À faire                                                                                                                    |
| LAUNCH-P1-09 | Codex — CI/release                      | Empêcher une CI verte avec des parcours critiques ignorés              | rendre intégrations/E2E bloquants et inclure Connect                              | un échec volontaire empêche la promotion ; release candidate restaurable          | Prouvé : staging échoue volontairement après rollback/restauration et E2E ; production reste non déployée                  |

## Modules proposés au premier lancement

Ces tickets sont dans l’offre commerciale dès le jour 1. Leur niveau contractuel doit être explicite : disponible, déploiement accompagné ou pilote. Aucun module ne doit contourner l’isolation, les droits Stripe ou la capacité de rollback.

| ID            | Module                             | Responsable                       | Critère minimal avant activation                                                                                                                                                                                      |
| ------------- | ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LAUNCH-MOD-01 | Multi-site                         | Codex — modèle/API/dashboard      | Fondations compte/résolveur, création/suspension, membres, sélecteur dashboard et Checkout propriétaire ancré au compte implémentés dans le worktree ; entitlement Stripe, facture et preuve staging restent à fermer |
| LAUNCH-MOD-02 | ChatGPT/Claude                     | Codex — agentic/API               | réservation de bout en bout depuis chaque canal, consentement, rejeu et transfert humain                                                                                                                              |
| LAUNCH-MOD-03 | Domaine personnalisé               | Codex — Connect/infra             | DNS, TLS, renouvellement, suppression et fallback testés                                                                                                                                                              |
| LAUNCH-MOD-04 | Cartes cadeaux                     | Codex — gift cards/billing        | émission, utilisation partielle, expiration, remboursement et concurrence vérifiés                                                                                                                                    |
| LAUNCH-MOD-05 | Prédictif avancé                   | Codex — data/product, revue Hamza | données minimales, explicabilité, seuil de confiance et fallback manuel mesurés                                                                                                                                       |
| LAUNCH-MOD-06 | Facturation annuelle               | Codex — billing                   | prix total, prorata, renouvellement, annulation, facture et webhooks testés                                                                                                                                           |
| LAUNCH-MOD-07 | « Sans limite » / « taux garanti » | Hamza + conseil juridique         | politique d’usage ou SLA avec métriques, exclusions, compensation et coût maximal                                                                                                                                     |

## Dépendances externes à confirmer

- [ ] Telnyx : profil de messagerie, numéro `from`, statut de livraison, limites et support incident ;
- [ ] Sentry et uptime : projet, DSN, équipe destinataire et canal d’astreinte ;
- [x] Exercice de restauration vierge sur le dernier dump R2 : 32 tables, 73 contraintes, 117 index, base temporaire supprimée ; RPO observable 20 h 05 et restore/contrôles de la base vierge 4 s mesurés ; RTO complet de restauration production et alerte volontaire externe restent à prouver ;
- [ ] Stripe : Billing Portal, prix annuels, TVA/HT-TTC, procédure d’annulation et compte de test ;
- [ ] RGPD : identité légale, DPA, sous-traitants, rétention audio/transcription et contact d’exercice des droits ;
- [ ] Domaines : accès DNS/Cloudflare, politique de certificats et procédure de sortie d’un domaine ;
- [ ] ChatGPT/Claude : comptes développeur, secrets de test, publication du connecteur et limites de responsabilité ;
- [ ] Pilotes : deux restaurants nommés, contacts gérants, créneaux d’appel, prix pilote et canal support ;
- [ ] Cohorte complète : huit restaurants suivants, ordre d’onboarding et capacité d’assistance quotidienne.

## Séquence d’exécution

1. P0-01 et P0-02 dans le worktree propre, tests négatifs et revue.
2. P1-03/P1-04 billing et modèle d’activation des modules.
3. P1-05/P1-06 SMS, alertes, backups et parcours vocal réel.
4. P1-07/P1-09 RGPD, contrats et CI bloquante en parallèle.
5. P1-08 puis dogfood interne, deux pilotes, et seulement ensuite les vagues de cinq puis trois restaurants.

La phase 0 sera clôturée quand les tickets ont une date cible, que les dépendances bloquantes ont une réponse, que les deux pilotes sont nommés et que la fiche de release candidate est complète. Le code des P0 peut avancer dans le worktree dès maintenant ; aucune mise en production ne part avant les critères de sortie de la phase 1.

## Première exécution technique

Le lot P0 et le lot Billing P1-03/P1-04 sont codés dans `/Users/hamza/Projects/Sokar/.worktrees/sokar-billing-10` : `requireSokarOperator()` protège les routes globales de provisioning et de santé via `SOKAR_OPERATOR_USER_IDS`, `ReservationService` refuse un rejeu dont le `callId` appartient à un autre restaurant, et le client public reçoit `RESERVATION_REPLAY_REJECTED` sans donnée croisée. La création et la mise à jour restaurant ne peuvent plus modifier `plan`. Checkout utilise une clé d’idempotence Stripe et une tentative persistée ; les événements d’abonnement sont journalisés, dédupliqués et ordonnés par checkpoint ; les erreurs de traitement webhook provoquent un retry Stripe. Une migration additive crée les contraintes et le ledger. Vérification : typecheck, lint sans erreur, tests ciblés P0/Billing verts ; la suite API hors test WebSocket bloqué par `listen EPERM` est verte. La migration et la validation Stripe staging sont désormais déployées ; restent la facture annuelle, les taxes, le prorata, la période de grâce et les parcours réels à deux identités.

### Preuve ops — restauration vierge

Le 7 septembre 2026, après correction de la compatibilité rclone et du privilège Docker du compte `deploy`, `bash scripts/database/test-restore-vierge.sh` a téléchargé `r2:sokar-backups/postgres/20260907T020001Z.dump` (130 148 octets), créé `sokar_restore_test_20260907185714`, restauré le dump sans erreur et vérifié 32 tables publiques, 73 contraintes, 117 index, les deux index critiques `agentic_holds` et les lignes de contrôle (`restaurants=14`, `agentic_holds=4`, `calls=64`, `reservations=8`, `customers=4`).

Le 7 septembre 2026 à 22:04 UTC, le même exercice a été rejoué sur le VPS avec la base temporaire `sokar_restore_test_20260907220422`. Le dump `20260907T020001Z.dump` avait alors 20 h 05 d’âge (RPO observable au moment de l’exercice) ; téléchargement, création, restauration et contrôles ont duré 4,00 s (`/usr/bin/time -p`), puis la base a été supprimée. Cette durée est un RTO de restauration vierge, pas encore le RTO complet d’une restauration de production avec arrêt/reprise API. Le canal d’alerte externe reste à configurer et à tester avec une notification réellement reçue.
