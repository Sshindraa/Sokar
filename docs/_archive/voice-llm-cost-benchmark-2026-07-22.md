# Benchmark LLM voix économique — 22 juillet 2026

## Conclusion

Pour un objectif prioritaire de coût, latence et fiabilité conversationnelle, le meilleur modèle
testé reste `mistralai/mistral-small-3.2-24b-instruct`. Aucun challenger économique récent ne le
remplace sans compromis important.

## Panel et protocole

- Contrôle : Mistral Small 3.2, fournisseur Mistral fixé sans fallback.
- Challengers : Granite 4.1 8B, Seed 2.0 Mini, Nex-N2-Mini, Mistral Small 4 et Gemma 4 31B.
- Six scénarios fictifs × trois répétitions : 108 scénarios au total.
- Streaming, raisonnement minimal, température 0,2 et limite de 150 tokens comme le pipeline voix.
- Validation stricte du nom de l'outil, du JSON, des types et des valeurs métier.
- Boucle complète avec résultat d'outil simulé puis réponse finale prête pour le TTS.
- Aucun prompt interne, paramètre restaurant, client réel, appel ou accès base de données.

## Résultats

| Modèle            | Exactitude | Phrase p50 | Phrase p95 | Coût/scénario | Ratio coût vs Mistral |
| ----------------- | ---------: | ---------: | ---------: | ------------: | --------------------: |
| Mistral Small 3.2 |      18/18 |   1 055 ms |   1 642 ms |     $0.000144 |                 1,00× |
| Seed 2.0 Mini     |      18/18 |   1 861 ms |   2 740 ms |     $0.000280 |                 1,94× |
| Nex-N2-Mini       |      16/18 |   1 863 ms |   3 368 ms |     $0.000061 |                 0,42× |
| Granite 4.1 8B    |      14/18 |   1 059 ms |   1 962 ms |     $0.000098 |                 0,68× |
| Mistral Small 4   |      12/18 |   2 368 ms |   3 893 ms |     $0.000324 |                 2,25× |
| Gemma 4 31B       |      10/18 |   2 997 ms |   4 989 ms |     $0.000189 |                 1,31× |

Granite est presque aussi rapide et environ 32 % moins cher, mais ignore systématiquement le
transfert obligatoire des groupes de neuf personnes et rate un signalement de retard. Nex est le
moins cher mais choisit `checkAvailability` au lieu de créer la réservation sur deux essais.
Seed est le seul challenger à 18/18, mais il est 76 % plus lent en médiane, 67 % plus lent au p95
et presque deux fois plus cher. Sa formulation finale promet aussi une table à l'arrivée après un
simple signalement de retard et affirme à tort que les groupes de plus de sept personnes ne sont
pas accueillis.

## Décision

1. Conserver Mistral Small 3.2 comme modèle vocal par défaut.
2. Ne pas basculer sur Seed : aucun gain de coût ni de latence.
3. Ne considérer Granite que comme expérimentation après durcissement déterministe des transferts,
   pas comme remplacement production.
4. Chercher les gains de latence dans le pipeline actuel : il abandonne le premier stream lors
   d'un tool call puis répète la requête en non-streaming avant d'exécuter l'outil.

Le runner `apps/api/scripts/benchmark-voice-llms.ts` utilise le panel économique par défaut. Les
résultats bruts sont dans `/tmp/sokar-voice-llm-cost-benchmark-2026-07-22.json`.
