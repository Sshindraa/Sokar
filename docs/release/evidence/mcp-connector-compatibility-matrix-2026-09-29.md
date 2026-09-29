# Matrice de compatibilité MCP — 29 septembre 2026

> **Statut : parcours fonctionnels terminés dans ChatGPT et Claude sur le staging Chez Sokar.**
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

Les lignes ci-dessus décrivent le serveur staging au moment de l’essai, avant le correctif. Le code en cours ajoute maintenant :

- la propagation stricte de `resource` entre autorisation, code et échange de jeton, puis sa conservation dans le jeton et son contrôle sur les appels MCP ;
- `authorization_response_iss_parameter_supported: true` et `iss` sur les redirections OAuth de succès comme de refus ;
- `securitySchemes` et leurs scopes OAuth pour chacun des outils, plus `_meta["mcp/www_authenticate"]` quand un appel manque d’un scope ;
- le callback ChatGPT stable associé à RFC 9207.

DCR reste le mode d’enregistrement pris en charge. CIMD n’est pas implémenté et `client_id_metadata_document_supported` n’est donc pas annoncé. Ces changements ont des tests d’intégration locaux, mais ne sont pas encore déployés ni revérifiés dans ChatGPT ou Claude sur le staging.

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

**Conclusion opérationnelle :** l’authentification et les appels fonctionnels ont passé dans les deux clients. La matrice n’est pas entièrement close, car le nettoyage physique du run n’a pas abouti. Le script et le runbook de sandbox doivent être réconciliés avec la règle d’audit append-only avant qu’un futur run puisse être annoncé comme purgé.

## Captures et limites de preuve

- Les écrans de consentement OAuth ont été observés pendant les deux liaisons, avec le périmètre Chez Sokar, les scopes et le retour réussi vers chaque client.
- Les captures d’écran et retours d’outils sont visibles dans le fil de cette session, mais les images n’ont pas été exportées comme fichiers dans ce dossier.
- Les clients ne montrent pas les messages JSON-RPC bruts d’initialisation MCP, la version négociée, ni le contenu brut de tools/list. Les versions de protocole sont donc indiquées comme non observables, pas comme vérifiées.
- Les identifiants OAuth, codes de retour, challenge et jetons ne sont pas consignés dans cette matrice.
