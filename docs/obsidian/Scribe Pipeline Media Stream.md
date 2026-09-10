# Scribe Pipeline — ElevenLabs STT via Telnyx Media Stream

**Statut** : pipeline Media Stream actif pour les appels Telnyx configurés sur `/voice/stream/:callId`
**Code** : `apps/api/src/modules/voice/stream/`

---

## Architecture

```
Appel → Telnyx call.initiated
                │
                ▼
      POST /voice/telnyx
                │
       ┌────────┴────────┐
       │ Media Stream ?  │
       └────────┬────────┘
          OUI   │   NON
                ▼          ▼
         Media Stream    ai_config
         via WebSocket   (existant)
                │
                ▼
      Telnyx → WS → Notre serveur
                │
       ┌────────┴────────┐
       │  forward audio  │
       ▼                 ▼
  ElevenLabs Scribe  Cartesia TTS
  (scribe_v2         (sonic-3.6)
   _realtime, auto)
       │                 │
       ▼                 ▼
  Transcript → LLM → Texte → TTS audio
                               │
                               ▼
                       Retour à Telnyx
                       via WS bidirectionnel
```

## Fichiers créés

| Fichier                | Rôle                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `stream/types.ts`      | Types : CallSession, SttEvent, TelnyxStreamMessage, états             |
| `stream/manager.ts`    | CallSessionManager — cycle de vie, state machine, barge-in, appel LLM |
| `stream/stt-bridge.ts` | Pont WebSocket Telnyx ↔ ElevenLabs Scribe, parsing des événements     |
| `stream/handler.ts`    | Route WS `/voice/stream/:callId`, orchestration complète pipeline     |

## Media Stream vs AI Config

| Aspect         | ai_config (actuel)                     | Media Stream (nouveau)                                                               |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| STT            | Telnyx ai_config (boîte noire)         | ElevenLabs **Scribe** `scribe_v2_realtime` ✅ détection fr/en + langues touristiques |
| Turn detection | Géré par Telnyx (boîte noire)          | VAD Scribe + événements normalisés `UtteranceStart/End`                              |
| Pipeline       | Géré par Telnyx (boîte noire)          | Géré par nous (contrôle total)                                                       |
| Barge-in       | Géré par Telnyx                        | `clear` message + state machine                                                      |
| Complexité     | Faible                                 | Élevée (notre code)                                                                  |
| Prix STT       | Dépend du fournisseur Telnyx ai_config | Voir le tarif ElevenLabs Scribe en vigueur                                           |

## Barge-in

Deux niveaux de détection :

1. **ElevenLabs Scribe** — envoie les transcripts partiels et engagés
2. **Telnyx WebSocket** — si on reçoit de l'audio `inbound` pendant le SPEAKING

Les deux déclenchent : `clear` du buffer audio Telnyx → transition SPEAKING → LISTENING

## Configuration Scribe Realtime

- `language_code` est laissé automatique ; `secondary_languages` cible par défaut `fr,en,es,it,de,pt,nl` et `include_language_detection=true` renvoie la langue détectée sur le segment final.
- Les mots-clés génériques de réservation couvrent les sept langues activées et sont complétés en priorité par le nom du restaurant, dans les limites ElevenLabs (50 termes de 20 caractères maximum).
- `previous_text` est transmis uniquement avec le premier paquet audio de chaque socket, avec un contexte bilingue de réservation de moins de 50 caractères.
- Quand Scribe envoie `committed_transcript` puis `committed_transcript_with_timestamps`, le bridge ne déclenche le tour LLM qu'une seule fois ; un repli temporisé couvre l'absence du second événement.
- Les avertissements, entités et erreurs documentées Scribe sont journalisés sans écrire de données sensibles dans les logs. La détection d'entités et le filtrage audio restent désactivés par défaut.

La liste peut être surchargée par `ELEVENLABS_STT_LANGUAGES` (CSV de codes ISO-639-1/3). Le mode `ELEVENLABS_STT_ALL_LANGUAGES=true` active les 44 langues Sonic 3.6 ; il reste opt-in tant que les réponses déterministes et les voix n'ont pas été validées par langue. Scribe indique que `secondary_languages` fiabilise la détection en limitant les langues candidates.

## Routage de langue du dialogue

- À chaque `UtteranceEnd`, `language_code` est normalisé en code Cartesia et mémorisé dans `CallSession.voiceLanguageCode`. Le français reste la valeur initiale tant qu'aucun segment final n'a été détecté.
- Le manager LLM ajoute une consigne système volatile : il doit comprendre et raisonner dans la langue active, puis répondre exclusivement dans cette langue. Cette consigne n'est pas recopiée dans l'historique métier.
- Les réponses déterministes (disponibilité, progression de réservation, nom, présence, repli fournisseur et fin d'appel) suivent également la langue française ou anglaise active.
- Cartesia reçoit `locale` (jamais `language` en même temps), `normalization=auto` et les réglages de génération sur les appels HTTP et WebSocket Context V2. Le cache audio inclut la locale, la voix, le modèle, le codec, les réglages et le dictionnaire afin qu'une phrase identique en français et en anglais ne partage jamais le même buffer.
- Le fallback TTS natif utilise `fr-FR` ou `en-US` et adapte le message technique. Une nouvelle détection sur un segment ultérieur peut faire évoluer la langue de la session.

## Latence

| Optimisation        | Détail                                                  |
| ------------------- | ------------------------------------------------------- |
| Codec L16           | Moins de transcodage que PCMU                           |
| Partial transcripts | Spéculation LLM avant le commit de phrase               |
| Chunks audio        | Cadence Telnyx à mesurer ; Scribe recommande 100 ms–1 s |
| Cartesia TTS        | Streaming SSE direct vers Telnyx                        |

## Comment tester

```bash
# Le pipeline Media Stream est activé par la configuration du numéro Telnyx.
# Vérifier que l'URL WebSocket publique pointe vers /voice/stream/:callId.

# Lancer l'API
pnpm dev
```

Telnyx utilisera le media streaming au lieu du `ai_config` pour les appels entrants.

## ⚠️ Points d'attention

- Le `call.initiated` webhook crée une session vide (sans WS encore). Le WS est connecté ensuite par Telnyx
- Si ElevenLabs n'est pas prêt, les premiers chunks audio sont bufferisés
- Le bridge normalise les transcripts Scribe (le LLM parse les dates et téléphones)
- Vérifier que `ELEVENLABS_API_KEY` et `CARTESIA_API_KEY` sont dans le .env

## Liens

- [[Telnyx Pipeline]] — Pipeline Telnyx entrant
- ElevenLabs STT — Modèles et prix dans la doc ElevenLabs (pas de note dédiée dans le vault)
