---
name: deployment-check
description: Verifier, deployer et valider un changement Sokar sur staging ou production de maniere sure.
triggers:
  - user
  - model
allowed-tools:
  - read
  - edit
  - write
  - grep
  - glob
  - exec
  - todo_write
  - ask_user_question
  - skill
---

Tu dois verifier l'etat du repo avant de deployer Sokar, puis executer et valider le deploiement selon les regles de `AGENTS.md` et `docs/runbooks/`.

## Quand utiliser ce skill

- Avant un deploy en staging ou production.
- Apres un deploy pour valider que les services sont sains.
- Quand un workflow de deploy ou un service en prod pose probleme.

## Fichiers a consulter

- `AGENTS.md` : regles staging/production, commandes.
- `docs/runbooks/deployment.md`.
- `docs/runbooks/rollback.md`.
- `docs/runbooks/staging.md`.
- `docs/runbooks/environment.md`.
- `scripts/deploy-vps.sh` et `scripts/deploy-staging.sh`.
- `.github/workflows/` pour la CI.
- `infra/ecosystem*.config.js` pour PM2.
- `packages/database/prisma/migrations/` pour detecter une migration en attente.

## Etapes

1. Pre-deploy
   - Verifier `git status` : pas de modifications non committees locales.
   - Verifier `git log --oneline -5` pour connaitre le dernier commit a deployer.
   - Identifier si une migration Prisma est en attente (schema vs migrations appliquees).
   - Lancer `pnpm test`, `pnpm typecheck`, `pnpm lint` si possible en local.
   - S'assurer qu'aucun secret n'est expose dans le diff.

2. Decision
   - Staging : deploy automatique apres CI verte (`pnpm deploy:staging`).
   - Production : demander une confirmation explicite. Mentionner :
     - le hash/commit deploye,
     - les migrations DB eventuelles,
     - les services redemarres.
   - Si tests/lint/typecheck echouent, ne pas deployer.

3. Deploy
   - Pour staging : `pnpm deploy:staging`.
   - Pour production : `pnpm deploy:prod` (apres confirmation explicite).
   - Si un rollback est necessaire : `ssh deploy@pmbtc 'cd /opt/sokar && bash scripts/deploy-vps.sh --rollback <timestamp>'` ; utiliser `--with-db-rollback` seulement si le backup DB est acceptable.

4. Post-deploy
   - Verifier `pm2 status` sur le VPS.
   - Verifier les endpoints `/health` et `/livez` de l'API.
   - Verifier les logs recents (`pm2 logs --lines 50`).
   - Valider le dashboard et connect via les URL de prod/staging.

5. Resume
   - Lister les commits deployes.
   - Indiquer si une migration DB a ete appliquee.
   - Resumer le statut des services.
   - Signaler tout risque ou anomalie.

## Limites

- Jamais de deploy en production sans confirmation explicite.
- Jamais de force-push ou de `git push --force`.
- Ne pas ignorer un echec de test/lint/typecheck.
- Si rollback DB, verifier le timestamp du backup dans `/var/backups/sokar/`.

## Format du resume final

```
## Deploy
- Environnement : staging / production
- Commande : ...
- Commit : ...

## Migration DB
Oui / Non — [nom]

## Verifications
- [ ] `pnpm test` passe
- [ ] `pnpm typecheck` passe
- [ ] `pnpm lint` passe
- [ ] `pm2 status` OK
- [ ] `/health` et `/livez` OK
- [ ] Logs sans erreur critique

## Services
- sokar-api : online / offline
- sokar-dashboard : online / offline
- sokar-connect : online / offline

## Risques / Actions
- ...
```
