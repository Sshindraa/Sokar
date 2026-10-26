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

## Coordination des attentes — 26 octobre 2026, branche #595

Revue du chemin Deepgram → tour structuré → ElevenLabs : plusieurs protections
mesurent déjà le silence depuis la dernière voix. Leurs durées ne s'additionnent
pas comme des pauses successives.

| Contrôle                    | Horloge et comportement                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| Clôture locale Deepgram     | Silence audio ; seuil adaptatif existant                               |
| Retenue d'épellation        | Silence déjà déduit, grâce tardive et reprise des lettres conservées   |
| Juge de fin de tour         | Exécution parallèle, délai maximal inchangé                            |
| Désaccord juge/modèle       | Silence audio ; une reprise maintient le verdict d'attente             |
| Relance après tour inachevé | **Corrigée : dernière voix fiable, sinon réception du texte**          |
| Premier son                 | Silence audio ; aucune nouvelle attente si le seuil est déjà satisfait |

La relance après un tour inachevé comptait ses 2 000 ms depuis la réception de
la transcription, sans déduire le silence déjà écoulé pendant le STT. Elle ne
réévaluait une reprise que si une partielle STT était disponible. Désormais :

- avec au moins 500 ms d'audio suivi et une dernière voix connue, elle déduit
  le silence audio courant du budget configuré ;
- la grâce minimale existante de 300 ms reste présente pour une suite tardive ;
- au déclenchement, une reprise audio réévalue le temps restant même si le STT
  n'a pas encore émis de mots ;
- les partielles en cours, les cinq reports bornés existants et la validation
  avant le premier son restent en place ;
- sans horloge audio fiable, elle compte depuis la réception de la transcription
  comme auparavant. Aucun seuil ni fournisseur ne change.

Exemple déterministe couvert en test : 1 200 ms de silence à la réception du
texte → 800 ms restantes au lieu de 2 000 ms. Si la voix reprend pendant ces
800 ms, le silence est à nouveau vérifié avant la relance. Avec un budget déjà
écoulé, la grâce de 300 ms s'applique. Ce gain de 1 200 ms est une propriété du
scénario synthétique, pas une mesure d'appel ni une réduction sur tous les tours.
Les réponses jugées complètes ne passent pas par ce minuteur.

Les événements existants `dialogue_guard`, avec `guard=incomplete_turn_silence`,
portent l'horloge (`caller_audio` ou `turn_received`), le budget, le silence déjà
écoulé et l'attente programmée. À la libération : résultat silence/plafond,
nombre de reports et budget restant. Aucun texte ni donnée personnelle ajouté.

Les tests couvrent les deux horloges, le budget épuisé, la reprise audio sans
partielle et les reports historiques bornés. La recette réelle reste nécessaire
sur hésitation, correction et épellation lente ; aucun changement du secours Ink
ou de ses temporisations sémantiques n'est inclus dans cette correction.

## Formulation après opération — 26 octobre 2026, branche #595

Le second passage ne reconstruit plus un tour complet quand une opération vient
réellement d'être exécutée : vérification de disponibilité (succès ou échec),
création de réservation, enregistrement d'un message ou transfert simulé.
Les refus des garde-fous et les corrections de brouillon gardent le contrat
complet, sauf si une vérification réelle est ensuite exécutée. Le premier
passage et son autorisation d'action restent inchangés.

Le contrat interne `voice_action_reply` génère `awaiting`, `action` (none ou
end_call), `confidence`, `tone` si actif, puis `say`. Le modèle ne génère ni
compréhension, ni interprétation, ni brouillon ni message métier. L'adaptateur
reconstitue les champs attendus par le moteur avec une copie du brouillon
vérifié et l'interprétation du premier passage (hors congé explicite) ; il n'accepte aucun nouveau brouillon ni nouvelle action. Les champs
avant `say` sont validés avant streaming, la sortie entière est ensuite validée.
Le contrôle des lettres avant relecture et la confiance avant congé sont
conservés. Les erreurs suivent le secours existant ; aucune opération n'est
réexécutée par la formulation.

Le prompt de ce passage décrit seulement la formulation d'un résultat connu,
avec les règles d'accord, de récapitulatif complet, d'épellation et de question
suivante. Il conserve les faits vérifiés et les règles communes du restaurant.
Les événements `llm_say_started` et `structured_turn` portent un champ additif
`contract=action_reply|full_turn`, sans texte d'appel supplémentaire.

### Mesure exploratoire avec le vrai modèle

Rejeu existant `voice-behavior-replay.mjs`, modèle `openai/gpt-6-luna` relu dans
la configuration production, clé staging restant sur le serveur. Raisonnement
`effort=none`, pas de température, concurrence 1, bras alternés. Quatre cas
fictifs : disponibilité sans nom, disponibilité avec nom, réservation créée,
échec de disponibilité. Deux tirages par cas et par bras : 16 requêtes par
comparaison, plus une sonde préalable ; aucune action métier ni synthèse vocale.

Le premier prototype a montré un awaiting incorrect sur une question : les
règles de question/récapitulatif/lettres ont été rétablies avant un nouveau
rejeu des deux bras. Mesure de la version retenue :

| Mesure sur 8 réponses par bras | Tour complet | Formulation seule |
| ------------------------------ | ------------ | ----------------- |
| Tokens d'entrée fournisseur    | 40 402       | 22 226            |
| Tokens de sortie fournisseur   | 874          | 433               |
| Médiane réponse JSON entière   | 1 804,5 ms   | 1 859 ms          |

Soit **45 % de tokens d'entrée et 50 % de sortie en moins**. La baisse de
latence n'est **pas démontrée** : le premier prototype était plus rapide mais
le rejeu final ne l'est pas. Ce banc non streaming mesure la réponse entière,
pas le premier contenu utile ni le délai audio au téléphone. Les huit réponses
finales compactes ont été relues : résultat et question attendue cohérents,
aucune action supplémentaire ni réussite annoncée sur l'échec. Cela reste un
petit corpus exploratoire, pas une garantie sur toutes les conversations.

Les artefacts locaux restent hors dépôt dans
`/Users/hamza/.codex/voice-action-reply-2026-10-26/` (`reference.json`,
`candidate.json`, `results-staging-v2.json`). La sonde locale initiale a refusé
la clé (401) avant tout cas ; deux comparaisons ont ensuite été exécutées avec
la clé staging. Aucun secret n'a été exporté ni écrit dans ces artefacts.

Décision : garder la réduction du contrat pour le volume mesuré, sans annoncer
un gain de vitesse. Avant extension, qualifier au téléphone disponibilité,
réservation, échec, message, correction et épellation ; comparer les jalons du
premier contenu utile par contrat. Aucun déploiement dans cette passe.
