# Exécution croissance et acquisition — 13 octobre 2026

Brief suivi : [seo-acquisition-execution-plan.md](../runbooks/seo-acquisition-execution-plan.md).
Branche : `codex/growth-execution-2026-10-13` (worktree `sokar-growth`, base `main` = `fd576d7a`).
Le checkout principal n'a pas été modifié : ses changements non commités (onboarding v2, rôles,
provisioning, formules) restent intacts et ne sont pas embarqués.

Lecture des statuts : **livré techniquement** = code et tests présents sur la branche ; **vérifié
staging/production** = aucune vérification à ce jour, le déploiement n'a pas été fait ; **validé
commercialement** = aucune validation, aucun entretien, aucun paiement ; **en attente terrain** =
dépend d'une personne ou d'un accès externe.

## 1. Résultat obtenu et périmètre traité

**Résultat** : la vitrine ne présente plus de simulation comme une activité réelle, les prix sont
affichés hors taxes, les métadonnées de l'accueil et des tarifs sont propres, une demande de
démonstration sans compte est enregistrée et suivie par l'équipe, le sitemap ne publie plus de liste
tronquée en silence, et une fiche d'entretien et de pilote est prête. **Rien n'est encore déployé**.

**Traité** : TRUST-01, COPY-01, DEMO-01, DEMO-02, METRIC-01 (étape 1), SEO-01 (diagnostic), SEO-02,
ICP-01, BASE-01.

**Non traité, avec raison** :

- VOICE-01 et OPS-01 : appels réels et installation chez un client, donc dépendance terrain et
  onboarding v2 non intégré dans `main`.
- BILL-01 : vérification du catalogue Stripe et des quotas : accès externe non disponible.
- ICP-02, PILOT-01, ECON-01 : entretiens et pilotes, dépendance humaine.
- LAND-01 : la landing n'est pas publiée tant que la démonstration vocale n'est pas qualifiée.
- CONNECT-01, SCALE-01 : P2 conditionnels, critères non remplis.

## 2. Tickets

