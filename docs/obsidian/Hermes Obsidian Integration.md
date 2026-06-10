# Hermes x Obsidian — Intégration Sokar

**Dernière mise à jour** : Mai 2025
**Statut** : Actif — utilisé quotidiennement

---

## Pourquoi

L'intégration Hermes-Obsidian est le pont entre l'agent IA et la documentation persistante du projet Sokar. Elle permet :

- **Mémoire persistante** — Hermes lit et écrit dans le vault Obsidian, ce qui lui donne accès à l'historique des décisions, sprints et notes de réunion au-delà de sa propre mémoire éphémère.
- **Brainstorming et exploration** — Lancer des commandes `hermes -z` pour brainstormer dans une note, structurer des idées, ou faire des recherches dans toute la doc sans ouvrir l'IDE.
- **Documentation vivante** — Les notes générées par Hermes (`write_note`, `append_note`) sont directement exploitables dans Obsidian avec les wikilinks, tags et graph view intacts.
- **Automatisation** — Création de daily notes, journaux de sprint, et rapports techniques sans friction.

Le vault réside dans le monorepo (`docs/obsidian/`), donc versionné avec le code — pas de dérive entre la doc et l'implémentation.

---

## Commandes disponibles

Le skill Hermes-Obsidian expose **6 fonctions** accessibles via `hermes -z` ou le MCP server `obsidian-vault` :

| Fonction | Signature | Description |
|---|---|---|
| `list_notes` | `list_notes()` | Liste tous les fichiers `.md` du vault (hors `.obsidian/`). Retourne un tableau JSON des chemins relatifs. |
| `read_note` | `read_note(note_path)` | Lit une note par chemin relatif ou titre. Ajoute `.md` automatiquement si omis. Cherche par titre dans tout le vault si le chemin exact n'existe pas. |
| `write_note` | `write_note(note_path, content)` | Écrit ou écrase une note. Crée les dossiers intermédiaires si nécessaire. Le contenu est passé tel quel (markdown, frontmatter, wikilinks). |
| `append_note` | `append_note(note_path, content)` | Ajoute du texte à la fin d'une note existante. Erreur si la note n'existe pas. |
| `search_vault` | `search_vault(query)` | Cherche une chaîne (case-insensitive) dans tout le vault. Retourne les notes avec un snippet de 160 caractères autour du match. |
| `daily_note` | `daily_note()` | Crée ou ouvre la note du jour dans `Daily/YYYY-MM-DD.md` avec un template (notes, tâches, liens). |

**Conseil** : Le MCP server `obsidian-vault` (via `@modelcontextprotocol/server-filesystem`) est aussi configuré dans Windsurf Cascade — il permet la lecture/écriture directe de fichiers depuis l'IDE. Le skill Hermes est plus riche (search, daily note, fuzzy title lookup).

---

## Exemples d'utilisation

### 1. Lister toutes les notes disponibles

```zsh
hermes -z "Liste toutes les notes du vault Obsidian Sokar et affiche les 5 plus récentes par date de modification"
```

Sortie typique :
```
Architecture.md
README.md
Sprint 1.md
Hermes Obsidian Integration.md
```

### 2. Chercher une information dans toute la doc

```zsh
hermes -z "Cherche 'Telnyx' dans le vault Obsidian. Résume chaque mention dans un tableau avec la note source, le snippet et le contexte."
```

Utilise `search_vault("Telnyx")` pour trouver tous les endroits où Telnyx est mentionné.

### 3. Brainstormer et persister dans une note

```zsh
hermes -z "Crée une note 'Archives/Sprint 3 Ideas.md' dans le vault Obsidian. Fais un brainstorming structuré : section ## Revenue Tracking avec 3 idées, section ## Post-Call Analysis avec 3 idées, section ## AWS Migration avec les services concernés. Ajoute des tags #brainstorm et #sprint3 en frontmatter YAML."
```

Utilise `write_note` pour créer la note avec contenu markdown structuré, frontmatter et wikilinks vers les notes existantes.

---

## Configuration

### Chemins

| Élément | Chemin |
|---|---|
| **Vault racine** | `/Users/hamza/Desktop/Sokar/docs/obsidian/` |
| **Skill Hermes** | `/Users/hamza/Desktop/Sokar/agent/skills/obsidian/skill.py` |
| **MCP Config** | `/Users/hamza/Desktop/Sokar/agent/config/mcp-config.json` (serveur `obsidian-vault`) |
| **Variable d'env** | `OBSIDIAN_VAULT` (optionnelle, override du chemin par défaut) |

