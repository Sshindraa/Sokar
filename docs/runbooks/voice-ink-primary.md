# Ink-2 automatique comme STT principal

Décision utilisateur du 25 octobre 2026. Changement préparé en branche, non déployé.

## Fonctionnement

Les nouvelles sessions utilisent Cartesia Ink-2 automatique par défaut
(`VOICE_STT_PROVIDER=cartesia`). Une seule socket `/stt/turns/websocket` reçoit
le flux téléphonique ; aucune connexion Deepgram et aucune socket Ink manuelle.
Le fournisseur valide le texte cumulatif au `turn.end`. Les partielles et
`turn.eager_end` ne sont pas des fins définitives. Les protections communes
(épellation, parole inachevée, interruption, reconnexion, transfert) restent actives.
Les flags historiques de comparaison Ink ne s'appliquent pas à ce chemin.

La clé du fournisseur choisi est exigée au démarrage. La démonstration en direct
fonctionne avec Cartesia sans clé Deepgram. Les rapports après appel restent
sur Deepgram Nova/Whisper ; leur clé est conservée pour ce seul usage et pour
le retour arrière. Aucune migration ni modification de contrat public.

## Vérifications locales

- 203 tests ciblés : environnement, démo, adaptateurs, transport et résilience.
- Suite voix : 1 537 tests passés, deux tests ignorés existants.
- TypeScript API et ESLint sur les fichiers modifiés : sans erreur.
- Transport testé : PCMA brut sur une seule socket Cartesia, sans clé Deepgram,
  même avec une ancienne liste de comparaison Ink renseignée.
- Les événements intermédiaires ne valident aucun tour ; le `turn.end` fournit
  l'heure complète. Un refus de clé Cartesia ne lance pas Deepgram.

## Rejeu réel du fournisseur

Quatre extraits privés de l'appel test `98e86c8e`, piste appelant uniquement,
MP3 réencodé A-law 8 kHz, trames 20 ms à rythme réel depuis le VPS, clé staging,
version Cartesia `2026-03-01`, `turn_end_timeout_ms=1500`. Une session par extrait,
4 s de silence au plus après chaque clip, aucune requête au dialogue ou réservation.
Les événements privés restent hors Git (`$TMPDIR/sokar-call-audio/98e86c8e/ink-auto-qualification.jsonl`).

| Tour                   | Fin de parole audio → turn.end | Observation                    |
| ---------------------- | ------------------------------ | ------------------------------ |
| Demande de réservation | 428 ms                         | Intention et phrase conservées |
| Demain / ouverture     | 439 ms                         | Mot de date mal reconnu        |
| Heure d'ouverture      | 1 041 ms                       | Question mal reconnue          |
| Horaire                | 874 ms                         | Heure complète conservée       |

Ces mesures incluent la cadence d'envoi du rejeu ; les sessions indépendantes,
le MP3 réencodé et l'absence du débruitage runtime empêchent de les comparer
strictement aux délais de l'appel initial. Elles ne prouvent ni supériorité ni
équivalence de qualité. Elles vérifient le protocole automatique et révèlent
la nécessité d'une recette réelle.

## Activation et retour arrière

1. Soumettre la branche et attendre les vérifications CI. La fusion reste une
   décision humaine conformément à AGENTS.md ; ne pas fusionner automatiquement.
2. Après fusion, laisser les workflows livrer staging puis production avec
   snapshots, smokes et rollback habituels. Signaler le changement de fournisseur voix.
3. Le staging a encore `VOICE_STT_PROVIDER=deepgram` au 25/10 : définir
   `VOICE_STT_PROVIDER=cartesia` dans son `.env` privé lors de l'activation et
   recharger l'API sans interrompre d'appel actif. Contrôler aussi l'environnement
   PM2 effectif pour éviter qu'une valeur héritée ne masque le `.env`.
4. Qualifier un appel de test informé : heure, date, convives, épellation,
   hésitation et reprise de parole. Vérifier le fournisseur Cartesia par tour,
   aucune connexion Deepgram, texte complet et réservations attendues.
   Ne pas déplacer le numéro partagé sans coordination.
5. La production n'avait pas de valeur `VOICE_STT_PROVIDER` dans le `.env`
   lors du diagnostic : le nouveau défaut s'y applique après livraison. Vérifier
   la valeur PM2 effective et les health checks. Ne pas annoncer un appel réel
   qualifié sur la seule base des rejeux ou des smokes HTTP.
6. Retour arrière : définir `VOICE_STT_PROVIDER=deepgram`, conserver la clé
   Deepgram, vider les deux listes de comparaison/remplacement Ink pour éviter
   de réactiver le défaut du chemin manuel, puis recharger l'API après les
   appels actifs. Le rollback d'artefacts suit le runbook de déploiement ;
   aucune restauration de base n'est nécessaire.
