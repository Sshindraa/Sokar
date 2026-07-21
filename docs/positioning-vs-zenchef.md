# Positionnement Sokar vs Zenchef / OpenTable

> Document de référence pour la roadmap produit. Basé sur l'état du codebase au 2026-07-03.

---

## 1. Positionnement actuel

Sokar n'est **pas** un clone de Zenchef ou d'OpenTable. Ceux-ci sont des **plateformes de réservation en ligne** : widget de résa, réseau de découverte, gestion de salle, marketing. Sokar est un **agent vocal IA 24/7 + plateforme de réservation agentic** (réservable via ChatGPT, Claude, etc. grâce au MCP).

Pitch implicite du code :

> "On remplace l'appel manqué et on vous rend indépendant des plateformes commissionnées."

**Sokar se positionne comme l'alternative à la perte d'appels + à la commission par couvert**, pas comme un concurrent feature-pour-feature de Zenchef Grow.

---

## 2. Tarification

| Plan           | Prix            | Alignement marché                                 |
| -------------- | --------------- | ------------------------------------------------- |
| **Essential**  | 149€/mois       | ~Zenchef Reserve (129€) +20€, mais inclut la voix |
| **Pro**        | 249€/mois       | = Zenchef Grow (249€), avec MCP/agentic + no-show |
| **Multi-site** | 249€ + 99€/site | Compétitif vs Zenchef Grow multi-site             |

Le levier marketing principal est le **0€ de commission par couvert**, calculé dans le ROI dashboard via `THEFORK_COMMISSION_PER_PAX = 3€`. <ref_file file="/Users/hamza/Projects/Sokar/packages/config/src/constants.ts" />

---

## 3. Ce qui différencie Sokar (réel, dans le code)

| Avantage                             | Preuve dans le code                                                |
| ------------------------------------ | ------------------------------------------------------------------ |
| Agent vocal IA 24/7                  | `modules/voice/` — Telnyx + Deepgram + Cartesia                    |
| Réservable par les IA du marché      | `modules/agentic-reservations/mcp/` — OAuth, rate-limit, redaction |
| OpenAI Reserve intégré               | `modules/agentic-reservations/openai-reserve/`                     |
| Reconnaissance client + VIP          | `modules/customers/` + seed "Chez Sokar" VIP                       |
| No-show anticipation + réactivation  | `dashboard/reactivation/`, `NoShowWidget`                          |
| ROI temps réel                       | `analytics/roi.service.ts`, `DashboardCharts`                      |
| Sokar Connect (réseau de découverte) | `apps/connect/` + `modules/connect/` — 38 tests, prod-ready        |
| 0€/couvert, abonnement pur           | `constants.ts`                                                     |

**Aucun concurrent n'a l'agent vocal + le MCP agentic**. C'est la différence défendable.

---

## 4. Gaps pour remplacer Zenchef Grow — audit corrigé

Méthode de vérification : pour chaque gap, on a contrôlé 5 niveaux : modèle Prisma, route API, composant dashboard, tests, branchement produit.

| #   | Gap                               | Prisma | API | Dashboard | Tests | Branchement | Nature du gap                                                           |
| --- | --------------------------------- | :----: | :-: | :-------: | :---: | :---------: | :---------------------------------------------------------------------- |
| 1   | **Widget embed**                  |   ⚠️   | ✅  |    ✅     |  ✅   |     ⚠️      | **Productisation** — le moteur existe, pas le snippet JS self-service   |
| 2   | **Floor plan / gestion de salle** |   ❌   | ❌  |    ❌     |  ❌   |     ❌      | **Fondation absente**                                                   |
| 3   | **Avis / réputation**             |   ⚠️   | ❌  |    ❌     |  ⚠️   |     ❌      | **Fondation partielle** — Google Rating inactif, pas de vrai module     |
| 4   | **Marketing automation**          |   ⚠️   | ⚠️  |    ⚠️     |  ❌   |     ✅      | **Features isolées** — réactivation VIP + reengagement, pas de vrai CRM |
| 5   | **Dépôts / garanties no-show**    |   ⚠️   | ❌  |    ✅     |  ❌   |     ❌      | **Dead code préparatoire** — UI config, mais pas de traitement/paiement |
| 6   | **Cartes cadeaux / vouchers**     |   ❌   | ❌  |    ❌     |  ❌   |     ❌      | **Fondation absente**                                                   |
| 7   | **POS / TheFork**                 |   ❌   | ❌  |    ❌     |  ❌   |     ❌      | **Promesse marketing** — FAQ trompeuse, aucun code réel                 |
| 8   | **Réseau de découverte**          |   ✅   | ✅  |    ✅     |  ✅   |     ✅      | **Déjà implémenté** (Sokar Connect)                                     |

