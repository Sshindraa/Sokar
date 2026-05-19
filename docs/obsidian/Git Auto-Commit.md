# Git Auto-Commit System

Système de commits automatiques pour le monorepo Callyx.

## Usage Rapide

```bash
# Commit automatique avec message intelligent
callyx-commit

# Commit avec message personnalisé
callyx-commit "feat(api): ajoute la route reservations"

# Commit + push vers GitHub
callyx-commit --push

# Commit personnalisé + push
callyx-commit "fix: corrige le bug voice" --push
```

## Comment ça marche

Le script `agent/scripts/auto-commit.sh` analyse les fichiers modifiés et génère un message de commit au format [Conventional Commits](https://www.conventionalcommits.org/):

| Détection | Type | Scope | Exemple |
|-----------|------|-------|---------|
| Fichiers dans `apps/api` | `feat` ou `fix` | `api` | `feat(api): update 3 file(s)` |
| Fichiers dans `apps/dashboard` | `feat` | `dashboard` | `feat(dashboard): update 2 file(s)` |
| Fichiers dans `packages/database` | `feat` | `database` | `feat(database): update 1 file(s)` |
| Fichiers dans `agent/` | `feat` | `agent` | `feat(agent): update 4 file(s)` |
| Fichiers dans `docs/` | `docs` | `docs` | `docs(docs): update 5 file(s)` |
| Fichiers de config | `chore` | `config` | `chore(config): update 2 file(s)` |
| Fichiers avec "test" | `test` | module | `test(api): update 3 file(s)` |

## Alias

Ajoute dans ton `~/.zshrc` :

```bash
alias callyx-commit="/Users/hamza/Desktop/Callyx/agent/scripts/auto-commit.sh"
```

Puis recharge :

```bash
source ~/.zshrc
```

## Commit Manuel (sans script)

```bash
cd /Users/hamza/Desktop/Callyx
git add -A
git commit -m "ton message"
git push origin main
```

## Voir l'historique

```bash
git log --oneline --graph -20
```

## Mode Automatique (Cron)

Un daemon tourne en arrière-plan et commit **toutes les 15 minutes** si des fichiers ont changé.

### Vérifier que le cron est actif

```bash
crontab -l | grep callyx
```

Tu dois voir :
```
*/15 * * * * /bin/zsh /Users/hamza/Desktop/Callyx/agent/scripts/auto-commit-daemon.sh
```

### Désactiver le cron auto

```bash
crontab -l | grep -v callyx | crontab -
```

### Logs du daemon

```bash
tail -f /Users/hamza/Desktop/Callyx/.git/auto-commit.log
```

### Fonctionnement du daemon

- Toutes les 15 minutes, vérifie s'il y a des changements
- Détecte le scope (`api`, `dashboard`, `database`, `agent`, `docs`) automatiquement
- Commit avec message au format Conventional Commits
- Push vers GitHub automatiquement
- Logue chaque action dans `.git/auto-commit.log`

## Lier avec Obsidian

Chaque commit est logué automatiquement dans [[Journal.md]] via le MCP serveur.
