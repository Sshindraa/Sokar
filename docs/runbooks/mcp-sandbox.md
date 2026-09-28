# Runbook — Sandbox MCP

> **Statut : ACTIF — 29 septembre 2026.**
> Cette sandbox réutilise le restaurant `chez-sokar-demo`. Elle est conçue pour
> les tests de connecteurs et rejette les bases dont le nom n’indique pas un
> environnement local, staging, test ou dev.

## Prérequis

- Le seed a créé `chez-sokar-demo` avec `agenticOptIn=true` et `mcpEnabled=true`.
- La base cible est locale, staging, test ou dev.
- Les tests utilisent le téléphone factice `+33612345600`.
- Un seul run MCP sandbox est exécuté à la fois sur le restaurant de démo.

## Démarrer un run

```zsh
pnpm --filter @sokar/database mcp:sandbox start
```

La commande ne crée aucune donnée. Elle affiche un manifeste à conserver :

```json
{
  "runId": "mcp-xxxxxxxx",
  "startedAt": "2026-09-29T10:00:00.000Z",
  "restaurantId": "…",
  "restaurantSlug": "chez-sokar-demo",
  "customerPhone": "+33612345600",
  "specialRequestsMarker": "MCP-SANDBOX:mcp-xxxxxxxx"
}
```

Pour rejouer exactement le même scénario plusieurs fois, fixez le `run-id` :

```zsh
pnpm --filter @sokar/database mcp:sandbox start --run-id=chatgpt-20260929
```

## Scénario de test

Utiliser `chez-sokar-demo`, le téléphone du manifeste et, pour chaque
réservation créée manuellement, ajouter le marqueur dans `specialRequests` :

```text
MCP-SANDBOX:chatgpt-20260929
```

Parcours minimal :

1. Initialisation MCP et lecture de `tools/list`.
2. `search_restaurants` sur Lyon.
3. `check_availability` sur un créneau futur.
4. `create_hold`, puis `create_reservation` avec consentement explicite.
5. `get_reservation_status` avec la référence et le téléphone.
6. `modify_reservation`.
7. `cancel_reservation`.
8. Répéter les accès négatifs avec un mauvais téléphone et un autre client.

## Consulter l’état

```zsh
pnpm --filter @sokar/database mcp:sandbox status \
  --run-id=chatgpt-20260929 \
  --started-at=2026-09-29T10:00:00.000Z
```

## Purger le run

La purge est d’abord simulée :

```zsh
pnpm --filter @sokar/database mcp:sandbox reset \
  --run-id=chatgpt-20260929 \
  --started-at=2026-09-29T10:00:00.000Z
```

Vérifier les compteurs, puis ajouter `--apply` :

```zsh
pnpm --filter @sokar/database mcp:sandbox reset \
  --run-id=chatgpt-20260929 \
  --started-at=2026-09-29T10:00:00.000Z \
  --apply
```

La purge ne touche qu’aux réservations MCP marquées, aux holds MCP créés
pendant le run, aux entrées de liste d’attente du téléphone de test, au client
de test créé pendant le run et aux journaux/idempotence associés. Elle refuse
une base de production dont le nom ne contient pas `staging`, `test`, `dev` ou
`local`.

## Matrice de compatibilité

Compléter
[`../release/evidence/mcp-connector-compatibility-matrix-2026-09-29.md`](../release/evidence/mcp-connector-compatibility-matrix-2026-09-29.md)
avec les captures d’écran OAuth et les résultats observés dans ChatGPT et
Claude. Une matrice vide ou `À exécuter` ne constitue pas une preuve de
compatibilité.
