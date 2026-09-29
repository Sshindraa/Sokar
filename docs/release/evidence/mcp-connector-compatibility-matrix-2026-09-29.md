# Matrice de compatibilité MCP — 29 septembre 2026

> **Statut au 29 septembre 2026 :** les parcours complets de réservation datent d’avant le correctif OAuth. Après le correctif, consentements frais et essais en lecture seule réussis dans ChatGPT et Claude. Le correctif de reset a été déployé sur staging et appliqué au run précédent : ses artefacts opérationnels sont supprimés, ses 2 réservations auditées sont anonymisées et conservées comme tombstones. Un nouveau run est démarré ; les parcours d’écriture post-correctif restent à rejouer dans les deux clients.
> Le consentement Claude staging couvre tous les restaurants ayant activé MCP ; l’utilisateur l’a accepté pour le staging. Les essais restent limités à Chez Sokar. Aucun test ni changement n’a ciblé la production.
> Les connecteurs de production existants n’ont servi à aucune mutation.

## Cible et isolation

- Serveur testé : https://api-staging.sokar.tech/mcp
- Restaurant de démonstration : chez-sokar-demo, base sokar_staging
- Identifiant du restaurant : 9587ad78-ebc0-4805-a716-41727658d5e7
- Runbook : [Sandbox MCP](../../runbooks/mcp-sandbox.md)
- Run initial, maintenant purgé : `connector-20260929-01`, commencé le 29 septembre 2026 à 00:48:18.731 UTC
- Run actif pour les essais post-correctif : `connector-20260929-02`, commencé le 29 septembre 2026 à 20:01:23.879 UTC
- Marqueur du run initial : `MCP-SANDBOX:connector-20260929-01`
- Téléphone factice du manifeste : +33612345600
- Référence OAuth OpenAI : [Authentication – Plugins](https://developers.openai.com/plugins/build/auth)

Le connecteur Sokar déjà enregistré dans chaque client pointe vers api.sokar.tech en production. Il n’a servi qu’aux lectures précédentes de recherche et de disponibilité. Les opérations d’écriture historiques ci-dessous ont été exécutées avec le connecteur distinct Sokar Staging et n’ont ciblé que Chez Sokar. Le consentement Claude staging couvre les restaurants ayant activé MCP ; l’utilisateur a accepté cette portée plus large, sans l’utiliser pour tester d’autres restaurants.

## Liaison OAuth

| Vérification                                   | ChatGPT                                  | Claude                                                                | Résultat                                                                                             |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Découverte OAuth staging                       | Réussie                                  | Réussie                                                               | Les deux clients ont trouvé le serveur d’autorisation api-staging.sokar.tech                         |
| Portée restaurant                              | Consentement ChatGPT limité à Chez Sokar | Consentement Claude couvrant les restaurants staging ayant activé MCP | Portée Claude plus large ; les essais de cette matrice restent limités à Chez Sokar                  |
| Ressource                                      | https://api-staging.sokar.tech           | https://api-staging.sokar.tech                                        | Cohérente avec la ressource du MCP staging                                                           |
| Scopes                                         | mcp:read, mcp:reserve, mcp:cancel        | mcp:read, mcp:reserve, mcp:cancel                                     | Les accès de lecture, réservation et annulation ont été accordés                                     |
| Enregistrement client                          | DCR sélectionné                          | DCR sélectionné                                                       | La méthode d’authentification effectivement négociée n’est pas visible dans l’interface              |
| PKCE                                           | S256 observé                             | S256 observé                                                          | Le flux OAuth a abouti dans les deux clients                                                         |
| URI de retour                                  | chatgpt.com/connector/oauth_callback     | claude.ai/api/mcp/auth_callback                                       | Retour réussi vers chaque client                                                                     |
| État de connexion                              | Sokar Staging installé et connecté       | Sokar Staging affiché comme connecté                                  | OAuth staging complété                                                                               |
| Version MCP issue de initialize                | Non observable                           | Non observable                                                        | L’interface ne montre pas la requête/réponse JSON-RPC brute ni protocolVersion                       |
| tools/list brut                                | Non exporté                              | Non exporté                                                           | Les appels réussis prouvent que les outils sont utilisables ; la réponse brute n’a pas été conservée |
| authorization_response_iss_parameter_supported | Absent des métadonnées lues              | Absent des métadonnées lues                                           | Le champ ne figurait pas dans la découverte OAuth staging                                            |

### Correctif OAuth ChatGPT

Les écrans de consentement et le parcours d’écriture décrits plus haut ont été testés avant le correctif. La [PR #294](https://github.com/Sshindraa/Sokar/pull/294), commit `5e1645db9a1be92780763f2abc3b3fbc40993a0b`, a ensuite été fusionnée sur `main` et déployée sur staging puis en production.

Le correctif ajoute :

- la propagation stricte de `resource` entre autorisation, code et échange de jeton, puis sa conservation dans le jeton et son contrôle sur les appels MCP ;
- `authorization_response_iss_parameter_supported: true` et `iss` sur les redirections OAuth de succès comme de refus ;
- `securitySchemes` et leurs scopes OAuth pour chacun des outils, plus `_meta["mcp/www_authenticate"]` quand un appel manque d’un scope ;
- le callback ChatGPT stable associé à RFC 9207.

DCR reste le mode d’enregistrement pris en charge. CIMD n’est pas implémenté et `client_id_metadata_document_supported` n’est donc pas annoncé.

| Vérification après déploiement     | Résultat observé                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CI de `main`                       | Succès ; tous les jobs requis sont verts                                                                                                       |
| Déploiement staging                | Succès ; smoke tests et E2E staging verts                                                                                                      |
| Déploiement production             | Succès ; smoke tests verts, `GET /health` renvoie 200                                                                                          |
| Métadonnées ressource protégée     | `resource=https://api-staging.sokar.tech`, serveur OAuth staging et scopes `mcp:read`, `mcp:reserve`, `mcp:cancel`                             |
| Métadonnées serveur d’autorisation | `authorization_response_iss_parameter_supported: true`; CIMD non annoncé                                                                       |
| Défi sans jeton sur `/mcp`         | HTTP 401 avec `WWW-Authenticate` pointant vers `/.well-known/oauth-protected-resource`                                                         |
| Redirections avec `iss`            | Couvertes par les tests d’intégration de la PR ; l’autorisation ChatGPT fraîche a abouti, mais l’interface a masqué les paramètres du callback |

### Retest client en lecture seule après le correctif OAuth #294

Le 29 septembre, les connecteurs staging déjà installés ont été réutilisés dans les deux clients. Aucun écran de consentement neuf n’a été accepté pendant ce retest et aucun outil d’écriture n’a été appelé.

| Vérification                                                           | ChatGPT                                                                                                      | Claude                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Recherche de Chez Sokar                                                | Réussie ; nom, slug `chez-sokar-demo`, adresse à Lyon, cuisine, gamme de prix et horaires retournés          | Réussie après précision de la ville Lyon ; nom, slug et ID retournés. L’adresse ne fait pas partie de la réponse de recherche |
| Disponibilité — 2 personnes, 1 octobre 2026, 19:30–21:00, Europe/Paris | `available: true`, aucune alternative                                                                        | `available: true`, aucune alternative                                                                                         |
| Écriture après correctif                                               | Aucune réservation ni hold créé pendant ce retest en lecture seule                                           | Aucune réservation ni hold créé                                                                                               |
| OAuth frais après correctif                                            | Réussi le 29 septembre : nouveau compte staging ; écran limité à Chez Sokar, `resource` et 3 scopes visibles | Réussi le 29 septembre après accord utilisateur ; l’écran couvre les restaurants staging ayant activé MCP                     |

Claude a d’abord interprété la recherche sans ville comme Paris, puis a proposé une recherche à Monaco. Cette deuxième recherche a été refusée. La requête a été relancée explicitement sur Lyon et a retourné Chez Sokar. Cela montre qu’il faut préciser la ville dans les essais de recherche.

Les interfaces des clients ne montrent toujours pas le `protocolVersion` d’`initialize` ni la réponse JSON-RPC brute de `tools/list`. Les appels réussis confirment que les outils sont utilisables après déploiement, mais ne prouvent pas les versions négociées ni le contenu brut des schémas `securitySchemes`. Le consentement ChatGPT frais a été capturé dans cette session ; les paramètres `iss` du callback restent non observables dans l’interface.

#### ChatGPT avec un nouveau consentement staging

Le 29 septembre, une deuxième connexion `Sokar Staging` a été ajoutée sans retirer la connexion existante. L’écran affiche Chez Sokar, `resource=https://api-staging.sokar.tech`, les scopes `mcp:read`, `mcp:reserve`, `mcp:cancel` et PKCE S256. Le retour vers `chatgpt.com/connector/oauth_callback` a abouti. L’interface ne laisse pas voir les paramètres de redirection, donc `iss` n’a pas pu être relevé manuellement.

Avec cette nouvelle connexion, la recherche à Lyon a retourné Chez Sokar, 12 rue de la République, cuisine bistrot/française, prix `€€`, pour 2 personnes le 30 septembre de 19 h à 21 h. La recherche à 21 h–23 h le soir même n’a retourné aucun résultat. Aucun hold ni réservation n’a été créé pendant ce retest.

Un appel séparé de disponibilité pour Chez Sokar, 2 personnes, le 30 septembre à 19 h a répondu `available=true` pour 19 h–21 h. ChatGPT a confirmé qu’aucun hold ni réservation n’avait été créé.

#### Claude avec un nouveau consentement staging

Le 29 septembre, Sokar Staging a été reconnecté depuis Claude Desktop. Après validation explicite de l’utilisateur, l’écran a été accepté. Il affiche `resource=https://api-staging.sokar.tech`, les scopes `mcp:read`, `mcp:reserve`, `mcp:cancel`, PKCE S256 et le retour `claude.ai/api/mcp/auth_callback`. La portée annoncée est « restaurants qui ont activé MCP » sur le staging, donc plus large que Chez Sokar. Seul Chez Sokar a été utilisé dans les essais ci-dessous. Claude demande une approbation ponctuelle par outil ; seules les approbations nécessaires à ces lectures ont été accordées.

Avec cette nouvelle liaison, `search_restaurants` a trouvé Chez Sokar à Lyon pour 2 personnes le 30 septembre, 19 h–21 h : 12 rue de la République, cuisine bistrot/française, gamme de prix 2. `check_availability` a répondu disponible pour la plage exacte, sans alternative, avec `create_hold` comme action recommandée. Aucun hold ni réservation n’a été créé.

### Retest des sorties MCP après la PR #299

Le 29 septembre, après fusion de la PR #299 (`02a72dc`) et les déploiements staging et production, les connecteurs staging existants ont été réutilisés dans ChatGPT et Claude. Le retest a eu lieu après le dernier redémarrage de staging. Aucun nouvel écran OAuth n’a été accepté et aucun outil d’écriture n’a été appelé.

| Vérification — 2 personnes, Lyon, 1 octobre 2026, 19:30–21:00 Europe/Paris | ChatGPT                                                                                                                                                                                                                                  | Claude                       | Conclusion                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `search_restaurants`                                                       | Chez Sokar, slug `chez-sokar-demo`, adresse `12 Rue de la République, 69001 Lyon`, cuisines `Bistrot` et `Française`, `priceRange: 2`, `maxOnlinePartySize: 6`; créneau `2026-10-01T17:30:00.000Z`–`19:00:00.000Z`; `capacityLimits: []` | Mêmes champs et même créneau | Les nouvelles données publiques et le créneau exact sont rendus dans les deux clients.                         |
| `check_availability`                                                       | `available: true`, `alternativeSlots: []`, `decision: "available"`, `recommendedAction: "create_hold"`                                                                                                                                   | Même réponse                 | La recommandation est informative ; aucun hold n’a été créé.                                                   |
| Compteurs après le retest                                                  | `search_restaurants`: 2 succès ; `check_availability`: 2 succès                                                                                                                                                                          | Un appel de chaque outil     | Labels observés : `auth_type="oauth"`, `transport="mcp"`. Aucun appel d’écriture ni erreur dans ce run propre. |

Les compteurs de ce retest ont été lus sur le loopback de l’API staging après le dernier redéploiement. Les deux clients contribuent chacun un succès pour chacun des deux outils. Les interfaces confirment le contenu rendu, mais ne fournissent toujours pas le `protocolVersion` brut d’`initialize` ni la réponse brute de `tools/list`. Aucun nouveau consentement n’a été accepté pendant ce retest précis ; les consentements frais réalisés ensuite sont décrits dans « Retest client en lecture seule après le correctif OAuth #294 ».

## Parcours fonctionnel réel avant le correctif OAuth

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

Avant le correctif de reset, le run `connector-20260929-01` contenait :

| Artefact du run               | Nombre |
| ----------------------------- | -----: |
| Réservations                  |      2 |
| Holds                         |      2 |
| Entrées de liste d’attente    |      0 |
| Clients de test               |      1 |
| Enregistrements d’idempotence |      2 |
| Journaux d’audit              |     10 |

Une première tentative avant le correctif avait échoué, car elle essayait de supprimer les journaux `reservation_audit_log`, protégés par le trigger append-only. Après fusion de la PR #310 et déploiement staging avec smoke tests verts, le dry-run a de nouveau ciblé exactement les compteurs ci-dessus. L’application du reset puis une commande `status` ont confirmé le résultat suivant :

| Artefact conservé ou restant  | Nombre après reset |
| ----------------------------- | -----------------: |
| Réservations tombstones       |                  2 |
| Réservations anonymisées      |                  2 |
| Holds                         |                  0 |
| Entrées de liste d’attente    |                  0 |
| Clients de test               |                  0 |
| Références client hors run    |                  0 |
| Enregistrements d’idempotence |                  0 |
| Journaux d’audit append-only  |                 12 |
| Preuves de consentement       |                  0 |

Les réservations étaient déjà `CANCELLED`. Le reset les conserve donc comme tombstones, remplace leur marqueur par `MCP-SANDBOX:connector-20260929-01:PURGED`, retire les champs client et les clés d’idempotence, puis ajoute deux événements d’anonymisation. Les deux holds, les deux enregistrements d’idempotence et le client de test ont disparu ; les 10 audits d’origine et les 2 nouveaux restent append-only. Aucun trigger ni garde-fou n’a été désactivé et aucune migration de schéma n’a été nécessaire.

Un nouveau run sans réservation ni hold a été démarré : `connector-20260929-02`, commencé le 29 septembre à 20:01:23.879 UTC. **Conclusion opérationnelle :** le parcours complet recherche/réservation/modification/annulation a réussi avant le correctif OAuth ; après déploiement, OAuth frais, recherche et disponibilité ont été revalidés dans les deux clients. Les écritures post-correctif restent à rejouer, puis ce nouveau run devra être purgé. Les interfaces ne montrent toujours pas le `protocolVersion` brut d’`initialize` ni la réponse JSON-RPC brute de `tools/list`.

## Captures et limites de preuve

- Les nouveaux écrans de consentement ChatGPT et Claude après le correctif ont été capturés ; Claude affiche la portée multi-restaurants staging acceptée par l’utilisateur.
- Les captures d’écran et retours d’outils sont visibles dans le fil de cette session, mais les images n’ont pas été exportées comme fichiers dans ce dossier.
- Les clients ne montrent pas les messages JSON-RPC bruts d’initialisation MCP, la version négociée, ni le contenu brut de tools/list. Les versions de protocole sont donc indiquées comme non observables, pas comme vérifiées.
- Les identifiants OAuth, codes de retour, challenge et jetons ne sont pas consignés dans cette matrice.
