# État de la documentation Sokar

> **Source de triage documentaire — auditée le 12 septembre 2026.**
> Ce fichier indique ce qui décrit le produit actuel, ce qui est déjà livré, ce qui reste à
> prouver et ce qui doit seulement être conservé comme historique. Le code, le schéma Prisma,
> les migrations et les runbooks opérationnels spécialisés restent les sources de vérité
> techniques.

## Comment lire les statuts

| Statut              | Signification                                                                             | Action attendue                                                            |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ACTIF`             | Document maintenu et utilisable pour prendre une décision aujourd'hui.                    | Le mettre à jour avec tout changement significatif.                        |
| `LIVRÉ / RÉFÉRENCE` | La fonctionnalité décrite existe ; le document conserve surtout les choix de conception.  | Ne pas lire les anciennes cases ou formulations au futur comme un backlog. |
| `PARTIEL`           | Une partie est livrée ; les écarts restants sont nommés explicitement.                    | Ne planifier que les écarts listés dans la colonne « Reste ».              |
| `RUNBOOK`           | Procédure à exécuter ; des cases vides peuvent être un modèle par restaurant ou campagne. | Cocher dans la preuve d'exécution, pas dans le modèle partagé.             |
| `DRAFT EXTERNE`     | Dossier préparatoire dépendant d'un fournisseur ou d'une soumission externe.              | Revalider URLs, identifiants et exigences avant utilisation.               |
| `HISTORIQUE`        | Trace d'une décision ou d'un audit terminé.                                               | Ne pas créer de tickets depuis ce document.                                |

## Sources de vérité

| Sujet                                 | Source actuelle                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Carte du code et des flux             | [`PROJECT_MAP.md`](./PROJECT_MAP.md)                                                                   |
| État produit courant                  | [`obsidian/Context.md`](./obsidian/Context.md)                                                         |
| Historique des livraisons             | trois dernières entrées de [`obsidian/Journal.md`](./obsidian/Journal.md), puis recherche ciblée       |
| Plan CRM, marketing et prix 199/299 € | [`roadmap-produit-crm-marketing-199-299.md`](./roadmap-produit-crm-marketing-199-299.md)               |
| Déploiement et rollback               | [`runbooks/deployment.md`](./runbooks/deployment.md), [`runbooks/rollback.md`](./runbooks/rollback.md) |
| Contrat de données                    | `packages/database/prisma/schema.prisma` et migrations SQL                                             |
| Contrat API réellement chargé         | `apps/api/src/main.ts` et routes de chaque module                                                      |
| Prix affichés actuellement            | `apps/dashboard/src/app/constants.ts` et `apps/dashboard/src/app/pricing/page.tsx`                     |

## Audit des documents visibles à la racine de `docs/`

| Document                                   | Statut              | Ce qui est déjà fait                                                                                                                                                        | Reste réel / décision                                                                                                                                          |
| ------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_MAP.md`                           | `ACTIF`             | Carte monorepo, modules, flux, paiements, voice et sécurité.                                                                                                                | Maintenir les queues, pages et règles de déploiement à chaque ajout significatif.                                                                              |
| `connect-v1.1.md`                          | `LIVRÉ / RÉFÉRENCE` | App Connect, routes publiques, hold/confirm idempotent, pages restaurant/ville, JSON-LD, sitemap, robots, `llms.txt`, widget, analytics et domaines personnalisés existent. | Obtenir la preuve commerciale du pilote réel et continuer la qualité SEO/conversion. Les anciennes cases `[ ]` sont les critères originaux, pas l'état actuel. |
| `connect-v1.md.archived`                   | `HISTORIQUE`        | Première version remplacée par v1.1.                                                                                                                                        | Aucun développement à en déduire. Conserver uniquement pour retracer les décisions.                                                                            |
| `floor-plan-spec.md`                       | `LIVRÉ / RÉFÉRENCE` | Schéma salle/sections/tables, allocation atomique, disponibilité capacitaire, dashboard, planning, liste d'attente et Service Copilot existent.                             | Preuve terrain multi-services, ergonomie avancée et éventuels raffinements multi-plan.                                                                         |
| `gift-cards-spec.md`                       | `LIVRÉ / RÉFÉRENCE` | Packs, montant libre, cagnotte, widget, dashboard, codes courts, Stripe, remboursements et protections transactionnelles sont présents.                                     | Ajouter l'unicité DB stricte du PaymentIntent après audit des doublons ; qualifier le cycle financier complet en environnement réel.                           |
| `hermes-automation.md`                     | `PARTIEL`           | Hooks Husky, scripts de revue et commandes `verify:*` existent dans le dépôt.                                                                                               | L'état des webhooks, tunnels et crons vit hors dépôt : le vérifier avec les commandes du document avant de le déclarer opérationnel.                           |
| `mistral-marketplace-submission.md`        | `DRAFT EXTERNE`     | Le serveur MCP/OAuth Sokar existe.                                                                                                                                          | Créer ou revalider un client Mistral, les redirect URIs, l'icône, le contact et les exigences Marketplace au moment de la soumission.                          |
| `onboarding-strategy.md`                   | `LIVRÉ / RÉFÉRENCE` | Les cinq actions proposées sont dans le code : démo audio/transcript, trois scénarios, message fondateur, progressive disclosure et écran préalable au renvoi d'appel.      | Mesurer activation, écoute de la démo, abandon et premier appel réel ; corriger selon les données.                                                             |
| `positioning-vs-zenchef.md`                | `ACTIF`             | Matrice produit et marché recalée sur l'implémentation actuelle.                                                                                                            | Ne revendiquer que les capacités testées ; réviser après livraison des epics CRM/POS/marketing.                                                                |
| `roadmap-produit-crm-marketing-199-299.md` | `ACTIF`             | Blueprint technique détaillé et baseline documentée.                                                                                                                        | Implémenter les epics ; le prix cible 199/299 € n'est pas encore le prix affiché ni facturé.                                                                   |
| `runbook.md`                               | `RUNBOOK`           | Guide transversal d'exploitation et d'incident.                                                                                                                             | Les campagnes pilote restent à exécuter et à documenter ; préférer les runbooks spécialisés pour déploiement, rollback et tests.                               |
| `sokar-mcp-agentic-reservations-v3.2.md`   | `LIVRÉ / RÉFÉRENCE` | MCP Streamable HTTP, OAuth, outils de réservation, idempotence, capacités, OpenAI Reserve et tests E2E ChatGPT/Claude sont livrés.                                          | Suivre disponibilité, latence, erreurs partenaires et montée en charge ; les mentions « GO » appartiennent au plan initial.                                    |
| `sokar-mcp-integrator-guide.md`            | `ACTIF`             | Guide d'intégration MCP/OAuth utilisable en local, staging et production.                                                                                                   | Maintenir les outils, scopes, URLs et exemples avec le serveur chargé en production.                                                                           |
| `sokar-mcp-p0-migration-audit.md`          | `HISTORIQUE`        | Audit pré-implémentation ; migrations P0 et couche agentic livrées.                                                                                                         | Aucun ticket actif. Consulter seulement pour les décisions de migration d'origine.                                                                             |
| `TECHNICAL_BACKLOG.md`                     | `HISTORIQUE`        | Tous les P0/P1/P2 de cet audit sont marqués corrigés.                                                                                                                       | Utiliser les audits datés et la roadmap CRM pour le travail actuel ; ne plus alimenter ce fichier comme backlog.                                               |
| `widget-embed.md`                          | `ACTIF`             | `/embed.js`, iframe, thème, redimensionnement et validation de l'origine des messages sont livrés.                                                                          | Allowlist `frame-ancestors` par restaurant et enrichissement analytics/personnalisation si priorisés.                                                          |

