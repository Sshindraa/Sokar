-- Canal A — colonnes publiques sur restaurants + flags gating sur restaurant_exposure_settings
-- Additive, nullable partout, pas de NOT NULL forcé tant que <100% des restos ont la valeur.

-- Colonnes publiques sur restaurants (données métier exposées sur /r/[slug])
ALTER TABLE "restaurants" ADD COLUMN "description"      TEXT;
ALTER TABLE "restaurants" ADD COLUMN "city"             TEXT;
ALTER TABLE "restaurants" ADD COLUMN "country"          TEXT NOT NULL DEFAULT 'FR';
ALTER TABLE "restaurants" ADD COLUMN "postal_code"      TEXT;
ALTER TABLE "restaurants" ADD COLUMN "cover_image_url"  TEXT;
ALTER TABLE "restaurants" ADD COLUMN "published_at"     TIMESTAMP(3);

-- Index pour requêtes pages locales: /restaurants/{city} et sitemap
CREATE INDEX "restaurants_city_published_at_idx"
  ON "restaurants" ("city", "published_at");

-- Flags gating Canal A sur restaurant_exposure_settings (source de vérité unique)
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "canal_a_published"      BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "canal_a_agentic"        BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "canal_a_published_at"   TIMESTAMP(3);
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "canal_a_description"    TEXT;

-- Champ source sur reservations (déduit du ?source= query param côté booking)
-- Nullable pour rétrocompat avec les réservations existantes (PHONE/MCP/OPENAI_RESERVE)
ALTER TABLE "reservations" ADD COLUMN "source" TEXT;
