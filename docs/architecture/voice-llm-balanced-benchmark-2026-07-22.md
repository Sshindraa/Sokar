# Benchmark LLM voix équilibré — 22 juillet 2026

## Conclusion

Avec un budget légèrement relevé, `google/gemini-3.1-flash-lite` est le remplacement prudent et
`google/gemini-3.5-flash-lite` l'option de latence maximale. Les deux conservent 100 % d'exactitude
sur les appels d'outils. Gemini 3.1 est recommandé pour un premier canary grâce à son ancienneté
supérieure, son p95 stable et son coût inférieur à Gemini 3.5.

## Panel et protocole

- Mistral Small 3.2 comme contrôle.
- GPT-5.4 Nano, Gemini 3.1 Flash Lite, Gemini 3.5 Flash-Lite et GPT-5.4 Mini.
- Six scénarios fictifs × trois répétitions, boucle d'outil complète et réponse prête pour le TTS.
- Même protocole assaini et mêmes validateurs stricts que les deux campagnes précédentes.
- Aucun prompt interne, client, accès base de données ou changement production.

## Résultats du panel intermédiaire

| Modèle                | Exactitude | Phrase p50 | Phrase p95 | Coût/scénario | Ratio coût vs Mistral |
| --------------------- | ---------: | ---------: | ---------: | ------------: | --------------------: |
| Gemini 3.5 Flash-Lite |      18/18 |     950 ms |   1 978 ms |     $0.000621 |                 4,32× |
| Mistral Small 3.2     |      18/18 |   1 161 ms |   2 069 ms |     $0.000144 |                 1,00× |
| Gemini 3.1 Flash Lite |      18/18 |   1 218 ms |   1 642 ms |     $0.000487 |                 3,38× |
| GPT-5.4 Mini          |      18/18 |   1 751 ms |   2 816 ms |     $0.001185 |                 8,23× |
| GPT-5.4 Nano          |      18/18 |   2 075 ms |   2 691 ms |     $0.000358 |                 2,49× |

## Consolidation des deux campagnes comparables

Mistral et les deux Gemini ont chacun 36 observations avec exactement la même configuration.

| Modèle                | Exactitude | Phrase p50 | Phrase p95 | Coût moyen/scénario |
| --------------------- | ---------: | ---------: | ---------: | ------------------: |
| Gemini 3.5 Flash-Lite |      36/36 |     990 ms |   1 615 ms |           $0.000622 |
| Gemini 3.1 Flash Lite |      36/36 |   1 238 ms |   1 642 ms |           $0.000487 |
| Mistral Small 3.2     |      36/36 |   1 146 ms |   2 099 ms |           $0.000144 |

Gemini 3.5 réduit la médiane de 156 ms et le p95 de 484 ms face à Mistral. Gemini 3.1 est 92 ms
plus lent en médiane mais réduit le p95 de 457 ms. GPT-5.4 Nano et Mini n'apportent aucun gain de
latence malgré une exactitude parfaite.

## Recommandation

1. Canary initial : Gemini 3.1 Flash Lite sur le restaurant de test.
2. Variante agressive : Gemini 3.5 Flash-Lite si le gain médian justifie 28 % de coût en plus par
   rapport à Gemini 3.1 et si sa sortie récente est acceptable.
3. Garder Mistral comme contrôle et fallback pendant le canary.
4. Mesurer le premier audio Cartesia, les interruptions, les multi-tours et les transcriptions
   bruitées avant toute généralisation.

Le panel se relance avec `BENCHMARK_PANEL=balanced`. Les résultats bruts sont dans
`/tmp/sokar-voice-llm-balanced-benchmark-2026-07-22.json`.
