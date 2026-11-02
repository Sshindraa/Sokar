# Contexte Sokar

> État courant; historique : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Activité → `Journal.md`; décisions >30 j → `archive/Context-decisions-2026.md`.
>
> TODOs et décisions du mois uniquement; cible <8 Ko (`scripts/quality/check-vault-size.sh`).

## TODOs actifs

- [ ] Incident RGPD : vérification SMS et export rouverts en production ; effacement et opposition marketing restent bloqués (503) jusqu’à correction. Correctif SMS livré et qualifié en staging ; examiner les anciens journaux. Les demandes manuelles passent par privacy@sokar.tech.

- [ ] Notifications : #484 qualifiée staging/off prod; WEB/outbox/WhatsApp locaux. Annulation/modification #485–#487 actives et qualifiées staging; liens off prod. Après délai : contact, aucun frais auto.
- [ ] Audit notifications local : reprise horaire des échecs de livraison ciblés et SMS client, claims pour alertes responsables, réparations des audits et rappels isolés ; qualifier Redis/fournisseurs et surveiller le rattrapage en staging avant livraison. Les autres sujets d'outbox restent en reprise manuelle.
- [ ] Audit entrées publiques local : OAuth atomique dans Redis, limite Fastify partagée, clés MCP asynchrones, réponses SMS/WhatsApp dédupliquées ; qualifier Redis/Telnyx en staging. Numéro d'envoi partagé : l'unicité d'un candidat ne prouve pas le lien entre une réponse et sa réservation ; corrélation fiable à définir avant de garantir l'isolation. RGPD : vérification et export rouverts durablement en production (#616) ; effacement et opposition marketing bloqués en 503 ; correctif livré en production, blocage maintenu dans la configuration, workflow production réactivé ; vérifier la réouverture et les journaux historiques. PR #615 fusionnée et staging qualifié (smokes, réception SMS confirmée) ; refus des anciens liens corrigé ; effacement et audit regroupés en transaction, expériences détachées avant anonymisation. Qualifier PostgreSQL, SMS et staging avant livraison ; reprise après consommation du jeton, export des formats historiques non couverts et opposition marketing restent ouverts.
- [ ] WhatsApp : flags off. Téléphone = confirmation SMS, sans rappel ; WEB avec consentement = rappel WhatsApp sans repli SMS. Callbacks Meta signés (7 j, rapprochement ID ; sans ID → manuel). Template FR/Utility soumis, Telnyx #800571 ouvert. Reste : fournisseur, abonnement/secrets Meta, qualification staging ; SMS staging validé. Voir `whatsapp-reservation-activation.md`.
- [ ] SEO/confidentialité : accueil/privacy #438–#442 ; comparer GSC après couverture 16–22/10 (§10.36), staging noindex. Dashboard/Connect/API : notice par catégories, annexe client en projet (`privacy-client-annex.md`), preuves internes. Workspace Business Starter, stockage « Aucune préférence » : pas de promesse UE. ATDC Google autorisé ; notifications démo minimisées. Resend Free/DPA archivé ; rétention et autres contrats à vérifier. `/privacy` noindex en revue. Mentions légales incomplètes : identité EI non publiable, adresse seule autorisée ; réseaux facultatifs.
- [ ] Démo : demande/réception/traitement qualifiés en production. DEMO-SIM vérifié localement : animation isolée, fictive (§10.22). Aucun délai annoncé.
- [ ] Vitrine : suivi démo manuel à 12 mois, sans purge auto. Avant clôture : identité légale, TVA, garanties Resend/Google, conservation et promesse « Support prioritaire 7j/7 » à valider.
- [ ] Notifications ops : #463 en prod, CI/smokes et API/workers/DB/Redis/fichiers OK. Régulation active ; test staging : deux alertes groupées, doublon supprimé ; admission prod vérifiée sans fournisseur. Clé staging posée, prod/allowlist intactes. Suivre volumes et jobs historiques ; quota Free ≠ débit. Voir `resend-alert-regulation.md`.
- [ ] SMS : staging livré. Prod : 40008 rejeté ; pas de rejeu ; SMS résa/WhatsApp off partout ; cause Telnyx à établir.
- [ ] Croissance : ICP-01/METRIC-01 prêts localement (§10.23), essais exclus. France entière; présélection publique, contacts/envois autorisés par Hamza. Entretiens/SEO en parallèle; deux pilotes, recette avant activation.
- [ ] Voix : #586–#588 livrés (`22546523`), staging/prod et 4566 tests API verts. Ink complet anticipé, silence épellation déduit ; seuil DG inchangé. #580 garde 160 ms en branche, rejeux verts ; qualification sur appel staging à finir (`voice-stt-qualification.md`) ; clients off.
- [ ] Audit voix local : qualifier un appel et les retransmissions en staging avant livraison ; installer la protection des journaux Nginx avant l'API. Les sessions restent en mémoire : reprise après redémarrage et routage multiprocessus à résoudre avant de les garantir.
- [ ] Naturel : phase 1 en branche, 1601 tests voix verts. Qualification Chez Sokar seul ; recette audio avant extension. Voir `voice-conversation-continuity.md`.
- [ ] Cartes cadeaux : finir le compte Stripe sandbox démo (encaissements/versements) et qualifier les notifications avant ouverture commerciale.
- [ ] Expériences : migration et qualification Stripe/CGV/TVA/notifications en staging; garder `EXPERIENCE_BOOKING_ENABLED=false`.
- [ ] Places : valider CGU, attribution, stockage et compatibilité OSM avant activation.
- [ ] Onboarding v2 : #404–#411 livrés ; téléphone/en ligne requis, numéro attribué manuellement. UI locale : formule après appel test, équipe/rôles à valider. Décider auto-attribution Telnyx et compte Stripe après audit 1.6 ; paiement après onboarding. Propriété/transfert local : qualifier Clerk réel et reprise en staging avant livraison.
- [ ] FAQ pratique : renseigner Chez Sokar, l'ajouter à `VOICE_PRACTICAL_INFO_RESTAURANT_IDS`, tester par appel (terrasse, parking, animaux, inconnu → gérant) puis étendre à Connect, widget et MCP.
- [ ] Span-01 : annoter 300 à 500 tours difficiles, puis décider de la phase 2 (advisory).
- [ ] Banc voix : décider phase 1b et annoter humainement `bf3893ae` (`truthStatus: unverified`); ablation/substitution ne discriminent pas.
- [ ] Appel en direct onboarding : compléter un appel de bout en bout avec réservation simulée (écho, latence, disponibilité, confirmation), puis déployer `microphone=(self)` (nginx prod) avant la mise en ligne.
- [ ] Appel réel Chez Sokar : valider compréhension/épellation, mesurer le délai de relecture et tester « A, deux S, A, M ».
- [ ] Après l’appel réel, vérifier `judge` (disponibilité/délai) et rejouer « je voudrais bien venir »; retrait via `VOICE_TURN_JUDGE_RESTAURANT_IDS`.
- [ ] Banc voix : traiter la répétition mot pour mot (20–55 %, seuil 80 %) et utiliser le vrai prompt `prompts.ts`.
- [ ] Relais LLM : GPT-6 Luna fast principal en prod depuis le 20/10, doublon 700 ms, repli Cerebras ; conservation sans UE acceptée pour l’instant. Suivre `hedge_won`/`primary_won` ; Chez Sokar prêt (#521), sur feu vert.
- [ ] Essai staging L16 : confirmer l’endianness avec la sonde.
- [ ] Activer `VOICE_STT_CHUNK_MS=100` après vérification staging.
- [ ] Étudier le débruitage et le parser par étape.
- [ ] Après phase 6, refaire l’appel pilote Deepgram + Dialogue V2 et analyser latence/fallback.
- [ ] Flux non retenu (20/10, courts/épellations perdus); allowlist vide. Mesurer les tours « inachevés ».
- [ ] Phase A3 : décider du canary keyterms métier/L16 après revue des résultats et validation staging.
- [ ] Rapport d’appel : après le prochain test réel, vérifier le lien de l’appel et le statut `linked` dans `voice_call_audio.py report <id>`.
- [ ] Après déploiement, lire le premier rapport d’appel et décider si l’ancien code de dialogue réservé au banc STT peut être déplacé.
- [ ] Voix (local, non déployé) : écouter un appel avec le vrai modèle sur les répétitions et les confirmations (consignes communes et du tour structuré, garde-fou) avant tout déploiement; décider ensuite si le registre par restaurant (`VOICE_PERSONALITY_STYLE_RESTAURANT_IDS`, vide par défaut) s'étend à tous.
- [ ] Voix #580 : correctif anti-bruit livré en production ; effectuer et analyser un appel entrant réel sur Chez Sokar.
- [ ] ChatGPT/OpenAI Reserve : Cloudflare Pages publié ; l’URL `.html` redirige (308) vers `/restaurant-reservation` (200), CORS prod vérifié. Accord « ChatGPT merchants » non confirmé ; attendre l’accord avant activation.

## Décisions récentes

- 2026-10-31 — [Companion] Modèle de production : Claude Sonnet 5.5 (`anthropic/claude-sonnet-5.5`), raisonnement bas, pour tous les restaurants ; aucun réglage par restaurant ni aiguillage entre modèles. Banc : questions simples 105/105 contre 101/105 pour Haiku, ancrage 139/141.

- 2026-10-28 — [Fidélité et intégrations] Fidélité manuelle ouverte à Pro/Multi-site après livraison ; POS et groupes restent coupés jusqu’au premier client L’Addition / multi-site.

- 2026-10-25 — [Intégrations] Google Agenda retiré complètement (code, UI, offre, colonnes DB) : peu utile aux restaurateurs et synchro partielle (téléphone seulement).
- 2026-10-22 — [Voix] Aucune fonction voix par restaurant ni coupée par défaut : tout est actif pour tous les restaurants (seuls le débogage et l'enregistrement restent limités).
- 2026-10-06 — [Voix/TTS] Voix Cartesia par défaut : Sarah (`90358bc7-3328-4b93-a942-d0447d7d4b5c`), à la place de Katie pour les profils sans voix personnalisée.
- 2026-10-06 — [Onboarding audio] Réponses de démonstration alignées sur les phrases du client; le cache inclut le texte pour invalider les anciens audios après une modification du script.
- 2026-10-11 — [Onboarding/horaires] Dernières arrivées réglées une fois par service et propagées automatiquement aux jours ouverts; si une fermeture plus tôt rend l’heure invalide, retenir le dernier créneau valide avant cette limite.

- 2026-10-06 — [Onboarding] Appel test sur le numéro public uniquement.
- 2026-10-03 — [UI/widget] Retour à la référence visuelle de phase 2; conserver les corrections fonctionnelles suivantes.
- Cartes cadeaux : encaissement restaurant via Stripe Connect; aucun débit à la réservation, consommation sur l’addition réelle. Qualification financière avant ouverture commerciale; commit/push du lot autorisés le 06/10.
