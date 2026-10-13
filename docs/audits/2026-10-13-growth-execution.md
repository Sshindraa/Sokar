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
9. **Sitemap** : rendu à la requête (`force-dynamic`), donc le build ne dépend plus de l'API (la CI n'en a pas). Une panne de l'API lève une erreur (pas de liste tronquée). _Coût_ : pendant une panne, Google reçoit une erreur au lieu d'une liste partielle ; le comportement du cache Next est à vérifier en staging.
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

## 10. Qualification après fusion (13/10/2026, soir)

Brief de qualification : PR #417 fusionnée à 17:18:47 UTC (merge `298fd1ac`). Les preuves ci-dessous
proviennent des journaux GitHub Actions, de contrôles HTTP en lecture seule, de tests locaux et de
navigations sur la production. Les demandes de test sur staging ont été faites avec des données
fictives.

### 10.1 Déploiement vérifié (journaux GitHub Actions)

| Environnement | Run                            | Migration `20261013120000_demo_requests`                                                             | Résultat                                                                                  |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Staging       | 38438346093, 17:24 à 17:27 UTC | Appliquée à 17:26:57 UTC (« All migrations have been successfully applied »)                         | Smoke tests : succès                                                                      |
| Production    | 38439002920, 17:29 à 17:32 UTC | Appliquée à 17:31:43 UTC, après sauvegarde `sokar-20261013T173139Z.dump` et restauration de contrôle | Health : API `/health` et `/livez` 200, dashboard 200, Connect 200 ; smoke tests : succès |

La promotion en production a été automatique, comme le prévoit `AGENTS.md`, une fois CI et staging verts.
Rollback disponible : snapshot pré-build et sauvegarde datée (`/var/backups/sokar/`).

### 10.2 Demande de démonstration sur staging

- Envoi de test par le formulaire de staging, avec des données fictives (établissement « QA test Sokar
  13-10-2026 (à supprimer) », e-mail `qa.sokar.test@example.com`). Requête réseau :
  `POST /api/proxy/public/demo-requests` → **201**. Le message « Demande bien enregistrée » est affiché.
  La demande est donc persistée et la table existe.
- **Visible dans l'administration : non vérifié.** Staging tourne en mode démo : une requête anonyme est
  traitée comme `demo-user`, et `GET /admin/demo-requests` répond 403 (« Sokar operator access required »).
  Il faut un compte opérateur connecté pour voir la liste. Cette demande de test doit être clôturée
  par l'opérateur après contrôle.
- **Notification reçue : non, et non configurable en l'état.** Constat : les workflows de déploiement
  ne transmettaient pas `DEMO_REQUEST_NOTIFY_TO` au `.env` de l'API. Aucune notification n'a donc pu partir,
  ni en staging ni en production. Correctif dans la PR #418 (secret GitHub + script de synchronisation).
  Reste à fournir le destinataire de test autorisé et à créer le secret.

### 10.3 Sitemap : disponibilité de l'API et comportement réel du cache

Test local : build de production de Connect (`output: standalone`, Next 15.5), API simulée sur un port
local, deux instances. Les réponses ci-dessous viennent de `curl` sur le serveur réel.

| Étape | API                                            | Réponse             | Entrées | Lecture                                         |
| ----- | ---------------------------------------------- | ------------------- | ------- | ----------------------------------------------- |
| A1    | disponible, v1                                 | 200                 | 5       | Données fraîches                                |
| A2    | disponible, v2 (3 fiches), cache encore valide | 200                 | 5       | Cache : aucune nouvelle requête à l'API         |
| A3    | indisponible (503), cache encore valide        | 200                 | 5       | Cache : la panne est invisible                  |
| A4    | indisponible, après 310 s                      | 200                 | 5       | Données périmées servies, pas de liste tronquée |
| A5    | revenue, v2                                    | 200                 | 5       | Revalidation lancée en arrière-plan             |
| A6    | revenue, v2                                    | 200                 | 6       | Données à jour                                  |
| B1    | serveur froid (aucun cache), indisponible      | **500**, corps vide | 0       | Pas de liste tronquée                           |
| B2    | serveur froid, revenue                         | 200                 | 5       | Liste complète                                  |

Conclusions : le sitemap ne publie jamais une liste partielle. Une panne de l'API est absorbée par le
cache de données pendant 5 min, puis par la donnée périmée. Au démarrage à froid, elle produit une erreur.
En production, `cf-cache-status: DYNAMIC` : Cloudflare ne met pas le sitemap en cache. **Non testé** :
le comportement de Nginx en amont et les effets de purge au déploiement.

### 10.4 Pages modifiées sur mobile, iPad et desktop (production)

| Page             | 375 px                                     | 768 px | 1024 px | Constat                                                             |
| ---------------- | ------------------------------------------ | ------ | ------- | ------------------------------------------------------------------- |
| `/` hero         | OK                                         | OK     | OK      | CTA empilés en mobile, sans débordement                             |
| `/` section démo | OK (grille 2 colonnes puis pleine largeur) | OK     | OK      | Mention de simulation visible                                       |
| `/pricing`       | **Illisible**                              | —      | —       | Thème clair stocké : fond clair, texte blanc. **Corrigé dans #418** |
| `/demo`          | OK                                         | OK     | OK      | Lisible en thème clair comme en sombre                              |

Constats hors périmètre, non corrigés : en-tête « Cas d'usage » sur deux lignes à 768 px (en-tête
partagé, non modifié par cette branche) ; étiquettes décoratives « METRIC_CARD » et « 01_HMI_TUNER »
dans les maquettes (pré-existantes, à trancher par Hamza).

### 10.5 Défauts constatés et corrigés (PR #418)