| ID         | Statut                        | Changement                                                                                                                                                                                                                                                                                       | Preuve                                                                                                                                                     | Prochaine action (responsable)                                                                                                      |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| BASE-01    | Livré techniquement           | Inventaire et constats datés (section 3)                                                                                                                                                                                                                                                         | Observations HTTP du 13/10/2026 16:35 UTC ; code cité                                                                                                      | Aucune ; à compléter avec Search Console et la base prod (Hamza)                                                                    |
| TRUST-01   | Livré techniquement           | Mention « Exemple illustratif — données simulées » ; retrait du revenu « 5 420 € », des tendances chiffrées, de « temps réel », « Live » et « Appel client en cours » ; maquette du storyboard corrigée ; compteur « +42 aujourd'hui » retiré                                                    | `DemoSection.test.tsx` (3 tests) ; HTML servi contenant la mention                                                                                         | Relire les chiffres restants (412, 189, 98 %) avec Hamza après déploiement                                                          |
| COPY-01    | Livré techniquement           | Hero : « Un assistant téléphonique pour vos réservations », paragraphe factuel, CTA « Demander une démonstration » → `/demo` et « Créer votre compte » → `/register` ; HT sur tous les prix ; FAQ intégrations et données réécrites ; métadonnées dédiées accueil, tarifs, démo ; `metadataBase` | `marketing-metadata.test.ts`, `PricingSection.test.tsx` ; titre, description, canonical et `og:locale` vérifiés dans le HTML servi                         | Valider les formulations signalées (section 5, points 3 et 4)                                                                       |
| VOICE-01   | En attente terrain            | Aucun appel passé. Dispositifs inventoriés (section 4)                                                                                                                                                                                                                                           | Lecture du code uniquement                                                                                                                                 | Qualifier les scénarios de la section 7 du brief avec les fournisseurs réels, en staging (Hamza ou l'équipe technique)              |
| OPS-01     | Bloqué                        | Non commencé                                                                                                                                                                                                                                                                                     | —                                                                                                                                                          | Intégrer l'onboarding v2 dans `main` (son auteur), puis qualifier numéro, renvoi et secours avec l'opérateur                        |
| DEMO-01    | Livré techniquement           | Table `demo_requests` et migration `20261013120000_demo_requests` (CREATE seul) ; `POST /public/demo-requests` ; page `/demo` sans compte                                                                                                                                                        | 13 tests API (`demo-request.routes.test.ts`) ; 5 tests UI (`DemoRequestForm.test.tsx`) ; parcours d'erreur vérifié dans le navigateur (API locale arrêtée) | Appliquer la migration en staging ; tester un envoi complet vers un destinataire de test (Hamza)                                    |
| DEMO-02    | Livré techniquement           | `GET /admin/demo-requests`, `PATCH /admin/demo-requests/:id` (opérateurs Sokar seulement) ; page `/dashboard/admin/demo-requests`                                                                                                                                                                | Tests API (401, 403, filtre, statut horodaté, 404) ; 4 tests UI                                                                                            | Désigner le responsable du suivi et le délai de réponse (Hamza) ; ajouter le lien de navigation après intégration du chantier admin |
| METRIC-01  | Livré techniquement (étape 1) | `demo_requested` = ligne de `demo_requests` ; `notifiedAt`, `contactedAt`, `demoDoneAt` horodatent les étapes opérateur. Aucun nouvel outil d'analytics                                                                                                                                          | Tests API sur les horodatages                                                                                                                              | Mapper les étapes suivantes sur les sources existantes après BILL-01 (section 6)                                                    |
| BILL-01    | En attente externe            | Prix publics alignés sur le runbook Stripe (199 / 299 / 249 € HT + 99 € HT par site, annuel −20 %)                                                                                                                                                                                               | Runbook `stripe-billing.md` et `plan.ts`, cohérents entre eux                                                                                              | Lancer `scripts/ops/verify-stripe-catalog.mjs` en lecture seule (opérateur avec accès Stripe) ; confirmer les quotas                |
| SEO-01     | Diagnostic livré (partiel)    | Constats datés ci-dessous (section 3)                                                                                                                                                                                                                                                            | HTTP et code                                                                                                                                               | Accès Search Console (Hamza) ; comptage des établissements publiables en base (équipe technique)                                    |
| SEO-02     | Livré techniquement           | Sitemap : erreur au lieu d'une liste tronquée, `/pricing` ajouté, dates inventées retirées, délai d'attente de 5 s ; `noindex` sur `/login`, `/register`, `/widget/[restaurantId]` et `/widget/[slug]/gift-card`                                                                                 | `sitemap.test.ts` (4) ; `transactional-pages.test.ts` (3) ; `page.metadata.test.ts` (1)                                                                    | Vérifier en staging le comportement de Next et Nginx pendant une panne API (non reproduite)                                         |
| ICP-01     | Livré techniquement           | `docs/runbooks/restaurant-discovery-interview.md` : fiche de qualification, guide, proposition de pilote, brouillon de prospection non envoyé, modèle de suivi sans donnée personnelle                                                                                                           | Relecture du document                                                                                                                                      | Valider le brouillon et choisir les établissements (Hamza)                                                                          |
| ICP-02     | En attente terrain            | Aucun entretien réalisé                                                                                                                                                                                                                                                                          | —                                                                                                                                                          | Mener 8 à 12 entretiens selon le guide (Hamza)                                                                                      |
| PILOT-01   | Bloqué                        | Non démarré                                                                                                                                                                                                                                                                                      | —                                                                                                                                                          | Dépend d'OPS-01, de BILL-01 et d'ICP-02                                                                                             |
| ECON-01    | À faire                       | Non démarré                                                                                                                                                                                                                                                                                      | —                                                                                                                                                          | Dépend des pilotes                                                                                                                  |
| LAND-01    | Bloqué                        | Landing non publiée                                                                                                                                                                                                                                                                              | —                                                                                                                                                          | Qualifier VOICE-01 ; obtenir l'accès Search Console ou Keyword Planner pour l'étude de demande                                      |
| CONNECT-01 | À requalifier (P2)            | Non démarré                                                                                                                                                                                                                                                                                      | —                                                                                                                                                          | Condition : inventaire réel de fiches publiées                                                                                      |
| SCALE-01   | À requalifier (P2)            | Non démarré                                                                                                                                                                                                                                                                                      | —                                                                                                                                                          | Condition : ECON-01 et LAND-01                                                                                                      |

## 3. Observations (BASE-01 et SEO-01)

Mesures en lecture seule (requêtes GET simples), faites le 13/10/2026 vers 16:35 UTC. Aucune protection
n'a été contournée.

| Surface                                      | Constat avant correction                                                                                                                                                                  | Source                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `https://sokar.tech/sitemap.xml`             | 200, 3 URL : accueil, `/assistant` et `/restaurant/chez-sokar-demo`                                                                                                                       | HTTP                                 |
| `https://api.sokar.tech/public/sitemap-data` | 200, 1 fiche publiée (`chez-sokar-demo`)                                                                                                                                                  | HTTP, comptage uniquement            |
| `https://api.sokar.tech/public/cities`       | 200, 0 ville                                                                                                                                                                              | HTTP                                 |
| `/pricing` dans le sitemap                   | Absent                                                                                                                                                                                    | HTTP                                 |
| `/`, `/pricing`, `/login`, `/register`       | Titre « Sokar — Restaurant Management », description générique en anglais, aucun canonical, aucun Open Graph ; `robots` absent                                                            | HTTP, HTML                           |
| `/privacy`                                   | `robots: index, follow` et `og:locale fr_FR` (modèle de référence)                                                                                                                        | HTTP                                 |
| Code `fetchPublishedSlugs` et `fetchCities`  | Retournent `[]` en cas d'erreur ; le sitemap ISR (5 min) la met en cache                                                                                                                  | `apps/connect/src/lib/api-client.ts` |
| Routage Nginx                                | `/sitemap.xml` et `/robots.txt` vers Connect ; `/`, `/pricing`, `/login`, `/register` et `/widget/*` vers le dashboard ; `/widget/*/gift-card` vers Connect ; `/book/*` vers le dashboard | `infra/nginx/sokar.conf`             |

**Diagnostic** : le 403 signalé dans le brief n'a pas été reproduit avec des requêtes simples. La liste
tronquée observée précédemment reste inexpliquée : le mécanisme (erreur réseau ou API transitoirement
indisponible, remplacée par `[]` puis mise en cache) est confirmé dans le code, sa cause précise ne
l'est pas. **Inconnues** : nombre d'établissements répondant à `PUBLIC_CONNECT_WHERE` en base (accès
production non disponible) ; indexation réelle (Search Console non accessible) ; comportement de Next
et Nginx pendant une panne (à tester en staging).

**Point à décider** : la fiche `chez-sokar-demo` est publiée, indexée dans le sitemap, et contient des
données de démonstration. Hamza doit confirmer si elle est voulue (démo publique) ou à dépublier.

**Décision technique hors périmètre** : le layout racine lit les cookies (`cookies()`), donc toutes les
pages du dashboard sont rendues à chaque requête (`ƒ` au build). Ce n'est pas un effet de cette branche.
Il limitera le rendu statique de la future landing (LAND-01) ; à traiter avant cette landing.

## 4. Démonstration vocale : niveaux de preuve (VOICE-01, lecture du code)

| Dispositif                                                                                 | Ce qu'il prouve                                                                                           | Ce qu'il ne prouve pas                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Animation et maquettes (`DemoSection`, `ScrollStoryboardSection`)                          | Présentation visuelle, désormais signalée comme simulée                                                   | Aucun appel, aucune réservation, aucune voix                                                  |
| Démonstration en direct pendant l'onboarding (`voice/demo/live-demo.ts`, `demo-stream.ts`) | Même pipeline STT → dialogue → TTS que la production, sur un transport navigateur, session marquée `demo` | Écritures de réservation simulées ; qualité réelle non mesurée ici ; aucun appel téléphonique |
| Lecture TTS d'un script                                                                    | Non vérifié dans cette session                                                                            | —                                                                                             |

Aucun appel n'a été passé. Les scénarios du brief (demande simple, changement en cours d'appel, complet,
nom ambigu, question pratique, reprise, dégradation) restent à qualifier avec les fournisseurs réels.

