# Guide intégrateur MCP Sokar

> Statut: endpoint pilote local pour agents tiers.
> Transport actuel: JSON-RPC 2.0 stateless sur HTTP `POST /mcp`.

Sokar expose les restaurants opt-in via un serveur MCP générique. Un agent peut
découvrir un restaurant, vérifier une disponibilité, créer une réservation avec
consentement explicite, puis relire ou annuler la réservation.

## Endpoint

Local:

```http
POST http://localhost:4000/mcp
Content-Type: application/json
Authorization: Bearer sk_sokar_agent_xxx
Origin: https://claude.ai
```

Production:

```http
POST https://api.sokar.fr/mcp
Content-Type: application/json
Authorization: Bearer sk_sokar_agent_xxx
```

Le body est un message JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_restaurants",
    "arguments": {}
  }
}
```

Les batchs JSON-RPC sont acceptés en envoyant un tableau de messages.

## Authentification

Sokar accepte une API key Bearer:

```http
Authorization: Bearer sk_sokar_agent_xxx
```

La clé est vérifiée via la table `AgentClient`:

- `keyHash`: hash SHA-256 de la clé complète
- `keyPrefix`: préfixe affichable pour l'admin et les logs
- `restaurantId`: optionnel, limite le client à un restaurant
- `scopes`: `mcp:read`, `mcp:reserve`, `mcp:cancel` ou `mcp:*`
- `allowedOrigins`: allowlist par client si la requête browser envoie `Origin`
- `revokedAt`: révocation immédiate
- `lastUsedAt`: mis à jour à chaque appel réussi

En développement uniquement, `AGENT_DEV_KEY` reste accepté comme fallback si
aucun client `AgentClient` n'existe en base. Le seed local crée aussi un client
`AgentClient` hashé pour la clé de démo.

Le dashboard admin expose une page `Intégrations MCP` pour créer et révoquer les
clés en self-service. La clé complète est affichée une seule fois au moment de la
création; ensuite, seul `keyPrefix` reste visible.

Compatibilité: les anciens clients avec `mcp:write` restent acceptés pour les
actions de réservation et d'annulation, mais les nouvelles clés doivent utiliser
les scopes granulaires.

Les `Origin` browser acceptés aujourd'hui:

- `https://claude.ai`
- `https://cursor.sh`
- `http://localhost:3000`
- `http://localhost:4000`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:4000`

Les requêtes non-browser sans header `Origin` sont acceptées.

## Exposition restaurant

Tous les tools MCP appliquent les règles d'exposition avant d'appeler le core:

- restaurant opt-in: `Restaurant.agenticOptIn = true`
- exposition MCP: `RestaurantExposureSettings.mcpEnabled = true`
- client lié à un restaurant: accès limité à ce `restaurantId`
- taille de groupe: `partySize <= maxPartySize`
- délai minimum: `startsAt` respecte `minLeadTimeMinutes`
- créneaux exposés: `exposedCreneaux` contient le slot demandé, sauf liste vide

Un restaurant non exposé est masqué comme s'il n'existait pas (`NOT_FOUND`).
Une contrainte non respectée retourne `POLICY_VIOLATION`.

## Handshake MCP

### initialize

Requête:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

Réponse:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "sokar-mcp", "version": "0.1.0" }
  }
}
```

### tools/list

Requête:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Réponse: `result.tools` contient les outils publics:

- `search_restaurants`
- `get_restaurant_details`
- `check_availability`
- `create_reservation`
- `cancel_reservation`
- `get_reservation_status`

## Format tools/call

Tous les appels d'outil utilisent:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {}
  }
}
```

Succès:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{\"ok\":\"payload JSON sérialisé\"}" }],
    "isError": false
  }
}
```

