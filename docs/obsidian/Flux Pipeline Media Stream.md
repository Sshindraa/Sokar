# Flux Pipeline — Deepgram STT via Telnyx Media Stream

**Statut** : ⚡ Nouveau — parallèle au pipeline AI config existant
**Déclencheur** : `FLUX_ENABLED=true`
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
       │ FLUX_ENABLED?   │
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
  Deepgram Flux     Cartesia TTS
  (flux-general      (sonic-3.5)
   -multi, fr)
       │                 │
       ▼                 ▼
  Transcript → LLM → Texte → TTS audio
                               │
                               ▼
                       Retour à Telnyx
                       via WS bidirectionnel
```

## Fichiers créés

| Fichier                     | Rôle                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `stream/types.ts`           | Types : CallSession, FluxEvent, TelnyxStreamMessage, états            |
| `stream/manager.ts`         | CallSessionManager — cycle de vie, state machine, barge-in, appel LLM |
| `stream/deepgram-bridge.ts` | Pont WebSocket Telnyx ↔ Deepgram Flux, parsing des événements         |
| `stream/handler.ts`         | Route WS `/voice/stream/:callId`, orchestration complète pipeline     |

## Flux Media Stream vs AI Config

| Aspect         | ai_config (actuel)                                  | Media Stream (nouveau)                             |
| -------------- | --------------------------------------------------- | -------------------------------------------------- |
| STT            | Deepgram Nova-3 (English-only Flux)                 | Deepgram **Flux** `flux-general-multi` ✅ français |
| Turn detection | `endpointing: 300` + `utterance_end_ms: 1000` (VAD) | **Natif** dans Flux — UtteranceStart/End           |
| Pipeline       | Géré par Telnyx (boîte noire)                       | Géré par nous (contrôle total)                     |
| Barge-in       | Géré par Telnyx                                     | `clear` message + state machine                    |
| Complexité     | Faible                                              | Élevée (notre code)                                |
| Prix STT       | $0.0058/min (Nova-3 multi)                          | $0.0065/min (Flux multi)                           |

## Barge-in

Deux niveaux de détection :

1. **Deepgram Flux** — envoie `UtteranceStart` quand le caller parle
2. **Telnyx WebSocket** — si on reçoit de l'audio `inbound` pendant le SPEAKING

Les deux déclenchent : `clear` du buffer audio Telnyx → transition SPEAKING → LISTENING

## Latence

| Optimisation   | Détail                              |
| -------------- | ----------------------------------- |
| Codec L16      | Moins de transcodage que PCMU       |
| Flux eager EOT | Spéculation LLM avant fin de phrase |
| Chunks audio   | 20ms (standard téléphonie)          |
| Cartesia TTS   | Streaming SSE direct vers Telnyx    |

## Comment tester

```bash
# Activer le pipeline Flux
export FLUX_ENABLED=true

# Lancer l'API
pnpm dev
```

Telnyx utilisera le media streaming au lieu du `ai_config` pour les appels entrants.

## ⚠️ Points d'attention

- Le `call.initiated` webhook crée une session vide (sans WS encore). Le WS est connecté ensuite par Telnyx
- Si Deepgram n'est pas prêt, les premiers chunks audio sont bufferisés
- Flux ne supporte pas le smart formatting (le LLM doit parser les dates/tél)
- Vérifier que `DEEPGRAM_API_KEY` et `CARTESIA_API_KEY` sont dans le .env

## Liens

- [[Telnyx Pipeline]] — Pipeline AI config existant
- Deepgram STT — Modèles et prix dans la doc Deepgram (pas de note dédiée dans le vault)
