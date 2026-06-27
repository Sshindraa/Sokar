# Scripts Sokar

Ce dossier doit rester petit et lisible. Avant d'ajouter un script, vérifie s'il
peut être une commande `package.json`, une tâche CI, ou une note de runbook.

## Surface officielle

Ces scripts sont les chemins stables utilisés par les hooks, le déploiement ou
les opérations de production récurrentes :

- `deploy-vps.sh` — déploiement production VPS (avec release dirs + rollback).
  - `deploy-vps.sh [branch]` — déploiement normal (snapshot pré/post build).
  - `deploy-vps.sh rollback [timestamp]` — rollback vers une release précédente.
- `backup-postgres.sh` — backup PostgreSQL local avec vérification.
- `backup-postgres-r2.sh` — backup PostgreSQL offsite vers Cloudflare R2 (SHA256, quota, rotation).
- `deploy-r2-backup.sh` — déploie le backup R2 + rclone + cron sur le VPS.
- `restore-postgres-backup.sh` — restauration contrôlée d'un dump (garde anti-prod, `SKIP_PROD_GUARD=1` pour P0).
- `test-restore-vierge.sh` — prouve le restore bout-en-bout sur une base vierge depuis R2.
- `check-memory.sh` — garde-fou mémoire local.
- `precommit-review.sh` — hook pre-commit.
- `prepush-quality-gate.sh` — hook pre-push.

## Sous-dossiers

- `ops/` — scripts one-shot d'installation ou de durcissement infra.
- `smoke/` — outils manuels (dogfood IA, simulation voice, bridge MCP stdio, diagnostic clés API). Pas des tests automatisés — la couverture MCP/OAuth est dans `apps/api/src/modules/agentic-reservations/__tests__/` (Vitest).
- `sql/` — requêtes SQL opérationnelles ou d'urgence.
- `agent/` — automatisations liées aux agents locaux.

## Règle anti-cumul

Ajoute un nouveau script seulement si les trois points sont vrais :

1. la commande sera réutilisée ;
2. elle a un propriétaire clair (`prod`, `dev`, `smoke`, `agent`, `sql`) ;
3. elle est référencée depuis ce README, `package.json`, un hook, ou un runbook.

Sinon, garde la commande dans la documentation du runbook concerné.
