# Onboarding Pilote P1 Sokar Connect

## Objectif

10 restaurants réels onboardés sur Sokar Connect pour valider les 4 critères go/no-go P1.

## Critères go/no-go P1 (dashboard `/dashboard/connect/pilot`)

1. **holdToConfirmRate** ≥ 30 % (réservations web confirmées / holds créés)
2. **slugP95Ms** < 500 ms (latence p95 sur `GET /public/r/:slug`)
3. **piiLeakIncidents** = 0 (jamais de fuite PII dans les logs)
4. **aggregateRatingSafe** = true (aucun `aggregateRating` inventé dans le JSON-LD)

Source : `apps/api/src/modules/connect/connect-kpis.service.ts` (`CONNECT_TARGETS`).

## Pré-requis techniques (déjà prêts)

- [x] Sitemap dynamique (`apps/connect/src/app/sitemap.ts`)
- [x] robots.txt (`apps/connect/src/app/robots.ts`)
- [x] Endpoint `GET /public/sitemap-data` (`apps/api/src/modules/connect/connect.routes.ts`)
- [x] KPIs service (`apps/api/src/modules/connect/connect-kpis.service.ts`)
- [x] Dashboard pilot (`apps/dashboard/src/app/dashboard/connect/pilot/page.tsx`, polling 60 s)
- [x] Onboarding 5 étapes Connect (`apps/api/src/modules/restaurants/onboarding.service.ts`)

## Étapes d'onboarding par restaurant

### 1. Collecte des données (restaurant)

- [ ] Nom du restaurant
- [ ] Slug souhaité (validation via `GET /api/restaurants/check-slug?slug=...`)
- [ ] Adresse complète (rue, ville, code postal, pays)
- [ ] Coordonnées GPS (géocodage via Nominatim)
- [ ] Type de cuisine
- [ ] Gamme de prix (1-4)
- [ ] Capacité (nombre de tables, taille max de groupe)
- [ ] Horaires d'ouverture (jour par jour, midi/soir)
- [ ] Photo de couverture (upload via `POST /api/restaurants/:id/images`)
- [ ] Description courte (1-2 phrases, vous-forme)
- [ ] Numéro de téléphone E.164 (pour Telnyx)
- [ ] Email de contact

### 2. Configuration via dashboard

- [ ] Accéder au dashboard Sokar (`https://sokar.tech/dashboard`)
- [ ] Créer le restaurant
- [ ] Compléter les 5 étapes Connect :
  - `connect-identity` — slug, description, photo de couverture
  - `connect-location` — adresse, carte, coordonnées GPS
  - `connect-cuisine` — type de cuisine, tarifs, ambiance
  - `connect-capacity` — capacité d'accueil, durée de service, acompte
  - `connect-activation` — publication de la page
- [ ] Vérifier la preview sur `/restaurant/[slug]`
- [ ] Activer `connectPublished` via `PATCH /api/restaurants/:id/connect`

### 3. Provisioning Telnyx

- [ ] Lister les numéros disponibles : `GET /api/admin/provisioning/available-numbers`
- [ ] Attribuer un numéro : `POST /api/admin/provisioning/:restaurantId/assign-phone`
- [ ] Vérifier le webhook : `POST /api/admin/provisioning/:restaurantId/verify-webhook`
- [ ] Tester l'appel : `POST /api/admin/provisioning/:restaurantId/test-call`
- [ ] Finaliser le provisioning : `POST /api/admin/provisioning/:restaurantId/complete`

### 4. Validation

- [ ] Page `/restaurant/[slug]` accessible (HTTP 200)
- [ ] Sitemap inclut le restaurant (`GET /sitemap.xml` sur `https://sokar.tech`)
- [ ] Widget de réservation fonctionnel (`/restaurant/[slug]/book`)
- [ ] Test de réservation end-to-end : hold (`POST /public/r/:slug/hold`) → confirm (`POST /public/r/:slug/confirm`)

### 5. Google Search Console (one-time)

- [ ] Créer la propriété `https://sokar.tech` dans Google Search Console
- [ ] Vérifier via `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (meta tag dans `apps/connect/src/app/layout.tsx`) ou fichier `google<hash>.html`
- [ ] Soumettre le sitemap `https://sokar.tech/sitemap.xml`
- [ ] Surveiller l'indexation (jours → semaines)

## Suivi du pilote

- **Dashboard** : `/dashboard/connect/pilot` (polling 60 s)
- **Endpoint KPIs** : `GET /api/internal/connect-kpis`
- **Période** : 2-4 semaines après onboarding complet
- **Décision go/no-go** : basée sur les 4 critères ci-dessus

## Rollback

- Désactiver `connectPublished` pour un restaurant : `PATCH /api/restaurants/:id/connect` avec `{ connectPublished: false }`
- Le restaurant reste dans la base mais n'est plus public (retiré du sitemap, page 404)
