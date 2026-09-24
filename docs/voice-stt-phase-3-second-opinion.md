# Phase 3 B — seconde transcription (résultats partiels)

**Exécution : 24 septembre 2026. Statut : incomplète, quota ElevenLabs épuisé.**

L’expérience compare A (Scribe Realtime) et B (`scribe_v2` batch) sur le même audio téléphonique synthétisé et dégradé. Les 992 audios ont été synthétisés et conservés sur le serveur. Le contrôle de trois phrases a réussi sur les deux moteurs. Pendant le lot complet, le quota ElevenLabs a bloqué la majorité des transcriptions ; les chiffres ci-dessous ne décrivent donc que les paires effectivement obtenues.

## Couverture

| Jeu                               | Phrases | A non vide | B non vide | Paires A/B évaluables | Erreurs batch 401 |
| --------------------------------- | ------: | ---------: | ---------: | --------------------: | ----------------: |
| Validation                        |     304 |        243 |        239 |                   239 |                65 |
| Hard-calibration                  |     344 |          0 |          0 |                     0 |               344 |
| Hard-validation (jeu tenu à part) |     344 |          0 |          0 |                     0 |               344 |
| **Total**                         | **992** |    **243** |    **239** |               **239** |           **753** |

Sur la validation, 61 phrases n’ont pas de transcription Realtime exploitable ; quatre autres ont une transcription Realtime mais pas de résultat batch. Les deux jeux difficiles n’ont produit aucune transcription exploitable. Le diagnostic batch a renvoyé HTTP 401 avec le détail : quota de 10 000 crédits, solde restant nul, 2 crédits requis pour une requête. Aucune autre requête fournisseur n’a été lancée après ce diagnostic.

Durée audio totale synthétisée : **31,4 minutes** (validation 9,5 min, hard-calibration 11,1 min, hard-validation 10,8 min). Les fichiers audio restent sur le serveur ; une reprise ne nécessitera pas de nouvelle synthèse Cartesia.

## Résultats sur les 239 paires réussies

L’évaluation réutilise l’interprétation de production (`recordUserTurn`). Les transcriptions vides ou en erreur sont exclues des comparaisons A/B. La précision compte les valeurs attendues non extraites comme fausses. L’accord et les taux d’alerte du désaccord ne portent que sur les faits où A a extrait une valeur.

| Type      | Faits |  Précision A |  Précision B |   Accord A/B | Erreurs A détectées par désaccord | Fausses alertes sur A juste | Rappel confiance à fausses alertes égales |
| --------- | ----: | -----------: | -----------: | -----------: | --------------------------------: | --------------------------: | ----------------------------------------: |
| Personnes |    70 | 69 % (48/70) | 70 % (49/70) | 91 % (49/54) |                        50 % (3/6) |                  4 % (2/48) |                    33 % (2/6), seuil 0,27 |
| Jour      |    68 | 90 % (61/68) | 93 % (63/68) | 95 % (59/62) |                       100 % (1/1) |                  3 % (2/61) |                     0 % (0/1), seuil 0,29 |
| Heure     |    76 | 88 % (67/76) | 96 % (73/76) | 94 % (67/71) |                       100 % (4/4) |                  0 % (0/67) |                     0 % (0/4), seuil 0,11 |

Pour les extraits de 1 à 4 secondes avec une réponse batch valide (n=209), la latence batch mesurée sur le serveur est **563 ms au p50** et **873 ms au p95**. La durée moyenne des 239 audios évalués est de 1,55 s.

Exemples où B corrige A :

- `v192`, « Vers vingt et une heures quinze » : A retient 19:15, B 21:15 (attendu 21:15), confiance A 0,12.
- `v206`, « À vingt-deux heures trente » : A retient 22:00, B 22:30 (attendu 22:30), confiance A 0,24.

## Conclusion et reprise

Sur ce sous-ensemble de validation standard, B est légèrement plus précis pour les personnes (+1 point), les jours (+3) et les heures (+8). Le désaccord repère les 4 erreurs d’heure d’A observées, sans fausse alerte parmi les 67 heures justes. Ces effectifs d’erreurs restent faibles (6, 1 et 4) et **le jeu difficile tenu à part n’a aucune paire** : l’expérience ne permet pas de conclure que B améliore la détection en conditions difficiles ni de recommander son usage dans les appels.

Pour terminer, il faut que le quota ElevenLabs soit réinitialisé ou augmenté. Les transcriptions manquantes pourront alors être reprises à partir des audios déjà stockés ; une reprise entraînera des frais STT supplémentaires. Les 992 audios ne doivent pas être resynthétisés.

Toutes les phrases du banc sont synthétiques ; aucun audio d’appel réel n’a été utilisé.
