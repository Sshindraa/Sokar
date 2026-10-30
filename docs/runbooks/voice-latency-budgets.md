# Latence voix : anticipation sur Ink et budget de silence

Décision du 25 octobre 2026 : traiter l'attente avant la réponse sans changer
le fournisseur, l'ordre du JSON de sûreté ni les conditions d'exécution métier.

## Constat et changements

Appel test `3d6e51c6` : 8 anticipations sur 11 abandonnées, dont 7 pour une
différence entre le texte anticipé et le texte final, et une pour l'état.
La spéculation partait d'une partielle Deepgram alors qu'Ink fournissait le
texte final du dialogue. La clôture Deepgram ajoutait ensuite sa propre attente.

Lorsque le remplacement Ink est déjà autorisé, une réponse terminée par
`flush_done` peut maintenant préparer le modèle avant la clôture Deepgram.
Le tampon reste intact ; le callback ne valide aucun tour et ne parle ni
n'exécute d'action. Le minuteur de partielle privilégie aussi ce texte Ink prêt
pour éviter de revenir ensuite à une ancienne hypothèse Deepgram. Une reprise
de voix ou un nouveau cycle Ink en cours empêche d'utiliser ce tampon comme
complet. Un cycle Ink complet n'est pas une preuve de fin de parole : Deepgram
reste seul responsable de la clôture dans ce montage.

La validation finale de la requête spéculative reste identique : transcription,
état, historique et schéma doivent correspondre, avec les tolérances existantes
uniquement. Si une anticipation est déjà compatible avec le texte Ink (casse,
ponctuation autorisée, etc.), elle reste en cours ; aucun chiffre, négation ou
lettre différente n'est rendu tolérant. Les callbacks de clôture Deepgram
restent attachés à leur texte exact. Le plafond existant de trois anticipations
par tour reste inchangé ; suivre aussi les remplacements et tokens gaspillés.

## Épellation : ne pas compter le silence deux fois

Le délai historique ajoutait `800 - 200 = 600 ms` après le résultat STT, même
quand plus de 200 ms de silence s'étaient déjà écoulées. Sur une mesure audio
fiable (au moins 500 ms suivies), le délai utilise désormais :

- un budget total de silence de 800 ms par défaut, augmenté si les pauses
  observées de l'appelant l'exigent ;
- la déduction du silence déjà écoulé ;
- une grâce minimale de 200 ms pour les fragments STT tardifs (sans dépasser
  la grâce historique si cette dernière était configurée plus courte).

Avec 530 ms déjà écoulées : 270 ms restantes plutôt que 600 ms. Avec 600 ms :
200 ms restantes. Si la voix reprend, le même budget de silence est à nouveau
exigé ; une partielle récente prolonge toujours l'attente. La borne de retenue
existante de trois secondes reste active. Sans mesure fiable, le comportement
historique est conservé ; le mode automatique de secours Ink est inchangé.

Le seuil général Deepgram de silence local reste à 600 ms par défaut, puis
s'adapte aux pauses de l'appelant comme avant. Aucune baisse générale vers
300/400 ms n'est introduite sur la base d'un seul appel.

## Mesure du délai vers la première phrase

L'événement additif `llm_say_started` marque le premier contenu non blanc de
`say`, pour chaque passage. Avec `llm_first_token`, `llm_first_phrase` et les
premiers octets/audio, on peut séparer le préfixe JSON, l'attente de la phrase
et la voix. Aucun texte d'appel n'est journalisé par cet événement. Les champs
de compréhension, faits et action restent avant la parole ; aucune réponse
n'est émise pour gagner du temps avant validation.

## Vérifications et limites

- 1 566 tests voix passés : callback uniquement après `flush_done`, tampon non
  consommé, comparaison seule sans anticipation Ink, erreur de callback isolée,
  cache spéculatif réutilisé sans parole/action anticipée, différences de nombres
  non tolérées, budget écoulé et reprise des lettres.
- Typecheck, build API et lint ciblé sans erreur.
- Rejeu de quatre extraits privés du même appel en A-law 8 kHz, temps réel,
  module Ink compilé et clé staging ; aucune génération de dialogue ni écriture
  métier. Le point de clôture Deepgram provient des traces initiales.

| Tour                   | Texte Ink complet disponible avant la clôture rejouée |
| ---------------------- | ----------------------------------------------------- |
| Demande de réservation | 407 ms                                                |
| Horaire                | 186 ms                                                |
| Convives               | 279 ms                                                |
| Épellation             | 311 ms                                                |

Sur l'extrait d'épellation, le VAD rejoué indique 600 ms de silence à la clôture :
projection de grâce 200 ms contre 600 ms auparavant. Les fichiers privés restent
hors Git sous `$TMPDIR/sokar-call-audio/3d6e51c6/latency-ink-ready-*.jsonl`.
Le premier essai horaire utilisait à tort le texte Ink comme entrée Deepgram ;
l'essai retenu utilise le texte Deepgram original « 16 heures ».

Ces petits rejeux MP3 réencodés ne reproduisent ni le débruitage ni toute la
conversation, et ne mesurent pas un gain téléphonique bout en bout. Le temps
réseau/calcul du fournisseur n'est pas réduit : sa préparation commence plus
tôt. Les gains potentiels se chevauchent et ne doivent pas être additionnés.

Après livraison : relever les hits/misses et tokens de spéculation, les repères
LLM et la latence audio ; tester une épellation lente avec pause et reprise,
une correction de nombre/date et une négation. Garder les clients hors de la
qualification. Retour arrière applicatif habituel, sans restauration DB ;
retirer le restaurant de la liste de remplacement Ink désactive son anticipation.
