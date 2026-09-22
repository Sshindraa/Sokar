# Telnyx Pipeline

**Dernière mise à jour** : 22 septembre 2026
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
| **LLM**             | Groq OpenAI-compatible                 | `qwen/qwen3.8-27b`                                           | System prompt + conversation turns ; aucun repli de modèle                              |
| **TTS**             | Cartesia                               | `sonic-3.6` + Katie (`f786b574-daa5-4673-aa0c-cbe3e8534c02`) | Chunk on `.`, `!`, `?`, min_chunk_length 4. Voice ID depuis `ctx.personality.voiceIdCa` |
| **First utterance** | —                                      | —                                                            | `"Bonjour, ${ctx.name}..."`                                                             |

> **Version TTS** : le pipeline suit l'alias stable continu `sonic-3.6` afin de recevoir les snapshots stables les plus récents. Si un comportement strictement reproductible devient nécessaire, revenir à un snapshot daté et mettre à jour les clés de cache et les tests dans la même release.

Le code de langue détecté par Scribe est transmis au LLM ; Cartesia reçoit la locale BCP-47 correspondante (`fr-FR`, `en-US`, etc.), `normalization=auto`, les contrôles de génération de la personnalité et, si configuré, `pronunciation_dict_id`. Le cache TTS est isolé par modèle, voix, locale, codec et réglages ; le fallback Telnyx utilise `fr-FR` ou `en-US`.

---

## Pipeline Vocal Complet

```
[Appelant parle]
      │
      ▼
┌─────────────────┐
│   ElevenLabs Scribe │  ← scribe_v2_realtime, détection multilingue ciblée, VAD
│   (transcription)│
└────────┬────────┘
         │ utterances textuelles
         ▼
┌─────────────────┐
│   Groq LLM       │  ← décision + tool calls
│   Qwen 3.8 27B   │
└────────┬────────┘
         │ réponse textuelle
         ▼
┌─────────────────┐
│  Cartesia Sonic 3.6 TTS  │  ← synthèse vocale
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

> **Depuis le 22/09/2026** : `call.hangup`, la fermeture du stream WebSocket et cette route convergent toutes vers `modules/voice/call-finalization.service.ts`. L'ordre et les doublons n'importent plus : la finalisation est idempotente, ne régresse jamais (un outcome plus fort n'est pas remplacé par un plus faible, une transcription plus courte n'écrase pas la plus complète) et déduit le résultat des faits persistés. `calls.caller_phone` est persisté dès `call.initiated` (migration `20260922120000`), ce qui permet au job `voice-finalization` (toutes les 15 min) de rattraper un appel resté sans `outcome` **et** de déclencher la récupération commerciale sans dépendre du webhook. La valeur `CallOutcome.MESSAGE` distingue un message enregistré pour le gérant d'un simple abandon.

---

## Modèle LLM vocal

Le chemin vocal utilise un seul modèle configuré par `VOICE_LLM_MODEL`, avec
`qwen/qwen3.8-27b` comme valeur par défaut. Le provider est Groq direct ; il
n'existe plus de sélection VIP, de canari par restaurant ou de repli automatique.
Après trois échecs consécutifs, le circuit breaker court-circuite temporairement
les appels et le pipeline prononce le message de dégradation prévu.

L'ouverture du stream journalise le provider et le modèle résolus. Chaque tour
persiste `llmProvider` et `llmModel` lorsqu'un appel LLM a effectivement été
exécuté ; le bilan d'appel reprend le couple pour les KPI. Le même log distingue
`openrouterKeyConfigured` (clé présente) de `openrouterUsed` (route utilisée),
sans jamais enregistrer la clé elle-même.

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

2026-09-04 14:08 — [voice, confirmation, closing] **Corrections de dialogue préparées pour test téléphonique** — Branche isolée `codex/voice-confirmation-closing` depuis `origin/main@28f5bfa`, intégrant les améliorations locales d’épellation/STT. La première question termine la réponse LLM (streaming et non-streaming) avant toute suite ou outil du même tour. Une clôture explicite du client passe en `CLOSING`, annule génération/spéculation, ignore les nouveaux transcripts, attend le mark Telnyx (ou le webhook TTS natif) avant hangup idempotent ; timeout borné et retry réseau. Un simple merci garde l’appel ouvert ; un court transcript ambigu après le départ demande clarification. Disponibilité annoncée explicitement. Vérification : suite vocale 429/429, typecheck et lint sans erreur ; test audio réel et déploiement encore à effectuer. Aucun changement de voix, de modèle ou de schéma.
2026-09-04 14:55 — [voice, analysis, name-spelling] **Régression d’épellation identifiée après test Henri** — Le dernier appel a confirmé l’alternative 12h30, mais une transcription STT bruitée a permis au LLM de confirmer « A D K I F » malgré « Non ». Le parseur reconnaît maintenant « en nombre de actifs », les corrections « non, … » et « A deux K I F » ; les keyterms STT incluent `deux k` et `double k`. Tests ciblés : 171/171 ; typecheck API et formatage OK. Déploiement contrôlé à réaliser.