### MCP Server (Windsurf)

```json
"obsidian-vault": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem",
           "/Users/hamza/Desktop/Sokar/docs/obsidian"],
  "description": "Sokar Obsidian vault — lecture et écriture des notes"
}
```

Le MCP server Filesystem expose les opérations fichiers standard (read, write, edit, search). Le skill Hermes (`skill.py`) ajoute `search_vault` (recherche plein texte avec snippets) et `daily_note` (template auto).

---

## Liens

- [[README]] — Guide de démarrage et structure du projet
- [[Architecture]] — Stack complète et organisation du monorepo
- [[Sprint 1]] — Objectifs et suivi du MVP en cours

---

## Automatisation — Everything Auto-Géré

Depuis la v2.1 du MCP server, **plus aucune mise à jour manuelle n'est nécessaire**. Le système auto-logging Sokar gère tout :

### Comment ça marche

Chaque fois qu'une tâche est exécutée via `mcp_serve.py` (le MCP gateway), **3 actions automatiques** se déclenchent :

1. **Classification intelligente** — la tâche est analysée pour déterminer son type : création de route API, modification de schéma Prisma, ajout de composant dashboard, pipeline vocal, job queue, etc.
2. **Mise à jour de la note ciblée** — par exemple, si vous modifiez `restaurant.routes.ts`, la note `API Endpoints.md` est automatiquement mise à jour avec les nouvelles routes.
3. **Logging dans le journal** — une ligne est ajoutée à `Journal.md` et `Context.md` est mis à jour.

### Composants du système

| Composant | Fichier | Rôle |
|---|---|---|
| **MCP Gateway** | `agent/scripts/mcp_serve.py` | Point d'entrée unique — classification + auto-logging |
| **Git Watcher** | `agent/skills/obsidian/auto_sync.py` | Surveille git diff, met à jour les notes selon les fichiers modifiés |
| **Notion Sync** | `agent/skills/obsidian/notion_sync.py` | Sync bidirectionnelle Notion ↔ Obsidian |
| **Doc Helpers** | `agent/skills/obsidian/auto_doc.py` | Helpers pour Context.md, décisions, liens |
| **Skill Vault** | `agent/skills/obsidian/skill.py` | Tools Hermes : list, read, write, search, daily |

### Carte de détection auto

| Mot-clé dans la tâche | Note mise à jour | Type |
|---|---|---|
| route, endpoint, crud, fastify | `API Endpoints.md` | `create_route` |
| prisma, schema, model, migration | `Database Schema.md` | `modify_schema` |
| voice, stt, tts, telnyx, deepgram | `Voice Pipeline.md` | `voice_pipeline` |
| dashboard, ui, component, tailwind | `Dashboard.md` | `add_component` |
| bullmq, queue, worker, scheduler | `BullMQ Jobs.md` | `queue_job` |
| hermes, agent, skill, mcp | `Hermes Agent.md` | `agent_config` |
| auth, clerk, webhook, jwt | `Security.md` | `security` |
| test, vitest, coverage | `Testing Strategy.md` | `testing` |

### Architecture visuelle

```
Tâche Hermes → mcp_serve.py → classification
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              Journal.md    Context.md    Note ciblée
                                          (API Endpoints, etc.)
                                           │
                                           ▼
                                     auto_sync.py
                                     (git watcher)
                                           │
                                           ▼
                                     notion_sync.py
                                     (Notion sync)
```

### Usage quotidien

Vous n'avez **rien à faire**. Le système est intégré directement dans `mcp_serve.py` qui est le point d'entrée obligatoire pour toute tâche Hermes.

Si vous voulez lancer la surveillance en arrière-plan :
```zsh
# Optionnel : daemon auto_sync (git watcher)
python3 agent/skills/obsidian/auto_sync.py daemon &

# Optionnel : daemon notion_sync (bidirectionnel, nécessite NOTION_TOKEN)
NOTION_TOKEN="ntn_..." python3 agent/skills/obsidian/notion_sync.py daemon &
```

### Voir aussi

- [[auto_sync]] — Détails du git watcher
- [[notion_sync]] — Détails de la sync Notion
- [[Journal]] — Le journal d'exécution automatique

---

*Documentation générée et maintenue par Hermes Agent. Éditer via Obsidian ou `hermes -z`.*