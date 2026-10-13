# Qualification de la démonstration vocale (VOICE-01)

**Date de préparation** : 13/10/2026. **Statut** : non exécutée. Aucun appel n'a été passé. Aucun
résultat ne figure dans cette fiche tant qu'un essai réel n'a pas été joué et consigné.

## 1. Périmètre

Cette fiche qualifie le résultat métier d'un appel traité par le pipeline de production, avec les
vrais fournisseurs : téléphonie Telnyx, STT (`VOICE_STT_PROVIDER`, ElevenLabs par défaut), LLM
(`VOICE_LLM_PROVIDER`, `VOICE_LLM_MODEL`) et TTS Cartesia. Le résultat se lit dans le dashboard du
restaurant de test, pas seulement à l'écoute.

Elle ne qualifie pas :

- l'animation et les maquettes de la page d'accueil ;
- la lecture TTS d'un script ;
- la démonstration en direct de l'onboarding, qui exige un compte restaurateur authentifié.

Le niveau de preuve de chaque dispositif est décrit à la section 4 du
[rapport de qualification](2026-10-13-growth-execution.md).

## 2. Prérequis à vérifier avant chaque session

| Prérequis                                                                                                                                                                         | Responsable               | Contrôle                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| Restaurant de test sur staging, sans établissement client ni donnée client                                                                                                        | Équipe technique          | Identifiant opaque consigné dans le journal des essais                      |
| Numéro de test Telnyx routé vers ce restaurant de test uniquement                                                                                                                 | Équipe technique          | L'appel reçoit la réponse de l'assistant ; aucun renvoi vers un numéro réel |
| Appelant disposant du numéro de test                                                                                                                                              | Hamza ou équipe technique | Numéro non publié, ni dans le dépôt ni dans les captures                    |
| Environnement, commit déployé et valeurs des variables `VOICE_*` relevés au moment de l'essai (noms dans `apps/api/.env.example`)                                                 | Équipe technique          | Ligne complète dans le journal des essais                                   |
| Accès en lecture au dashboard du restaurant de test, pour lire les réservations créées                                                                                            | Hamza ou équipe technique | Relevé de la réservation (identifiant opaque, créneau, effectif, statut)    |
| Rejeux LLM : la clé Cerebras sert aussi la production. Aucun rejeu sans plafond de requêtes et contrôle du solde (voir l'en-tête de `apps/api/scripts/voice-behavior-replay.mjs`) | Équipe technique          | Plafond consigné avant le lancement                                         |

## 3. Scénarios

Les sept scénarios du plan (section 7) sont à jouer dans cet ordre. Le résultat attendu est un
résultat métier, vérifié dans le dashboard.

| #   | Scénario                       | Déroulé de l'appelant                                                                       | Résultat métier attendu                                                             |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Demande simple                 | Demande une table pour un nombre de personnes à un créneau libre, puis répond aux questions | Une seule réservation, avec le créneau, l'effectif et les informations exacts       |
| 2   | Changement pendant l'appel     | Annonce une demande, puis la modifie (heure ou effectif) avant la fin                       | La demande finale remplace l'intention précédente ; une seule réservation exacte    |
| 3   | Restaurant complet             | Demande un créneau déjà saturé                                                              | Aucune réservation créée ; réponse et alternative cohérentes                        |
| 4   | Nom ou heure ambigus           | Donne un prénom seul ou une heure imprécise (« vers huit heures »)                          | Clarification avant toute écriture ; aucune réservation prématurée                  |
| 5   | Question pratique              | Pose une question hors réservation (accès, allergènes, parking)                             | Information vérifiée, ou transfert ou solution de secours ; aucune réponse inventée |
| 6   | Reprise ou répétition          | Rappelle, ou répète la demande après la fin du premier appel                                | Pas de doublon ; l'appel et le dashboard concordent                                 |
| 7   | Service ou fournisseur dégradé | Dégradation contrôlée décidée par l'équipe technique, en staging uniquement                 | Secours réel, comportement annoncé, aucune perte silencieuse de demande             |

Le scénario 7 n'est joué qu'en staging, avec une coupure décidée et consignée à l'avance. Il ne
se joue jamais en production.

## 4. Règles de calcul

- **Dénominateur** : tous les essais joués, y compris les échecs, les coupures et les incidents
  techniques. Ne jamais ne retenir que les essais réussis.
- **Essai annulé pour une raison de test** (numéro mal routé, coupure réseau côté appelant) : consigné
  à part avec son motif. Il ne compte ni comme réussite ni comme échec, mais il reste visible.
- **Lecture** : le résultat est validé par le relevé de réservation dans le dashboard, pas par
  l'audio seul.
- **Un essai isolé** s'affiche comme un cas observé, jamais comme un taux.
- **Mise à jour** : rejouer les sept scénarios après tout changement significatif du pipeline voix
  (STT, LLM, TTS, prompts, variables `VOICE_*`).

## 5. Preuves à archiver

- **Audio** : enregistré pour usage de test, anonymisé avant tout archivage public.
- **Transcription** : texte horodaté, sans numéro, nom ni adresse réels.
- **Relevé de réservation** : identifiant opaque, créneau, effectif, statut.
- **Ligne du journal** : date (UTC), environnement, commit, scénario, essai, résultat, motif en cas
  d'échec.

Aucune de ces preuves ne contient de donnée personnelle. Aucune n'est versée dans le dépôt sans
anonymisation préalable.

## 6. Critère de sortie

La démonstration est qualifiée lorsque :

- les sept scénarios ont été joués, dénominateur complet à l'appui ;
- la réservation finale est exacte dans le dashboard pour chaque scénario qui doit en créer une ;
- les limites et le secours sont compris et écrits dans la fiche ;
- aucun défaut bloquant n'est ouvert selon le runbook pilote.

## 7. État actuel

- **Essais** : 0 sur 7 scénarios. Aucun appel passé.
- **Dépendances réelles** :

| Dépendance                                                                           | Responsable               | Conséquence si elle manque              |
| ------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------- |
| Restaurant de test sur staging et numéro de test routé vers lui                      | Équipe technique          | Aucun appel possible                    |
| Appelant disposant du numéro de test                                                 | Hamza ou équipe technique | Aucun scénario joué                     |
| Compte restaurateur de test (uniquement si la démonstration en direct est qualifiée) | Hamza                     | Démonstration en direct non qualifiable |

Search Console n'est pas une dépendance de cette qualification.

## 8. Journal des essais

| Date (UTC) | Environnement | Commit | Scénario | Essai | Résultat | Preuve | Motif si échec |
| ---------- | ------------- | ------ | -------- | ----- | -------- | ------ | -------------- |
| —          | —             | —      | —        | —     | —        | —      | —              |
