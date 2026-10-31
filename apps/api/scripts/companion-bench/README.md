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
pnpm exec tsx scripts/companion-bench/run.ts --model anthropic/claude-haiku-5.5 --reasoning medium
```

- `--trials N` : essais par question, 1 par défaut.
- `--only 3,7,12` : seules ces questions. Un numéro inconnu arrête le banc.
- `--model <id>` : identifiant OpenRouter. Absent : le modèle de production (`COMPANION_LLM_MODEL`).
- `--reasoning low|medium|high` : effort de raisonnement. Absent : celui de production (bas).
- `--rescore <fichier>` : renote l'ancrage et le chiffre d'un fichier de `results/`, sans appeler le
  modèle (mêmes réponses, critères courants). Les valeurs sont recalculées dans la base et rangées
  dans `expectedNow`. Si une valeur enregistrée ne se retrouve plus, la question est signalée en
  « dérive » et garde son chiffre. Écrit `<fichier>-rescored.json`.

Les résultats (réponses brutes, appels d'outils avec leurs arguments et leurs résultats, tokens)
vont dans `results/<date>.json`, ignoré par git.

## Règle d'usage

Pendant une phase de travail, on joue 1 essai sur les seules questions touchées (`--only`). Les
3 essais sur tout le banc se lancent une seule fois, en fin de phase.

## Ce qui est noté

- Questions notées : celles qui ont une valeur attendue (`expected`). Les autres sont à relire
  dans `results/`.
- Deux critères pour les questions notées : l'outil (au moins un appel ; pour une question
  d'enquête, un appel avec `compare` et deux angles, un angle = une source et un regroupement) ;
  puis la valeur attendue dans la réponse, à la tolérance de la question. Pour la question 26, le
  premier canal nommé doit aussi être le plus haut dans un résultat d'outil.
- Ancrage, sur toutes les questions : chaque nombre de la réponse doit venir d'un résultat d'outil
  de la même réponse. Ne comptent pas : les dates, les années, les heures, les durées (« 30 jours »),
  « 1er », « sur 5» et les intervalles « du 1er au 30 ». Un nombre arrondi à l'unité ou au dixième
  est ancré, et le signe d'un écart peut se dire en mots.
- Lectures (questions 10 et 42 à 47) : une question peut se lire de plusieurs façons (mesure, date,
  référence). Chaque lecture possible a ses valeurs, calculées dans la base, et des repères que la
  réponse doit employer pour dire laquelle elle a choisie (`says`). Une réponse est juste si elle
  nomme une lecture et donne toutes ses valeurs, à la tolérance de la question. Pour une question
  sans période (44 à 47), chaque fenêtre naturelle (7 jours, 30 jours, mois en cours) est une
  lecture ; la fenêtre se nomme par son libellé ou par une de ses dates. Les questions 42 à 47 sont
  des enquêtes : elles doivent passer par `explain_change`.
- Ajouts faits après la lecture des réponses de la passe B2 (le texte des questions ne change pas) :
  fenêtres de 7 et 30 jours pour les questions sans période (44 à 47) ; repère par date pour une
  fenêtre (« du 2 au 31 octobre ») ; réservations à côté des couverts (42, 43), date de prise (43, 46) et semaine précédente pour le mardi 20 (42).
- Les valeurs attendues viennent de requêtes Prisma écrites dans ce fichier, indépendantes de
  `query-data.ts`.

## Tokens

Le total est donné en entrée (dont la part lue du cache) et en sortie, avec les moyennes par
essai pour une question simple et pour une question d'enquête. Les consignes et les outils sont lus
du cache à partir de la deuxième requête de chaque réponse.
