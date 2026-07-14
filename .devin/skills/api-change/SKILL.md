---
name: api-change
description: Modifier le backend Sokar (API, Prisma, workers, shared, config) de maniere sure et verifiee.
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

Tu dois aider a modifier le backend de Sokar (apps/api, packages/database, packages/shared, packages/config) en suivant le process ci-dessous.

## Quand utiliser ce skill

- Ajouter ou modifier une route, un service, un worker ou un plugin dans `apps/api`.
- Modifier le schema Prisma ou ajouter une migration dans `packages/database`.
- Ajouter un utilitaire partage dans `packages/shared` ou `packages/config`.
- Corriger un bug de logique backend, de validation, de queue, de DB, etc.

## Fichiers a consulter

- `AGENTS.md` : conventions, commandes, regles de securite, contraintes dashboard.
- `docs/PROJECT_MAP.md` : architecture, flux, points sensibles.
- `docs/TECHNICAL_BACKLOG.md` : verifier si l'item existe deja.
- `docs/runbooks/migration.md` si modification Prisma.
- `docs/runbooks/environment.md` si ajout de variable d'environnement.
- Le(s) module(s) concernes dans `apps/api/src/modules/`.
- Les tests existants : `__tests__/*.test.ts` dans le module.
- `apps/api/src/env.ts` si nouvelle env var.
- `packages/database/prisma/schema.prisma` si modele impacte.

## Etapes

1. Explorer
   - Identifier les fichiers concernes et les flux existants.
   - Rechercher les usages du code a modifier avec `grep`.
   - Lire les tests existants pour comprendre le contrat attendu.

2. Comprendre et expliquer
   - Resumer l'architecture ou la cause du probleme en 2-3 phrases.
   - Si le changement touche plusieurs fichiers, un domaine sensible (auth, paiement, voice, DB) ou implique une migration, proposer un plan avant d'implementer.

3. Implementer
   - Diff minimal.
   - Respecter les conventions TypeScript, Fastify, Prisma, Zod.
   - Ne jamais commiter de secrets.
   - Pour une migration Prisma, generer `migration.sql` avec `pnpm db:migrate --name <nom>`.
   - Pour un champ env var, l'ajouter dans `apps/api/src/env.ts`, `.env.example` et `.env.staging.example` si applicable.

4. Tests
   - Ajouter ou mettre a jour un test unitaire/integrations cible.
   - Si Prisma est modifie, s'assurer que le client est regenere (`pnpm db:generate`).

5. Verifications
   - `pnpm test` filtre si possible (ex: `pnpm --filter @sokar/api test`).
   - `pnpm typecheck`.
   - `pnpm lint`.
   - Si schema change : `pnpm db:generate` puis verifier que les tests passent.

6. Livraison
   - Lister les fichiers modifies.
   - Indiquer s'il y a une migration DB.
   - Resumer les tests ajoutes et les verifications lancees.
   - Signaler les risques restants.
   - Ne pas deployer en production sans confirmation explicite.

## Limites

- Ne pas toucher aux paiements (gift-cards, Stripe) ni a la voice si ce n'est pas le perimetre demande.
- Ne pas modifier la DB sans signaler clairement le changement.
- Pas de breaking change sans validation explicite.
- Pas de deploy prod sans confirmation.

## Format du resume final

```
## Changement
[Resumer en une phrase]

## Fichiers modifies
- ...

## Migration DB
Oui / Non — [nom de la migration]

## Tests
- [ ] test unitaire ajoute/mis a jour
- [ ] `pnpm typecheck` passe
- [ ] `pnpm lint` passe
- [ ] `pnpm test` passe

## Risques
- ...
```