## 5. Fichiers et comportements modifiés

**Vitrine (dashboard)**

- `apps/dashboard/src/app/DemoSection.tsx` et `DemoSection.test.tsx` : mention de simulation, sans revenu
  ni « temps réel ».
- `apps/dashboard/src/app/ScrollStoryboardSection.tsx` : titres et maquette corrigés.
- `apps/dashboard/src/app/page.tsx` : métadonnées, hero, CTA, compteur retiré.
- `apps/dashboard/src/app/layout.tsx` : `metadataBase` (base absolue pour canonical et Open Graph).
- `apps/dashboard/src/app/pricing/page.tsx`, `PricingPlans.tsx`, `PricingSection.test.tsx` : prix HT,
  mention « Facturation annuelle, engagement de 12 mois ».
- `apps/dashboard/src/app/constants.ts` : fonctionnalités et FAQ.
- `apps/dashboard/src/app/marketing-metadata.ts` et son test : métadonnées de l'accueil, des tarifs et de la démo ; les prix de la description viennent du catalogue partagé `PLAN_PRICES_EUR`.
- `apps/dashboard/src/app/demo/` (page, formulaire, test) : demande de démonstration.
- `apps/dashboard/src/app/dashboard/admin/demo-requests/` (page, test) : suivi opérateur.
- `apps/dashboard/src/app/login/layout.tsx`, `register/layout.tsx`, `widget/[restaurantId]/layout.tsx`, `transactional-pages.test.ts` : `noindex`.

