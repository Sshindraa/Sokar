# Matrice de compatibilité MCP — 29 septembre 2026

> **Statut : À exécuter.** Cette matrice est le modèle de preuve pour les
> tests réels ChatGPT et Claude. Elle ne remplace pas les tests automatisés et
> ne doit pas être signée avant d’avoir capturé les écrans OAuth et les
> réponses observées.

## Périmètre

- Serveur : `https://api.sokar.tech/mcp`
- Restaurant sandbox : `chez-sokar-demo`
- Téléphone sandbox : `+33612345600`
- Runbook : [`../../runbooks/mcp-sandbox.md`](../../runbooks/mcp-sandbox.md)
- OpenAI : [Authentication – Plugins](https://developers.openai.com/plugins/build/auth)

## Contrat OAuth

| Vérification                                        | ChatGPT    | Claude     | Preuve                               |
| --------------------------------------------------- | ---------- | ---------- | ------------------------------------ |
| Découverte `.well-known/oauth-protected-resource`   | À exécuter | À exécuter | Capture de la réponse JSON           |
| `resource` écopié dans authorization et token       | À exécuter | À exécuter | Capture requête/réponse              |
| PKCE `S256`                                         | À exécuter | À exécuter | Capture de l’écran puis de l’échange |
| `authorization_response_iss_parameter_supported`    | À exécuter | À exécuter | Métadonnée et `iss` de callback      |
| Méthode client `none` ou `client_secret_*`          | À exécuter | À exécuter | DCR/CIMD observé                     |
| Redirect URI accepté                                | À exécuter | À exécuter | Callback final                       |
| `securitySchemes` + `_meta["mcp/www_authenticate"]` | À exécuter | À exécuter | Capture de l’UI de liaison           |

## Parcours fonctionnel

| Étape                    | Résultat attendu             | ChatGPT    | Claude     | Preuve                |
| ------------------------ | ---------------------------- | ---------- | ---------- | --------------------- |
| Initialisation MCP       | `2025-11-25` négocié         | À exécuter | À exécuter | JSON-RPC `initialize` |
| `tools/list`             | 11 outils et `outputSchema`  | À exécuter | À exécuter | Capture               |
| `search_restaurants`     | `Chez Sokar` visible         | À exécuter | À exécuter | Capture               |
| `check_availability`     | Décision + alternatives      | À exécuter | À exécuter | Capture               |
| Consentement             | Accès explicite affiché      | À exécuter | À exécuter | Capture               |
| `create_hold`            | Token temporaire             | À exécuter | À exécuter | Réponse               |
| `create_reservation`     | Référence créée              | À exécuter | À exécuter | Réponse               |
| `get_reservation_status` | Accès avec téléphone correct | À exécuter | À exécuter | Réponse               |
| Mauvais téléphone        | Accès refusé sans fuite      | À exécuter | À exécuter | Réponse               |
| `modify_reservation`     | Modification confirmée       | À exécuter | À exécuter | Réponse               |
| `cancel_reservation`     | Annulation confirmée         | À exécuter | À exécuter | Réponse               |
| Refresh/Révocation       | Jeton révoqué ou renouvelé   | À exécuter | À exécuter | Réponse               |

## Décision

Ne publier une compatibilité comme validée que lorsque les deux colonnes ont
un résultat daté, une capture ou une réponse reproductible, et que le run
sandbox a été purgé avec `mcp:sandbox reset --run-id=… --started-at=… --apply`.
