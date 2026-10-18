# Contexte Sokar

> État courant ; historique : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Activité → `Journal.md` ; décisions >30 j → `archive/Context-decisions-2026.md`.
>
> TODOs et décisions du mois uniquement ; cible <8 Ko (`scripts/quality/check-vault-size.sh`).

## TODOs actifs

- [ ] Gestion client : annulation/modification #485–#487 actives et qualifiees staging ; liens off prod. Choix reels, remplacement atomique ; apres delai/contact.

- [ ] Ops Resend : correctif isole `codex/resend-alert-regulation` (debit Redis commun, e-mails system-health groupes). Coordination serveur/GitHub configuree ; cle staging dediee Sending access/sokar.tech autorisee et configuree, envoi technique fournisseur accepte. Livrer par CI/staging/smoke avant production ; aucune migration. Voir `docs/runbooks/resend-alert-regulation.md`.

- [ ] SEO : accueil/privacy livrés (#438–#442) ; GSC arrêté au 13/10, comparer après couverture du 16–22/10 (§10.36). Staging noindex maintenu. Mentions légales bloquées : identité non autorisée à publier ; réseaux facultatifs.
- [ ] Démo : demande/réception/traitement qualifiés en production. DEMO-SIM vérifié localement : animation isolée, fictive (§10.22). Aucun délai annoncé.
- [ ] Vitrine : suivi démo manuel à 12 mois sans purge auto (§10.39–10.42). Avant clôture : identité /legal, TVA, garanties Resend/Google et exécution de la conservation ; valider la promesse « Support prioritaire 7j/7 ».
- [ ] Croissance : ICP-01/METRIC-01 prêts localement (§10.23) ; essai gratuit 14 jours sans carte, suspension automatique à la fin (16/10). France entière ; présélection publique, contacts/envois autorisés par Hamza. Entretiens/SEO en parallèle ; deux pilotes, recette avant activation.
- [ ] Voix : staging configuré/activé, #437 déployée. VOICE-01 interne à qualifier avant activation client ; appels NO_ACTION sans réservation. Pipelines staging/prod différents (growth §10.21).
- [ ] Cartes cadeaux : finir le compte Stripe sandbox démo (encaissements/versements) et qualifier les notifications avant ouverture commerciale.
- [ ] Expériences : migration et qualification Stripe/CGV/TVA/notifications en staging ; garder `EXPERIENCE_BOOKING_ENABLED=false`.
- [ ] Places : valider CGU, attribution, stockage et compatibilité OSM avant activation.

- [ ] Onboarding v2 : #404–#411 livrés ; téléphone et en ligne restent requis, attribution du numéro manuelle avant ouverture. En local : proposition de formule après appel test, équipe/rôles à valider avec un compte Clerk. Décider l'attribution Telnyx automatique et le compte Stripe unique après l'audit phase 1.6 ; paiement après onboarding. UI locale à valider.
- [ ] Onboarding en ligne : bouton « Annuler la réservation test » dans l’étape Règles et diffusion (aujourd’hui le restaurateur réserve sur sa vraie page puis annule à la main).
- [ ] FAQ pratique : renseigner Chez Sokar, l'ajouter à `VOICE_PRACTICAL_INFO_RESTAURANT_IDS`, tester par appel (terrasse, parking, animaux, inconnu → gérant) puis étendre à Connect, widget et MCP.
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

- [ ] Voix (local, non déployé) : écouter un appel avec le vrai modèle sur les répétitions et les confirmations (consignes communes et du tour structuré, garde-fou) avant tout déploiement ; décider ensuite si le registre par restaurant (`VOICE_PERSONALITY_STYLE_RESTAURANT_IDS`, vide par défaut) s'étend à tous.

## Décisions récentes

- 2026-10-17 — [Marque] Sokar = « Le chef de rang numérique de votre restaurant », slogan « Il répond, il réserve, il organise votre salle. » (`packages/shared/src/brand.ts`). Ne plus présenter Sokar comme « assistant téléphonique ».
- 2026-10-06 — [Voix/TTS] Voix Cartesia par défaut : Sarah (`90358bc7-3328-4b93-a942-d0447d7d4b5c`), à la place de Katie pour les profils sans voix personnalisée.
- 2026-10-06 — [Onboarding audio] Réponses de démonstration alignées sur les phrases du client ; le cache inclut le texte pour invalider les anciens audios après une modification du script.
- 2026-10-11 — [Onboarding/horaires] Dernières arrivées réglées une fois par service et propagées automatiquement aux jours ouverts ; si une fermeture plus tôt rend l’heure invalide, retenir le dernier créneau valide avant cette limite.

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