Légende : ✅ présent / ⚠️ partiel / ❌ absent.

### 4.1 Widget embed — productisation, pas refonte

Le **moteur** du widget existe et est fonctionnel :

- `apps/connect/src/components/booking-widget.tsx` — flow complet hold/confirm/idempotency + honeypot anti-bot. <ref_file file="/Users/hamza/Projects/Sokar/apps/connect/src/components/booking-widget.tsx" />
- `apps/dashboard/src/app/widget/[restaurantId]/page.tsx` — widget mobile-first, bottom sheet, thème CSS custom. <ref_file file="/Users/hamza/Projects/Sokar/apps/dashboard/src/app/widget/[restaurantId]/page.tsx" />
- `GET /public/widget/:slug` — endpoint public dédié, testé. <ref_snippet file="/Users/hamza/Projects/Sokar/apps/api/src/modules/restaurants/restaurant.routes.ts" lines="333-363" />

Ce qui manque pour la parité Zenchef :

| Existe                          | Manque                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Composant `BookingWidget`       | Snippet JS embeddable `<script src=".../embed.js" data-slug="..."></script>` |
| Page `/widget/[restaurantId]`   | Page publique `/widget/:slug` (pas seulement interne)                        |
| Endpoint `/public/widget/:slug` | Customisation self-service marque blanche (couleurs, logo, polices)          |
| Middleware iframe preview       | Documentation d'intégration (WordPress, Wix, Squarespace)                    |

**Conclusion** : c'est un travail de **packaging + DX**, pas de refonte technique. La fondation (hold/confirm/idempotency/anti-bot) est plus solide techniquement que beaucoup de concurrents.

### 4.2 Floor plan / gestion de salle — fondation absente

Aucun modèle Prisma pour les tables, sections, zones ou floor plan. <ref_file file="/Users/hamza/Projects/Sokar/packages/database/prisma/schema.prisma" />

Le moteur de disponibilité est maintenant **capacity-aware** grâce au plan de salle :

- `ConnectAvailabilityService` (code mort) a été supprimé ; Connect utilise désormais `CapacityAwareAvailabilityService`.
- `ReservationService` (legacy) vérifie les overlaps sur 120 min. <ref_file file="/Users/hamza/Projects/Sokar/apps/api/src/modules/reservations/reservation.service.ts" />
- `CapacityAwareAvailabilityService` alloue une table physique par réservation et calcule les créneaux disponibles en fonction des tables actives et de leurs capacités. <ref_file file="/Users/hamza/Projects/Sokar/apps/api/src/modules/floor-plan/availability-capacity-aware.service.ts" />
- `capacitySpecials.totalCapacity` est utilisé comme fallback pour initialiser le plan de salle.

Le dashboard a une **liste** de réservations (`/dashboard/reservations`), pas de vue salle/planning. <ref_file file="/Users/hamza/Projects/Sokar/apps/dashboard/src/app/dashboard/reservations/page.tsx" />

**Impact** : c'est le plus gros morceau de la roadmap. Il faut un modèle de données, un moteur d'allocation, un UI drag-and-drop, et adapter les 3 canaux (voice, Connect, MCP) pour qu'ils comprennent les tables.

