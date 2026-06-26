# Sokar Auto-Logging System

## Architecture

Le système d'automatisation Sokar élimine tout besoin de mise à jour manuelle de la documentation. Il repose sur **3 composants** qui fonctionnent en synergie :

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                   SOKAR AUTO-LOGGING SYSTEM                         │
  │                                                                      │
  │  ┌──────────────────┐    ┌──────────────┐    ┌──────────────────┐   │
  │  │  mcp_serve.py    │    │ auto_sync.py │    │ notion_sync.py   │   │
  │  │  (MCP gateway)   │───▶│ (git watcher)│    │ (bidirectional)  │   │
  │  │                  │    │              │    │                  │   │
  │  │ Détecte le type  │    │ Surveille    │    │ Obsidian ↔ Notion│   │
  │  │ de tâche         │    │ git diff     │    │ sync automatique │   │
  │  │ Met à jour la    │    │ Met à jour   │    │ Mapping carte    │   │
  │  │ note ciblée      │    │ les notes    │    │ (.notion_map.json│   │
  │  └────────┬─────────┘    └──────┬───────┘    └────────┬─────────┘   │
  │           │                     │                      │            │
  │           └──────────┬──────────┴──────────┬───────────┘            │
  │                      │                     │                        │
  │              ┌───────▼──────────────────────▼────────┐              │
  │              │         OBSIDIAN VAULT                  │             │
  │              │  docs/obsidian/*.md                     │             │
  │              │                                         │             │
  │              │  Journal.md     ← log horodaté          │             │
  │              │  Context.md     ← activité courante     │             │
  │              │  API Endpoints  ← routes détectées      │             │
  │              │  Database Schema← modèles Prisma        │             │
  │              │  Voice Pipeline ← fichiers voice        │             │
  │              │  Dashboard.md   ← composants UI         │             │
  │              │  ...             ← notes auto-générées  │             │
  │              └─────────────────────────────────────────┘             │
  └─────────────────────────────────────────────────────────────────────┘
```

## Composants

### 1. `mcp_serve.py` (MCP Gateway)

**Chemin** : `/Users/hamza/Desktop/Sokar/tools/hermes/scripts/mcp_serve.py`

Le point d'entrée unique pour toute exécution via un client MCP.

**Ce qu'il fait automatiquement après chaque tâche** :

1. **Classifie la tâche** — détecte si c'est une création de route, modification de schema, ajout de composant, pipeline vocal, job queue, etc.
2. **Log dans Journal.md** — ajoute une ligne au tableau horodaté
3. **Met à jour Context.md** — section "Dernière activité"
4. **Met à jour la note ciblée** — par exemple, si une route `reservation.routes.ts` est modifiée, `API Endpoints.md` est automatiquement mis à jour
5. **Déclenche auto_sync** — pour synchroniser les changements de code

**Carte de classification** :

| Mot-clé dans la tâche    | Type détecté     | Note mise à jour    |
| ------------------------ | ---------------- | ------------------- |
| route, endpoint, crud    | `create_route`   | API Endpoints.md    |
| prisma, schema, model    | `modify_schema`  | Database Schema.md  |
| voice, stt, tts, telnyx  | `voice_pipeline` | Voice Pipeline.md   |
| dashboard, ui, component | `add_component`  | Dashboard.md        |
| bullmq, queue, worker    | `queue_job`      | BullMQ Jobs.md      |
| hermes, agent, skill     | `agent_config`   | Hermes Agent.md     |
| auth, clerk, webhook     | `security`       | Security.md         |
| test, vitest, coverage   | `testing`        | Testing Strategy.md |

### 2. `auto_sync.py` (Git Watcher)

**Chemin** : `/Users/hamza/Desktop/Sokar/tools/hermes/skills/obsidian/auto_sync.py`

Surveille les changements dans le code source et met à jour le vault Obsidian.

**Modes** :

- `daemon [interval]` — boucle toutes les N secondes (défaut: 30)
- `diff` — analyse git diff en une passe
- `watch` — scan filesystem (fallback sans git)
- `map` — affiche la carte fichier → note

**Carte de détection** :

| Pattern fichier                          | Note Obsidian      | Extracteur  |
| ---------------------------------------- | ------------------ | ----------- |
| `apps/api/src/modules/*.routes.ts`       | API Endpoints.md   | `routes`    |
| `packages/database/prisma/schema.prisma` | Database Schema.md | `schema`    |
| `apps/api/src/modules/voice/`            | Voice Pipeline.md  | `voice`     |
| `apps/dashboard/`                        | Dashboard.md       | `dashboard` |
| `packages/`                              | Architecture.md    | `packages`  |
| `tools/hermes/`                          | Hermes Agent.md    | `agent`     |

### 3. `notion_sync.py` (Bidirectional Sync)

**Chemin** : `/Users/hamza/Desktop/Sokar/tools/hermes/skills/obsidian/notion_sync.py`

Synchronisation bidirectionnelle entre Notion et Obsidian.

**Prérequis** : Variable d'environnement `NOTION_TOKEN` (token d'intégration Notion).

**Commandes** :

- `push` — Obsidian → Notion
- `pull` — Notion → Obsidian
- `sync` — Bidirectionnel (pull puis push)
- `daemon [interval]` — Boucle toutes les N secondes
- `register <note> <page_id>` — Ajoute un mapping

**Mapping** : Stocké dans `docs/obsidian/.notion_map.json`.

## Flux complet (exemple)

```
1. Le client MCP envoie: "Ajoute une route GET /restaurants/:id"
2. mcp_serve.py exécute la tâche via Hermes
3. ↓ Classification: create_route → API Endpoints.md
4. ↓ Log: Journal.md ligne + Context.md activité
5. ↓ auto_sync.py diff: détecte restaurant.routes.ts modifié
6. ↓ Mise à jour: API Endpoints.md section "Mises à jour automatiques"
7. (Optionnel) notion_sync.py push → Notion
```

Résultat : **0 action manuelle** pour la documentation.

## Démarrage

### Daemon complet (tout automatique)

```zsh
# Démarrer les 3 daemons (recommandé)
python3 tools/hermes/skills/obsidian/auto_sync.py daemon &
python3 tools/hermes/skills/obsidian/notion_sync.py daemon &
# mcp_serve.py est actif via le client MCP configuré
```

### Vérifier que tout fonctionne

```zsh
# Tester auto_sync
python3 tools/hermes/skills/obsidian/auto_sync.py diff

# Tester notion_sync
NOTION_TOKEN="ntn_..." python3 tools/hermes/skills/obsidian/notion_sync.py map

# Voir les logs
cat ~/.hermes/logs/auto_sync.log
cat ~/.hermes/logs/notion_sync.log
cat ~/.hermes/logs/mcp_serve.log
```

## Fichiers

| Fichier                                       | Rôle                                                   |
| --------------------------------------------- | ------------------------------------------------------ |
| `tools/hermes/scripts/mcp_serve.py`           | MCP Gateway + classification + auto-logging            |
| `tools/hermes/skills/obsidian/auto_sync.py`   | Git/filesystem watcher                                 |
| `tools/hermes/skills/obsidian/notion_sync.py` | Sync bidirectionnelle Notion                           |
| `tools/hermes/skills/obsidian/auto_doc.py`    | Helpers de documentation (Context.md, décisions)       |
| `tools/hermes/skills/obsidian/skill.py`       | Tools Hermes pour le vault (list, read, write, search) |
| `docs/obsidian/.notion_map.json`              | Carte Obsidian → Notion                                |
