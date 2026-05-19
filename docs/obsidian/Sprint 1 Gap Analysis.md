# Sprint 1 — Gap Analysis

**Date** : 2026-05-19
**Source A** : Notion — "🏗️ Sprint 1 — Brief Technique Agent Code"
**Source B** : Obsidian — "docs/obsidian/Sprint 1.md"

---

## 1. Vérification de l'outil Notion MCP

**Fichier** : `/Users/hamza/Desktop/Callyx/notion_mcp_client.py`
- [x] Existe (1981 octets, Python 3)
- [x] Fonctionne avec `NOTION_TOKEN` depuis Hermes config (`~/.hermes/config.yaml`)
- ⚠️ Le token est passé via `NOTION_API_KEY` dans la config Hermes mais le script utilise `NOTION_TOKEN`.
- ⚠️ Le script nécessite `npx` sur le PATH pour lancer `@notionhq/notion-mcp-server`.
- Token Notion valide : `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`
- Les MCP tools système (`mcp_notion_API_*`) retournent 401 — ils utilisent un jeton invalide/différent de celui de Hermes config.

---

## 2. Écarts : Contenu présent dans Notion mais absent d'Obsidian

| # | Sujet | Description |
|---|-------|-------------|
| 1 | **Durée réaliste explicite** | Notion : "4 à 6 semaines". Obsidian ne mentionne pas de timeline. |
| 2 | **Avertissement edge cases vocaux** | "La gestion des edge cases vocaux (bruit, accent, interruptions, silence) prend seule 2 semaines." Absent d'Obsidian. |
| 3 | **Arborescence monorepo détaillée** | Notion liste les fichiers exacts : `pipeline.ts`, `outcome.ts`, `tools.ts`, `prompts.ts`, `fillers.ts`, `reservation.service.ts`, `reservation.schema.ts`, `restaurant.service.ts`, `restaurant.routes.ts`, `report.service.ts`, `queues.ts`, workers, `redis/client.ts`, `email/index.ts`, etc. Obsidian a une section "Structure modulaire" mais sans arbre de fichiers. |
| 4 | **Enums Prisma** | Notion liste explicitement : `Plan { STARTER PRO PREMIUM }`, `CallIntent`, `CallOutcome`, `ReservationStatus`, `ProfileType`, `FillerStyle`. Obsidian mentionne les modèles mais pas les enums. |
| 5 | **Variables d'Environnement** | Section dédiée dans Notion (contenu non extrait ici, mais la section existe). Obsidian n'en a pas. |
| 6 | **Routes API détaillées** | Notion a une section "Routes API" avec détails (pas entièrement extraite ici). Obsidian renvoie vers [[API Endpoints]]. |
| 7 | **Constants** | Notion référence `packages/config/src/constants.ts`. Absent d'Obsidian. |
| 8 | **Outcome Detection** | Module `voice/outcome.ts` listé dans Notion. Absent d'Obsidian. |
| 9 | **Tools Vapi** | Module `voice/tools.ts` listé dans Notion. Absent d'Obsidian. |
| 10 | **Pipeline Vapi détails** | Notion liste 3 endpoints précis : `/voice/incoming`, `/voice/function-call`, `/voice/end`. Obsidian mentionne juste "Agent state machine". |
| 11 | **Main entry point** | Notion détaille : graceful shutdown `SIGTERM/SIGINT`, `BullMQ scheduler 0 23 * * *` (daily evening report), `/health` (PostgreSQL + Redis), `/auth/*` (Better Auth). Obsidian n'a rien sur `main.ts`. |

---

## 3. Écarts : Contenu présent dans Obsidian mais absent de Notion

| # | Sujet | Description |
|---|-------|-------------|
| 1 | **Checkbox status** | Obsidian suit chaque item avec `[x]` (fait) ou `[ ]` (à faire). Notion n'a pas de suivi checkboxes dans le Brief. |
| 2 | **Liens inter-notes Obsidian** | `[[Testing Strategy]]`, `[[API Endpoints]]`, `[[Dashboard]]`, `[[Database Schema]]`, `[[Voice Pipeline]]`, `[[BullMQ Jobs]]`, `[[Architecture]]`, `[[README]]`. Notion est un document plat sans ces références. |
| 3 | **Tableau des dépendances externes** | Obsidian liste Clerk, Vapi, Telnyx, Redis, PostgreSQL, ConfigCat, Requestly, Doppler, PostHog, Datadog avec statuts. Notion n'a pas ce tableau. |
| 4 | **PostHog Analytics** | Mentionné dans Obsidian comme "Configuré". Absent de Notion. |
| 5 | **Migration Telnyx (Sprint 2)** | Obsidian mentionne "Migration Telnyx (Sprint 2)". Notion est focalisé sur Vapi uniquement. |
| 6 | **Rate limiting + CORS** | Spécifique à Obsidian (section API Fastify). |
| 7 | **Agent state machine** | Obsidian : `idle → listening → thinking → speaking`. Notion n'a pas ce détail. |
| 8 | **Filler styles** | Obsidian : `CASUAL / FORMAL / WARM`. Notion les référence dans les enums mais sans détails. |
| 9 | **Workers BullMQ spécifiques** | Obsidian liste 3 workers (evening report, SMS confirmation, outbound confirm) + Redis call caps. Notion mentionne juste "scheduler 0 23 * * *". |
| 10 | **Sections modulaires** | Obsidian a des sections structurées : API / Dashboard / Database / Voice Pipeline / Jobs Queue. Notion est plus technique/monorepo-files. |
| 11 | **Telnyx webhook guard** | Obsidian mentionne "Webhook Telnyx guard (signature validation)" comme fait. Notion parle de "Security Guards" génériques. |

---

## 4. Actions Recommandées

### Synchronisation Obsidian → Mettre à jour depuis Notion

1. Ajouter la **durée estimée (4-6 semaines)** et l'**avertissement edge cases vocaux** en début de Sprint 1.md
2. Ajouter une section **Arborescence** avec l'arbre de fichiers exact depuis Notion
3. Ajouter les **Enums Prisma** dans la section Database
4. Ajouter les **3 endpoints Pipeline Vapi** dans la section Voice Pipeline
5. Ajouter les détails **Main entry point** (graceful shutdown, BullMQ scheduler, health check)
6. Ajouter les sections **Constants**, **Outcome Detection**, **Tools Vapi**
7. Ajouter le module `voice/tools.ts` et `voice/outcome.ts` dans la Voice Pipeline

### Synchronisation Notion → Mettre à jour depuis Obsidian

1. Ajouter un **tableau de suivi des dépendances externes** avec statuts
2. Ajouter les **checkboxes de progression**
3. Ajouter la **machine d'état vocale** (`idle → listening → thinking → speaking`)
4. Ajouter les **détails des workers BullMQ** (evening report, SMS, outbound confirm)
5. Ajouter la mention **Telnyx pour Sprint 2**
6. Ajouter **Rate limiting + CORS**
7. Ajouter **PostHog Analytics**
8. Ajouter des **liens vers les notes connexes** (même si Obsidian-style links ne marchent pas dans Notion)

### Maintenance

- ⚠️ Aligner le nom de variable d'environnement dans `notion_mcp_client.py` : config Hermes utilise `NOTION_API_KEY`, mais le script utilise `NOTION_TOKEN`. Vérifier lequel le MCP server attend.
- Ajouter le Notion MCP serveur au fichier `agent/config/mcp-config.json` pour y accéder depuis l'agent.