# Matrice de compatibilité MCP — 29 septembre 2026

> **Statut au 29 septembre 2026 :** parcours complets avant correctif, puis retests MCP en lecture seule après déploiement OAuth dans ChatGPT et Claude.
> Les deux réservations de test sont annulées. La purge physique complète a échoué car la base protège ses journaux d’audit append-only ; la transaction a été annulée et les compteurs sont inchangés.
> Les connecteurs de production existants n’ont servi à aucune mutation.

## Cible et isolation

- Serveur testé : https://api-staging.sokar.tech/mcp
- Restaurant de démonstration : chez-sokar-demo, base sokar_staging
- Identifiant du restaurant : 9587ad78-ebc0-4805-a716-41727658d5e7
- Runbook : [Sandbox MCP](../../runbooks/mcp-sandbox.md)
- Run : connector-20260929-01, commencé le 29 septembre 2026 à 00:48:18.731 UTC
- Marqueur : MCP-SANDBOX:connector-20260929-01
- Téléphone factice du manifeste : +33612345600
- Référence OAuth OpenAI : [Authentication – Plugins](https://developers.openai.com/plugins/build/auth)

Le connecteur Sokar déjà enregistré dans chaque client pointe vers api.sokar.tech en production. Il n’a servi qu’aux lectures précédentes de recherche et de disponibilité. Toutes les opérations d’écriture ci-dessous ont été exécutées avec le connecteur distinct Sokar Staging, limité par OAuth au seul restaurant Chez Sokar.

## Liaison OAuth

| Vérification                                   | ChatGPT                                                                       | Claude                                                                    | Résultat                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Découverte OAuth staging                       | Réussie                                                                       | Réussie                                                                   | Les deux clients ont trouvé le serveur d’autorisation api-staging.sokar.tech                         |
| Portée restaurant                              | Paramètre restaurant_id pour Chez Sokar ; consentement limité à ce restaurant | Paramètre restaurant_id ; écran « Accès limité au restaurant Chez Sokar » | Aucun autre restaurant staging n’était dans le périmètre accordé                                     |
| Ressource                                      | https://api-staging.sokar.tech                                                | https://api-staging.sokar.tech                                            | Cohérente avec la ressource du MCP staging                                                           |
| Scopes                                         | mcp:read, mcp:reserve, mcp:cancel                                             | mcp:read, mcp:reserve, mcp:cancel                                         | Les accès de lecture, réservation et annulation ont été accordés                                     |
| Enregistrement client                          | DCR sélectionné                                                               | DCR sélectionné                                                           | La méthode d’authentification effectivement négociée n’est pas visible dans l’interface              |
| PKCE                                           | S256 observé                                                                  | S256 observé                                                              | Le flux OAuth a abouti dans les deux clients                                                         |
| URI de retour                                  | chatgpt.com/connector/oauth_callback                                          | claude.ai/api/mcp/auth_callback                                           | Retour réussi vers chaque client                                                                     |
| État de connexion                              | Sokar Staging installé et connecté                                            | Sokar Staging affiché comme connecté                                      | OAuth staging complété                                                                               |
| Version MCP issue de initialize                | Non observable                                                                | Non observable                                                            | L’interface ne montre pas la requête/réponse JSON-RPC brute ni protocolVersion                       |
| tools/list brut                                | Non exporté                                                                   | Non exporté                                                               | Les appels réussis prouvent que les outils sont utilisables ; la réponse brute n’a pas été conservée |
| authorization_response_iss_parameter_supported | Absent des métadonnées lues                                                   | Absent des métadonnées lues                                               | Le champ ne figurait pas dans la découverte OAuth staging                                            |

### Correctif OAuth ChatGPT

Les écrans de consentement et le parcours d’écriture décrits plus haut ont été testés avant le correctif. La [PR #294](https://github.com/Sshindraa/Sokar/pull/294), commit `5e1645db9a1be92780763f2abc3b3fbc40993a0b`, a ensuite été fusionnée sur `main` et déployée sur staging puis en production.

Le correctif ajoute :

- la propagation stricte de `resource` entre autorisation, code et échange de jeton, puis sa conservation dans le jeton et son contrôle sur les appels MCP ;
- `authorization_response_iss_parameter_supported: true` et `iss` sur les redirections OAuth de succès comme de refus ;
- `securitySchemes` et leurs scopes OAuth pour chacun des outils, plus `_meta["mcp/www_authenticate"]` quand un appel manque d’un scope ;
- le callback ChatGPT stable associé à RFC 9207.

DCR reste le mode d’enregistrement pris en charge. CIMD n’est pas implémenté et `client_id_metadata_document_supported` n’est donc pas annoncé.

| Vérification après déploiement     | Résultat observé                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| CI de `main`                       | Succès ; tous les jobs requis sont verts                                                                                    |
| Déploiement staging                | Succès ; smoke tests et E2E staging verts                                                                                   |
| Déploiement production             | Succès ; smoke tests verts, `GET /health` renvoie 200                                                                       |
| Métadonnées ressource protégée     | `resource=https://api-staging.sokar.tech`, serveur OAuth staging et scopes `mcp:read`, `mcp:reserve`, `mcp:cancel`          |
| Métadonnées serveur d’autorisation | `authorization_response_iss_parameter_supported: true`; CIMD non annoncé                                                    |
| Défi sans jeton sur `/mcp`         | HTTP 401 avec `WWW-Authenticate` pointant vers `/.well-known/oauth-protected-resource`                                      |
| Redirections avec `iss`            | Couvertes par les tests d’intégration de la PR pour succès et refus ; pas capturées dans une nouvelle autorisation manuelle |

### Retest client en lecture seule après le correctif OAuth #294

Le 29 septembre, les connecteurs staging déjà installés ont été réutilisés dans les deux clients. Aucun écran de consentement neuf n’a été accepté pendant ce retest et aucun outil d’écriture n’a été appelé.

| Vérification                                                           | ChatGPT                                                                                             | Claude                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Recherche de Chez Sokar                                                | Réussie ; nom, slug `chez-sokar-demo`, adresse à Lyon, cuisine, gamme de prix et horaires retournés | Réussie après précision de la ville Lyon ; nom, slug et ID retournés. L’adresse ne fait pas partie de la réponse de recherche |
| Disponibilité — 2 personnes, 1 octobre 2026, 19:30–21:00, Europe/Paris | `available: true`, aucune alternative                                                               | `available: true`, aucune alternative                                                                                         |
| Écriture après correctif                                               | Aucune réservation ni hold créé                                                                     | Aucune réservation ni hold créé                                                                                               |
| OAuth frais après correctif                                            | Non retesté : compte staging existant réutilisé                                                     | Non retesté : connecteur staging existant réutilisé                                                                           |

Claude a d’abord interprété la recherche sans ville comme Paris, puis a proposé une recherche à Monaco. Cette deuxième recherche a été refusée. La requête a été relancée explicitement sur Lyon et a retourné Chez Sokar. Cela montre qu’il faut préciser la ville dans les essais de recherche.

Les interfaces des clients ne montrent toujours pas le `protocolVersion` d’`initialize` ni la réponse JSON-RPC brute de `tools/list`. Les appels réussis confirment que les outils sont utilisables après déploiement, mais ne prouvent pas les versions négociées ni le contenu brut des schémas `securitySchemes`. Le nouveau parcours d’autorisation, ses écrans et les paramètres `iss` restent à capturer manuellement si une nouvelle connexion est nécessaire.

### Retest des sorties MCP après la PR #299

Le 29 septembre, après fusion de la PR #299 (`02a72dc`) et les déploiements staging et production, les connecteurs staging existants ont été réutilisés dans ChatGPT et Claude. Le retest a eu lieu après le dernier redémarrage de staging. Aucun nouvel écran OAuth n’a été accepté et aucun outil d’écriture n’a été appelé.

| Vérification — 2 personnes, Lyon, 1 octobre 2026, 19:30–21:00 Europe/Paris | ChatGPT                                                                                                                                                                                                                                  | Claude                       | Conclusion                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search_restaurants`                                                       | Chez Sokar, slug `chez-sokar-demo`, adresse `12 Rue de la République, 69001 Lyon`, cuisines `Bistrot` et `Française`, `priceRange: 2`, `maxOnlinePartySize: 6`; créneau `2026-10-01T17:30:00.000Z`–`19:00:00.000Z`; `capacityLimits: []` | Mêmes champs et même créneau | Les nouvelles données publiques et le créneau exact sont rendus dans les deux clients.                         |
| `check_availability`                                                       | `available: true`, `alternativeSlots: []`, `decision: "available"`, `recommendedAction: "create_hold"`                                                                                                                                   | Même réponse                 | La recommandation est informative ; aucun hold n’a été créé.                                                   |
| Compteurs après le retest                                                  | `search_restaurants`: 2 succès ; `check_availability`: 2 succès                                                                                                                                                                          | Un appel de chaque outil     | Labels observés : `auth_type="oauth"`, `transport="mcp"`. Aucun appel d’écriture ni erreur dans ce run propre. |

Les compteurs ont été lus sur le loopback de l’API staging après le dernier redéploiement. Les deux clients contribuent chacun un succès pour chacun des deux outils. Les interfaces confirment le contenu rendu, mais ne fournissent toujours pas le `protocolVersion` brut d’`initialize` ni la réponse brute de `tools/list`. Le consentement OAuth n’a pas été refait et ses écrans n’ont pas été capturés.

## Parcours fonctionnel réel

Les mêmes paramètres ont été utilisés pour comparer les deux clients. Restaurant : Chez Sokar. Groupe : 2 personnes. Créneau commun : 30 septembre 2026, 19 h 30–21 h 00, Europe/Paris.

| Étape                           | ChatGPT sur staging                                          | Claude sur staging                                           | Résultat                                                                                                   |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Recherche du restaurant         | Réussie ; identifiant 9587ad78-ebc0-4805-a716-41727658d5e7   | Réussie ; même identifiant, slug chez-sokar-demo             | Les deux ont utilisé Sokar Staging                                                                         |
| Disponibilité                   | available=true de 19 h 30 à 21 h 00                          | available=true de 19 h 30 à 21 h 00                          | Le même créneau a été confirmé disponible dans les deux clients                                            |
| Hold                            | Créé puis consommé par la réservation                        | Créé puis consommé par la réservation                        | Le holdToken n’a pas été recopié dans la réponse finale                                                    |
| Création de réservation         | CONFIRMED ; réservation bb4fcbf4-31cf-43dc-8b87-30df37184e88 | CONFIRMED ; réservation c4327868-3c00-4e72-8418-6a3c89c1f876 | Marqueur MCP du run présent ; consentement de traitement vrai, SMS/email transactionnels et marketing faux |
| Statut avec téléphone correct   | CONFIRMED                                                    | CONFIRMED                                                    | Accès autorisé                                                                                             |
| Statut avec téléphone incorrect | Accès refusé                                                 | Accès refusé ; erreur NOT_FOUND                              | La réservation n’a pas été divulguée avec un autre numéro                                                  |
| Modification                    | Réussie ; 20 h 00–21 h 30                                    | Réussie ; 20 h 00–21 h 30                                    | 2 personnes conservées et statut CONFIRMED après modification                                              |
| Vérification après modification | CONFIRMED ; plage 18:00–19:30 UTC, soit 20 h–21 h 30 à Paris | CONFIRMED ; même conversion UTC/Europe-Paris                 | Fuseau appliqué correctement dans les deux clients                                                         |
| Annulation                      | cancelled=true ; état final CANCELLED                        | cancelled=true ; relecture finale CANCELLED                  | Les deux parcours d’écriture ont été terminés                                                              |

### Observation sur les heures implicites

Lors d’une première demande sans heure de fin, ChatGPT a vérifié 19 h 30–21 h 30, tandis que Claude a pris 19 h 30–21 h 00. Les deux réponses étaient disponibles, mais la comparaison n’était pas équivalente. Le test a ensuite été rejoué avec un début et une fin explicitement identiques ; les deux ont renvoyé available=true. Les futurs tests doivent toujours fixer slotStart et slotEnd.

## Purge du run

Avant la purge, puis après l’échec de reset, la commande status du staging renvoie les mêmes compteurs :

| Artefact du run               | Nombre |
| ----------------------------- | -----: |
| Réservations                  |      2 |
| Holds                         |      2 |
| Entrées de liste d’attente    |      0 |
| Clients de test               |      1 |
| Enregistrements d’idempotence |      2 |
| Journaux d’audit              |     10 |

La simulation de reset a ciblé exactement ces artefacts. L’application de reset a échoué sur la suppression de reservation_audit_log avec l’erreur « reservation_audit_log is append-only ». Le reset essaie de supprimer les journaux d’audit alors que le trigger PostgreSQL l’interdit. La transaction a donc été annulée ; une nouvelle lecture des compteurs a confirmé qu’aucun élément n’avait été supprimé.

Les deux réservations sont déjà CANCELLED et les deux holds ont servi à créer ces réservations ; aucun créneau de test n’est encore retenu. Les journaux d’audit ne contiennent pas de téléphone ni de nom bruts selon le service d’audit. Ils sont conservés par conception avec les réservations auxquelles ils se rapportent. Aucun trigger, contrainte ou garde-fou d’audit n’a été désactivé pour forcer la purge.

**Conclusion opérationnelle :** le parcours complet recherche/réservation/modification/annulation a réussi avant le correctif OAuth ; après déploiement, les métadonnées OAuth et les outils de recherche/disponibilité ont aussi été vérifiés dans les deux clients. La matrice reste ouverte : le parcours de consentement post-correctif et la version MCP négociée ne sont pas visibles dans l’interface, et le nettoyage physique du run n’a pas abouti. Le reset sandbox doit respecter l’audit append-only avant qu’un futur run puisse être annoncé comme purgé.

## Captures et limites de preuve

- Les écrans de consentement OAuth ont été observés pendant les deux liaisons, avec le périmètre Chez Sokar, les scopes et le retour réussi vers chaque client.
- Les captures d’écran et retours d’outils sont visibles dans le fil de cette session, mais les images n’ont pas été exportées comme fichiers dans ce dossier.
- Les clients ne montrent pas les messages JSON-RPC bruts d’initialisation MCP, la version négociée, ni le contenu brut de tools/list. Les versions de protocole sont donc indiquées comme non observables, pas comme vérifiées.
- Les identifiants OAuth, codes de retour, challenge et jetons ne sont pas consignés dans cette matrice.
