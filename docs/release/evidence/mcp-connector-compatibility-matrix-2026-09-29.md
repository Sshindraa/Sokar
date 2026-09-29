# Matrice de compatibilité MCP — 29–30 septembre 2026

> **Statut au 30 septembre 2026 :** PR #314 fusionnée ; CI, déploiement staging et smoke tests verts. Le rejeu idempotent avec un hold déjà consommé réussit maintenant dans Claude et ChatGPT (`reused=true`, même réservation, aucun doublon). Dans les deux clients, recherche, disponibilité, hold, création, lecture, modification et annulation sont passés. Les cinq runs sont purgés ; seuls les tombstones anonymisés et leurs audits append-only restent.
> Le consentement Claude staging couvre tous les restaurants ayant activé MCP ; l’utilisateur l’a accepté pour le staging. Les essais et appels MCP restent limités à Chez Sokar sur staging ; seul le workflow de déploiement automatique a publié le code en production.
> Les connecteurs de production existants n’ont servi à aucune mutation.

## Cible et isolation

- Serveur testé : https://api-staging.sokar.tech/mcp
- Restaurant de démonstration : chez-sokar-demo, base sokar_staging
- Identifiant du restaurant : 9587ad78-ebc0-4805-a716-41727658d5e7
- Runbook : [Sandbox MCP](../../runbooks/mcp-sandbox.md)
- Run initial, maintenant purgé : `connector-20260929-01`, commencé le 29 septembre 2026 à 00:48:18.731 UTC
- Run `connector-20260929-02`, commencé le 29 septembre 2026 à 20:01:23.879 UTC, maintenant purgé après ChatGPT et une première tentative Claude avec paramètres erronés
- Run `connector-20260929-03`, commencé le 29 septembre 2026 à 21:06:38.994 UTC, maintenant purgé après le parcours Claude exact
- Run `connector-20260929-04`, commencé le 29 septembre 2026 à 21:55:03.699 UTC, maintenant purgé après le retest Claude post-correctif
- Run `connector-20260930-05`, commencé le 29 septembre 2026 à 22:04:32.908 UTC (30 septembre à 00:04:32 CEST), maintenant purgé après le retest ChatGPT post-correctif
- Marqueur du run initial : `MCP-SANDBOX:connector-20260929-01`
- Marqueur du run 02 : `MCP-SANDBOX:connector-20260929-02`
- Marqueur du run 03 : `MCP-SANDBOX:connector-20260929-03`
- Marqueur du run 04 : `MCP-SANDBOX:connector-20260929-04`
- Marqueur du run 05 : `MCP-SANDBOX:connector-20260930-05`
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

## Parcours d’écriture post-correctif — ChatGPT

Le 29 septembre, ChatGPT a utilisé le connecteur `Sokar Staging` sur Chez Sokar uniquement, avec le run `connector-20260929-02`. La disponibilité du 30 septembre 2026, 19 h–21 h, Europe/Paris, pour 2 personnes était positive. Le hold puis la réservation ont été créés avec le téléphone factice `+33612345600`, le nom `MCP Sandbox`, le marqueur `MCP-SANDBOX:connector-20260929-02` et les consentements `reservationProcessing=true`, `transactionalSms=false`, `transactionalEmail=false`, `marketingOptIn=false`.

| Étape                                           | Résultat observé dans ChatGPT                                      |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Création                                        | Réservation `CONFIRMED`, ID `c237ada8-23c6-4070-b13e-39d608a2b474` |
| Lecture avec le téléphone du manifeste          | Succès : 2 personnes, 19 h–21 h                                    |
| Lecture avec le téléphone erroné `+33612345601` | Refus `NOT_FOUND`, aucune donnée révélée                           |
| Modification                                    | Réussie ; `changed=true`, statut `CONFIRMED`, 20 h–21 h 30         |
| Relecture après modification                    | Le créneau 20 h–21 h 30 est confirmé                               |
| Annulation et relecture finale                  | Annulation réussie ; état `CANCELLED`                              |

