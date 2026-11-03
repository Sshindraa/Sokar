# Audit du naturel de la conversation — 25 octobre 2026

Statut : diagnostic et propositions ; aucune modification du runtime dans cet audit.
Référence : code de #588, production `22546523`, appel déjà analysé `3d6e51c6`.
Objectif décidé par Hamza : perception d'une conversation humaine, en conservant une présentation honnête de l'assistant IA et l'exactitude métier.

## Périmètre et preuves

Revue transversale du parcours vocal actif : initialisation et accueil, audio entrant, Deepgram/Ink,
fin de tour, anticipation, dialogue structuré et garde-fous, actions, synthèse en contexte,
lecture Telnyx, interruptions, reprise, relances et évaluation. Les chemins historiques sont
distingués du chemin appelé en production. Ce n'est pas une certification ligne par ligne du
monorepo, du dashboard ou des systèmes externes. Les tests ne remplacent pas une écoute.

Vérifications nouvelles, en lecture seule :

- Appel `3d6e51c6` : `calls.tts_provider = elevenlabs-eleven_v4_turbo`,
  `llm_provider = openrouter`, `stt_provider = deepgram-nova-3`.
  Le champ STT de l'appel ne remplace pas la provenance du texte sélectionné par tour :
  l'hybride peut sélectionner Ink tout en gardant Deepgram pour clore le tour.
- Les clés ElevenLabs et Cartesia sont configurées dans l'environnement API.
  `context-tts.ts:40` choisit ElevenLabs avant Cartesia dès que sa clé existe.
  Attribuer les délais de synthèse de cet appel à Cartesia était donc incorrect.
- Suite API relancée : **415 fichiers réussis, 11 ignorés ; 4 566 tests réussis,
  80 ignorés**, sortie 0. Aucun appel fournisseur ni réservation réelle dans cette vérification.
- Trois sondes locales de fonctions pures confirment : une sortie `end_call`, claire et sûre
  selon le modèle, est autorisée depuis `humanFallback` ; un mot bref à confiance élevée
  passe la preuve d'interruption ; le premier fragment émis pour
  « Très bien, pour combien » est « Très bien, ».
  Ces sondes montrent des possibilités du code, pas leur fréquence dans les appels.

## Ce qui existe déjà et mérite d'être conservé

- Un seul contexte de synthèse par réponse, y compris plusieurs phrases : il ne faut pas
  proposer à nouveau cette architecture comme si elle manquait.
- Coupure rapide avec pause réversible ; annulation des générations périmées.
- Historique de la portion entendue après une interruption : alignement ElevenLabs quand
  disponible, estimation sinon. Ce n'est pas une preuve acoustique parfaite de réception.