### 4.3 Avis / réputation — fondation partielle

- `Restaurant` a des champs `googlePlaceId`, `googleRating`, `googleReviewCount` pour l'affichage public. <ref_snippet file="/Users/hamza/Projects/Sokar/packages/database/prisma/schema.prisma" lines="78-84" />
- Le worker `google-places-sync.worker.ts` existe mais **n'est jamais schedulé** : `scheduleGooglePlacesSync()` est exportée mais nulle part appelée. <ref_file file="/Users/hamza/Projects/Sokar/apps/api/src/shared/queue/workers/google-places-sync.worker.ts" />
- Aucun modèle `Review`, aucune API CRUD, aucun dashboard de gestion, aucune intégration TripAdvisor/TheFork.

**Conclusion** : l'affichage public est prêt si on alimente manuellement les champs, mais il n'y a pas de plateforme d'avis. Zenchef Grow est beaucoup plus avancé.

### 4.4 Marketing automation — features isolées, pas un CRM

Ce qui est **branché et production-ready** :

- `reactivation.worker.ts` : scan hebdomadaire des VIPs dormants (90-180j) + création de campagnes SMS validées par le gérant. <ref_file file="/Users/hamza/Projects/Sokar/apps/api/src/shared/queue/workers/reactivation.worker.ts" />
- `reengagement.worker.ts` : emails J+3/J+7 pour réduire le churn onboarding. <ref_file file="/Users/hamza/Projects/Sokar/apps/api/src/shared/queue/workers/reengagement.worker.ts" />
- Page `/dashboard/reactivation` et navigation intégrées. <ref_file file="/Users/hamza/Projects/Sokar/apps/dashboard/src/app/dashboard/reactivation/page.tsx" />

Ce qui manque pour un vrai marketing automation :

- Modèles génériques `Campaign`, `Template`, `Segment`, `Automation`.
- Créateur de campagnes, éditeur de templates, segmentation dynamique.
- Multi-canal (SMS + email) et analytics d'ouverture/clic/conversion.
- Tests sur les workers.

**Conclusion** : Sokar a des features métier isolées performantes, mais pas la plateforme marketing de Zenchef Grow.

### 4.5 Dépôts / garanties no-show — dead code préparatoire

- `capacitySpecials` expose `depositRequired`, `depositAmount`, `depositThreshold` dans l'API et l'onboarding. <ref_snippet file="/Users/hamza/Projects/Sokar/apps/api/src/modules/restaurants/restaurant.routes.ts" lines="83-91" /> <ref_snippet file="/Users/hamza/Projects/Sokar/apps/dashboard/src/features/onboarding/steps.tsx" lines="1359-1379" />
- **Aucun traitement** dans les flows de réservation (Connect, Voice, MCP, Widget).
- **Aucune infrastructure de paiement** : pas de Stripe, Mollie, Adyen, webhook, modèle `Payment`.
- Mention de Stripe dans la page de confidentialité mais pas d'intégration réelle.

**Conclusion** : le modèle de données est prêt, mais il manque le processing de paiement. C'est un "demi-gap" : plus simple que le floor plan, mais pas trivial.

### 4.6 Cartes cadeaux / vouchers — absent

Aucun modèle, route, composant ou test. Fondation absente.

### 4.7 POS / TheFork — promesse marketing

- Aucune route, modèle, worker ou dashboard pour Lightspeed, Square ou TheFork.
- La FAQ mentionne "ZenChef, TheFork, Lightspeed en cours de développement" — c'est une promesse marketing sans fondement technique. <ref_snippet file="/Users/hamza/Projects/Sokar/apps/dashboard/src/app/constants.ts" lines="62-65" />
- Le seul lien avec TheFork est le calcul ROI (`theforkSavings`), pas une intégration.

**Recommandation produit** : corriger ou clarifier cette FAQ avant de la publier à plus grande échelle.

### 4.8 Réseau de découverte — déjà implémenté

