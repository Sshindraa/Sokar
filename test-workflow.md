# Test Workflow Cascade → Hermes

Ce fichier a été créé pour valider le workflow.

## Architecture confirmée

- **Cascade** (kimi-k2.6) : planification, raisonnement
- **Hermes MCP** (bridge) : délégation d'exécution
- **Hermes** (deepseek-v4-flash) : exécution via OpenCode Go → OpenRouter fallback

## Configuration vérifiée

| Élément | Valeur |
|---------|--------|
| Primary provider | OpenCode Go (https://opencode.ai/zen/go/v1) |
| Primary model | deepseek-v4-flash |
| Fallback provider | OpenRouter (https://openrouter.ai/api/v1) |
| Fallback model | deepseek/deepseek-v4-flash |
| MCP server | hermes (1/1 tools Enabled) |

## Date

2026-05-20 13:45:56