**API**

- `apps/api/src/modules/demo-requests/` : service, routes et tests (13).
- `apps/api/src/main.ts` : enregistrement de `demoRequestRoutes`.
- `apps/api/src/test/setup.ts` et `helpers.ts` : délégué `demoRequest` dans les mocks Prisma.
- `apps/api/.env.example` : `DEMO_REQUEST_NOTIFY_TO` documentée.

**Base de données**

- `packages/database/prisma/schema.prisma` : enum `DemoRequestStatus`, modèle `DemoRequest` (table `demo_requests`).
- `packages/database/prisma/migrations/20261013120000_demo_requests/migration.sql` : `CREATE TYPE`, `CREATE TABLE`, deux index. Aucun `DROP` ni `TRUNCATE`. Non appliquée.

**Connect**

- `apps/connect/src/app/sitemap.ts` et `sitemap.test.ts` : sitemap.
- `apps/connect/src/lib/api-client.ts` : `fetchSitemapSources` (erreur explicite, délai de 5 s).
- `apps/connect/src/app/widget/[slug]/gift-card/page.tsx` et `page.metadata.test.ts` : `noindex`.

**Documentation**

- `docs/audits/2026-10-13-growth-execution.md` : ce rapport.
- `docs/runbooks/restaurant-discovery-interview.md` : support d'entretien et de pilote.
- `docs/runbooks/seo-acquisition-execution-plan.md` : brief, reformaté par Prettier (forme seulement).
- `docs/runbooks/environment.md` : section « Demandes de démonstration ».
- `docs/obsidian/Context.md` : trois lignes de TODO. `docs/obsidian/Journal.md` : une entrée.

**Comportements visibles après déploiement**

- Accueil et tarifs : nouveaux titres, descriptions et canonical ; prix « HT ».
- `/demo` : formulaire sans compte, confirmation sans délai promis.
- `/login`, `/register`, `/widget/*` : `noindex, nofollow`.
- `/sitemap.xml` : `/pricing` ajouté ; une panne de l'API renvoie une erreur au lieu d'une liste partielle.

**Décisions prises** (chacune a un coût si elle est fausse)

