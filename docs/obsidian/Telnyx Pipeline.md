# Telnyx Pipeline

**Dernière mise à jour** : Mai 2025
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

| Étape | Provider | Modèle | Détail |
|-------|----------|--------|--------|
| **STT** | Deepgram | `nova-3` | Langue `fr`, endpointing 300ms, utterance_end_ms 1000ms |
| **LLM** | OpenRouter | `deepseek/deepseek-v4-flash` (default) ou PRO si VIP | System prompt + conversation turns |
| **TTS** | ElevenLabs | Voice ID depuis `ctx.personality.voiceIdEl` | Chunk on `.`, `!`, `?`, min_chunk_length 4 |
| **First utterance** | — | — | `"Bonjour, ${ctx.name}..."` |

---

## Pipeline Vocal Complet

```
[Appelant parle]
      │
      ▼
┌─────────────────┐
│   Deepgram STT   │  ← nova-3, français, endpointing 300ms
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
│  ElevenLabs TTS  │  ← synthèse vocale
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

| De | Vers | Condition |
|----|------|-----------|
| IDLE | LISTENING | VAD: speech start |
| LISTENING | IDLE | VAD: end, pas besoin LLM |
| LISTENING | PROCESSING | VAD: end, requête LLM |
| PROCESSING | SPEAKING | TTS first byte reçu |
| SPEAKING | LISTENING | TTS playback terminé |
| * | IDLE | Call hangup |

---

## Routes Webhook Telnyx

### `POST /voice/telnyx` — `call.initiated`
Point d'entrée. Charge contexte, vérifie circuit breaker, associe client, retourne `ai_config`.

### `POST /voice/telnyx/function-call` — Tool execution
Exécute les fonctions appelées par le LLM :

| Tool | Paramètres | Description |
|------|-----------|-------------|
| `createReservation` | date, time, partySize (1-7), customerName, customerPhone | Crée une réservation. >= 8 → auto-handoff |
| `checkAvailability` | date, time, partySize | Vérifie créneaux dispo |
| `getOpeningHours` | — | Retourne horaires formatés |
| `handoffToManager` | — | SMS alert au manager |

Tous les retours sont en français (lus par TTS).

### `POST /voice/telnyx/end` — Fin d'appel
Reçoit : `call_leg_id`, `transcript`, `ended_reason`, `started_at`, `ended_at`, `stt_provider`, `llm_provider`, `tts_provider`.

Met à jour le Call record avec durée, transcript, outcome, provider info, flag carrier.

> **Attention** : `call.hangup` Telnyx event arrive *avant* le webhook `/end`. Utiliser `/end` pour les stats finales, `hangup` pour les actions temps réel.

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

| Niveau | Clé Redis | Action |
|--------|-----------|--------|
| Mensuel | `infra:calls:<id>:<YYYY-MM>` | Sentry warning au threshold |
| Horaire | `infra:calls:<id>:<YYYY-MM-DD-HH>` | Bloque l'appel si dépassé |

Les counters expirent automatiquement via TTL Redis.

---

## Détection d'Outcome

`detectOutcome(call)` → `CallOutcome` :

| Outcome | Condition |
|---------|-----------|
| `RESERVED` | Transcript match confirmation réservation |
| `HANDOFF` | `endedReason === 'transfer'` |
| `ERROR` | `endedReason === 'error'` |
| `INFO` | Transcript mentionne horaires |
| `NO_ACTION` | Fallback |

---

## Filler Words

Trois styles de phrases d'attente selon `FillerStyle` :

| Style | Ton | Exemple |
|-------|-----|---------|
| CASUAL | Détendu | "Je regarde ça..." |
| FORMAL | Poli | "Veuillez patienter un instant..." |
| WARM | Amical | "Pas de souci, je regarde ça !" |

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

Voir aussi : [[Architecture]], [[Sprint 1#Pipeline Vocal]]