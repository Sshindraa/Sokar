# Runbook — Environment

## Node version

- Repo constraint: `>=20.0.0 <23.0.0` (root `package.json` engines).
- `.nvmrc` = `22`.
- `.npmrc` has `engine-strict=true` — `pnpm` refuses to run under Node 26+.
- Local Mac (post-migration 2026-07-01): Node 22.23.1 is the default at `~/.local/bin/node` (symlink to `~/.hermes/node/bin/node`). No PATH prefix needed for `pnpm`.
- pnpm 10.33.3 installed via `npm i -g pnpm@10.33.3`, symlinked at `~/.local/bin/pnpm`.

## Convention

- One `.env` file per app, sourced at startup. No `.env.prod`.
- `NEXT_PUBLIC_*` is baked at build time — must be present during `next build`, not only at runtime.
- Deploy scripts fail-fast if a critical `.env` is missing (API, dashboard, connect).
- `packages/database/.env` is the only intentional duplicate: Prisma CLI does not follow symlinks and does not read `.env.local` from the root.

## Files

| File                         | Role                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `.env.local` (root)          | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD`                  |
| `packages/database/.env`     | `DATABASE_URL` for Prisma CLI (`db:push`, `db:seed`, `db:studio`) |
| `apps/connect/.env`          | Connect dev vars (`SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`)   |
| `apps/api/.env` (prod)       | All API vars (Telnyx, Deepgram, Cartesia, DB, Redis, etc.)        |
| `apps/dashboard/.env` (prod) | Clerk keys, `API_URL`, Sentry                                     |
| `apps/connect/.env` (prod)   | `SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `DASHBOARD_URL`     |

Pour la télémétrie Service Copilot, définir `SERVICE_COPILOT_TELEMETRY_SECRET` dans l’environnement
de l’API (valeur aléatoire d’au moins 32 caractères). Elle signe les jetons de recommandation ; ne pas
la réutiliser pour un autre usage et ne jamais la mettre dans une variable `NEXT_PUBLIC_*`.

## Voice LLM

Le provider vocal est sélectionné au démarrage de l’API par `VOICE_LLM_PROVIDER` :

- `cerebras` (défaut historique) : `VOICE_LLM_MODEL` sur Cerebras ;
- `openrouter` : `VOICE_LLM_MODEL` sur OpenRouter ;
- `groq` : `VOICE_LLM_MODEL` directement sur l’API Groq OpenAI-compatible.

Pour le modèle Qwen 3.8 direct sur Groq, définir dans `apps/api/.env` :

```dotenv
GROQ_API_KEY="gsk_..."
GROQ_BASE_URL="https://api.groq.com/openai/v1"
VOICE_LLM_PROVIDER="groq"
VOICE_LLM_MODEL="qwen/qwen3.8-27b"
VOICE_LLM_FALLBACK_MODEL="meta-llama/llama-3.3-70b-instruct"
```

La clé est un secret local au VPS et ne doit jamais être commitée ou envoyée dans le chat. Une réponse
Groq en 402 (quota), 429 (limite) ou 5xx, ainsi qu’une erreur réseau, bascule vers OpenRouter si
`OPENROUTER_API_KEY` est défini. En production, l’API refuse de démarrer si la clé du provider primaire
est absente.

## Demo restaurant

The seed creates a fictional `Chez Sokar` (slug `chez-sokar-demo`):

- Number: `+331****0405`
- MCP + OpenAI Reserve opt-in enabled
- Hours, personality, test customers (including a VIP)

Used for local voice / MCP tests before a real pilot.
