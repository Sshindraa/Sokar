# Positionnement Sokar face à Zenchef

> **Statut : ACTIF — audit code et marché du 12 septembre 2026.**
> Cette comparaison distingue la capacité présente dans le dépôt, sa preuve terrain et la cible de
> la roadmap 199/299 €. Les fonctionnalités concurrentes et tarifs peuvent évoluer ; vérifier la
> [page officielle des formules Zenchef](https://www.zenchef.com/fr/formules) avant publication.

## Lecture commerciale honnête

Sokar est aujourd'hui solide sur la réservation multicanale, l'agent vocal, le plan de salle, la
liste d'attente, Connect, MCP, les cartes cadeaux et l'exploitation pendant le service. Zenchef
reste plus complet comme suite restaurant généraliste sur les paiements de réservation, les
intégrations POS, la distribution, la réputation et le CRM/marketing mature.

Le positionnement défendable est :

> Sokar centralise les réservations web, téléphone et assistants IA, puis aide l'équipe pendant le
> service. Le produit est conçu en France autour d'une IA vocale et de parcours agentiques natifs.

Il ne faut pas vendre Sokar comme un remplacement fonctionnel total de Zenchef tant que les epics
POS, CRM enrichi, automation marketing et paiements de réservation ne sont pas livrés.

## Prix : actuel et cible

| Offre      | Prix affiché/facturé dans Sokar | Prix cible décidé | Condition avant migration                                                                     |
| ---------- | ------------------------------: | ----------------: | --------------------------------------------------------------------------------------------- |
| Essential  |                      149 €/mois |        199 €/mois | Entitlements fiables, métriques d'usage, packaging stabilisé et parcours de migration Stripe. |
| Pro        |                      249 €/mois |        299 €/mois | Segmentation, automations, marketing mesurable et fonctions Pro effectivement activées.       |
| Multi-site |          249 €/mois + 99 €/site |       À redécider | Finir la preuve d'isolation et aligner le packaging groupes avec le CRM partagé.              |

Les prix actuels sont codés dans `apps/dashboard/src/app/constants.ts` et
`apps/dashboard/src/app/pricing/page.tsx`. Le runbook Stripe utilise huit Price IDs d'environnement.
Changer le texte marketing seul créerait une divergence entre le prix affiché, Checkout et les
droits ; la migration doit suivre le plan de rollout de la roadmap.

Au 12 septembre 2026, Zenchef affiche publiquement Reserve 129 €, Manage 169 € et Grow 249 € par
mois, avec plusieurs options payantes. Cette référence vient de la
[page tarifaire officielle](https://www.zenchef.com/fr/formules) et doit être datée dans toute
proposition commerciale.

## Matrice fonctionnelle actuelle

Légende :

- `LIVRÉ` : code et tests présents ;
- `À PROUVER` : fonction présente, mais validation terrain ou partenaire incomplète ;
- `PARTIEL` : un sous-ensemble existe ;
- `ABSENT` : pas de parcours commercial utilisable.

| Domaine                                  | Sokar au 12/09/2026          | Preuve Sokar                                                               | Position Zenchef publique                                                |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Réservation dashboard                    | `LIVRÉ`                      | module `reservations`, pages dashboard                                     | Inclus.                                                                  |
| Widget web                               | `LIVRÉ`                      | `apps/connect`, `apps/widget`, `/embed.js`                                 | Inclus.                                                                  |
| Appels pris par IA                       | `LIVRÉ`, qualité à suivre    | pipeline Telnyx + ElevenLabs + Cartesia                                    | AI Concierge en option selon formule.                                    |
| Réservation par ChatGPT/Claude           | `LIVRÉ`                      | MCP Streamable HTTP, OAuth, E2E réels                                      | Pas une capacité différenciante à revendiquer sans test concurrent daté. |
| Plan de salle                            | `LIVRÉ`                      | module `floor-plan`, canvas dashboard                                      | Inclus par Zenchef.                                                      |
| Allocation capacitaire                   | `LIVRÉ`                      | verrouillage transactionnel et availability capacity-aware                 | Plan de salle et créneaux intelligents annoncés.                         |
| Liste d'attente                          | `LIVRÉ`                      | service, workers de promotion/nettoyage                                    | Incluse à partir de Manage.                                              |
| Service Copilot                          | `À PROUVER`                  | recommandations et télémétrie dans `floor-plan`                            | Aucune comparaison publique suffisamment précise.                        |
| Rappels SMS                              | `LIVRÉ`                      | queue `confirmationSms`                                                    | Inclus ; SMS tarifés.                                                    |
| CRM de base                              | `LIVRÉ`                      | `Customer`, consentements, VIP, historique réservation/appel               | CRM annoncé.                                                             |
| CRM enrichi par dépenses POS             | `ABSENT`                     | aucun ledger POS normalisé                                                 | Intégrations POS annoncées.                                              |
| Segments avancés calculés                | `ABSENT`                     | modèle cible seulement dans la roadmap                                     | Segmentation et outils clients annoncés.                                 |
| Automations marketing génériques         | `PARTIEL`                    | réactivation VIP spécifique                                                | Suite Marketing et emails annoncés.                                      |
| Attribution réservation + CA             | `ABSENT`                     | modèle cible seulement                                                     | Analyses et revenus par canal annoncés.                                  |
| Empreinte bancaire / acompte réservation | `ABSENT`                     | Stripe couvre billing et gift cards, pas ce parcours                       | Empreinte, prépaiement et acompte annoncés.                              |
| Cartes cadeaux                           | `LIVRÉ`, finance à qualifier | module `gift-cards`, widget, dashboard, Stripe                             | Chèques-cadeaux annoncés.                                                |
| Avis et réputation                       | `PARTIEL`                    | Google Places sync ; pas de boîte de traitement complète                   | Collecte/publication/réponse annoncées.                                  |
| Google Reserve                           | `ABSENT`                     | Connect fournit SEO et disponibilité, sans intégration Reserve with Google | Inclus.                                                                  |
| Meta Reserve                             | `ABSENT`                     | aucun connecteur de distribution Meta                                      | Inclus/option selon formule.                                             |
| Multi-site                               | `PARTIEL`                    | account/site, sélection, quotas et facturation                             | Base clients et fonctions groupes annoncées.                             |
| API / agentic                            | `LIVRÉ`                      | routes API + MCP/OpenAI Reserve                                            | Accès API annoncé sur Grow.                                              |
| Paiement à table / QR                    | `ABSENT`                     | aucun parcours d'addition à table                                          | Zenchef l'annonce dans sa plateforme.                                    |

Sources concurrentes consultées :

- [Formules et comparaison Zenchef](https://www.zenchef.com/fr/formules) ;
- [Présentation de la plateforme Zenchef](https://www.zenchef.com/fr/zenchef-landing) ;
- [Guide Zenchef sur la digitalisation](https://www.zenchef.com/fr/guides/comment-digitaliser-restaurant).

## Ce qui justifie Essential à 199 €

La formule Essential peut être défendue à 199 € si elle livre une exploitation quotidienne
cohérente, pas seulement une liste de modules :

1. réservation dashboard + Connect + widget + voice sur la même disponibilité ;
2. plan de salle et liste d'attente fiables sous concurrence ;
3. rappels, annulation et suivi du no-show ;
4. fichier client utilisable avec consentements ;
5. dashboard de valeur : appels traités, réservations captées, heures économisées ;
6. limites d'usage et dépassements visibles avant facturation ;
7. onboarding qui conduit jusqu'au premier appel et à la première réservation réelle ;
8. sauvegarde, observabilité et support exploitables.

Les fonctionnalités 1 à 4 sont largement présentes. Les points 5 à 7 demandent surtout une preuve
commerciale, une instrumentation plus fiable et un packaging explicite. Les entitlements et compteurs
d'usage de la roadmap doivent empêcher qu'un simple changement d'interface active par erreur une
fonction Pro.

## Ce qui justifie Pro à 299 €

Pro doit produire un revenu mesurable ou un gain opérationnel supérieur :

1. identité client consolidée et fusion de doublons ;
2. données de visite et de dépense importées depuis au moins un POS ;
3. segments recalculés : nouveau, fidèle, à risque, VIP, gros dépensier, déjeuner ;
4. campagnes email/SMS avec consentement par canal, exclusions et fréquence maximale ;
5. automations déclenchées par événement avec retry, idempotence et journal d'exécution ;
6. attribution d'une réservation et du chiffre d'affaires à une campagne ;
7. rapports par segment, campagne et établissement ;
8. fonctions multi-site partagées lorsque le client possède plusieurs restaurants.

Ces éléments correspondent aux epics décrits dans
[`roadmap-produit-crm-marketing-199-299.md`](./roadmap-produit-crm-marketing-199-299.md). Tant que
les items 1 à 6 ne sont pas opérationnels, Pro à 299 € repose surtout sur voice, agentic, cartes
cadeaux et Service Copilot ; la promesse CRM/marketing doit rester limitée.

## Ordre de construction recommandé

```text
USAGE + ENTITLEMENTS
  -> CRM identity + timeline + merge
  -> POS adapter + ledger + reconciliation
  -> segment engine
  -> consent/channel policy
  -> campaign delivery
  -> automation runtime
  -> attribution reservation/revenue
  -> réservation payante et protection no-show
  -> consolidation multi-site
```

Cet ordre évite de construire un éditeur de campagnes sur des identités non dédupliquées ou de
promettre un ROI sans transactions POS rattachables.

## Claims autorisés maintenant

- « Sokar prend les réservations par téléphone, sur votre site et via les assistants compatibles. »
- « La disponibilité s'appuie sur votre plan de salle et vos tables. »
- « Vous gérez les réservations, la liste d'attente et les cartes cadeaux dans le même outil. »
- « L'assistant vocal est conçu pour les restaurants français et reste configurable. »

## Claims à retenir jusqu'à preuve

- parité complète avec Zenchef ou SevenRooms ;
- CRM enrichi automatiquement par la caisse ;
- attribution exacte du chiffre d'affaires marketing ;
- réduction chiffrée du no-show sans cohorte Sokar ;
- ROI ou gain de temps non mesuré sur de vrais restaurants ;
- disponibilité sur Google Reserve ou Meta Reserve.

## Règle de mise à jour

Une ligne passe de `ABSENT` ou `PARTIEL` à `LIVRÉ` uniquement après présence du code, contrôle
pertinent vert et, lorsqu'un fournisseur externe intervient, preuve datée en staging ou production.
Toute évolution de prix doit mettre à jour simultanément l'interface, les Price IDs Stripe, le
runbook billing, la matrice d'entitlements et ce document.