Erreur métier:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "{\"ok\":false,\"error\":\"...\",\"code\":\"INVALID_INPUT\"}" }
    ],
    "isError": true
  }
}
```

Erreurs JSON-RPC transport:

- `-32700`: body vide ou parse error
- `-32600`: requête JSON-RPC invalide
- `-32601`: méthode inconnue
- `-32602`: paramètres invalides
- `-32603`: erreur interne

Erreurs HTTP auth:

- `401 UNAUTHORIZED`: header Authorization manquant
- `401 INVALID_API_KEY`: clé invalide
- `403 ORIGIN_NOT_ALLOWED`: Origin non autorisé

## Outils

### search_restaurants

Recherche les restaurants opt-in exposés MCP.

Arguments:

```json
{
  "city": "Lyon",
  "partySize": 2,
  "slotStart": "2026-06-23T17:00:00.000Z",
  "slotEnd": "2026-06-23T19:00:00.000Z",
  "cuisineType": ["Française"],
  "maxResults": 5
}
```

Contraintes:

- `city`: string, 1 à 100 caractères
- `partySize`: entier, 1 à 50
- `slotStart`, `slotEnd`: date-time ISO avec offset
- `cuisineType`: optionnel, maximum 10 valeurs
- `maxResults`: optionnel, entier 1 à 20, défaut 5

Réponse:

```json
{
  "restaurants": [
    {
      "id": "ba5be41b-eb72-4e05-bb9c-b576e39e33ba",
      "name": "Chez Sokar",
      "slug": "chez-sokar-demo"
    }
  ]
}
```

### get_restaurant_details

Retourne les informations publiques d'un restaurant.

Arguments:

```json
{
  "restaurantId": "ba5be41b-eb72-4e05-bb9c-b576e39e33ba"
}
```

Réponse:

```json
{
  "id": "ba5be41b-eb72-4e05-bb9c-b576e39e33ba",
  "name": "Chez Sokar",
  "slug": "chez-sokar-demo",
  "formattedAddress": "12 Rue de la République, 69001 Lyon",
  "phoneE164": "[REDACTED]",
  "websiteUrl": null,
  "cuisineType": ["Bistrot", "Française"],
  "priceRange": 2,
  "ambiance": ["Convivial", "Branché"],
  "noiseLevel": "ANIME",
  "dietary": ["Végétarien", "Sans gluten"],
  "openingHours": {
    "tue": { "open": "12:00", "close": "22:00" }
  }
}
```

Les champs PII ou sensibles sont redacted avant retour.

### check_availability

Vérifie un créneau pour un restaurant.

Arguments:

```json
{
  "restaurantId": "ba5be41b-eb72-4e05-bb9c-b576e39e33ba",
  "partySize": 2,
  "slotStart": "2026-06-23T17:30:00.000Z",
  "slotEnd": "2026-06-23T19:30:00.000Z"
}
```

Réponse:

```json
{
  "available": true
}
```

### create_reservation

Crée une réservation. L'agent doit avoir obtenu le consentement explicite de
l'utilisateur avant cet appel.

Arguments:

```json
{
  "restaurantId": "ba5be41b-eb72-4e05-bb9c-b576e39e33ba",
  "partySize": 2,
  "startsAt": "2026-06-23T17:30:00.000Z",
  "endsAt": "2026-06-23T19:30:00.000Z",
  "customerName": "Claude Test",
  "customerPhone": "+33612345678",
  "specialRequests": "Table en terrasse si possible",
  "holdToken": "optional-hold-token",
  "idempotencyKey": "agent-session-unique-key",
  "consents": {
    "reservationProcessing": true,
    "transactionalSms": false,
    "transactionalEmail": false,
    "marketingOptIn": false
  }
}
```

Contraintes:

- `customerPhone`: format E.164
- `reservationProcessing`: obligatoire et doit valoir `true`
- `idempotencyKey`: obligatoire, stable pour la tentative de création
- `specialRequests`: optionnel, maximum 500 caractères, filtré anti-injection
- `holdToken`: optionnel en phase pilote

Réponse:

```json
{
  "reservationId": "d7aa8415-cec7-4cb0-b7ef-267e14f46993",
  "state": "CONFIRMED",
  "reused": false
}
```

### get_reservation_status

Relit l'état d'une réservation.

Arguments:

```json
{
  "reservationId": "d7aa8415-cec7-4cb0-b7ef-267e14f46993"
}
```

Réponse:

```json
{
  "id": "d7aa8415-cec7-4cb0-b7ef-267e14f46993",
  "state": "CONFIRMED",
  "partySize": 2,
  "startsAt": "2026-06-23T17:30:00.000Z",
  "endsAt": "2026-06-23T19:30:00.000Z",
  "createdAt": "2026-06-22T19:35:41.000Z"
}
```

### cancel_reservation

Annule une réservation existante.

Arguments:

```json
{
  "reservationId": "d7aa8415-cec7-4cb0-b7ef-267e14f46993",
  "reason": "Utilisateur indisponible"
}
```

Réponse:

```json
{
  "cancelled": true
}
```

## Rate limit et sécurité

Chaque outil est rate-limité par client MCP. Les réponses sont filtrées avant
sortie:

- secrets et tokens remplacés par `[REDACTED]`
- emails inline remplacés par `[REDACTED_EMAIL]`
- téléphones inline remplacés par `[REDACTED_PHONE]`
- longues chaînes hexadécimales remplacées par `[REDACTED_HEX]`

Les appels sont audités via le core agentic.

## Test local E2E

Terminal 1:

```zsh
cd /Users/hamza/Desktop/Sokar/apps/api
PATH="/usr/local/opt/node@22/bin:$PATH" \
pnpm --filter @sokar/api exec tsx src/main.ts
```

Terminal 2:

```zsh
cd /Users/hamza/Desktop/Sokar
DATABASE_URL="$(awk -F= '$1=="DATABASE_URL"{sub(/^[^=]*=/,""); gsub(/^"|"$/,""); print; exit}' .env.local)" \
PATH="/usr/local/opt/node@22/bin:$PATH" \
pnpm db:seed

cd /Users/hamza/Desktop/Sokar/apps/api
SOKAR_MCP_KEY="sk_sokar_agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
PATH="/usr/local/opt/node@22/bin:$PATH" \
pnpm --filter @sokar/api exec tsx ../../scripts/smoke/test-mcp-client.ts
```

Le client de test exécute:

1. `initialize`
2. `tools/list`
3. `search_restaurants`
4. `get_restaurant_details`
5. `check_availability`
6. `create_reservation`
7. `get_reservation_status`

## Claude Desktop via stdio

Le bridge stdio local expose les mêmes 6 tools et proxy les appels vers
`POST /mcp`. L'API Sokar doit tourner à côté.

Commande manuelle:

```zsh
cd /Users/hamza/Desktop/Sokar/apps/api
SOKAR_API_BASE="http://localhost:4000" \
SOKAR_MCP_KEY="sk_sokar_agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
PATH="/usr/local/opt/node@22/bin:$PATH" \
pnpm --filter @sokar/api exec tsx ../../scripts/smoke/sokar-mcp-stdio.ts
```

Exemple `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sokar-restaurants": {
      "command": "/Users/hamza/.npm-global/bin/pnpm",
      "args": [
        "--dir",
        "/Users/hamza/Desktop/Sokar/apps/api",
        "exec",
        "tsx",
        "../../scripts/smoke/sokar-mcp-stdio.ts"
      ],
      "env": {
        "PATH": "/usr/local/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin",
        "SOKAR_API_BASE": "http://localhost:4000",
        "SOKAR_MCP_KEY": "sk_sokar_agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    }
  }
}
```
