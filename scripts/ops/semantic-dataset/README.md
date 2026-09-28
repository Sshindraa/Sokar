# Jeu d'évaluation figé des signaux sémantiques (Jev)

`apps/api/scripts/fixtures/semantic-eval/synthetic-v1.jsonl` : 144 tours de
conversation téléphonique **synthétiques** (aucune donnée d'appel réel),
étiquetés une fois pour toutes. Il sert à mesurer chaque changement de Jev
(définitions, cadrage, version du modèle) sur une base identique, sans le bruit
d'un juge qui varie d'un passage à l'autre.

| Catégorie      | Cas |     | Catégorie      | Cas |
| -------------- | --- | --- | -------------- | --- |
| confirmation   | 15  |     | autre_question | 15  |
| hesitation     | 5   |     | gerant         | 12  |
| refus          | 14  |     | message        | 12  |
| correction     | 15  |     | annulation     | 9   |
| reponse_simple | 10  |     | carte_cadeau   | 10  |
| incertain      | 14  |     | ambigu         | 13  |

Chaque ligne : `{ id, category, awaitingBefore, input, output, labels, disputed }`,
compatible avec `semantic:eval` (les champs en plus sont ignorés). `disputed`
liste les comportements sur lesquels les deux premiers votes divergeaient.

## Mesurer Jev

```bash
OPENROUTER_API_KEY=… pnpm --filter api semantic:eval \
  scripts/fixtures/semantic-eval/synthetic-v1.jsonl --provider openrouter
```

Référence v1 (définitions `2026-09-28.3-jev`, 28/09/2026), précision / rappel au
seuil 0,8 : répond à la question 98/87, corrige 100/87, change de sujet 95/88,
incertain 100/93, confirme 100/85, refuse 94/77, gérant, message, annulation et
carte cadeau 100/100, besoin de précision 100/**26**.

## Limites

- Généré et étiqueté par un seul modèle (MiMo v2.6 Pro) : le vote à la majorité
  réduit ses erreurs aléatoires, pas ses biais. Les cas sont plus propres que de
  vrais appels (sur les appels de test du 27/09, `fact_is_tentative` avait 25 %
  de précision) : ces chiffres sont un plafond, à confronter à l'évaluation
  hebdomadaire sur les vrais appels.
- Peu de cas d'hésitation (5) et de carte cadeau positive (4).

## Reconstruire (coût ≈ 0,0025 $ par cas avec MiMo v2.6 Pro)

1. Exporter les définitions depuis le code :
   `pnpm --filter api exec tsx -e "import {BEHAVIORS} from './src/modules/voice/stream/semantic-signals/behaviors'; console.log(JSON.stringify({behaviors: BEHAVIORS.map(({id,instructions,present,absent})=>({id,instructions,present,absent}))}))" > defs.json`
2. `OPENROUTER_API_KEY=… node scripts/ops/semantic-dataset/build.mjs --defs defs.json --out synthetic.jsonl --per-category 20`

Changer les définitions ne demande **pas** de reconstruire le jeu : les
étiquettes décrivent ce que dit le client, pas la formulation des questions.
Reconstruire seulement pour ajouter des catégories ou des cas.
