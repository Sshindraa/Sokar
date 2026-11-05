# Marketing : repérer, cibler, mesurer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montrer au gérant les services qui resteront probablement vides, dimensionner l'audience par paliers sous le budget, et capturer une mesure honnête, sans jamais envoyer sans sa validation.

**Architecture:** Deux fichiers purs ou presque (`fill-forecast.ts`, `fill-targeting.ts`) portent les calculs. `planServiceFill` est découpé en chargement unique (`loadServiceFillContext`) et sélection par service (`planFromContext`), que réutilise `fill-suggestions.service.ts`. `EmptySlotsWidget` affiche la liste ; le rapport existant reçoit des champs additifs.

**Tech Stack:** Fastify 5, Prisma 6, ioredis (`redisCache`), Zod, Vitest ; Next.js 16, next-intl, Shadcn UI.

**Spec:** `docs/superpowers/specs/2026-11-02-marketing-intelligent-design.md`

## Global Constraints

- Aucune modification de schéma. Aucun champ de réponse existant ne change : tout ajout est additif.
- Aucun `k`, aucune mesure ne modifie l'audience ou le classement. Aucune fourchette ni aucun chiffre de couverts gagnés affiché.
- Consentement, opposition et fréquence restent dans `buildAudience`. Pas de réglage par restaurant.
- Aucun nom, téléphone ni e-mail dans les réponses, les journaux, le cache Redis.
- Routes `requireMarketingCampaigns` (direction seule).
- Libellés fr, en, es, it dans `fillService` ; `vous` partout. Dashboard : tokens Tailwind, `cn()`, `transition-all duration-200`, états chargement, vide, erreur et données.
- Valeurs posées à la main avec un commentaire `shortcut:` : seuils de suggestion, probabilités des paliers, prévision médiane.
- Prettier : `semi`, `singleQuote`, `trailingComma=all`, `printWidth=100`. Tests itératifs : `pnpm --filter @suppernote/api test -- <chemin> 2>&1 | tail -n 40`.

## Review Focus

- « Préparer » ouvert depuis une suggestion : la page affiche le même canal que le calcul (e-mail), alors que son défaut est SMS. Test : Task 6.
- Prévision à 0 place vide, ou budget nul, sur la page de remplissage : message clair, pas une audience muette à 0. Test : Task 5.
- Calcul de prévision traversant un changement d'heure (25 octobre 2026) : les fenêtres passées restent justes. Test : Task 1.
- Service du jour déjà commencé ou passé : jamais suggéré, y compris le midi dont la fenêtre débute à minuit. Test : Task 2.
- Petit échantillon : 3 réservants sur 10 contre 0 sur 5 ne doit jamais s'afficher comme une preuve d'effet. Test : Task 8.

---

### Task 1: Prévision des places vides

**Files:**

- Create: `apps/api/src/modules/marketing/fill-forecast.ts`
- Test: `apps/api/src/modules/marketing/__tests__/fill-forecast.test.ts`

**Interfaces:**

- Consumes: `addDays` de `../companion/query-data`, `COUNTED_RESERVATION_STATES`.
- Produces:
  - `serviceWindow` et `dayBounds`, déplacés depuis `fill-service.service.ts` pour éviter un import circulaire ; `fill-service.service.ts` réexporte `serviceWindow`.
  - `type ForecastSource = 'historique' | 'simple'`
  - `type ForecastRow = { reservedAt: Date; createdAt: Date; partySize: number }`
  - `loadForecastHistory(restaurantId: string, now: Date): Promise<ForecastRow[]>`
  - `forecastEmptyPlaces(args: { rows: ForecastRow[]; date: string; service: TonightService; freePlaces: number; now: Date }): { emptyPlaces: number; lateArrivals: number; forecastSource: ForecastSource }`

- [ ] **Step 0: Créer la branche**

La PR #625 est fusionnée : `feat/companion-v1` ne doit plus recevoir de travail. Dans le checkout principal, sans worktree :

```bash
git fetch origin main
git switch -c feat/marketing-creux-ciblage-mesure origin/main
```

Expected : changement de branche sans conflit, modifications locales non commitées conservées (`AGENTS.md`, `README.md`, `docs/PROJECT_MAP.md`, `docs/obsidian/*`). Ne jamais les indexer sauf indication de la Task 9. Si git refuse le changement de branche, s'arrêter et le signaler, sans remiser ni écraser ces fichiers.