1. **Isolation** : worktree créé à la main, pas l'outil natif `EnterWorktree` (qui exige le mot « worktree » explicitement). Le brief demande une branche `codex/` et l'isolation du chantier, et le checkout principal porte du travail non commité. _Coût si faux_ : un worktree à supprimer (`git worktree remove`). Cela va à l'encontre de la préférence mémorisée « pas de worktree sans demande explicite » : à confirmer.
2. **Brief** : le fichier `seo-acquisition-execution-plan.md`, non suivi dans `main`, est committé avec le chantier et reformaté par Prettier (forme seulement). _Coût_ : un fichier de plus dans la PR.
3. **Un seul rapport** : les fichiers de baseline, de backlog et de phase 4, 5 et 7 du runbook ne sont pas créés ; leur contenu est dans ce rapport. Le guide d'entretien est un support, pas un rapport. _Coût_ : les noms prévus par le runbook n'existent pas encore.
4. **Demande de démonstration** : enregistrée avant toute notification ; aucun e-mail tant que `DEMO_REQUEST_NOTIFY_TO` n'est pas défini ; aucun compte Clerk ; aucun délai de réponse promis. _Coût_ : aucune alerte commerciale tant que la variable n'est pas définie.
5. **Accès opérateur** : `requireSokarOperator` (liste `SOKAR_OPERATOR_USER_IDS`). Le lien de navigation n'est pas ajouté, car le layout admin a des modifications non commitées dans le checkout principal. _Coût_ : l'URL doit être saisie à la main.
6. **Prix HT** : affichés hors taxes, comme le runbook Stripe. _Coût si le catalogue actif est TTC_ : les libellés sont faux ; à confirmer (BILL-01).
7. **Affirmations retirées sans preuve** : revenu récupéré, « répond à chaque appel », « arriveront progressivement » (intégrations), « conforme au RGPD », « hébergées en Europe », « jamais partagées avec des tiers », « chiffrées au repos et en transit », « en temps réel », « instantanément », « zéro » et garanties similaires. _Coût_ : des formulations moins fortes ; réintroduction possible après validation.
8. **Affirmations conservées et signalées** : « Support prioritaire 7j/7 », « Tout l'Essential, sans limite », « Vos clients reconnus à chaque appel », « Toujours disponible », « Tous. Des bistrots… », « Taux de réponse 98 % » (sous mention de simulation). _Coût_ : ces formulations restent publiques jusqu'à validation.
9. **Sitemap** : une panne de l'API lève une erreur (pas de liste tronquée). _Coût_ : pendant une panne, Google reçoit une erreur au lieu d'une liste partielle ; le comportement du cache Next est à vérifier en staging.
10. **`noindex`** sur `/login`, `/register`, `/widget/[restaurantId]` et `/widget/[slug]/gift-card`, sans `Disallow` (le robot doit lire la directive). _Coût_ : aucune indexation de ces pages, voulu.
11. **Migration** : additive, non appliquée. _Coût si elle n'est pas appliquée au déploiement_ : `POST /public/demo-requests` répond 503 (erreur propre, aucune demande perdue).
12. **Tests** : pour les assertions HT et métadonnées, le code a été écrit avant les assertions (ordre inversé). Le rouge a été observé pour la mention de simulation, les métadonnées, l'API, le formulaire, le sitemap et le `noindex`, pas pour les assertions HT. _Coût_ : preuve plus faible pour ces assertions.
13. **Mocks partagés** : `setup.ts` et `helpers.ts` ont reçu un délégué `demoRequest`. _Coût_ : conflit possible avec le travail non commité qui touche ces fichiers.
14. **Hors périmètre volontaire** : aucun message envoyé, aucun appel téléphonique, aucune modification Stripe, aucune landing publiée, aucune requête à Search Console.

## 6. Vérifications exécutées

| Vérification                                                       | Commande ou méthode                                                                            | Résultat                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Version Node                                                       | `pnpm node:check`                                                                              | OK (Node 22.23.2)                                                                                 |
| Installation                                                       | `pnpm install --frozen-lockfile`                                                               | OK                                                                                                |
| Build des paquets                                                  | `pnpm --filter "./packages/*" run build`                                                       | OK                                                                                                |
| Schéma Prisma                                                      | `prisma validate` (URL factice) ; `prisma generate` ; `prisma migrate diff --script` hors base | OK ; SQL limité à `CREATE`                                                                        |
| Sécurité des migrations                                            | `scripts/quality/check-migration-safety.mjs`                                                   | OK (1 migration ajoutée, aucune destructive)                                                      |
| Scoping tenant                                                     | `scripts/quality/check-tenant-scoping.mjs`                                                     | OK (avertissements de baisse de baseline, informatifs)                                            |
| Taille du vault                                                    | `scripts/quality/check-vault-size.sh`                                                          | OK (Context.md à 7 755 octets)                                                                    |
| Tests API complets                                                 | `pnpm --filter @sokar/api test`                                                                | 354 fichiers OK, 5 ignorés ; 3 779 tests OK, 54 ignorés                                           |
| Tests dashboard complets                                           | `pnpm --filter @sokar/dashboard test`                                                          | 77 fichiers, 584 tests OK                                                                         |
| Tests connect complets                                             | `pnpm --filter @sokar/connect test`                                                            | 20 fichiers, 136 tests OK                                                                         |
| Typecheck                                                          | `tsc` API, dashboard, connect                                                                  | OK, 0 erreur                                                                                      |
| Lint                                                               | `eslint` (API) ; `next lint` (dashboard, connect) sur les fichiers modifiés                    | OK, 0 avertissement                                                                               |
| Format                                                             | `prettier --check` sur les fichiers modifiés                                                   | OK                                                                                                |
| Build dashboard                                                    | `next build`                                                                                   | OK ; routes `/`, `/pricing`, `/demo` en `ƒ` (voir section 3)                                      |
| HTML servi (serveur local, valeurs factices de Clerk, non réelles) | `curl` sur `/`, `/pricing`, `/demo`, `/login`, `/register`                                     | Titres, descriptions, canonical et `robots` conformes ; mention de simulation et prix HT présents |
| Parcours navigateur                                                | Accueil et `/demo` en mobile (375 px) ; section démo en desktop                                | Lisible, CTA empilés ; erreur d'envoi affichée, saisie conservée                                  |
| Sitemap et métadonnées de production                               | `curl` GET (avant déploiement)                                                                 | Voir section 3                                                                                    |

