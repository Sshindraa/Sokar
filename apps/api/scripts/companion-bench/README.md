# Banc de questions du Companion

Chaque question part dans `answerCompanion`, avec la vraie clé OpenRouter, directement (ni HTTP ni
plafond), sur la base locale de `DEMO_RESTAURANT_ID`. Le garde-fou refuse `NODE_ENV=production` et
toute base hors localhost.

## Lancer

Depuis `apps/api` :

```bash
pnpm exec tsx scripts/companion-bench/run.ts                       # toutes les questions, 1 essai
pnpm exec tsx scripts/companion-bench/run.ts --trials 3            # toutes les questions, 3 essais
pnpm exec tsx scripts/companion-bench/run.ts --only 3,7,12         # 3, 7 et 12 seulement, 1 essai
pnpm exec tsx scripts/companion-bench/run.ts --only 3,7 --trials 3 # combinaison
```

- `--trials N` : essais par question, 1 par défaut.
- `--only 3,7,12` : seules ces questions. Un numéro inconnu arrête le banc.

Les résultats (réponses brutes, appels d'outils avec leurs arguments et leurs résultats, tokens)
vont dans `results/<date>.json`, ignoré par git.

## Règle d'usage

Pendant une phase de travail, on joue 1 essai sur les seules questions touchées (`--only`). Les
3 essais sur tout le banc se lancent une seule fois, en fin de phase.

## Ce qui est noté

- Questions notées : celles qui ont une valeur attendue (`expected`). Les autres sont à relire
  dans `results/`.
- Deux critères : au moins un outil appelé ; puis la valeur attendue dans la réponse. Pour la
  question 26, le premier canal nommé doit aussi être le plus haut dans un résultat d'outil.
- Les valeurs attendues viennent de requêtes Prisma écrites dans ce fichier, indépendantes de
  `query-data.ts`.

## Tokens

Le total est donné en entrée (dont la part lue du cache) et en sortie. Mesure du 30 octobre 2026,
5 questions à 1 essai : environ 9 700 tokens en entrée par question, dont environ 9 100 lus du cache
(les consignes et les outils, à partir de la deuxième requête de chaque réponse).