| Défaut                                                         | Correction                                                                                     | Preuve                                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/pricing` illisible quand le visiteur a choisi le thème clair | Liste des pages de vitrine étendue à `/pricing` ; script extrait dans `theme-bootstrap.ts`     | Test du script réel dans un contexte isolé (RED puis GREEN, 3/3) ; à vérifier sur la production après déploiement |
| `/demo` absente du sitemap                                     | Ajoutée aux pages statiques, avec son test                                                     | Sitemap test RED puis GREEN (5/5)                                                                                 |
| Notification de démo jamais transmise à l'API                  | Secret `DEMO_REQUEST_NOTIFY_TO` dans les deux workflows ; script `sync-demo-request-config.sh` | Script testé : remplacement sans doublon, valeur invalide refusée, secret absent sans effet, mode 600             |
| Sitemap échouant au build (`ECONNREFUSED`, CI)                 | Déjà corrigé dans la branche précédente (`aebedf2d`)                                           | Build local reproduit puis vert                                                                                   |

### 10.6 Public après promotion (13/10/2026, 17:35 UTC)

- `https://sokar.tech/sitemap.xml` : 200, 4 URL (accueil, `/assistant`, `/pricing`, fiche de démonstration).
  `/demo` absente : corrigée dans #418.
- Métadonnées : `/`, `/pricing`, `/demo` en `index, follow` avec titres propres ; `/login` et `/register`
  en `noindex, nofollow`.
- En-têtes du sitemap : `cache-control: public, max-age=0, must-revalidate`, `cf-cache-status: DYNAMIC`.

### 10.7 VOICE-01 : état et dépendances réelles

- Aucun appel n'a été passé dans cette session. Les dispositifs et leurs niveaux de preuve sont décrits en section 4.
- **Dépendance réelle 1** : des appels réels avec les fournisseurs réels, depuis un numéro de test, par
  une personne disposant de l'accès (Hamza ou l'équipe technique). Aucun identifiant de téléphonie n'est
  accessible ici.