Sokar Connect est prod-ready : pages publiques, JSON-LD, SEO local, ville, MCP, OpenAI Reserve, tests. Ce n'est pas un gap.

---

## 5. Synthèse stratégique

**Sokar aujourd'hui** = un excellent "AI receptionist + agentic booking" qui complète ou remplace la **partie téléphone** de Zenchef/OpenTable, mais **ne remplace pas** la partie plateforme (gestion de salle, widget plug-and-play, avis, marketing).

**Pour qu'un restaurateur puisse désinstaller Zenchef Grow**, il faut combler les 4 gaps bloquants suivants :

1. **Floor plan / gestion de salle** — fondation absente, plus gros morceau.
2. **Widget embed plug-and-play** — productisation rapide, le moteur est prêt.
3. **Avis / réputation** — fondation partielle, nécessite un vrai module.
4. **Marketing automation** — features isolées, nécessite une plateforme générique.

**Gaps importants mais non bloquants** :

5. **Dépôts/garanties no-show** — UI prête, manque le processing de paiement.
6. **Cartes cadeaux** — absent, revenu + parité Grow.
7. **Waitlist** — absent, utile pour services complets.
8. **Multi-langue** — absent, critique pour zones touristiques.
9. **POS / TheFork** — promesse marketing, aucun code.
10. **App mobile** — absent, nice-to-have.

---

## 6. Roadmap recommandée

| Phase  | Gap                                  | Effort      | Justification                                              |
| ------ | ------------------------------------ | ----------- | ---------------------------------------------------------- |
| **P1** | Floor plan / gestion de salle        | Élevé       | Bloquant, cœur de Manage/Grow                              |
| **P1** | Widget embed plug-and-play           | Moyen       | Bloquant, moteur déjà prêt, quick win commercial           |
| **P1** | Avis / réputation                    | Moyen-Élevé | Bloquant pour Grow, fondation partielle                    |
| **P2** | Marketing automation (CRM campagnes) | Élevé       | Bloquant pour Grow, mais base réactivation utilisable      |
| **P2** | Dépôts / garanties no-show           | Moyen       | UI + modèle prêts, revenu direct, différenciant            |
| **P3** | Cartes cadeaux                       | Moyen       | Revenu + parité Grow                                       |
| **P3** | Waitlist                             | Moyen       | Nice-to-have, utile pour services complets                 |
| **P3** | Multi-langue                         | Moyen       | Critique pour touristique, mais pas pour le marché FR core |
| **P3** | POS / TheFork                        | Élevé       | Promesse marketing à honorer ou retirer                    |

**Note sur le widget** : le gap a été rétrogradé de "refonte bloquante" à "productisation bloquante". C'est beaucoup plus rapide et moins risqué.

**Note sur le positionnement** : ne pas essayer de cloner Zenchef Grow feature-pour-feature. Garder le discours **"0 commission + IA vocale + réservable par les IA"** comme hameçon, puis combler les 4 gaps bloquants pour devenir une vraie alternative one-stop.

**Message commercial recommandé** (honnête et vendeur) :

> "Sokar remplace la partie la plus chère et la plus pénible de Zenchef/OpenTable — les commissions et les appels manqués — et on complète progressivement le reste."

---

## 7. Actions immédiates suggérées

1. **Corriger la FAQ** sur les intégrations POS/TheFork pour ne pas induire en erreur. <ref_snippet file="/Users/hamza/Projects/Sokar/apps/dashboard/src/app/constants.ts" lines="62-65" />
2. **Décider du scope du floor plan** : simple capacité-aware (tables logiques) ou vrai drag-and-drop visuel ?
3. **Prioriser le widget embed** : snippet JS + page publique `/widget/:slug` + customisation dashboard.
4. **Activer ou retirer** la sync Google Places (`scheduleGooglePlacesSync` jamais appelée).
5. **Nettoyer les références Stripe** dans la page de confidentialité si le paiement n'est pas activé.
