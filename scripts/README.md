# Scripts Sokar

Ce dossier contient uniquement les entrées d'exploitation et les helpers
réutilisables du monorepo. Les procédures ponctuelles et historiques sont
conservées dans [`docs/archive/operations/`](../docs/archive/operations/).

## Entrées publiques

Ces chemins sont stables et peuvent être appelés depuis la CI, les runbooks ou
les commandes `package.json` :

- `deploy-vps.sh` — déploiement production avec releases, snapshots et rollback.
- `deploy-staging.sh` — déploiement staging et smoke checks.
- `precommit-review.sh` — garde-fous secrets et code dangereux avant commit.
- `prepush-quality-gate.sh` — vérifications ciblées avant push.
- `backup-postgres-r2.sh` — shim de compatibilité pour l'ancien cron VPS ; les nouvelles installations utilisent `database/backup-postgres-r2.sh`.
- `agent/submit-pr.sh` — soumission et auto-merge des PR d'agents.

## Organisation

- `build/` — helpers Next.js (`copy-static.sh`, `guard-next-build.sh`).
- `database/` — sauvegarde, restauration et test de restauration PostgreSQL/R2.
- `ops/` — installation et exploitation VPS, watchdog, TLS, staging et R2.
- `quality/` — diagnostics locaux utilisés par les hooks.
- `smoke/` — diagnostics manuels voix, MCP et dogfood ; ce ne sont pas des tests CI.
- `sql/` — requêtes d'audit ou d'urgence, à exécuter avec validation explicite.
- `agent/` — outils d'automatisation pour les agents IA.

## Règle d'ajout

Avant d'ajouter un script, vérifier si une commande `package.json`, une tâche CI
ou un runbook suffit. Un nouveau script doit être réutilisable, avoir un
propriétaire (`build`, `database`, `ops`, `quality`, `smoke`, `sql` ou `agent`)
et être référencé ici ou dans son runbook.