- [ ] **Step 1: Écrire les tests qui échouent**

`forecastEmptyPlaces`, avec `now = 2026-11-02T10:00:00Z`, `date = '2026-11-04'`, `service = 'soir'`. Un helper construit des lignes pour les mercredis soir passés :

- `médiane de 4 services [2, 4, 6, 8] arrivées tardives → lateArrivals 5, source historique`, avec `freePlaces: 20` → `emptyPlaces: 15`.
- `3 services comparables seulement → lateArrivals 0, source simple, emptyPlaces = freePlaces`.
- `ne garde que les 8 services les plus récents`.
- `ignore une réservation créée avant le seuil` : même délai avant le service que `début visé − now`.
- `ignore un autre jour de semaine et l'autre service`.
- `une semaine sans réservation ne compte pas comme comparable`.
- `jamais négatif` : `freePlaces: 3`, médiane 10 → `emptyPlaces: 0`.
- `fenêtres justes à travers le changement d'heure` : un service du 21 octobre (UTC+2) à 18 h Paris (`16:00Z`) compte dans la fenêtre soir.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-forecast.test.ts 2>&1 | tail -n 40`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

Constantes : `FORECAST_LOOKBACK_WEEKS = 12`, `FORECAST_MAX_SERVICES = 8`, `FORECAST_MIN_SERVICES = 4`.

`loadForecastHistory` : `reservation.findMany` avec `isTest: false`, `state in COUNTED_RESERVATION_STATES`, `reservedAt` dans `[now − 84 j, now[`, select `reservedAt, createdAt, partySize`.

`forecastEmptyPlaces` : pour `k = 1..12`, fenêtre `serviceWindow(addDays(date, -7k), service)` ; seuil de création = `début passé − (début visé − now)` ; une semaine compte si elle a au moins une réservation ; arrivées = somme des `partySize` créés à partir du seuil. On garde les 8 premières semaines comparables, médiane arrondie (`Math.round`). Moins de 4 : 0 et `simple`. Mettre le commentaire `shortcut:` de la spec.

- [ ] **Step 4: Vérifier le succès**

Même commande. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing/fill-forecast.ts apps/api/src/modules/marketing/fill-service.service.ts apps/api/src/modules/marketing/__tests__/fill-forecast.test.ts
git commit -m "feat(marketing): prévoit les places qui resteront vides"
```

### Task 2: Liste des suggestions et « Ignorer »

**Files:**

- Create: `apps/api/src/modules/marketing/fill-suggestions.service.ts`
- Modify: `apps/api/src/modules/marketing/fill-service.service.ts` (`serviceAvailability`)
- Modify: `apps/api/src/modules/marketing/marketing.routes.ts`
- Test: `apps/api/src/modules/marketing/__tests__/fill-suggestions.service.test.ts`, `__tests__/marketing.routes.test.ts`

**Interfaces:**

- Consumes: Task 1 ; `serviceCapacity`, `serviceWindow` ; `redisCache` de `shared/redis/client`.
- Produces:
  - `serviceAvailability` renvoie en plus `firstSlotAt: Date | null`.
  - `type FillSuggestion = { date: string; service: TonightService; capacity: number; freePlaces: number; emptyPlaces: number; forecastSource: ForecastSource }`
  - `listFillSuggestions(args: { restaurantId: string; now?: Date }): Promise<FillSuggestion[]>`
  - `dismissFillSuggestion(args: { restaurantId: string; date: string; service: TonightService }): Promise<void>` (lève si Redis échoue)
  - `invalidateFillSuggestions(restaurantId: string): Promise<void>` (n'échoue jamais)
  - `GET /marketing/fill-suggestions` → `{ data: FillSuggestion[] }` ; `POST /marketing/fill-suggestions/dismiss` body `{ date, service }` → 204, ou 503 `{ error: 'DISMISS_UNAVAILABLE' }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Service, base de données, moteur de disponibilité et Redis mockés. Noms et assertions :

- `exclut service fermé, plein, capacité inconnue`.
- `exclut un service ayant une campagne prévue, pas une campagne annulée` : `marketingCampaign.findMany` filtré sur `status notIn ['CANCELLED','FAILED']`.
- `seuil : retient 9 places vides sur 20 couverts, écarte 7` puis `capacité 100 : écarte 29, retient 30`.
- `service du jour : écarte un premier créneau à moins de 2 h ou passé, retient à plus de 2 h`, dont un midi à 19 h.
- `horizon : aujourd'hui et les 6 jours suivants, 14 services évalués au plus`.
- `classement : places vides décroissantes, puis date la plus proche ; 3 au maximum`.
- `écarte un service ignoré`.
- `sert le cache sans recalcul ; le cache contient seulement des champs de FillSuggestion`.
- `Redis en panne à la lecture et à l'écriture : la liste est calculée quand même`.
- `dismiss : clé marketing:fill-dismissed:{restaurant}:{date}:{service}, EX 604800, et supprime le cache`.

Routes :

- `GET et POST refusés sans la capability, 403`.
- `POST dismiss : service invalide → 400` ; `Redis en panne → 503 DISMISS_UNAVAILABLE`.
- `POST /marketing/fill-service réussi appelle invalidateFillSuggestions`.
- `la réponse GET ne contient ni nom ni téléphone`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-suggestions.service.test.ts src/modules/marketing/__tests__/marketing.routes.test.ts 2>&1 | tail -n 40`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Constantes : `SUGGESTION_HORIZON_DAYS = 7`, `SUGGESTION_LIMIT = 3`, `MIN_EMPTY_PLACES = 8`, `MIN_EMPTY_RATIO = 0.3`, `MIN_LEAD_MS = 2 h`, `CACHE_TTL_SECONDS = 1800`, `DISMISS_TTL_SECONDS = 604800` ; commentaire `shortcut:` de la spec sur les seuils. Clé de cache : `marketing:fill-suggestions:{restaurantId}`.

Lectures et écritures de cache dans un `try/catch` avec `log.warn` sans donnée personnelle. `firstSlotAt` = premier créneau de `inService`, ajout sans effet sur `open` et `bookable`. Routes placées après `/marketing/fill-service`, `FillServiceSchema.pick({ date: true, service: true })` pour `dismiss`.

- [ ] **Step 4: Vérifier le succès**

Même commande. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing
git commit -m "feat(marketing): liste les services creux et permet de les ignorer"
```

### Task 3: Afficher les suggestions dans le widget

**Files:**

- Modify: `apps/dashboard/src/app/dashboard/EmptySlotsWidget.tsx`
- Modify: `apps/dashboard/src/app/dashboard/page.tsx:373-386`
- Modify: `apps/dashboard/messages/{fr,en,es,it}.json`
- Test: `apps/dashboard/src/app/dashboard/__tests__/EmptySlotsWidget.test.tsx`

**Interfaces:**

- Consumes: routes de la Task 2.
- Produces: clés `fillService.suggestions.{title, subtitle, empty, emptyPlaces, sourceSimple, prepare, dismiss, dismissError, midi, soir}`.

- [ ] **Step 1: Écrire les tests qui échouent**

Le mock `get` répond selon l'URL. Les tests existants restent valables quand `marketing/fill-suggestions` rejette avec 403 : ajouter ce rejet par défaut.

- `suggestions : affiche service, places vides et lien Préparer vers ?date=2026-11-04&service=midi`.
- `liste vide : affiche « Aucun service creux à remplir pour le moment. »`.
- `route en 403 ou en panne : vue actuelle, avec ses 3 jours et ses libellés`.
- `les deux routes en panne : DataFetchError`.
- `suggestions OK et empty-slots en panne : affiche les suggestions, sans erreur`.
- `Ignorer : POST marketing/fill-suggestions/dismiss, la ligne disparaît`.
- `Ignorer en échec : la ligne reste et le message d'erreur s'affiche`.
- `source simple : mention « Estimation sans historique suffisant »`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/dashboard test -- src/app/dashboard/__tests__/EmptySlotsWidget.test.tsx 2>&1 | tail -n 40`.
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Le chargement passe à `Promise.allSettled` sur les deux routes. Toute erreur de `marketing/fill-suggestions` bascule sur la vue actuelle, sans capacité à vérifier côté client et sans `FeatureLockCard`. La vue actuelle n'est pas modifiée.

Dans `page.tsx`, sortir `<EmptySlotsWidget />` du `<details>`, toujours sous `!isDemo`. Le `summary` devient « Absences sur 90 jours ». Le texte fr exact des états figure dans les tests ; traduire en, es, it.

- [ ] **Step 4: Vérifier le succès**

Run: même commande, puis `pnpm --filter @suppernote/dashboard test -- src/app/dashboard/__tests__/DashboardJourneys.test.tsx 2>&1 | tail -n 40`
Expected: PASS.

- [ ] **Step 5: Vérifier dans le navigateur**

Avec `preview_start`, ouvrir `/dashboard` en iPad et mobile. Expected : widget visible sans ouvrir le `details`, aucune erreur console, boutons accessibles au clavier.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/dashboard apps/dashboard/messages
git commit -m "feat(dashboard): montre les services creux probables à la direction"
```

### Task 4: Paliers et sélection pure

**Files:**

- Create: `apps/api/src/modules/marketing/fill-targeting.ts`
- Test: `apps/api/src/modules/marketing/__tests__/fill-targeting.test.ts`

**Interfaces:**

- Produces:
  - `type FillTier = 'CRENEAU' | 'REGULIER' | 'CONNU' | 'SANS_VISITE'`
  - `TIER_PROBABILITY: Record<FillTier, number>` = `{ CRENEAU: 0.30, REGULIER: 0.15, CONNU: 0.08, SANS_VISITE: 0.03 }`
  - `MIN_PROBABILITY = 0.05`, `FILL_MODEL_VERSION = 'v1'`
  - `type VisitStats = { slotVisits: number; visits: number; lastSlotAt: number; lastAt: number }`
  - `tierOf(stats: VisitStats, now: Date): FillTier`
  - `selectFillAudience<T extends { tier: FillTier; stats: VisitStats }>(args: { candidates: T[]; emptyPlaces: number; groupSize: number; holdoutRate: number; maxSends: number }): T[]`
  - `countByTier(tiers: FillTier[]): Partial<Record<FillTier, number>>`

- [ ] **Step 1: Écrire les tests qui échouent**

- `CRENEAU : 2 visites sur le créneau, la dernière à 119 j ; à 120 j, non`.
- `REGULIER : 3 visites, la dernière à 179 j ; à 180 j → CONNU`.
- `un client venu 20 fois le vendredi est REGULIER pour un mercredi, pas SANS_VISITE`.
- `aucune visite → SANS_VISITE`.
- `écarte SANS_VISITE (0,03 < 0,05), même si l'objectif n'est pas atteint`.
- `tri : palier, puis visites sur le créneau, puis récence`.
- `s'arrête à l'objectif` : 3 places vides, groupe 2, témoin 0,3, CRENEAU → `3 / (0,3 × 2 × 0,7)` = 8 clients (7,14 arrondi au client supérieur par l'accumulation).
- `vivier insuffisant : renvoie tous les éligibles`.
- `plafond : maxSends 40, témoin 0,3 → 57 clients, envois = 57 − round(17,1) = 40`.
- `maxSends 0 ou emptyPlaces 0 → liste vide`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-targeting.test.ts 2>&1 | tail -n 40`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Accumuler `p × groupSize × (1 − holdoutRate)` jusqu'à `emptyPlaces`. Plafond : plus grand `n` tel que `n − Math.round(n × holdoutRate) ≤ maxSends`. Commentaire `shortcut:` sur les probabilités, et commentaire d'une ligne : probabilité de réserver après le message, pas l'effet propre.

- [ ] **Step 4: Vérifier le succès**

Même commande. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing/fill-targeting.ts apps/api/src/modules/marketing/__tests__/fill-targeting.test.ts
git commit -m "feat(marketing): classe les clients par paliers d'historique"
```

### Task 5: Brancher le ciblage dans le plan et l'aperçu

**Files:**

- Modify: `apps/api/src/modules/marketing/fill-service.service.ts`
- Modify: `apps/api/src/modules/marketing/marketing.routes.ts` (`FILL_SERVICE_CONFLICTS`)
- Modify: `apps/dashboard/src/app/dashboard/marketing/fill-service/page.tsx`
- Modify: `apps/dashboard/messages/{fr,en,es,it}.json`
- Test: `__tests__/fill-service.service.test.ts`, `__tests__/marketing.routes.test.ts`, `fill-service/page.test.tsx`

**Interfaces:**

- Consumes: Tasks 1 et 4 ; `remainingDailyEmailBudget(tx, now)`.
- Produces:
  - `loadServiceFillContext(args: { restaurantId: string; channel: CampaignChannelCode; through: string; now: Date }): Promise<ServiceFillContext>`, `through` étant la dernière date visée. Charge une fois : audience, taille de groupe, visites honorées, réservations actives du début de la journée de Paris jusqu'à `through + 8 j`, historique de prévision, budget restant (`null` hors e-mail).
  - `planFromContext(context: ServiceFillContext, args: { date: string; service: TonightService; seed?: number; now: Date }): Promise<ServiceFillPlan>`
  - `planServiceFill` garde sa signature et compose les deux.
  - `PLANNED` gagne : `emptyPlaces`, `lateArrivals`, `forecastSource`, `excludedNearby`, `tiers`, `budgetExhausted`. `targetSize` vaut désormais le nombre de clients retenus.
  - `previewServiceFill` gagne : `emptyPlaces`, `forecastSource`, `excludedNearby`, `tiers`, `budgetExhausted`.
  - `estimateFillCost(args: { restaurantName: string | null; channel: CampaignChannelCode; sends: number; now: Date })`, extrait de l'aperçu pour la Task 6.

- [ ] **Step 1: Écrire ou adapter les tests**

`fill-service.service.test.ts` : `mockFloor` renvoie `[]` quand `args.select.createdAt` est présent et fournit `reservedAt` sur `busy`. Ajouter `$transaction` au mock de `db` et mocker `remainingDailyEmailBudget`.

Remplacer `taille d'audience = ceil(...)` par :

- `audience : s'arrête aux places vides probables, pas aux places libres`.
- `vivier insuffisant : prend tous les éligibles`.
- `e-mail : plafonne les envois au budget restant ; SMS : pas de plafond budget`.
- `budget nul : aucun membre, budgetExhausted vrai ; le brouillon est refusé`.
- `exclut une réservation active à 6 jours du service, compte excludedNearby ; garde à 8 jours`.
- `un même client le jour même compte seulement dans excludedSameDay`.
- `ne contacte pas SANS_VISITE`.
- `aperçu : tiers en comptes, aucun identifiant de client ni nom`.

Adapter `classe par affinité` au tri par palier. Le test du témoin à 10 % ne change pas dans cette tâche.

Route : `budget nul → 409 FILL_SERVICE_BUDGET_EXHAUSTED`.

Page : `places vides probables et mention d'estimation affichées`, `composition lisible : « 9 habitués de ce créneau, 12 clients réguliers »`, `prévision à 0 : message dédié, sans formulaire`, `budget épuisé : message dédié, sans formulaire`, `mention dédiée quand forecastSource vaut simple`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-service.service.test.ts src/modules/marketing/__tests__/marketing.routes.test.ts 2>&1 | tail -n 40`
Expected: FAIL sur les nouveaux tests.

- [ ] **Step 3: Implémenter**

Retirer `TAUX_REPONSE`. Dans la requête d'affinité, ajouter `visits`, `lastSlotAt` à côté de `matches` et `last`. Le snapshot garde `affinity` et `holdoutSeed` ; `freePlaces` et `excludedSameDay` gardent leur sens.

« Autour du service » : `reservedAt` dans `[début − 7 j, fin + 7 j[`, à partir du début de la journée de Paris. Budget lu dans `db.$transaction((tx) => remainingDailyEmailBudget(tx, now))`. Ajouter `nearby` à `noCandidateReasons`, dans les 4 langues.

Les textes de composition sont produits à l'affichage, avec pluriels ICU ; `SANS_VISITE` n'y apparaît pas puisqu'il n'est jamais retenu.

- [ ] **Step 4: Vérifier le succès**

Run: même commande, puis `pnpm --filter @suppernote/dashboard test -- src/app/dashboard/marketing/fill-service/page.test.tsx 2>&1 | tail -n 40`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing apps/dashboard/src/app/dashboard/marketing/fill-service apps/dashboard/messages
git commit -m "feat(marketing): dimensionne l'audience selon les places vides et le budget"
```

### Task 6: Enrichir les suggestions

**Files:**

- Modify: `apps/api/src/modules/marketing/fill-suggestions.service.ts`
- Modify: `apps/dashboard/src/app/dashboard/EmptySlotsWidget.tsx`
- Modify: `apps/dashboard/src/app/dashboard/marketing/fill-service/page.tsx`
- Modify: `apps/dashboard/messages/{fr,en,es,it}.json`
- Test: `__tests__/fill-suggestions.service.test.ts`, `__tests__/EmptySlotsWidget.test.tsx`, `fill-service/page.test.tsx`

**Interfaces:**

- Consumes: `loadServiceFillContext`, `planFromContext`, `estimateFillCost` (Task 5).
- Produces: `FillSuggestion` gagne `sends: number`, `tiers: Partial<Record<FillTier, number>>`, `costEstimate`, `canPrepare: boolean`. Le score interne n'est jamais renvoyé.

- [ ] **Step 1: Écrire les tests qui échouent**

- `charge le contexte une seule fois pour tous les services`.
- `calcule sur le canal EMAIL`.
- `canPrepare faux si MARKETING_SENDS_ENABLED n'est pas 'true', ou budget nul, ou zéro envoi : le service reste listé`.
- `AUDIENCE_TOO_LARGE : services listés, canPrepare faux, sends 0, aucune erreur`.
- `classement : canPrepare d'abord, puis couverts attendus par envoi, puis date`.
- `la réponse ne contient ni score, ni customerId, ni membres`.

Widget : `sans canPrepare, pas de bouton Préparer, service affiché`, `avec canPrepare, lien vers ...&channel=EMAIL`, `n'additionne aucun gain`, `aucun chiffre de couverts gagnés`.

Page : `?channel=EMAIL ouvre l'aperçu en e-mail ; sans paramètre, reste en SMS`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-suggestions.service.test.ts 2>&1 | tail -n 40`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Score = `somme(p × groupe × 0,7) / envois` sur les contactés : utiliser la part contactée issue de `HOLDOUT_RATE`, pas une valeur en dur. Le plan garde les clients et le service les résume en comptes. `process.env.MARKETING_SENDS_ENABLED`, comme la route ligne 735. Attraper seulement `AUDIENCE_TOO_LARGE`, les autres erreurs remontent.

Page : `useState<Channel>(params?.get('channel') === 'EMAIL' ? 'EMAIL' : 'SMS')`.

- [ ] **Step 4: Vérifier le succès**

Run: même commande, puis `pnpm --filter @suppernote/dashboard test -- src/app/dashboard/__tests__/EmptySlotsWidget.test.tsx src/app/dashboard/marketing/fill-service/page.test.tsx 2>&1 | tail -n 40`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing apps/dashboard/src/app/dashboard apps/dashboard/messages
git commit -m "feat(marketing): chiffre les envois et le coût de chaque suggestion"
```

### Task 7: Témoin à 30 % et snapshot

**Files:**

- Modify: `apps/api/src/modules/marketing/fill-service.service.ts`
- Test: `__tests__/fill-service.service.test.ts`

**Interfaces:**

- Consumes: `FILL_MODEL_VERSION`, `tierOf`.
- Produces: `HOLDOUT_RATE = 0.3`. Chaque membre porte `snapshot.tier` et `snapshot.modelVersion`, que lit la Task 8.

- [ ] **Step 1: Adapter les tests**

- `témoin : 30 % de l'audience, sans message, et reproductible avec la même graine`.
- `snapshot : tier et modelVersion v1 ; aucune phrase ni probabilité stockée`.
- `la part contactée de l'arrêt à l'objectif vaut 70 %`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/fill-service.service.test.ts 2>&1 | tail -n 40`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Changer la constante et enrichir le snapshot. Passer `HOLDOUT_RATE` à `selectFillAudience`, sans autre valeur en dur.

- [ ] **Step 4: Vérifier le succès**

Même commande. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing
git commit -m "feat(marketing): renforce le témoin et enregistre le palier de chaque client"
```

### Task 8: Rapport de mesure

**Files:**

- Modify: `apps/api/src/modules/marketing/marketing-report.service.ts:117-135,303-370`
- Modify: `apps/dashboard/src/app/dashboard/marketing/ServiceFillReport.tsx`
- Modify: `apps/dashboard/messages/{fr,en,es,it}.json`
- Test: `__tests__/marketing-report.service.test.ts`, `apps/dashboard/src/app/dashboard/marketing/ServiceFillReport.test.tsx` (à créer s'il n'existe pas)

**Interfaces:**

- Consumes: `snapshot.tier` (Task 7).
- Produces, en plus de `ServiceFillReport` :
  - `treated.reservedCustomers`, `holdout.reservedCustomers`
  - `effect: { difference: number; margin95: number } | null`, en points de pourcentage arrondis à 0,1 ; `null` si un groupe est vide
  - `byTier: Partial<Record<FillTier, { treated: { customers: number; reservedCustomers: number }; holdout: { customers: number; reservedCustomers: number } }>>`
  - `netEffect30d: { treatedCoversPerCustomer: number; holdoutCoversPerCustomer: number; difference: number } | null`
  - `truncated: boolean`

- [ ] **Step 1: Écrire les tests qui échouent**

- `marge d'erreur, cas calculé à la main` : 18 réservants sur 180, 1 sur 20 → `{ difference: 5, margin95: 10.5 }`.
- `groupe vide → effect null`.
- `un client avec deux réservations compte une fois dans reservedCustomers`.
- `byTier : sépare destinataires et témoin ; un membre ancien sans tier n'y figure pas`.
- `netEffect30d null avant 30 jours, sans requête ; calculé après, tous services confondus`.
- `campagne avec lastErrorCode TARGET_SERVICE_FULL : truncated vrai, conclusive faux`.

Adapter le `toEqual` existant de `compare les couverts du service visé` aux nouveaux champs ; les anciens gardent leurs valeurs.

Composant :

- `affiche « entre −3 et +14 points »`.
- `« Pas encore de preuve d'effet » si la marge contient 0`.
- `3 réservants sur 10 contre 0 sur 5, non concluant : jamais de preuve d'effet, même si la marge exclut 0`.
- `campagne tronquée : message dédié`.
- `netEffect30d null : « Disponible 30 jours après l'envoi »`.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm --filter @suppernote/api test -- src/modules/marketing/__tests__/marketing-report.service.test.ts 2>&1 | tail -n 40`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Ajouter `snapshot` au select de l'audience et `lastErrorCode` à celui de la campagne. Marge : `1,96 × √(p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂)`.

Requête à 30 jours : mêmes clients et états que `serviceFillReport`, `createdAt ≥ startedAt`, `reservedAt` dans `[startedAt, startedAt + 30 j[`, seulement si cette échéance est passée. Un ensemble de réservants évite le double compte.

Les types du composant restent optionnels pour les anciennes réponses. La preuve d'effet demande `conclusive && !truncated && difference − margin95 > 0`.

- [ ] **Step 4: Vérifier le succès**

Run: même commande, puis `pnpm --filter @suppernote/dashboard test -- src/app/dashboard/marketing 2>&1 | tail -n 40`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/marketing apps/dashboard/src/app/dashboard/marketing apps/dashboard/messages
git commit -m "feat(marketing): mesure l'effet avec sa marge et l'effet net à 30 jours"
```

### Task 9: Vérification complète et livraison

**Files:**

- Modify: `docs/obsidian/Journal.md`, `docs/obsidian/Context.md`
- Add: la spec et ce plan

- [ ] **Step 1: Lancer la vérification complète**

```bash
pnpm test 2>&1 | tail -n 40
```

```bash
pnpm lint 2>&1 | tail -n 40
```

```bash
pnpm build 2>&1 | tail -n 40
```

Expected : tout vert, y compris `onboarding-tone.test.ts`.

- [ ] **Step 2: Mettre à jour le vault**

Ajouter à `Journal.md` une entrée datée : routes ajoutées, témoin à 30 %, widget sorti du `details`. Ajouter un seul TODO court à `Context.md` : envois marketing conditionnés à la réouverture de l'effacement et de l'opposition, et à la mention du ciblage dans la notice.

- [ ] **Step 3: Indexer seulement ce lot**

`Journal.md` contient 14 entrées du 30 octobre venues d'une autre branche : elles ne doivent pas partir. Vérifier avec `git diff docs/obsidian/Journal.md`, puis indexer seulement les entrées du lot avec un correctif filtré (`git diff` édité, puis `git apply --cached`). Ne pas indexer `AGENTS.md`, `README.md`, `docs/PROJECT_MAP.md` ni `docs/obsidian/README.md`.

```bash
git add docs/superpowers/specs/2026-11-02-marketing-intelligent-design.md docs/superpowers/plans/2026-11-02-marketing-creux-ciblage-mesure.md docs/obsidian/Context.md
git diff --cached --stat
```

Expected : seulement la spec, le plan, `Context.md` et les nouvelles lignes de `Journal.md`.

- [ ] **Step 4: Commit et PR**

```bash
git commit -m "docs(marketing): spec, plan et décisions du lot repérer, cibler, mesurer"
```

```bash
pnpm pr:submit
```

Expected : PR créée, sans fusion automatique. `MARKETING_SENDS_ENABLED` n'est pas modifié.
