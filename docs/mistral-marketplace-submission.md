# Dossier de soumission — Connector Mistral Marketplace (Sokar)

> **Ne pas commiter le client secret.** Le secret est affiche dans la console du script.

## 1. Informations generales

- **Nom du connector** : `sokar` (ou `sokar-restaurant-reservations`)
- **Description** : Reservez une table dans un restaurant partenaire Sokar directement depuis Mistral Le Chat.
- **Server URL** : `https://api-staging.sokar.tech/mcp`
- **Icon URL** : (a fournir, ex: https://staging.sokar.tech/favicon.ico)
- **System prompt** : (optionnel — prompt injecte quand les outils sont utilises)

## 2. Endpoints OAuth

- **Issuer** : `https://api-staging.sokar.tech`
- **Authorization endpoint** : `https://api-staging.sokar.tech/oauth/authorize`
- **Token endpoint** : `https://api-staging.sokar.tech/oauth/token`
- **Registration endpoint** (Dynamic Client Registration) : `https://api-staging.sokar.tech/oauth/register`
- **Protected resource metadata** : `https://api-staging.sokar.tech/.well-known/oauth-protected-resource`
- **Authorization server metadata** : `https://api-staging.sokar.tech/.well-known/oauth-authorization-server`

## 3. Credentials OAuth

- **client_id** : `2bcdfa2d-f812-4b84-8bfe-7f600661dea4`
- **client_secret** : `__MISTRAL_CLIENT_SECRET__` (remplacer par le secret affiche dans la console)
- **redirect_uris** :
  - https://chat.mistral.ai/mcp/callback
  - https://chat.mistral.ai/mcp/auth_callback
  - https://console.mistral.ai/build/connectors/debugger/oauth-callback
- **scopes** : `mcp:read mcp:reserve mcp:cancel`
- **grant_types** : `authorization_code`, `refresh_token`
- **response_type** : `code`
- **code_challenge_method** : `S256` (PKCE supporte)
- **token_endpoint_auth_method** : `client_secret_basic` ou `client_secret_post`

## 4. Exemple de payload `auth_data`

```json
{
  "client_id": "2bcdfa2d-f812-4b84-8bfe-7f600661dea4",
  "client_secret": "__MISTRAL_CLIENT_SECRET__",
  "scopes": ["mcp:read", "mcp:reserve", "mcp:cancel"],
  "redirect_uri": "https://chat.mistral.ai/mcp/callback"
}
```

## 5. Notes pour Mistral

- Le MCP server Sokar implemente **StreamableHTTP** (POST /mcp) et refuse le GET /mcp (405), conformement a la spec MCP 2025-03-26.
- L'authentification se fait via OAuth 2.0 Authorization Code avec PKCE.
- Le consentement est public (pas de login Clerk cote client final) : l'utilisateur approuve/deny sur une page Sokar.
- Le scoping se fait au niveau des tools : le token donne acces a tous les restaurants ayant active MCP dans leur dashboard.

## 6. Contact

- **Email support** : support@sokar.tech (a remplacer)
- **Page produit** : https://staging.sokar.tech (a remplacer par prod)
