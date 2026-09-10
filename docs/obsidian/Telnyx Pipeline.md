# Telnyx Pipeline

**Dernière mise à jour** : Mai 2026
**Carrier** : Telnyx (production)
**Code** : `apps/api/src/modules/voice/telnyx.pipeline.ts`

---

## Flux Appel Entrant

```
Appel Telnyx
    │
    ▼
POST /voice/telnyx  ← call.initiated webhook
    │
    ├── 1. Load restaurant context via `RestaurantService.loadContext(to)`
    │       └── Cache Redis `phone:<number>` (TTL 1h)
    │
    ├── 2. Circuit breaker via `checkMarginHealth(ctx.id)`
    │       └── Bloque si quota horaire dépassé
    │
    ├── 3. Lookup/création client via `CustomerService.lookupOrCreate(ctx.id, from)`
    │
    ├── 4. [Optionnel] VIP push alert via BullMQ si `VIP_PUSH_ENABLED=true`
    │
    ├── 5. Build system prompt (greeting + restaurant + horaires + tools)
    │
    └── 6. Retourne `ai_config` à Telnyx
```

### ai_config retourné à Telnyx

| Étape               | Provider                               | Modèle                                                       | Détail                                                                                  |
| ------------------- | -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **STT**             | Telnyx ai_config / Scribe Media Stream | `scribe_v2_realtime` en Media Stream                         | La route Media Stream envoie PCMU en `ulaw_8000` et convertit PCMA en `pcm_8000`        |
| **LLM**             | OpenRouter                             | `deepseek/deepseek-v4-flash` (default) ou PRO si VIP         | System prompt + conversation turns                                                      |
| **TTS**             | Cartesia                               | `sonic-3.5` + Katie (`f786b574-daa5-4673-aa0c-cbe3e8534c02`) | Chunk on `.`, `!`, `?`, min_chunk_length 4. Voice ID depuis `ctx.personality.voiceIdCa` |
| **First utterance** | —                                      | —                                                            | `"Bonjour, ${ctx.name}..."`                                                             |

> ⚠️ **Limitation sonic-3.5** : les contrôles de `speed` et `volume` sont désactivés temporairement sur sonic-3.5 (depuis avril 2026, cf doc Cartesia). Le champ `speakingRate` dans `AgentPersonality` n'a pas d'effet tant que cette limitation est en place. Pour utiliser speed/volume, il faudrait revenir à `sonic-3` (snapshotté) ou attendre la réactivation par Cartesia.

---

## Pipeline Vocal Complet

```
[Appelant parle]
      │
      ▼
┌─────────────────┐
│   ElevenLabs Scribe │  ← scribe_v2_realtime, français, VAD
│   (transcription)│
└────────┬────────┘
         │ utterances textuelles
         ▼
┌─────────────────┐
│   OpenRouter LLM  │  ← decision + tool calls
│   (fonction appel)│
└────────┬────────┘
         │ réponse textuelle
         ▼
┌─────────────────┐
│  Cartesia Sonic 3.5 TTS  │  ← synthèse vocale
│   (audio stream) │
└────────┬────────┘
         │ audio chunks
         ▼
┌─────────────────┐
│   Telnyx Media   │  ← lecture à l'appelant
│   (play audio)   │
└─────────────────┘
```

---

## Machine à États

`AgentStateMachine` dans `agent-state.ts` — remplace les flags booléens.

```
IDLE ──► LISTENING ──► PROCESSING ──► SPEAKING ──► LISTENING (loop)
 │                                                       │
 └────────────────────── IDLE ◄──────────────────────────┘
                                  (call end → hangup)
```

Transitions :

| De         | Vers       | Condition                |
| ---------- | ---------- | ------------------------ |
| IDLE       | LISTENING  | VAD: speech start        |
| LISTENING  | IDLE       | VAD: end, pas besoin LLM |
| LISTENING  | PROCESSING | VAD: end, requête LLM    |
| PROCESSING | SPEAKING   | TTS first byte reçu      |
| SPEAKING   | LISTENING  | TTS playback terminé     |
| \*         | IDLE       | Call hangup              |

---

## Routes Webhook Telnyx

### `POST /voice/telnyx` — `call.initiated`

Point d'entrée. Charge contexte, vérifie circuit breaker, associe client, retourne `ai_config`.

### `POST /voice/telnyx/end` — Fin d'appel

Reçoit : `call_leg_id`, `transcript`, `ended_reason`, `started_at`, `ended_at`, `stt_provider`, `llm_provider`, `tts_provider`.

Met à jour le Call record avec durée, transcript, outcome, provider info, flag carrier.