- **Dépendance réelle 2** : la démonstration en direct de l'onboarding exige un compte restaurateur
  authentifié (émission d'un ticket soumise à Clerk). Un compte de test doit être créé par Hamza.
- Scénarios à qualifier (brief, section 7) : demande simple ; changement pendant la conversation ;
  restaurant complet ; nom ou heure ambigus ; question pratique ; reprise ou répétition ; service dégradé.
- Preuve attendue : date, environnement, version et commit, transcription expurgée, résultat métier
  vérifié dans le dashboard autorisé, taux de réussite avec son dénominateur (échecs inclus).
- Search Console n'est pas une dépendance de VOICE-01.

### 10.8 LAND-01 : préparation et dépendances réelles

**Étude de demande, sans Search Console ni Keyword Planner** (recherche web publique, 13/10/2026). Aucun
volume ni difficulté n'est donné : ils restent **UNKNOWN**.

Expressions candidates, classées par intention :

| #   | Expression                                        | Intention                 |
| --- | ------------------------------------------------- | ------------------------- |
| 1   | assistant téléphonique restaurant                 | Restaurateur (solution)   |
| 2   | standard téléphonique restaurant                  | Restaurateur              |
| 3   | standard téléphonique IA restaurant               | Restaurateur              |
| 4   | assistant vocal restaurant                        | Restaurateur              |
| 5   | assistant téléphonique IA restaurant              | Restaurateur              |
| 6   | prise de réservation téléphone restaurant         | Restaurateur              |
| 7   | réservation téléphonique restaurant logiciel      | Restaurateur (comparatif) |
| 8   | logiciel réservation restaurant téléphone         | Restaurateur (comparatif) |
| 9   | gestion des appels restaurant                     | Restaurateur (problème)   |
| 10  | appels manqués restaurant                         | Restaurateur (problème)   |
| 11  | répondre aux appels pendant le service restaurant | Restaurateur (problème)   |
| 12  | répondeur restaurant réservation                  | Restaurateur              |
| 13  | répondeur automatique restaurant                  | Restaurateur              |
| 14  | agent IA restaurant réservation                   | Restaurateur              |
| 15  | logiciel restaurant réservations téléphone        | Restaurateur              |
| 16  | réservation par téléphone restaurant              | Mixte                     |
| 17  | réserver une table par téléphone                  | Consommateur              |
| 18  | appeler un restaurant pour réserver               | Consommateur              |

**Paysage concurrentiel observé** (éditeurs et articles, données non vérifiées) : Allo (withallo.com),
Famulor (famulor.io), Bookler de Formitable (formitable.com), Assistent.ai, Ainora (ainora.lt), Anolla
(anolla.com), ClickTable, DineTime, BiteBuddy, aleno, Loman (loman.ai), CloudTalk, Jotform, et l'aide
Zenchef sur son assistant IA. Les éditeurs annoncent des taux (98 %, 100 %, 59,3 %, 80 à 90 %) ou des délais
de réponse qui ne sont pas vérifiables : **nous ne les reprenons pas**.

**Dépendances réellement manquantes pour publier la landing** :

- **Preuve de démonstration** : VOICE-01 (ci-dessus). C'est la seule dépendance bloquante.
- **Promesse** : déjà exacte dans la vitrine (répond aux appels transférés, consulte les disponibilités,
  enregistre les réservations). Aucune garantie chiffrée, aucune parité avec un concurrent.
- **Conversion** : `/demo` est en production. Le suivi opérateur existe, reste à le faire tenir (délai de
  réponse à définir par Hamza).
- **Technique** : route `/solutions/assistant-telephonique-restaurant` à créer après VOICE-01, avec
  métadonnées propres, canonical, entrée au sitemap, et maillage depuis l'accueil.

**Non bloquants** : Search Console (la landing peut être publiée sans elle ; l'indexation réelle reste
UNKNOWN) ; volumes de recherche ; témoignages et gains chiffrés (exclus de la landing tant qu'ils n'ont
pas leurs preuves).

**Plan proposé de la landing** (à publier après VOICE-01) : cible et problème concret ; fonctionnement
(répondre, consulter, enregistrer) ; démonstration avec transcription accessible et mention de simulation si
besoin ; configuration et secours ; limites (pas de synchronisation avec un autre logiciel, pas de gain
garanti) ; prix HT et engagement ; questions pratiques (FAQ) ; CTA vers `/demo`.

**Sources consultées** (13/10/2026) : [famulor.io/fr/industries/restaurants](https://www.famulor.io/fr/industries/restaurants),
[withallo.com/fr/industries/restaurants](https://www.withallo.com/fr/industries/restaurants),
[formitable.com/integrations/bookler](https://formitable.com/integrations/bookler),
[help.zenchef.com (Assistent AI)](https://help.zenchef.com/hc/en-gb/articles/17866645446301-Assistent-ai),
[ainora.lt/fr/standard-telephonique-restaurants](https://ainora.lt/fr/standard-telephonique-restaurants),
[appvizer.fr (logiciels de réservation)](https://www.appvizer.fr/magazine/relation-client/reservation/logiciel-de-reservation-restaurant),
[anolla.com/fr/logiciel-de-restaurant](https://anolla.com/fr/logiciel-de-restaurant),
[cloudtalk.io (réceptionniste IA)](https://www.cloudtalk.io/video/automate-restaurant-front-desk-with-ai-receptionist/).

### 10.9 Dépendances restantes (après qualification)

| Dépendance                                                                                        | Responsable               | Action précise                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adresse de test autorisée pour la notification de staging, puis adresse commerciale en production | Hamza                     | Indiquer les deux adresses et autoriser la création du secret GitHub `DEMO_REQUEST_NOTIFY_TO` : au niveau dépôt (adresse de test, lue par staging) et dans l'environnement `production` (adresse commerciale, prioritaire en production)    |
| Vérification de la liste opérateur                                                                | Hamza                     | Accès manquant : aucune session opérateur dans le navigateur intégré. Se connecter en compte opérateur sur staging, ouvrir `/dashboard/admin/demo-requests`, vérifier la ligne « QA test Sokar 13-10-2026 », puis la passer en « Clôturée » |
| Qualification vocale                                                                              | Hamza ou équipe technique | Passer les sept scénarios de la [fiche de qualification](2026-10-13-commercial-demo-validation.md) avec un restaurant de test et un numéro de test, archiver les preuves expurgées                                                          |
| Compte restaurateur de test                                                                       | Hamza                     | Créer un compte de test pour la démonstration en direct de l'onboarding                                                                                                                                                                     |
| Suivi des demandes                                                                                | Hamza                     | Désigner le responsable et fixer le délai de réponse à afficher, ou ne rien afficher                                                                                                                                                        |
| Search Console                                                                                    | Hamza                     | Donner l'accès à la propriété `sokar.tech` (non bloquant pour la landing)                                                                                                                                                                   |
| Lien de navigation admin                                                                          | Auteur du chantier admin  | Ajouter le lien vers `/dashboard/admin/demo-requests`                                                                                                                                                                                       |

### 10.10 Après fusion de #418 (13/10/2026, 18:33 UTC)

- **Fusion** : #418 fusionnée à 18:27:05 UTC, commit `a40edf98` sur `main`. Son arbre est identique à la branche relue (`git diff` vide).
- **CI et déploiements** : la CI de `main` (run 38446846772) tourne encore à 18:33 UTC. Deploy Staging puis Deploy Production s'enchaînent après elle. Leur résultat, la trace du passage de `sync-demo-request-config.sh` dans leurs journaux, et les vérifications de `/pricing` (thème clair mémorisé) et de `/sitemap.xml` (présence de `/demo`) restent à consigner dans cette section.
- **Secret `DEMO_REQUEST_NOTIFY_TO`** : absent du dépôt et de l'environnement `production` (`gh secret list`, 18:28 UTC). Les deux workflows n'appellent pas le script de synchronisation tant que la valeur est vide (garde `-n`) : la configuration existante reste en place. **Aucune notification ne partira tant que le secret n'existe pas.**
- **Accès opérateur** : aucune session opérateur dans le navigateur intégré. `https://staging.sokar.tech/dashboard/admin/demo-requests` affiche « Vérification des accès… », puis redirige vers `/dashboard`. Accès manquant : une connexion en compte opérateur sur staging, dans le navigateur intégré.
- **Workflows Dependabot** : deux runs `Dependabot Updates` (npm_and_yarn à la racine) en échec sur `main` à 18:27 UTC (runs 38446873602 et 38446873630). Ils ne concernent pas #418 et ne sont pas traités ici.
- **VOICE-01** : 0 appel passé. Protocole, scénarios et journal d'essais dans la [fiche de qualification](2026-10-13-commercial-demo-validation.md). Dépendances réelles : un restaurant de test et un numéro de test routé vers lui, et un appelant disposant de ce numéro. Les rejeux LLM ne remplacent pas cette qualification : ils ne couvrent ni la téléphonie, ni le STT, ni le TTS, et l'outil documenté utilise la clé Cerebras de production (en-tête de `apps/api/scripts/voice-behavior-replay.mjs`).
- **LAND-01** : non publiée. Le plan conditionne la publication à la preuve VOICE-01 (backlog, section 17). Search Console ne bloque pas.

### 10.11 Contrôles après déploiement de #418 (13/10/2026, après le run de production du 18:49 UTC)

**Déploiements** (journaux GitHub Actions ; jobs « VPS » et « smoke tests » verts pour les quatre runs) :

| Run         | Workflow          | Déclenché par            | Heure (UTC) |
| ----------- | ----------------- | ------------------------ | ----------- |
| 38447714633 | Deploy Staging    | CI de #418               | 18:33:29    |
| 38448276498 | Deploy Production | Staging vert (#418)      | 18:37:39    |
| 38449590156 | Deploy Staging    | CI de #419 (38448663489) | 18:47:20    |
| 38449918493 | Deploy Production | Staging vert (#419)      | 18:49:48    |

Le texte de `scripts/ops/sync-demo-request-config.sh` apparaît dans les journaux du run 38449918493 (lignes 78 et 244), affiché par l'action SSH. Aucun message d'exécution du script n'apparaît : cohérent avec la garde `-n` sur un secret vide. La preuve d'exécution (« Destinataires … synchronisés ») viendra avec le premier déploiement disposant du secret.

**`/pricing` en production, thème clair mémorisé** (`sokar-dashboard-theme=light`, navigateur intégré) :

- À 375 px : classe `light` absente de `<html>`, fond `rgb(10, 10, 10)`, texte `rgb(240, 240, 240)`, titre « Tarifs » en dégradé découpé sur le texte, visible sur la capture, sans défilement horizontal.
- Largeur par défaut du panneau : la capture montre la page lisible (cartes et prix HT).
- Référence avant #418 (production, #417) : classe `light`, fond `rgb(245, 245, 242)`, titre à couleur transparente sur fond clair : défaut confirmé.
- Le code vérifié est celui de #418 : #419 ne modifie que la documentation.
- Staging non contrôlé dans le navigateur (même code déployé).

**Sitemap** (`curl`, après le run du 18:49 UTC) : `https://sokar.tech/sitemap.xml` et `https://staging.sokar.tech/sitemap.xml` contiennent `/assistant`, `/demo` et `/pricing`.

**Demande de démonstration** : enregistrement vérifié sur staging avant ce contrôle (201, section 10.2). Visibilité opérateur, notification et traitement non vérifiés : accès opérateur et destinataires manquants.

**Qualification vocale** : aucun essai. Le provisioning déclenche un appel Telnyx réel (`POST /api/admin/provisioning/:restaurantId/test-call`), puis exige une confirmation humaine (`validate-test-call`, appel « reçu et entendu »). Ces routes sont réservées à l'opérateur. Prérequis : session opérateur sur staging, restaurant de test provisionné (numéro attribué, webhook vérifié), une personne pour passer l'appel, un accès en lecture au dashboard du restaurant de test.

**LAND-01** : non publiée. Critères du backlog (section 17) : COPY-01, VOICE-01, DEMO-01/02.

- DEMO-01 : enregistrement vérifié ; notification et traitement à vérifier.
- DEMO-02 : responsable désigné, délai de réponse défini, accès opérateur vérifié.
- COPY-01 : affirmations signalées validées (« Support 7j/7 », « sans limite » pour Pro, « Vos clients reconnus à chaque appel », « Toujours disponible », FAQ données et RGPD).
- VOICE-01 : aucune preuve.
- Search Console : non bloquant.

**Dépendances restantes** :

| Débloque                              | Entrée attendue                                                                                                                  | Responsable               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Notifications staging puis production | Adresse de test, adresse commerciale                                                                                             | Hamza                     |
| Visibilité, traitement, DEMO-02       | Connexion opérateur sur staging dans le navigateur intégré ; nom du responsable ; délai de réponse                               | Hamza                     |
| VOICE-01                              | Restaurant de test provisionné sur staging, numéro et webhook vérifiés, personne pour l'appel, confirmation `validate-test-call` | Hamza ou équipe technique |
| COPY-01                               | Validation des affirmations signalées                                                                                            | Hamza                     |
| LAND-01                               | VOICE-01 qualifiée, DEMO-02 et COPY-01 satisfaits                                                                                | Hamza, puis livraison     |

### 10.12 Livraison : affirmations retirées, demande traitable, VOICE-01 et LAND-01

**Affirmations retirées ou reformulées.** La garde `apps/dashboard/src/app/marketing-claims.test.ts` liste les formulations sans preuve. Elle a échoué sur sept pages avant les corrections (sept cas rouges) et passe après. Chaque retrait est listé ci-dessous.

| Page                         | Affirmation                                                                                                                          | Action                                                  | Motif                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Inscription et connexion     | Témoignage « Chef Matthieu, Bistrot L’Ardoise — 2 étoiles Michelin », « Sokar gère 100 % des appels », badge « Partenaire Certifié » | Retiré                                                  | Aucune source dans le dépôt ; le plan réserve les témoignages à leurs propres preuves       |
| Inscription et connexion     | « 98,4 % » « Taux de réponse garanti », « +18,4 % », « 412 » « Appels traités ce mois »                                              | Retiré                                                  | Valeurs codées en dur, sans source, présentées hors de tout libellé de simulation           |
| Inscription et connexion     | Badge « Simulation temps réel »                                                                                                      | Remplacé par « Exemple illustratif — données simulées » | Même libellé que la démonstration de l’accueil                                              |
| Offres, Essential            | « Répond aux appels transférés, 24h/24 »                                                                                             | « Répond aux appels transférés »                        | Disponibilité 24 h/24 non démontrée                                                         |
| Offres, Pro                  | « Tout l’Essential, sans limite »                                                                                                    | « Tout l’Essential »                                    | Aucune limite de volume démontrée                                                           |
| Offres, Pro                  | « Vos clients reconnus à chaque appel »                                                                                              | Retiré                                                  | Reconnaissance des appelants non démontrée dans le parcours vocal                           |
| Offres, Pro                  | « Réservable depuis ChatGPT et Claude »                                                                                              | Retiré                                                  | MCP peut rester en observation (voir docs/architecture/reservation-commercial-readiness.md) |
| Offres, Pro                  | « Support prioritaire 7j/7 »                                                                                                         | Retiré                                                  | Engagement de support non démontré                                                          |
| Accueil                      | « Toujours disponible » (carte flottante)                                                                                            | « Répond aux appels transférés »                        | Garantie de disponibilité non démontrée                                                     |
| Illustration du parcours     | « client reconnu »                                                                                                                   | « fiche client »                                        | Reconnaissance non démontrée                                                                |
| Page MCP                     | « Trois scopes, zéro débordement »                                                                                                   | « Trois scopes distincts »                              | Garantie absolue non démontrée                                                              |
| Politique de confidentialité | « Sokar est conforme au RGPD. »                                                                                                      | Retiré                                                  | Affirmation juridique, à valider (dépendance juridique)                                     |

**Restent à confirmer, non modifiés :**

- Hébergement « à Francfort, en Allemagne » (politique de confidentialité) : aucun élément du dépôt ne prouve la région du fournisseur. À confirmer par Hamza, ou à retirer.
- « Ton adapté à votre établissement » : le réglage de style est soumis à des indicateurs de déploiement ciblé (`VOICE_PERSONALITY_STYLE_RESTAURANT_IDS`). À confirmer avant publication.
- « Rapport quotidien de vos appels » : un job de rapport quotidien existe dans l'API. Son contenu reste à vérifier sur un exemple réel.
- Les chiffres de la démonstration de l'accueil (412, 189, 98 %) restent dans des blocs étiquetés « Exemple illustratif — données simulées ».

**Demande de démo traitable.** La page `/admin/demo-requests` est reliée à l'accueil admin et à la navigation admin, avec un réexport de `dashboard/admin/demo-requests`. L'accès reste réservé à l'opérateur côté API (`requireSokarOperator`). Test `admin/page.test.tsx` : rouge sans le lien, vert avec. Restent à vérifier en staging : visibilité, notification et traitement, qui exigent une session opérateur et des destinataires.

**VOICE-01.** La fiche `docs/audits/2026-10-13-commercial-demo-validation.md` distingue deux niveaux : la validation du provisioning (routage, webhook, renvoi, appel de test validé) et la qualification conversationnelle. Elle impose un premier appel de réservation exact dans le dashboard avant les sept scénarios. Statut : non exécutée. Le restaurant de test, le numéro de test et la personne disponible n'ont pas été renseignés.

**LAND-01 : contenu et structure (non publié).**

- Route : `/solutions/assistant-telephonique-restaurant`, créée à la publication seulement. Titre, description et canonical via `pageMetadata`. Sitemap et maillage depuis l'accueil et les offres seulement à la publication.
- Cible : restaurateurs indépendants qui ne peuvent pas décrocher pendant le service.
- Structure, dans l'ordre :
  1. H1 : « Un assistant téléphonique pour votre restaurant ».
  2. Problème : les appels pendant le service et les réservations qui ne sont pas prises. Aucun chiffre sans source.
  3. Fonctionnement : le renvoi transfère l'appel, l'assistant répond, propose un créneau et confirme la réservation.
  4. Démonstration : emplacement réservé à la preuve vocale (audio contrôlé par le visiteur, transcription accessible). Vide tant que VOICE-01 n'est pas qualifiée.
  5. Résultat métier : vide avant preuve. Aucun gain chiffré.
  6. Configuration et secours : numéro dédié inclus, renvoi, prise de relais humaine. Les limites réelles seront écrites d'après les scénarios 3, 4 et 5.
  7. Limites : ce que l'assistant ne fait pas, établi par les essais.
  8. Installation : numéro, renvoi, appel de test, les mêmes étapes que l'onboarding.
  9. Prix : Essential, 199 € HT/mois, ou 159,20 € HT/mois en facturation annuelle (1 910,40 € HT/an, engagement de 12 mois). Montants issus de `PLAN_PRICES_EUR`.
  10. Questions pratiques : quatre ou cinq questions couvertes par des faits (que se passe-t-il si l'assistant ne sait pas répondre, peut-on reprendre la main, le numéro change-t-il, quelles données sont enregistrées — lien vers la confidentialité).
  11. Appel à l'action : « Demander une démonstration », vers `/demo`.
- Conversion : demandes de démo (DEMO-01), source et version de page traçables sans donnée personnelle (METRIC-01).
- Recette à la publication : HTML statique, statut 200, title et H1, canonical, sitemap, responsive, transcription disponible.
- Conditions de publication, toutes requises :
  1. Niveau 1 et niveau 2 de VOICE-01 validés, preuves archivées.
  2. Demande de démo traitable de bout en bout : enregistrée, visible, notifiée, traitée.
  3. Responsable désigné et délai de réponse décidé (aucun délai affiché pour l'instant).
  4. Affirmations restantes validées (section ci-dessus).

Search Console n'est pas une condition.

**Dépendances restantes**

| Débloque                               | Entrée attendue                                                                                                    | Responsable               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Notifications, staging puis production | Adresse de test autorisée et adresse commerciale : non fournies (gabarits)                                         | Hamza                     |
| Visibilité et traitement en staging    | Session opérateur sur staging : à organiser                                                                        | Hamza                     |
| DEMO-02                                | Responsable des demandes : non fourni (gabarit). Délai affiché : aucun, décision enregistrée                       | Hamza                     |
| VOICE-01, niveau 1                     | Restaurant de test (référence non fournie), numéro de test et personne disponible (non fournis), session opérateur | Hamza ou équipe technique |
| VOICE-01, niveau 2                     | Premier appel de réservation exact, puis sept scénarios                                                            | Hamza ou équipe technique |
| Affirmations restantes                 | Validation de l'hébergement, du ton, du rapport quotidien                                                          | Hamza                     |
| LAND-01                                | Conditions de publication ci-dessus                                                                                | Hamza, puis livraison     |

### 10.13 Notifications, téléphonie staging et landing : diagnostic et préparation (13/10/2026)

**Notifications des démos.** Destinataire : `hamza@sokar.tech`. Responsable du suivi : Hamza. Délai affiché : aucun. Le secret `DEMO_REQUEST_NOTIFY_TO` existe au niveau dépôt, lu par staging, et dans l'environnement `production`, lu par la production. Le prochain déploiement l'écrit dans les `.env` via `sync-demo-request-config.sh` : la trace d'exécution reste à consigner.

**Diagnostic des fournisseurs.** `GET /health` :

- staging : `status: degraded`. `telnyx` en erreur, « TELNYX_API_KEY not configured ». `db`, `redis`, `queues` et `cartesia` sont `ok` ;
- production : `status: ok`, `telnyx: ok` (462 ms).

Le runbook staging prévoit `VOICE_DISABLED=true`, `RESEND_API_KEY` vide, et aucun appel réel sans configuration Telnyx complète. Dans le code, sans `RESEND_API_KEY`, l'envoi lève « RESEND_API_KEY is not set » : **une notification de démo ne peut pas partir de staging en l'état**.

**Restaurant de test.** La fiche `chez-sokar-demo` existe sur staging, publiée sous le nom « Chez Sokar ». Son numéro affiché est le numéro public de démonstration : il n'est pas opérationnel et ne sert pas aux essais.

**Affectation Telnyx.** Non vérifiable depuis ce poste : la clé Telnyx du `.env` de développement est vide. Le contrôle en lecture seule revient à Hamza (section « Ce qui bloque »).

**Préparation livrée.**

- Script `scripts/ops/sync-staging-provider-config.sh`. Il lit les secrets `*_STAGING` du seul workflow de staging. Sans secret, il ne modifie rien.
- Tests manuels sur un `.env` factice : remplacement sans doublon, clé vide sans effet, antislash conservé, commentaire intact, aucune valeur affichée, valeur contenant un espace refusée, fichier absent refusé. Tous passent.
- Le workflow de production ne lit aucun secret `_STAGING`. YAML de staging valide.
- Runbook : section « Fournisseurs de staging » de `docs/runbooks/environment.md`.
- Premier appel guidé : script rédigé dans la fiche VOICE-01, section 4. Le numéro, le restaurant et les conditions de staging restent à fournir.
- Landing : brouillon `/solutions/assistant-telephonique-restaurant`, noindex, hors sitemap et hors navigation, cinq tests verts, typecheck sans erreur. Publication soumise aux conditions de la section 10.12, inchangées.

**Ce qui bloque, par ordre.**

1. Clés de staging, à fournir sans les coller dans le chat ni dans le dépôt, avec `pbpaste | gh secret set NOM --repo Sshindraa/Sokar` après les avoir copiées dans le presse-papiers :
   - `RESEND_API_KEY_STAGING` : clé Resend dédiée à staging. Confirmer la liste des destinataires autorisés, exigée par le runbook ;
   - `TELNYX_API_KEY_STAGING`, `TELNYX_PUBLIC_KEY_STAGING`, `TELNYX_FROM_NUMBER_STAGING` (secrets) et `TELNYX_CONNECTION_ID_STAGING` (variable) : compte Telnyx, application d'appel dédiée à staging avec webhook `https://api-staging.sokar.tech/voice/telnyx`, numéro non affecté à la production.
2. Décision de Hamza : `VOICE_DISABLED=false` en staging, réglage critique à signaler dans la PR concernée.
3. Clés voix de staging à vérifier avec l'équipe : `ELEVENLABS_API_KEY` (transcription), et un LLM (`CEREBRAS_API_KEY` ou `OPENROUTER_API_KEY`).
4. Session opérateur sur staging dans le navigateur intégré, pour la visibilité, la notification et le traitement.

**Ce qui est vérifié, et ce qui ne l'est pas.**

- Enregistrement d'une démo sur staging : vérifié (201, section 10.2).
- Notification en staging : bloquée, la clé d'envoi manque.
- Notification en production : le chemin est configuré, non testé. Un essai créerait une demande réelle en production : à faire seulement avec votre accord.
- Visibilité et traitement : bloqués, la session opérateur manque.
- Voix : aucun appel passé, aucune clé écrite dans le dépôt ni dans le chat.

### 10.14 Preuves après déploiement de #420 et synchronisation des destinataires (13/10/2026, après 19:55 UTC)

- **Déploiements** : #420 fusionnée à 19:44:46 UTC (squash `f6302538`). Deploy Staging (run 38458094330) à 19:50:54 et Deploy Production (run 38458617445) à 19:54:50 : succès.
- **Destinataires des démos** : le script a écrit « Destinataires des demandes de démonstration synchronisés » en staging (19:51:09) et en production (19:54:59). La valeur n'apparaît dans aucun journal.
- **Pages publiques en production** : `/register` et `/login` ne contiennent plus le témoignage, « 98.4 % », « Taux de réponse garanti » ni « Appels traités ce mois » (zéro occurrence chacun). Le libellé « Exemple illustratif — données simulées » est présent.
- **Landing brouillon** : `/solutions/assistant-telephonique-restaurant` répond 404 en production et n'apparaît pas dans le sitemap. Elle est sur la branche `codex/landing-draft-2026-10-13`, en PR brouillon (#422).
- **E-mail en staging** : non vérifié. `RESEND_API_KEY` n'est pas configurée en staging, donc l'envoi est désactivé ; le test de bout en bout attend la clé.
- **Session opérateur** : toujours absente. `https://staging.sokar.tech/dashboard/admin/demo-requests` redirige vers `/dashboard`.
- **Téléphonie staging** : `telnyx` reste en erreur. Les secrets `*_STAGING` restent à fournir ; leur synchronisation est dans cette PR (#423).

### 10.15 Correction de la configuration staging et appels sortants (13/10/2026)

**Corrections** (la PR #423 contenait des erreurs de nommage et de périmètre) :

- `TELNYX_APP_ID` retiré : aucun consommateur dans l'API. Le rattachement d'un numéro lit `TELNYX_CONNECTION_ID` (`admin/provisioning.service`, assign-phone).
- `TELNYX_WEBHOOK_SECRET` retiré : aucun consommateur. La signature des webhooks est vérifiée avec `TELNYX_PUBLIC_KEY` (`voice/telnyx.guard`).
- `TELNYX_CONNECTION_ID` ajouté (variable `TELNYX_CONNECTION_ID_STAGING`) ; `EMAIL_FROM` ajouté (variable `EMAIL_FROM_STAGING`). Sans `EMAIL_FROM`, le code envoie depuis `noreply@sokar.fr`.
- Script, workflow de staging, runbook et exemples `.env` alignés. Le workflow de production ne lit aucun réglage `_STAGING`. Treize vérifications du script passent, sur des valeurs factices.

**Appels sortants : vérifiés, non opérationnels.** Trois défauts de code, non corrigés ici car ils touchent au pipeline vocal :

1. Les deux appelants (`provisioning.service`, `restaurant.routes`) ne transmettent pas `connectionId` : `connection_id` part vide.
2. Le webhook transmis est `${PUBLIC_API_URL}/voice/stream`, route WebSocket du flux média, et non un webhook HTTP. La cible serait `${PUBLIC_API_URL}/voice/telnyx`, mais le pipeline ne traite pas encore l'état `onboarding_test_call`.
3. `PUBLIC_API_URL` n'a pas de valeur par défaut en staging. Le test d'appel du provisioning retombe alors sur `https://api.sokar.tech`, c'est-à-dire la production ; la route restaurant utilise l'hôte de la requête.

Impact : le test d'appel et `validate-test-call` (niveau 1 de VOICE-01) sont bloqués. L'appel de réservation entrant, par `/voice/telnyx`, ne l'est pas.

**Liste consolidée des éléments manquants**

| Élément                                          | Destination                                                                   | Utilité                                           | Statut                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `RESEND_API_KEY`                                 | secret `RESEND_API_KEY_STAGING`                                               | Envoi des notifications de démo                   | Manquant (clé dédiée à staging)                              |
| `EMAIL_FROM`                                     | variable `EMAIL_FROM_STAGING`, valeur `noreply@sokar.tech` (corrigé en 10.16) | Expéditeur                                        | Renseigné : expéditeur déjà vérifié et utilisé en production |
| `TELNYX_API_KEY`                                 | secret `TELNYX_API_KEY_STAGING`                                               | Toute opération Telnyx                            | Manquant (clé dédiée)                                        |
| `TELNYX_PUBLIC_KEY`                              | secret `TELNYX_PUBLIC_KEY_STAGING`                                            | Acceptation des webhooks                          | Manquant                                                     |
| `TELNYX_CONNECTION_ID`                           | variable `TELNYX_CONNECTION_ID_STAGING`                                       | Rattachement du numéro à l'application de staging | Manquant (identifiant de l'application)                      |
| `TELNYX_FROM_NUMBER`                             | secret `TELNYX_FROM_NUMBER_STAGING`                                           | Numéro émetteur, appels sortants et SMS           | Manquant (numéro E.164 de staging)                           |
| `PUBLIC_API_URL`                                 | `.env` de staging                                                             | Cible des webhooks sortants                       | À confirmer : `https://api-staging.sokar.tech`               |
| `ELEVENLABS_API_KEY`                             | `.env` de staging                                                             | Transcription                                     | À confirmer                                                  |
| LLM : `CEREBRAS_API_KEY` ou `OPENROUTER_API_KEY` | `.env` de staging                                                             | Dialogue                                          | À confirmer                                                  |
| Session opérateur staging                        | navigateur intégré                                                            | Visibilité, notification, traitement              | Manquante                                                    |
| `VOICE_DISABLED=false`                           | `.env` de staging                                                             | Activation de la voix                             | Décision de Hamza                                            |

### 10.16 Test d'appel sortant, e-mail de staging, abonnements et landing : résultats vérifiés (13/10/2026)

**Résultats vérifiés**

- **Appel de test sortant** (code, commit `602136a9`). `connection_id` est repris de `TELNYX_CONNECTION_ID`, sinon refus explicite. Le webhook est `${PUBLIC_API_URL}/voice/telnyx`. Au décroché (`call.answered`), le message est lu ; à la fin de la lecture (`call.speak.ended`), l'appel est raccroché. Ces événements sont traités avant la résolution du restaurant par le numéro appelé. Tests : paramètres d'appel (5), état et actions (6), routage du pipeline (2), URL de webhook dans le test de route (1). Pipeline : 29 tests verts. Typage de l'API : sans erreur.
- **Contrats existants.** La signature de `placeOutboundCall` et les réponses des routes sont inchangées. Une seule assertion a été modifiée : l'URL de webhook du test de route, `/voice/stream` devenant `/voice/telnyx`. Elle figeait le défaut.
- **E-mail de staging.** Expéditeur retenu : `noreply@sokar.tech`, déjà vérifié et utilisé en production (journal du 26/08 : clé d'envoi restreinte, envoi test accepté). Restriction `EMAIL_TEST_ALLOWLIST` : 3 tests verts. Variables de dépôt créées : `EMAIL_FROM_STAGING=noreply@sokar.tech`, `EMAIL_TEST_ALLOWLIST_STAGING=hamza@sokar.tech`, `PUBLIC_API_URL_STAGING=https://api-staging.sokar.tech`.
- **Synchroniseur.** Treize vérifications et dix vérifications complémentaires passent, sur des valeurs factices.
- **Abonnements** (`scripts/ops/verify-stripe-catalog.mjs`, lecture seule, clé de test, prix de staging) : 8 lignes sur 8 conformes, 0 échec. Essential 199 € par mois, 1 910,40 € par an ; Pro 299 € ; Multi-site 249 € ; site supplémentaire 99 €.
- **Landing** (`/solutions/assistant-telephonique-restaurant`, worktree, port 3107). Rendu correct : titre, H1, `noindex, nofollow`, canonical, liens vers `/demo` et `/pricing`, emplacement de preuve. Console sans erreur. À 375 px : pas de défilement horizontal, contrôle visuel du haut et du bas de page. Aucun défaut relevé, aucune modification de la branche.

**Constats non corrigés**

- L'appel de test sortant n'a pas été joué sur le réseau : aucune clé Telnyx n'est disponible depuis ce poste. Le résultat réel dépend d'un appel de test par une personne.
- Le repli de `EMAIL_FROM` dans le code reste `noreply@sokar.fr`, obsolète : la production utilise `noreply@sokar.tech`. Non modifié, hors périmètre.

**Dépendances réelles, par bloc**

| Bloc                      | Éléments manquants                                                                                                                                                                                   | Où les fournir                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| E-mail                    | `RESEND_API_KEY`, clé d'envoi restreinte pour staging                                                                                                                                                | secret `RESEND_API_KEY_STAGING`                      |
| Voix entrante             | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_CONNECTION_ID` de l'application de staging, numéro de test rattaché ; clés `ELEVENLABS_API_KEY` et LLM à confirmer ; `VOICE_DISABLED=false`, décision | secrets et variables `_STAGING` ; `.env` de staging  |
| Appel de test sortant     | `TELNYX_FROM_NUMBER` (numéro E.164 de staging) ; profil vocal sortant de l'application à confirmer                                                                                                   | secret `TELNYX_FROM_NUMBER_STAGING` ; portail Telnyx |
| Démo                      | session opérateur sur staging dans le navigateur intégré                                                                                                                                             | navigateur intégré                                   |
| Abonnements en production | clé Stripe de lecture, mode live, non fournie                                                                                                                                                        | non fournie                                          |

### 10.17 Notifications de démo et abonnements : résultats vérifiés (13/10/2026)

**Notifications de démo.** `notifyDemoRequest` tente chaque destinataire, même après un échec, et ne retourne `true` que si chaque envoi a le résultat `success`. Un refus (liste de destinataires de test), un échec, un résultat inconnu ou une exception ne renseigne jamais `notifiedAt` : la demande reste enregistrée et visible comme non notifiée. Tests : quatre cas au niveau du service (accepté, bloqué sans appel à Resend, échec d'un destinataire parmi deux, exception sans interruption) et un cas au niveau de la route. Un test existant renvoyait un retour vide et attendait `notifiedAt` : il renvoie désormais un résultat `success` explicite.

**Abonnements.**

- Un catalogue unique (`apps/dashboard/src/app/pricing-catalog.ts`) : chaque fonctionnalité porte un statut, « disponible » ou « prévu », et la formule qui l'introduit. Les cartes et le tableau comparatif en dérivent.
- Prix annuels exacts, sans arrondi : Essential 159,20 € HT par mois (1 910,40 € HT par an), Pro 239,20 € (2 870,40 €), Multi-site 199,20 € (2 390,40 €), site supplémentaire 79,20 € (950,40 €). Les anciens tests figeaient l'arrondi (159, 239, 199 et +79) : ils sont mis à jour pour les montants exacts.
- Tableau comparatif sur `/pricing` : 12 fonctionnalités, 3 formules. Vérifié dans le navigateur : 20 cellules « Disponible », 7 « Prévu », 9 « Non inclus ».
- Contrôle préalable du catalogue Stripe de staging, en lecture seule avec une clé de test : 8 lignes sur 8 conformes. Ce contrôle n'est pas le livrable du chantier.

**Vérifié dans le navigateur** (worktree, port 3107) : `/pricing` sans erreur de console. À 375 px, la page ne déborde pas ; le tableau défile dans son conteneur.

**À valider avant publication.** Le statut « disponible » de la synchronisation Google Agenda, de la facturation groupée Multi-site et du suivi des no-shows repose sur le code et la FAQ : à confirmer par le produit. Sont marqués « prévu » : le ton adapté, la réservation depuis ChatGPT et Claude, la synchronisation ZenChef, TheFork et Lightspeed.

### 10.18 Fusion avec le copilote de service de #428 (14/10/2026)

Le décompte de la section 10.17 concerne le catalogue d'avant cette fusion. Le catalogue fusionné compte 21 fonctionnalités ; le tableau comparatif affiche 39 cellules « Disponible », 7 « Prévu » et 17 « Non inclus » (décompte calculé depuis `pricing-catalog.ts`).

**Ce que la page affiche.** Pro vend le copilote de service : suggestions pour les retards, estimation des tables bientôt disponibles avec indication de fiabilité, rapprochements avec les clients en attente, analyse d'une réorganisation et plan validé par l'équipe, historique des plans et retour arrière sous conditions. Essential garde planning, placement manuel, disponibilités, liste d'attente et pouls ; il n'inclut aucune fonction avancée du copilote, ce que teste un garde-fou. Pro et Multi-site proposent « Découvrir » (démonstration) avant l'inscription. Les textes publics sont ceux de `main` ; le catalogue fournit les statuts et le tableau.

**Statuts à valider par le produit.**

- Copilote « disponible » en Pro et Multi-site : l'accès est porté par la capacité de formule, et #428 présente ces fonctions comme incluses. Le pilote terrain reste ouvert ; aucun résultat en conditions de service n'est annoncé.
- Rapport quotidien de vos appels « disponible » en Essential, ajouté au-delà du texte de `main`.
- Les statuts « disponible » de la section 10.17 (Google Agenda, facturation groupée Multi-site, suivi des absences en Essential) restent à confirmer.

**Vérifié avant publication.** Typage et Prettier OK ; 620 tests du dashboard verts ; captures `/pricing` régénérées, 3/3 verts après régénération. Dans le navigateur (port 3107) : « Découvrir Pro » pointe vers `/demo?plan=pro&billing=annual`, aucun « Choisir Pro » n'apparaît, le copilote figure dans la carte Pro, console sans erreur.

### 10.19 Fusion avec la tarification de #429 (14/10/2026)

La décision de `main` remplace les montants de la section 10.17 : remise annuelle de 10 % (et non 20 %), base Multi-site de 299 € HT/mois, établissement supplémentaire inchangé à 99 € HT/mois. Les montants de la section 10.17 (20 %, 249 €, centimes sur les mensualités) ne sont plus valables.

- Source unique : le calcul local de la branche est retiré. `@sokar/shared` fournit le catalogue, les montants exacts et l'arrondi d'affichage.
- Affichage public : mensualités arrondies à l'euro (annuel : 179 € Essential, 269 € Pro et Multi-site de base, 89 € par établissement supplémentaire). La carte n'affiche plus de total annuel : « Facturé annuellement ». Le montant exact est indiqué avant paiement.
- Montants exacts (inscription et Stripe) : 2 149,20 € HT par an pour Essential ; 3 229,20 € pour Pro et Multi-site de base ; Multi-site à 2 établissements 4 298,40 € HT par an, à 3 établissements 5 367,60 € HT par an.
- Statuts et tableau comparatif : inchangés.

**Vérifié.** Typage du dashboard et de l'API (après reconstruction de `@sokar/shared`), Prettier ; dashboard 83 fichiers et 621 tests verts ; paquet partagé 71 tests verts ; captures `/pricing` régénérées, 3/3 verts. Dans le navigateur (port 3107) : 179, 269 et 358 € s'affichent, « Découvrir Pro » et « Découvrir Multi-site » sont présents, console sans erreur.
