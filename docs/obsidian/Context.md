# Contexte Sokar

> État courant; historique : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Activité → `Journal.md`; décisions >30 j → `archive/Context-decisions-2026.md`.
>
> TODOs et décisions du mois uniquement; cible <8 Ko (`scripts/quality/check-vault-size.sh`).

## TODOs actifs

- [ ] Notifications : #484 qualifiée staging/off prod; WEB/outbox/WhatsApp locaux. Annulation/modification #485–#487 actives et qualifiées staging; liens off prod. Après délai : contact, aucun frais auto.
- [ ] WhatsApp : local, flags off. Telephone = confirmation SMS sans rappel; WEB avec accord = rappel WhatsApp sans secours SMS. Callbacks Meta signes implementes (recus 7 j, rapprochement par ID; timeout sans ID manuel). Template fr/Utility soumis, Telnyx #800571 ouvert. Reste : fournisseur, abonnement/secrets Meta et qualification staging; SMS staging validé. Voir `whatsapp-reservation-activation.md`.
- [ ] SEO : accueil/privacy livrés (#438–#442); GSC arrêté au 13/10, comparer après couverture du 16–22/10 (§10.36). Staging noindex maintenu. Confidentialité locale Dashboard/Connect/API : notice commune par catégories, annexe nominative clients en projet (`privacy-client-annex.md`), preuves techniques internes; Workspace constaté Business Starter actif, stockage « Aucune préférence » : ne pas promettre une résidence UE. ATDC Google accepté sur autorisation spécifique. Notifications démo minimisées en local (référence + lien admin). Resend Free constaté et DPA signé fournisseur archivé en privé; conservation effective et autres contrats restent à valider. Dashboard `/privacy` noindex et en vérification. Mentions légales : nom/prénom de l'EI non autorisés à publier; adresse seule autorisée. La page reste incomplète sans identité d'éditeur; réseaux facultatifs.
- [ ] Démo : demande/réception/traitement qualifiés en production. DEMO-SIM vérifié localement : animation isolée, fictive (§10.22). Aucun délai annoncé.
- [ ] Vitrine : suivi démo manuel à 12 mois sans purge auto (§10.39–10.42). Avant clôture : identité /legal, TVA, garanties Resend/Google et exécution de la conservation; valider la promesse « Support prioritaire 7j/7 ».
- [ ] Notifications ops : #463 livree staging puis production (`e5eb3520`), CI/smoke verts, API/workers online et sante db/Redis/files OK. Regulation commune active; test artefact staging : deux alertes groupees dans un e-mail accepte, repetition supprimee; admission prod verifiee sans appel fournisseur. Cle staging Sending access/sokar.tech posee ; prod/allowlist intactes. Suivre les volumes et traiter les causes des jobs historiques; quota Free distinct du debit, pas de changement de plan. Voir `resend-alert-regulation.md`.
- [ ] SMS : staging livré. Prod : 40008 rejeté ; pas de rejeu ; SMS résa/WhatsApp off partout ; cause Telnyx à établir.
- [ ] Croissance : ICP-01/METRIC-01 prêts localement (§10.23), essais exclus. France entière; présélection publique, contacts/envois autorisés par Hamza. Entretiens/SEO en parallèle; deux pilotes, recette avant activation.
- [ ] Voix : décision finale du 25/10, montage hybride conservé : Deepgram clôt les tours, Ink transcrit sur opt-in test. #586 réorientée : attendre flush_done, concaténer les deltas sans altération, isoler les réponses tardives ; bascule Ink seul abandonnée. Correctif en branche, recette réelle après livraison ; clients off.
- [ ] Cartes cadeaux : finir le compte Stripe sandbox démo (encaissements/versements) et qualifier les notifications avant ouverture commerciale.
- [ ] Expériences : migration et qualification Stripe/CGV/TVA/notifications en staging; garder `EXPERIENCE_BOOKING_ENABLED=false`.
- [ ] Places : valider CGU, attribution, stockage et compatibilité OSM avant activation.
- [ ] Onboarding v2 : #404–#411 livrés; téléphone et en ligne restent requis, attribution du numéro manuelle avant ouverture. En local : proposition de formule après appel test, équipe/rôles à valider avec un compte Clerk. Décider l'attribution Telnyx automatique et le compte Stripe unique après l'audit phase 1.6; paiement après onboarding. UI locale à valider.
- [ ] FAQ pratique : renseigner Chez Sokar, l'ajouter à `VOICE_PRACTICAL_INFO_RESTAURANT_IDS`, tester par appel (terrasse, parking, animaux, inconnu → gérant) puis étendre à Connect, widget et MCP.
- [ ] Span-01 : annoter 300 à 500 tours difficiles, puis décider de la phase 2 (advisory).
- [ ] Banc voix : décider phase 1b et annoter humainement `bf3893ae` (`truthStatus: unverified`); ablation/substitution ne discriminent pas.
- [ ] Appel en direct onboarding : compléter un appel de bout en bout avec réservation simulée (écho, latence, disponibilité, confirmation), puis déployer `microphone=(self)` (nginx prod) avant la mise en ligne.
- [ ] Appel réel Chez Sokar : valider compréhension/épellation, mesurer le délai de relecture et tester « A, deux S, A, M ».
- [ ] Après l’appel réel, vérifier `judge` (disponibilité/délai) et rejouer « je voudrais bien venir »; retrait via `VOICE_TURN_JUDGE_RESTAURANT_IDS`.
- [ ] Banc voix : traiter la répétition mot pour mot (20–55 %, seuil 80 %) et utiliser le vrai prompt `prompts.ts`.
- [ ] Relais LLM : GPT-6 Luna fast (OpenRouter `openai/fast`) actif en prod depuis le 20/10, doublon à 700 ms et repli de Cerebras; conservation des données acceptée pour l'instant (pas d'UE). Suivre `hedge_won`/`primary_won`; Luna en principal sur Chez Sokar prêt (#521), sur feu vert.
- [ ] Essai staging L16 : confirmer l’endianness avec la sonde.
- [ ] Activer `VOICE_STT_CHUNK_MS=100` après vérification staging.
- [ ] Étudier le débruitage et le parser par étape.
- [ ] Après phase 6, refaire l’appel pilote Deepgram + Dialogue V2 et analyser latence/fallback.
- [ ] Flux non retenu (20/10, courts/épellations perdus); allowlist vide. Mesurer les tours « inachevés ».
- [ ] Phase A3 : décider du canary keyterms métier/L16 après revue des résultats et validation staging.
- [ ] Rapport d’appel : après le prochain test réel, vérifier le lien de l’appel et le statut `linked` dans `voice_call_audio.py report <id>`.
- [ ] Après déploiement, lire le premier rapport d’appel et décider si l’ancien code de dialogue réservé au banc STT peut être déplacé.
- [ ] Voix (local, non déployé) : écouter un appel avec le vrai modèle sur les répétitions et les confirmations (consignes communes et du tour structuré, garde-fou) avant tout déploiement; décider ensuite si le registre par restaurant (`VOICE_PERSONALITY_STYLE_RESTAURANT_IDS`, vide par défaut) s'étend à tous.

## Décisions récentes

- 2026-10-22 — [Voix] Aucune fonction voix par restaurant ni coupée par défaut : tout est actif pour tous les restaurants (seuls le débogage et l'enregistrement restent limités).
- 2026-10-06 — [Voix/TTS] Voix Cartesia par défaut : Sarah (`90358bc7-3328-4b93-a942-d0447d7d4b5c`), à la place de Katie pour les profils sans voix personnalisée.
- 2026-10-06 — [Onboarding audio] Réponses de démonstration alignées sur les phrases du client; le cache inclut le texte pour invalider les anciens audios après une modification du script.
- 2026-10-11 — [Onboarding/horaires] Dernières arrivées réglées une fois par service et propagées automatiquement aux jours ouverts; si une fermeture plus tôt rend l’heure invalide, retenir le dernier créneau valide avant cette limite.

- 2026-10-06 — [Onboarding] Appel test sur le numéro public uniquement.
- 2026-10-03 — [UI/widget] Retour à la référence visuelle de phase 2; conserver les corrections fonctionnelles suivantes.
- Cartes cadeaux : encaissement restaurant via Stripe Connect; aucun débit à la réservation, consommation sur l’addition réelle. Qualification financière avant ouverture commerciale; commit/push du lot autorisés le 06/10.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