> **Attention** : `call.hangup` Telnyx event arrive _avant_ le webhook `/end`. Utiliser `/end` pour les stats finales, `hangup` pour les actions temps réel.

---

## Sélection du Modèle LLM

```typescript
function selectLlmModel(isVip: boolean, turnCount: number): string {
  if (isVip || turnCount > LLM_VIP_TURN_THRESHOLD) return LLM_MODELS.PRO;
  return LLM_MODELS.FLASH;
}
```

- **FLASH** : `deepseek/deepseek-v4-flash` (défaut, rapide/économique)
- **PRO** : Modèle premium pour clients VIP ou conversations longues
- Configuré dans `@sokar/config`

---

## Cache TTS

SHA-256 du hash `text + voiceId` comme clé Redis :

```
clé: tts:<hash:16>
TTL: configurable (TTS_CACHE_TTL_SECONDS)
```

- Activé via `TTS_CACHE_ENABLED=true`
- Skip les phrases < `TTS_CACHE_MIN_LENGTH`
- Warmup au démarrage via `WARMUP_PHRASES`

---

## Circuit Breaker

Deux niveaux de rate limiting via Redis counters :

| Niveau  | Clé Redis                          | Action                      |
| ------- | ---------------------------------- | --------------------------- |
| Mensuel | `infra:calls:<id>:<YYYY-MM>`       | Sentry warning au threshold |
| Horaire | `infra:calls:<id>:<YYYY-MM-DD-HH>` | Bloque l'appel si dépassé   |

Les counters expirent automatiquement via TTL Redis.

---

## Détection d'Outcome

`detectOutcome(call)` → `CallOutcome` :

| Outcome     | Condition                                 |
| ----------- | ----------------------------------------- |
| `RESERVED`  | Transcript match confirmation réservation |
| `HANDOFF`   | `endedReason === 'transfer'`              |
| `ERROR`     | `endedReason === 'error'`                 |
| `INFO`      | Transcript mentionne horaires             |
| `NO_ACTION` | Fallback                                  |

---

## Filler Words

Trois styles de phrases d'attente selon `FillerStyle` :

| Style  | Ton     | Exemple                            |
| ------ | ------- | ---------------------------------- |
| CASUAL | Détendu | "Je regarde ça..."                 |
| FORMAL | Poli    | "Veuillez patienter un instant..." |
| WARM   | Amical  | "Pas de souci, je regarde ça !"    |

---

## Architecture Fichiers

```
apps/api/src/modules/voice/
├── telnyx.pipeline.ts    # Routes Telnyx (incoming, function-call, end)
├── agent-state.ts        # AgentStateMachine
├── prompts.ts            # buildSystemPrompt, formatOpeningHours
├── tools.ts              # Function definitions (createReservation, etc.)
├── outcome.ts            # detectOutcome
├── fillers.ts            # Filler words
├── tts-cache.ts          # Cache SHA-256 Redis
├── telnyx.guard.ts       # Signature ED25519 guard
└── pipeline.ts           # Vapi pipeline legacy
```

Voir aussi : [[Architecture]] (section Voice Pipeline)

2026-09-04 14:08 — [voice, confirmation, closing] **Corrections de dialogue préparées pour test téléphonique** — Branche isolée `codex/voice-confirmation-closing` depuis `origin/main@28f5bfa`, intégrant les améliorations locales d’épellation/STT. La première question termine la réponse LLM (stream primaire, fallback et non-streaming) avant toute suite ou outil du même tour. Une clôture explicite du client passe en `CLOSING`, annule génération/spéculation, ignore les nouveaux transcripts, attend le mark Telnyx (ou le webhook TTS natif) avant hangup idempotent ; timeout borné et retry réseau. Un simple merci garde l’appel ouvert ; un court transcript ambigu après le départ demande clarification. Disponibilité annoncée explicitement. Vérification : suite vocale 429/429, typecheck et lint sans erreur ; test audio réel et déploiement encore à effectuer. Aucun changement de voix, de modèle ou de schéma.
2026-09-04 14:55 — [voice, analysis, name-spelling] **Régression d’épellation identifiée après test Henri** — Le dernier appel a confirmé l’alternative 12h30, mais une transcription STT bruitée a permis au LLM de confirmer « A D K I F » malgré « Non ». Le parseur reconnaît maintenant « en nombre de actifs », les corrections « non, … » et « A deux K I F » ; les keyterms STT incluent `deux k` et `double k`. Tests ciblés : 171/171 ; typecheck API et formatage OK. Déploiement contrôlé à réaliser.