## Audit de `docs/runbooks/`

| Runbook                    | Statut       | Portée et état vérifié                                                           | Reste réel / précaution                                                                                                            |
| -------------------------- | ------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare-saas.md`       | `RUNBOOK`    | Provisionnement des domaines personnalisés et mode dégradé staging documentés.   | Revalider prix/limites Cloudflare dans leur documentation avant décision commerciale.                                              |
| `deployment.md`            | `ACTIF`      | Staging automatique, smoke tests, promotion production, snapshot et rollback.    | Mettre à jour dès qu'un workflow ou un chemin VPS change.                                                                          |
| `environment.md`           | `ACTIF`      | Contrat des fichiers `.env`, secrets, Node/pnpm et voice.                        | L'état réel des secrets se vérifie sur l'environnement sans les afficher.                                                          |
| `hermes.md`                | `ACTIF`      | Pointe vers la configuration runtime, seule source fiable pour le modèle Hermes. | Ne pas figer un fournisseur temporaire dans ce runbook.                                                                            |
| `mac-migration.md`         | `HISTORIQUE` | Procédure ponctuelle de transfert entre Macs.                                    | Utiliser uniquement avec un bundle daté présent dans `docs/archive/operations/`.                                                   |
| `multisite-accounts.md`    | `PARTIEL`    | Modèle account/site, sélecteur, provisioning et quotas Stripe validés.           | Finir la preuve d'isolation avec deux sessions Clerk et un membre limité à un site.                                                |
| `onboarding-p1-connect.md` | `RUNBOOK`    | Checklist d'ouverture d'un restaurant sur Connect.                               | Les cases sont à remplir pour chaque restaurant ; elles ne signalent pas des features manquantes.                                  |
| `rollback.md`              | `ACTIF`      | Rollback applicatif et restauration DB documentés ; restauration vierge exercée. | Mesurer le RTO complet production lors d'un exercice contrôlé.                                                                     |
| `service-copilot-pilot.md` | `RUNBOOK`    | Fonctionnalité et procédure de smoke/rollback disponibles.                       | Réaliser et signer la campagne terrain ; arrêter le pilote sur tout défaut d'intégrité.                                            |
| `staging.md`               | `ACTIF`      | URLs, isolation, services, déploiement et noindex.                               | Telnyx reste la dépendance bloquante pour un appel réel ; vérifier les flags et providers réellement injectés avant un test voice. |
| `stripe-billing.md`        | `ACTIF`      | Checkout, webhooks, portail, états d'abonnement, annuel et multisite.            | Les prix actifs restent 149/249 € tant que la migration vers 199/299 € n'a pas été exécutée et validée.                            |
| `testing.md`               | `ACTIF`      | Matrice locale, intégration, staging et scénarios providers.                     | Conserver des preuves datées pour les validations externes et les tests terrain.                                                   |

## État produit consolidé

### Livré dans le code et documenté comme tel

- Réservations dashboard, Connect/widget, voice et MCP avec protection idempotente selon le canal.
- Plan de salle, allocation atomique, disponibilité par capacité, liste d'attente et Service Copilot.
- Cartes cadeaux, packs, cagnotte, codes courts, Stripe et remboursement.
- Connect public, SEO structuré, widget embarqué et domaines personnalisés.
- Onboarding avec appel démo et explications progressives.
- Facturation SaaS actuelle Essential 149 €, Pro 249 € et Multi-site.
- Socle multi-site, RGPD, observabilité, sauvegarde, rollback et quality gates.

### À ne pas annoncer comme livré

- Tarifs Essential 199 € et Pro 299 € : ce sont les **tarifs cibles** de la roadmap.
- CRM enrichi par tickets de caisse et déduplication multi-identité.
- Segments calculés avancés, automation marketing générique et attribution du chiffre d'affaires.
- Paiements de réservation : empreinte, acompte, prépaiement, frais d'annulation et billetterie.
- Profil client partagé complet entre établissements avec permissions et consolidation marketing.
- Connecteurs POS de production et réconciliation des ventes.

### Fonctionnel mais encore à prouver hors code

- Pilote Connect sur de vrais restaurants avec conversion et qualité des données mesurées.
- Campagne Service Copilot en conditions de service.
- Isolation multi-site par deux sessions Clerk et un membre restreint.
- État live des automations Hermes et soumission Mistral Marketplace.
- Cycle financier complet des cartes cadeaux et facturation aux nouveaux prix.

## Règle de clôture documentaire

Une tâche n'est considérée terminée que si les quatre éléments suivants sont présents :

1. le code ou la configuration est livré ;
2. le plus petit contrôle pertinent est vert ;
3. une preuve externe est jointe quand la tâche dépend de Stripe, Clerk, Telnyx, Cloudflare ou d'un pilote ;
4. ce fichier, `obsidian/Context.md` et une entrée de `obsidian/Journal.md` reflètent le nouvel état.

Les specs conservent le raisonnement initial. Lorsqu'une spec est livrée, ajouter un bandeau d'état et
une matrice « livré / restant » plutôt que de réécrire silencieusement l'historique. Les checklists de
runbook restent des modèles ; la preuve d'une exécution doit être datée dans `docs/audits/` ou dans le
journal.