Le statut du run lu après ce parcours ChatGPT indiquait 1 réservation marquée, 1 hold, 1 client de test, 1 clé d’idempotence et 5 lignes d’audit ; liste d’attente, références client hors run et preuves de consentement : 0. La réservation avait été relue à l’état `CANCELLED`. Le run a ensuite aussi servi à une première tentative Claude incorrecte, détaillée dans « Nettoyage des runs post-correctif ».

## Parcours d’écriture post-correctif — Claude

Le 29 septembre, le connecteur `Sokar Staging` a été utilisé sur Chez Sokar uniquement avec le run `connector-20260929-03`. Les valeurs exactes étaient : 2 personnes, 30 septembre 2026, 19 h–21 h Europe/Paris, `MCP Sandbox`, le téléphone factice du manifeste, `specialRequests=MCP-SANDBOX:connector-20260929-03`, clé `mcp-connector-20260929-03-claude`, traitement de réservation vrai et les consentements SMS/email transactionnels et marketing faux. Chaque écriture a été inspectée dans la demande d’approbation puis autorisée une seule fois.

| Étape                                                 | Résultat observé dans Claude                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Recherche, détails et disponibilité                   | Chez Sokar trouvé ; `available=true`, 17:00Z–19:00Z, soit 19 h–21 h à Paris                                             |
| Hold                                                  | Créé avec 2 personnes et le créneau exact                                                                               |
| Création                                              | `CONFIRMED`, ID `b652a247-52f2-47c8-b1bb-b256bf85bb95`, `reused=false`                                                  |
| Lecture initiale                                      | `CONFIRMED`, 2 personnes, créneau 19 h–21 h                                                                             |
| Rejeu identique avec la même clé et le même holdToken | Échec `INVALID_HOLD` (« Invalid or expired hold »), au lieu de `reused=true`                                            |
| Modification vers 20 h–21 h 30                        | Réussie ; `changed=true`                                                                                                |
| Relecture après modification                          | Réussie ; 18:00Z–19:30Z, soit 20 h–21 h 30 à Paris. Une première lecture a eu une erreur transport et a réussi au retry |
| Annulation et relecture finale                        | Réussies ; `cancelled=true`, état `CANCELLED`                                                                           |

Le rejeu du run 03 a échoué parce que le service validait le hold comme actif avant de consulter l’idempotence. Après la première création, ce hold est déjà consommé. La PR #314 consulte maintenant d’abord la clé et le hash déjà terminés lorsqu’un `holdToken` est fourni ; elle ne réexécute pas les validations et ne crée pas de réservation supplémentaire. Les retests des runs 04 et 05 ci-dessous confirment le comportement dans les deux clients.

## Retest du rejeu après le correctif — Claude et ChatGPT