- Faits de disponibilité contrôlés, confirmation avant création, protection des lettres épelées.
- Reprise courte après une parenthèse (#587), anticipation sur Ink complet et budget
  d'épellation déduit (#588), à qualifier ensemble au prochain appel.
- Adaptation du silence aux pauses observées de l'appelant. Elle existe déjà ; le travail
  supplémentaire consiste à coordonner contexte et temporisations.
- Style du restaurant et faits pratiques déjà injectés depuis `telnyx.pipeline.ts`.
  Plusieurs notes historiques les décrivent encore comme désactivés : suivre le code actif.

## 1. P0 — Donner une portée explicite aux refus et aux accords

Constat : `fact-guards.ts:725` reçoit l'état et la sortie du modèle, mais pas le texte de
l'appelant. Pour `end_call`, après les contrôles de confiance/compréhension, il autorise
l'action sans vérifier à quelle proposition le refus répond. Le prompt décrit cette
distinction, mais une mauvaise interprétation confiante reste exécutable. L'appel de référence
s'est terminé après un « non, pas besoin » dont la portée était ambiguë ; on ne peut pas
affirmer après coup que l'appelant voulait continuer.

Proposition : représenter la proposition en attente et la cible du refus/accord (transfert,
message, réservation, fin de conversation), en réutilisant `lastAwaiting` et l'état existant.
Un refus d'une proposition secondaire revient à l'objectif principal. Un abandon explicite
reste immédiatement respecté. Si la portée est réellement indécidable, une seule question
de clarification, sans nouvelle relecture complète.

Exemple cible : proposition de transfert → « Non, pas besoin » → reprise de la réservation,
si c'est bien le contexte ; « Non, laissez tomber la réservation » → fin de l'appel.
Éviter une règle lexicale globale « non = continuer » ou « merci = raccrocher ».

Validation : mêmes mots dans plusieurs contextes, avec corrections et abandon explicite ;
aucune création ou fermeture déduite d'un accord donné à une autre proposition.

## 2. P0 — Distinguer l'écoute de la prise de parole

Constat : `stt-bridge.ts:1028` coupe le TTS dès qu'une transcription passe les filtres de
signal/écho/preuve. Ces filtres vérifient qu'il y a de la parole, pas si c'est un simple
« oui, je vous écoute ». La classification historique de `conversation-controller.ts`
n'est pas la politique de dialogue appelée par `processTranscriptStreaming`.
La pause rapide de `fast-barge-in.ts` est déjà une bonne base : 80 ms de voix, confirmation
par défaut à 500 ms, puis reprise ou coupure.

Proposition : conserver la pause réversible, différer l'annulation irréversible pour un
acquiescement ambigu, utiliser le segment en cours et la question effectivement entendue.
Une correction, une demande d'arrêt ou une vraie question doit conserver la coupure rapide.
Un oui répondant au récapitulatif entendu reste un accord à traiter. Le même mot au milieu
d'une explication peut n'être qu'un signal d'écoute.

Validation audio : oui pendant une explication, oui à une question, non correctif, voix faible,
bruit, écho, épellation. Mesurer reprise audible et mots perdus, pas seulement le nombre de coupures.

## 3. P1 — Unifier les consignes et réduire les confirmations inutiles

Constat : les interdictions de répétition existent déjà dans `prompts.ts:194` et
`structured-turn/prompt.ts:29`. Elles ne garantissent pas la pertinence de l'enchaînement.
Il existe aussi une contradiction concrète : le prompt commun demande la date complète au
récapitulatif (`prompts.ts:197`), le prompt structuré demande le jour proche seul, sans date
complète (`prompt.ts:31`). Après une épellation, le parcours peut demander un accord sur les
lettres puis un autre sur le récapitulatif ; ces deux étapes sont actuellement explicites.

Proposition : une source commune de règles de formulation et de récapitulatif, avec les
contraintes métier gardées côté code. Évaluer la formulation sur des échanges complets :
réponse à la question posée, progression, absence de redemande d'une valeur acquise,
réaction appropriée à une correction. Ne pas remplacer les répétitions par une rotation
automatique de synonymes. Ne pas imposer une phrase ultracourte quand une explication aide.

Pour les noms, garder la vérification des lettres quand l'appelant épelle ou corrige ;
étudier la fusion d'une confirmation de nom et du récapitulatif uniquement quand aucun doute
ne subsiste et que tous les faits ont été entendus. C'est une évolution distincte à tester,
pas une suppression immédiate du garde-fou.

## 4. P1 — Choisir les segments audio pour leur intonation

Constat : `say-stream.ts:78` émet le début de la première phrase à sa première virgule sûre
(minimum six caractères, sans chiffre ni lettre isolée). Le chemin ElevenLabs active cette
option dans `engine.ts:559`, puis force la génération du segment. Le contexte TTS est continu,
mais forcer « Très bien, » séparément peut produire un départ artificiel ou une pause si la
suite n'arrive pas assez tôt. C'est un risque à écouter, pas un défaut acoustique prouvé par
la seule lecture du code. Le banc `voice-tts-bench/early-phrase.ts` existe déjà.

Proposition : comparer le comportement actuel à une première unité de sens complète, et à un
regroupement des petits acquiescements avec la suite. Réutiliser le banc existant avec des
phrases représentatives, le fournisseur/voix réellement actifs et les mêmes rythmes d'arrivée
du modèle. Conserver les lettres, noms et horaires en unités protégées. N'ajouter ni émotion
systématique ni hésitations simulées : les réglages expressifs doivent gagner à l'écoute.

Ajouter des mesures de sous-alimentation et de durée des trous au milieu de la réponse.
Un premier son plus tôt n'est pas un succès si la phrase devient saccadée.

## 5. P1 — Coordonner les attentes selon la situation

Constat : plusieurs protections interviennent à des moments différents : silence local
600 ms par défaut, adaptation 350–1 100 ms après assez de pauses, garde forcée 350 ms ou
1 200 ms pendant une épellation, budget d'épellation 800 ms avec grâce tardive, juge borné
à 800 ms, désaccord traité après 1 200 ms de silence, dernier contrôle avant audio à 600 ms.
Ces durées se recouvrent : **leur somme n'est pas la latence de l'appel**.

Proposition : exposer une décision commune par tour fondée sur l'horloge audio et le contexte :
réponse attendue complète, recherche de mots, correction commencée, épellation, bruit.
Les protections gardent leur rôle ; la décision permet d'expliquer toute attente résiduelle
et d'éviter un second budget déjà écoulé. Réduire seulement les attentes démontrées superflues,
sur un corpus incluant des personnes lentes et des hésitations. Ne pas baisser tous les seuils.

Suivre p50/p90 du premier contenu utile, faux départs, personnes coupées, tours repris et
blancs internes. Le « premier audio », qui peut être un son d'attente, est un indicateur distinct.

## 6. P2 — Simplifier la génération sans perdre le raisonnement utile

Constat : le modèle génère sa compréhension, le brouillon complet et la décision avant `say`.
Un second passage après action reconstruit aussi une sortie structurée. Le délai avant la
parole sert en partie à ces données et aux contrôles. Les sondes précédentes distinguent
201–224 ms de préfixe JSON sur trois requêtes synthétiques ; cela ne prouve pas le même coût
sur tous les vrais tours.

Proposition : commencer par un contrat réduit après une action déjà exécutée, avec adaptation
interne vers l'état existant ; mesurer avant d'alléger le premier passage. Garder le contrôle
des faits avant leur annonce. Une disponibilité ou une réservation ne peut pas être annoncée
sur une simple intention. Suivre les anticipations reprises, les secondes passes et les tokens
abandonnés avant de lancer davantage de requêtes ou de changer de modèle.

## 7. Condition de réussite — Une recette du naturel sur l'audio

Le banc `behavior-eval` vérifie déjà les faits, les décisions, les répétitions et certaines
longueurs. Les rapports d'appels mesurent silences, chevauchements et erreurs d'écoute.
Ces outils constituent une base ; leurs sorties ne sont pas une note humaine de naturel.

Constituer 20 à 30 échanges, puis des appels complets : réservation simple, question pratique
pendant la réservation, indisponibilité, nom clair, épellation lente, correction, acquiescement,
refus de transfert, abandon explicite, bruit et reprise après silence.

Comparer les versions en ordre aléatoire, sans annoncer laquelle est nouvelle. Noter séparément :
écoute et continuité, adéquation de la réponse, rythme, intonation, exactitude et réussite.
Conserver des cas de contrôle qui n'ont pas servi à régler la version. Les formulations peuvent
varier ; l'intention, les faits et le comportement attendu doivent rester comparables.

Critères proposés avant extension : aucune erreur critique de réservation sur la recette,
aucun abandon explicite ignoré, aucun refus de transfert transformé en abandon dans les cas
sans ambiguïté, meilleure préférence d'écoute, pas de hausse des coupures et des trous audio.
Une préférence calculée sur 20 cas est exploratoire, pas une preuve statistique de généralisation.

## Ordre de travail recommandé

1. Établir le corpus et enregistrer la référence actuelle ; traiter la portée des refus et les
   acquiescements qui détruisent la continuité. Deux changements séparés et comparables.
2. Unifier les consignes, qualifier les confirmations, comparer le découpage prosodique.
3. Coordonner les attentes sur les traces audio, puis alléger les passages du modèle.
4. Recette téléphonique contrôlée avant extension. Aucun changement de fournisseur ou de voix
   n'est justifié par cet audit seul. Aucun gain téléphonique supplémentaire n'est annoncé.

L'ancien plan de juillet décrit plusieurs composants déjà remplacés. Il reste historique ;
les priorités ci-dessus suivent le chemin exécuté et l'objectif actuel de Hamza.
