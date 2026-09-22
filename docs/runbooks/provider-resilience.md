# Runbook — Résilience fournisseurs

> **Statut : ACTIF — créé le 21 septembre 2026.** Primitives dans
> `apps/api/src/shared/resilience/` (timeout, retry borné, circuit breaker). Voir
> [`../roadmap-production-readiness.md`](../roadmap-production-readiness.md) (chantier R1-2).

## Pourquoi

Un `fetch` sans borne peut rester en vol jusqu'à la mort de la socket. Sur le chemin vocal, cela
signifie un appel téléphonique muet sans dégradation déclenchée ; sur un paiement ou un SMS, un job
qui ne se termine jamais. Les trois règles appliquées ici :

1. **Tout appel fournisseur a un timeout explicite.** Pas de défaut implicite du SDK.
2. **Les retries sont bornés et ne rejouent que le transitoire** (timeout, erreur réseau, 5xx, 429).
   Rejouer un 4xx ou une erreur métier consomme du quota sans rien réparer.
3. **Chaque panne a une dégradation écrite** : un message d'excuse au client, un filler ignoré, un
   job en dead-letter — jamais un silence.

## Primitives

```ts
import {
  CircuitBreaker,
  ProviderTimeoutError,
  VOICE_PROVIDER_TIMEOUT_MS,
  fetchWithTimeout,
  retry,
  withTimeout,
} from '../../shared/resilience';
```

- `withTimeout(promise, ms, label)` — borne une promesse sans annulation native (SDK).
- `fetchWithTimeout(url, init, ms)` — `fetch` avec `AbortController` ; lève `ProviderTimeoutError`.
- `retry(operation, { attempts, baseDelayMs, maxDelayMs })` — backoff exponentiel, jitter ±20 %.
- `CircuitBreaker` — états `closed` / `open` / `half-open`, avec `failureThreshold` et `cooldownMs`.

## État par fournisseur

| Fournisseur                 | Usage                                         | Timeout                      | Retries                | Circuit breaker                              | Dégradation si panne                                       |
| --------------------------- | --------------------------------------------- | ---------------------------- | ---------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Telnyx (contrôle d'appel)   | `answer`, `speak`, `record` via `telnyxFetch` | 10 s                         | aucun (appel en cours) | non                                          | l'appel se poursuit ou se termine côté Telnyx              |
| Telnyx (SMS / WhatsApp)     | SDK + agent keep-alive                        | SDK                          | BullMQ (`attempts: 5`) | non                                          | job en dead-letter, alerte `dead_letter_backlog`           |
| Cartesia TTS (appel live)   | `/tts/bytes` streamé                          | 8 s par tentative            | 2 tentatives           | non                                          | message d'excuse parlé via `speakTelnyxNative`             |
| Cartesia TTS (fillers)      | `/tts/sse`                                    | 8 s                          | 3 tentatives           | non                                          | filler ignoré, la réponse principale continue              |
| Cartesia TTS (démo/preview) | `/tts/bytes` one-shot                         | 8 s                          | aucun                  | oui, 3 échecs / 30 s                         | erreur explicite de l'endpoint                             |
| ElevenLabs STT              | WebSocket temps réel                          | géré par le bridge           | reconnexion du bridge  | non                                          | tour sans transcription, alerte `calls_without_transcript` |
| LLM vocal (Groq)            | complétion vocale                             | 8 s (`VOICE_LLM_TIMEOUT_MS`) | aucun                  | oui, 3 échecs / 30 s (implémentation dédiée) | message d'excuse parlé, l'appel ne bascule plus de modèle  |
| Stripe                      | PaymentIntent, webhooks                       | 10 s (SDK)                   | `maxNetworkRetries: 2` | non                                          | paiement refusé proprement, job en dead-letter             |
| Resend                      | email transactionnel                          | 10 s                         | BullMQ                 | non                                          | email non envoyé, trace en base                            |
| Google Calendar / Places    | freeBusy, recherche                           | 10 s                         | aucun                  | non                                          | disponibilité réduite, log d'avertissement                 |

Le circuit breaker LLM vit dans `modules/voice/stream/manager.ts`. Il n'a pas été migré vers le
module partagé pour ne pas toucher le chemin vocal ; l'unification est un suivi assumé, pas un
oubli.

Depuis le 22 septembre 2026, le pipeline vocal n'a **qu'un provider** : Groq en direct, modèle
`qwen/qwen3.8-27b`. Il n'y a aucun routage secondaire : un 402/429/5xx ou une erreur réseau
remonte à l'appelant, qui prononce le message d'excuse parlé. Le circuit breaker reste utile pour
ne pas marteler Groq pendant 30 s après trois échecs consécutifs.

Conséquence à garder en tête : **il n'y a pas de continuité de modèle**. Une panne Groq dégrade la
conversation. Si ce compromis doit être rouvert, il faudra ajouter un provider réellement
indépendant, avec ses propres timeouts, métriques, coûts et tests de panne.

L'identité effective est enregistrée à l'ouverture du stream et dans la télémétrie :
`llmProvider=groq` et `llmModel=VOICE_LLM_MODEL` sur `VoiceTurnTelemetry` et
`VoiceCallTelemetry`. Le log de démarrage expose aussi `openrouterKeyConfigured` (présence de la
clé dans l'environnement) et `openrouterUsed` (route effectivement empruntée). La première valeur
peut être vraie pour un outil externe ; avec le pipeline actuel, la seconde reste toujours fausse.

## Ajouter un appel fournisseur

1. Utiliser `fetchWithTimeout` (ou `withTimeout` pour un SDK sans annulation) — jamais `fetch` nu.
2. Choisir la borne : `VOICE_PROVIDER_TIMEOUT_MS` (8 s) sur le chemin vocal,
   `DEFAULT_PROVIDER_TIMEOUT_MS` (10 s) ailleurs.
3. Si l'appel peut être rejoué sans effet de bord, passer par `retry` avec `attempts` ≤ 3.
4. Si le fournisseur est sur le chemin critique et peut rester indisponible, l'envelopper dans un
   `CircuitBreaker` (3 échecs / 30 s par défaut).
5. Écrire la dégradation : que voit le client, que voit l'opérateur, quelle alerte se déclenche.
6. Ajouter la ligne au tableau ci-dessus.

## Diagnostic

```zsh
# Timeouts et ouvertures de circuit côté worker
pm2 logs sokar-workers --lines 200 | grep -Ei 'circuit-breaker|ProviderTimeoutError'

# Timeouts côté API (voice, Connect)
pm2 logs sokar-api --lines 200 | grep -Ei 'timeout|circuit'
```

Un circuit ouvert se referme tout seul : une seule sonde est autorisée après le cooldown, et un
succès referme le circuit. Si un circuit reste ouvert en boucle, le fournisseur est réellement
indisponible — vérifier son statut avant de toucher au code.