La PR [#314](https://github.com/Sshindraa/Sokar/pull/314), commit `e53169b0`, a été fusionnée. La CI de `main`, le déploiement staging et ses smoke tests/E2E ont réussi. Les deux clients ont ensuite utilisé `Sokar Staging` et Chez Sokar exclusivement. Pour chaque client, la seconde création a repris tous les mêmes arguments, y compris le `holdToken` consommé.

| Étape                                             | Claude — run `connector-20260929-04`                                                          | ChatGPT — run `connector-20260930-05`                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Recherche, détails, disponibilité                 | Chez Sokar trouvé ; détails OK ; `available=true`, 1er octobre 2026, 19:00–20:30 Europe/Paris | Chez Sokar trouvé ; détails et horaires OK ; `available=true`, 2 octobre 2026, 19:00–20:30 Europe/Paris |
| Hold et première création                         | Hold créé ; `CONFIRMED`, ID `8a81494e-bbaa-486b-82da-6fba4a9f2861`, `reused=false`            | Hold créé ; `CONFIRMED`, ID `07f035a5-a836-4dc3-8bed-769551c83463`, `reused=false`                      |
| Rejeu strictement identique avec le hold consommé | `reused=true`, même ID, aucun doublon ni erreur                                               | `reused=true`, même ID, aucun doublon ni erreur                                                         |
| Lecture après création                            | `CONFIRMED`, 2 personnes, 19:00–20:30 Paris                                                   | `CONFIRMED`, 2 personnes, 19:00–20:30 Paris                                                             |
| Modification et relecture                         | `changed=true`, créneau 20:00–21:30 Paris confirmé                                            | `changed=true`, créneau 20:00–21:30 Paris confirmé                                                      |
| Annulation et relecture finale                    | `cancelled=true`, état `CANCELLED`                                                            | `cancelled=true`, état `CANCELLED`                                                                      |
| Purge vérifiée                                    | 1 réservation anonymisée, 6 audits ; 0 hold, client, clé d’idempotence ou consentement        | 1 réservation anonymisée, 6 audits ; 0 hold, client, clé d’idempotence ou consentement                  |

Les captures des comptes rendus Claude et ChatGPT ont été prises dans les clients pendant cette session et sont visibles dans le fil. Aucun secret OAuth n’a été consigné. Les réservations de test ont été annulées avant chaque reset.

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

### Nettoyage des runs post-correctif

Le run 02 contenait la réservation ChatGPT et une première réservation Claude créée avec des paramètres que Claude avait inventés après un prompt tronqué. Cette dernière a été annulée, rattachée au marqueur du run après vérification de son UUID, du restaurant, du canal MCP, de l’état annulé et de l’heure de création, puis anonymisée par le reset normal. Le client factice supplémentaire, sans autre réservation, ainsi que ses deux événements de chronologie et son identité de téléphone ont été supprimés. Aucun autre client ni restaurant n’a été touché.

| Run et reset            | Réservations anonymisées | Holds | Clients | Clés d’idempotence | Audits conservés | Consentements |
| ----------------------- | -----------------------: | ----: | ------: | -----------------: | ---------------: | ------------: |
| `connector-20260929-02` |                        2 |     0 |       0 |                  0 |               11 |             0 |
| `connector-20260929-03` |                        1 |     0 |       0 |                  0 |                6 |             0 |
| `connector-20260929-04` |                        1 |     0 |       0 |                  0 |                6 |             0 |
| `connector-20260930-05` |                        1 |     0 |       0 |                  0 |                6 |             0 |

Les dry-runs correspondaient aux artefacts connus avant chaque reset. Les audits restent append-only ; les holds, clients de manifeste, clés d’idempotence et données opérationnelles ont disparu.

**Conclusion opérationnelle :** OAuth frais et lectures MCP sont validés dans les deux clients. Le cycle métier complet, y compris le rejeu avec hold consommé, est validé dans Claude et ChatGPT. Tous les runs sont nettoyés comme documenté. Après le feu vert staging, le workflow automatique du dépôt a aussi exécuté `Deploy Production` (run [36637029278](https://github.com/Sshindraa/Sokar/actions/runs/36637029278)) avec smoke tests verts ; aucun client MCP de production ni aucune réservation de production n’a été utilisé pour cette matrice. Les interfaces ne montrent toujours pas le `protocolVersion` brut d’`initialize` ni la réponse JSON-RPC brute de `tools/list`.

## Captures et limites de preuve

- Les nouveaux écrans de consentement ChatGPT et Claude après le correctif ont été capturés ; Claude affiche la portée multi-restaurants staging acceptée par l’utilisateur.
- Les captures des résultats post-correctif Claude et ChatGPT sont visibles dans le fil de cette session ; les réponses détaillées sont transcrites dans les tableaux ci-dessus. Les images n’ont pas été exportées comme fichiers dans ce dossier.
- Les clients ne montrent pas les messages JSON-RPC bruts d’initialisation MCP, la version négociée, ni le contenu brut de tools/list. Les versions de protocole sont donc indiquées comme non observables, pas comme vérifiées.
- Les identifiants OAuth, codes de retour, challenge et jetons ne sont pas consignés dans cette matrice.