**Non vérifié** :

- déploiement, staging et production : rien n'est déployé ;
- parcours de succès `/demo` jusqu'à la base : API et PostgreSQL locaux non démarrés ;
- envoi réel d'e-mail : aucun destinataire configuré ;
- mise en page sur iPad (768 px) : non vérifiée ;
- Search Console, Stripe en production, appels vocaux : aucun accès.

## 7. Dépendances restantes

| Dépendance                    | Responsable                   | Action précise                                                                                 | Conséquence si elle manque                                |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Destinataires de notification | Hamza                         | Choisir les adresses et définir `DEMO_REQUEST_NOTIFY_TO` en staging puis en production         | Les demandes sont enregistrées mais personne n'est alerté |
| Délai de réponse              | Hamza                         | Fixer le délai réel, puis l'afficher si on le tient                                            | Aucun délai n'est promis ; le délai reste à définir       |
| Migration `demo_requests`     | Équipe technique              | Appliquer en staging avant la production, vérifier la table                                    | `/public/demo-requests` répond 503                        |
| Relecture juridique           | Hamza ou conseil juridique    | Valider la FAQ données (hébergement, sous-traitants voix, RGPD) et « Support 7j/7 »            | Affirmations retirées ou signalées restent à trancher     |
| Fiche `chez-sokar-demo`       | Hamza                         | Confirmer la publication ou la dépublier                                                       | Fiche démo indexable                                      |
| Catalogue Stripe              | Opérateur avec accès Stripe   | `scripts/ops/verify-stripe-catalog.mjs` en lecture seule ; confirmer quotas et « sans limite » | Prix HT et périmètre non confirmés                        |
| Search Console                | Hamza                         | Donner l'accès à la propriété `sokar.tech`                                                     | Indexation réelle inconnue (UNKNOWN)                      |
| Base production               | Équipe technique              | Compter les établissements publiables selon `PUBLIC_CONNECT_WHERE` (sans coordonnées)          | Nombre de fiches publiables inconnu                       |
| Qualification vocale          | Hamza ou équipe technique     | Passer les scénarios du brief avec les fournisseurs réels, en staging                          | Pas de démonstration vocale qualifiée ; landing bloquée   |
| Onboarding v2                 | Auteur du travail non commité | Intégrer dans `main`                                                                           | OPS-01 et PILOT-01 bloqués                                |
| Entretiens et pilotes         | Hamza                         | Choisir 8 à 12 établissements, mener les entretiens selon le guide                             | Aucune décision commerciale possible                      |
| Navigation admin              | Auteur du chantier admin      | Ajouter le lien vers `/dashboard/admin/demo-requests`                                          | Accès par URL uniquement                                  |

**Points à reporter dans la PR et la décision de mise en production** : nouvelle table (migration),
routes publiques ajoutées (additives), changement de sitemap et de métadonnées, copie publique modifiée.

## 8. Décision proposée

1. **Relire la PR puis la faire passer en staging** : appliquer la migration, envoyer une demande de test
   (avec un destinataire de test), vérifier `/`, `/pricing`, `/demo`, `/sitemap.xml`, `/login` et le
   suivi opérateur. Puis promouvoir selon le runbook de déploiement, avec snapshot et rollback prêts.
2. **Ne pas publier de landing** tant que la démonstration vocale n'est pas qualifiée (VOICE-01) et que
   l'accès à Search Console n'est pas obtenu.
3. **Ne lancer aucun pilote** avant trois conditions : onboarding v2 intégré (OPS-01), catalogue Stripe
   confirmé (BILL-01), et au moins un entretien mené (ICP-02). Aucune offre ne doit être faite avant la
   confirmation du prix HT.
4. **Mesurer la demande réelle** pendant deux semaines après ouverture de `/demo` : nombre de demandes,
   délai de réponse tenu, taux de demandes notifiées. Décider ensuite de la suite selon ces chiffres.
5. **Réviser les textes signalés** avant la prochaine mise en production publique.
