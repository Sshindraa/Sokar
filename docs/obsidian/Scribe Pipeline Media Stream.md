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
  (scribe_v2         (sonic-3.5)
   _realtime, fr)
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

| Aspect         | ai_config (actuel)                     | Media Stream (nouveau)                                  |
| -------------- | -------------------------------------- | ------------------------------------------------------- |
| STT            | Telnyx ai_config (boîte noire)         | ElevenLabs **Scribe** `scribe_v2_realtime` ✅ français  |
| Turn detection | Géré par Telnyx (boîte noire)          | VAD Scribe + événements normalisés `UtteranceStart/End` |
| Pipeline       | Géré par Telnyx (boîte noire)          | Géré par nous (contrôle total)                          |
| Barge-in       | Géré par Telnyx                        | `clear` message + state machine                         |
| Complexité     | Faible                                 | Élevée (notre code)                                     |
| Prix STT       | Dépend du fournisseur Telnyx ai_config | Voir le tarif ElevenLabs Scribe en vigueur              |

## Barge-in

Deux niveaux de détection :

1. **ElevenLabs Scribe** — envoie les transcripts partiels et engagés
2. **Telnyx WebSocket** — si on reçoit de l'audio `inbound` pendant le SPEAKING

Les deux déclenchent : `clear` du buffer audio Telnyx → transition SPEAKING → LISTENING

## Latence

| Optimisation        | Détail                                    |
| ------------------- | ----------------------------------------- |
| Codec L16           | Moins de transcodage que PCMU             |
| Partial transcripts | Spéculation LLM avant le commit de phrase |
| Chunks audio        | 20ms (standard téléphonie)                |
| Cartesia TTS        | Streaming SSE direct vers Telnyx          |

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
