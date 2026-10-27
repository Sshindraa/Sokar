# Qualification de la compréhension vocale

L'appel staging `33ece9ba` du 24/10/2026 ne permet pas de comparer la qualité de Deepgram et Ink :
aucun audio ni hypothèse Deepgram conservée. Le texte sélectionné venait d'Ink, malgré le label
Deepgram de l'appel. Ne pas prendre ce texte pour les paroles réelles de l'appelant.

## Configuration du prochain essai

Après déploiement du correctif, sur staging et sur le seul restaurant de test :

- Ajouter son identifiant à `VOICE_STT_INK_RESTAURANT_IDS` pour comparer les moteurs.
- Garder `VOICE_STT_INK_REPLACE_RESTAURANT_IDS` vide : Deepgram pilote le dialogue.
- Ajouter ce même restaurant à `VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS` pour garder les deux
  hypothèses (`voiceDebug=stt_comparison`), les segments Deepgram et le dialogue. Les textes passent
  par `redactPii` ; les noms peuvent rester. Rétention des journaux : 14 jours.
- Activer `CALL_RECORDING_ENABLED=true` et ajouter le restaurant à
  `CALL_RECORDING_TEST_RESTAURANT_IDS`, avec le stockage privé configuré. **Prévenir le testeur avant
  qu'il appelle** : le flux actuel démarre l'enregistrement dès le décroché et ne joue pas d'annonce
  automatique. Réserver cet essai au testeur informé, jamais aux clients.
- Vérifier le routage vers staging. Si le numéro est partagé, utiliser une fenêtre de test convenue
  et restaurer le routage production après l'essai. Ne pas déplacer le numéro sans coordination.
- Conserver PCMA et le débruitage actuel pour ce premier essai : modifier un paramètre à la fois.

## Scénario et critères

Le testeur effectue une demande complète (date, heure, nombre de personnes), une correction, une
réponse courte, puis une épellation. Employer des coordonnées fictives. Comparer les hypothèses
à l'audio réellement enregistré ; ne pas désigner un moteur gagnant avec la transcription de l'autre.

Après le raccroché :

1. Vérifier `recordingStatus=AVAILABLE`, l'existence du fichier et les deux pistes audibles.
2. Lire le rapport avec `python3 scripts/ops/voice_call_audio.py report <id>` et récupérer l'audio
   avec `python3 scripts/ops/voice_call_audio.py <id>`. L'audio reste hors dépôt.
3. Relever pour chaque tour les deux hypothèses, le moteur sélectionné, les erreurs métier
   (date, heure, couverts, nom), la découpe et le délai fin de parole → premier audio.
4. Vérifier que le fournisseur du texte figure dans l'événement `stt_final` et dans
   `voice_turn_telemetry.stt_provider`. Le label d'appel historique reste insuffisant pour un appel mixte.
5. Si Ink est sélectionné lors d'un essai ultérieur autorisé, aucun score de confiance Deepgram ne
   doit décrire son texte. Une fusion de textes de fournisseurs différents porte `mixed-stt`, sans
   confiances par mot héritées.

Ne réautoriser le remplacement Ink que sur un périmètre test explicitement choisi et après revue
des erreurs sur audio. Si les deux moteurs échouent sur le même passage, examiner ensuite la
segmentation et le signal amont ; une comparaison avec/sans débruitage requiert un nouvel essai
contrôlé. Aucune conclusion sur le bruit, l'accent ou le codec sans preuve audio.

À la fin de la qualification, vider les listes de comparaison et de remplacement, puis désactiver
l'instrumentation temporaire qui n'est plus nécessaire.

## Non-régression avant le premier audio

L'appel production `9c291ac3` du 24/10/2026 a été compris, mais le premier son de sa réponse a été
annulé (`cancelled_voice_resumed`, 20 ms d'attente) au passage d'un bruit bref. Le garde-fou exige
désormais 160 ms de signal continu au seuil adaptatif avant cette annulation. Un pic bref attend
le silence (600 ms par défaut) ou le plafond (1 200 ms), sans perdre la réponse. La coupure par
transcription et la pause rapide pendant une réponse déjà audible gardent leur fonctionnement.

Validation privée hors dépôt : piste appelant décodée en A-law 8 kHz et redécoupée en blocs de 5 ms,
avec horloge simulée, garde lancée à 12,375 s : ancienne garde annulée à 20 ms, nouvelle garde libérée
après 620 ms ; une reprise sur la vraie demande à 7,400 s reste annulée. C'est un rejeu de l'audio,
pas une reproduction des paquets ou du débruitage Telnyx originaux. Les tests persistés utilisent
seulement des signaux synthétiques ; aucune voix enregistrée n'est ajoutée au dépôt.

Lors de la recette staging, vérifier qu'un bruit bref avant le premier son conserve la réponse et
qu'une vraie reprise de parole l'interrompt toujours. L'absence de premier audio ne doit plus rester
inexpliquée : contrôler `first_audio_hold` et `tts_first_audio` ensemble.
