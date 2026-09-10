# Diagnostics Sokar

Scripts de diagnostic manuels pour le pipeline vocal, MCP et le dogfood QA.
Non exécutés en CI — usage développeur local uniquement.

## Scripts

| Script                          | Rôle                                                                                           | Invocation                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `test-stt-tts.mjs`              | Valide les 3 APIs vocales (ElevenLabs Scribe STT, Cartesia TTS, OpenRouter LLM) indépendamment | `pnpm test:diagnostic`                                 |
| `benchmark-cartesia-voices.mjs` | Génère un corpus français/anglais pour comparer les voix Sonic 3.6                             | `node tools/diagnostics/benchmark-cartesia-voices.mjs` |
| `dogfood-sokar.sh`              | Dogfood QA du site/dashboard via Hermes CLI                                                    | `pnpm dogfood:sokar`                                   |
| `simulate-voice-call.ts`        | Simule un appel vocal contre l'API locale (`/api/test/simulate-call`)                          | `pnpm test:voice:simulate`                             |
| `test-mcp-client.ts`            | Client de test pour les endpoints MCP de l'API (depuis le contexte `apps/api`)                 | `pnpm test:mcp:client`                                 |
| `sokar-mcp-stdio.ts`            | Bridge MCP stdio pour Claude Desktop (depuis le contexte `apps/api`)                           | `pnpm test:mcp:stdio`                                  |

## Variables d'environnement

| Variable                 | Script(s)                                             | Défaut                                        | Rôle                                          |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `ELEVENLABS_API_KEY`     | test-stt-tts                                          | —                                             | Clé API ElevenLabs                            |
| `CARTESIA_API_KEY`       | test-stt-tts                                          | —                                             | Clé API Cartesia                              |
| `OPENROUTER_API_KEY`     | test-stt-tts                                          | —                                             | Clé API OpenRouter                            |
| `CARTESIA_VOICE_ID`      | test-stt-tts                                          | `f786b574-...`                                | ID de voix Cartesia                           |
| `ELEVENLABS_STT_MODEL`   | test-stt-tts                                          | `scribe_v2_realtime`                          | Modèle STT                                    |
| `CARTESIA_MODEL`         | test-stt-tts                                          | `sonic-3.6`                                   | Modèle TTS                                    |
| `CARTESIA_BENCHMARK_DIR` | benchmark-cartesia-voices                             | `/private/tmp/sokar-cartesia-voice-benchmark` | Répertoire temporaire des MP3 et du manifeste |
| `OPENROUTER_MODEL`       | test-stt-tts                                          | `mistralai/ministral-3b-2512`                 | Modèle LLM                                    |
| `SOKAR_API_BASE`         | simulate-voice-call, test-mcp-client, sokar-mcp-stdio | `http://localhost:4000`                       | URL de base de l'API                          |
| `SOKAR_MCP_KEY`          | test-mcp-client, sokar-mcp-stdio                      | placeholder dev                               | Clé MCP (surcharger en production)            |
| `SOKAR_CALLER_PHONE`     | simulate-voice-call                                   | `+336****5678`                                | Numéro appelant simulé                        |
| `SOKAR_SIMULATE_MODE`    | simulate-voice-call                                   | `mock`                                        | Mode de simulation (`auto` ou `mock`)         |
| `SOKAR_DOGFOOD_URL`      | dogfood-sokar                                         | `https://sokar.tech`                          | URL cible dogfood                             |
| `SOKAR_DOGFOOD_OUTPUT`   | dogfood-sokar                                         | `$REPO_ROOT/.hermes/dogfood`                  | Répertoire de sortie                          |

## Notes

- Les scripts MCP (`test-mcp-client.ts`, `sokar-mcp-stdio.ts`) nécessitent le contexte `apps/api` pour résoudre `@modelcontextprotocol/sdk`. Les commandes `pnpm test:mcp:*` gèrent cela automatiquement via `pnpm --filter @sokar/api exec`.
- Voir `docs/sokar-mcp-integrator-guide.md` pour le guide d'intégration MCP complet.
- `test-stt-tts.mjs` charge `.env.local` via `node --env-file` (Node 20+).
