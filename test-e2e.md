# Test End-to-End Cascade → Hermes

Fichier créé par le workflow MCP asynchrone.

## Informations

- **Date**: 2026-05-20 15:08
- **Provider**: OpenCode Go deepseek-v4-flash
- **Fallback**: OpenRouter deepseek/deepseek-v4-flash
- **MCP**: hermes (2/2 tools — execute_task + check_task)
- **Status MCP Registry**: Enabled

## Workflow validé

1. Cascade (kimi-k2.6) planifie la tâche
2. `execute_task(task="...")` → retourne `task_id` en <1s
3. `hermes -z` lancé en background (async, pas de timeout)
4. `check_task(task_id)` → récupère le résultat après ~30s
5. Auto-logging dans Journal.md et Context.md

## Notes

Le serveur MCP fonctionne correctement (testé en local avec Content-Length protocol).
La connexion MCP outil dans Windsurf est en cours de stabilisation.
