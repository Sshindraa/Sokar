# Contexte Sokar

> État courant ; historique : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Activité → `Journal.md` ; décisions >30 j → `archive/Context-decisions-2026.md`.
>
> TODOs et décisions du mois uniquement ; cible <8 Ko (`scripts/quality/check-vault-size.sh`).

## TODOs actifs

- [ ] Cartes cadeaux : finir le compte Stripe sandbox démo (encaissements/versements) et qualifier les notifications avant ouverture commerciale.
- [ ] Expériences : migration et qualification Stripe/CGV/TVA/notifications en staging ; garder `EXPERIENCE_BOOKING_ENABLED=false`.
- [ ] Places : valider CGU, attribution, stockage et compatibilité OSM avant activation.

- [ ] Span-01 : annoter 300 à 500 tours difficiles, puis décider de la phase 2 (advisory).

- [ ] Banc voix : décider phase 1b et annoter humainement `bf3893ae` (`truthStatus: unverified`) ; ablation/substitution ne discriminent pas.
- [ ] Appel en direct onboarding : l'essayer avec les vrais fournisseurs (écho, latence, réservation simulée), puis déployer `microphone=(self)` (nginx prod) avant la mise en ligne.
- [ ] Appel réel Chez Sokar : valider compréhension/épellation, mesurer le délai de relecture et tester « A, deux S, A, M ».
- [ ] Après l’appel réel, vérifier `judge` (disponibilité/délai) et rejouer « je voudrais bien venir » ; retrait via `VOICE_TURN_JUDGE_RESTAURANT_IDS`.
- [ ] Banc voix : traiter la répétition mot pour mot (20–55 %, seuil 80 %) et utiliser le vrai prompt `prompts.ts`.
- [ ] Secours UE : décider UE seule, UE→mondial ou aucun basculement ; vérifier les régions Cerebras, Deepgram, Cartesia et Telnyx.
- [ ] Essai staging L16 : confirmer l’endianness avec la sonde.
- [ ] Activer `VOICE_STT_CHUNK_MS=100` après vérification staging.
- [ ] Phase 4a : évaluer le verrouillage FR côté Scribe.
- [ ] Étudier le débruitage et le parser par étape.
- [ ] Après phase 6, refaire l’appel pilote Deepgram + Dialogue V2 et analyser latence/fallback.
- [ ] Avant Flux, comprendre les 9/31 finals manquants ; garder l’allowlist vide jusque-là.
- [ ] Phase A3 : décider du canary keyterms métier/L16 après revue des résultats et validation staging.
- [ ] MCP : déployer le reset audité, nettoyer/rejouer le run staging et rejouer les écritures ; tests Chez Sokar uniquement, sans `initialize`/`tools/list` bruts.
- [ ] Rapport d’appel : après le prochain test réel, vérifier le lien de l’appel et le statut `linked` dans `voice_call_audio.py report <id>`.
- [ ] Après déploiement, lire le premier rapport d’appel et décider si l’ancien code de dialogue réservé au banc STT peut être déplacé.

## Décisions récentes

- 2026-10-06 — [Onboarding] Appel test sur le numéro public uniquement.
- 2026-10-03 — [UI/widget] Retour à la référence visuelle de phase 2 ; conserver les corrections fonctionnelles suivantes.
- Cartes cadeaux : encaissement restaurant via Stripe Connect ; aucun débit à la réservation, consommation sur l’addition réelle. Qualification financière avant ouverture commerciale ; commit/push du lot autorisés le 06/10.

2026-09-30 — [MCP, UX] Réponse de disponibilité limitée au résultat utile ; préciser la création uniquement si demandé et rafraîchir les outils après déploiement.

2026-09-29 — [MCP, UX] Pas de surface prompts/resources sans besoin récurrent avéré.

2026-09-29 — [MCP, contrats] Retries idempotents, erreurs stables, sorties validées ; quote informatif, hold réservé à la capacité.

2026-09-29 — [MCP, observabilité] Contrats recherche/disponibilité additifs ; métriques indépendantes du client.

2026-09-25 — [Voix] Keyterms métier en opt-in par restaurant ; aucune donnée personnelle ; MIP opt-out par défaut.

2026-09-24 — [Réservations] Taille de groupe par défaut unifiée à 7 ; lignes existantes inchangées.

2026-09-23 — [Voix/observabilité] TurnPlan en shadow sans autorité ; métriques Prometheus, Grafana accessible par tunnel SSH.

2026-09-21 — [Connect] Publication refusée sans slug, avant toute écriture.

2026-09-21 — [Seed] Restaurants de démo créés uniquement en local, ou à distance avec opt-in explicite.

2026-09-21 — [Codex] Configuration plugins allégée ; raisonnement par défaut réglé sur high.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
