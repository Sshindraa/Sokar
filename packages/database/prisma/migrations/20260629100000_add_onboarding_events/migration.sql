-- Onboarding funnel analytics : table d'événements persistés.
-- Alimentée par le worker BullMQ `analytics` (queue partagée avec RGPD).
-- Permet de mesurer les drop-offs par étape sans outil externe (PostHog/Segment).

CREATE TABLE IF NOT EXISTS "onboarding_events" (
    "id"            TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "user_id"       TEXT,
    "event"         TEXT NOT NULL,
    "task"          TEXT,
    "metadata"      JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id")
);

-- Index pour les requêtes de funnel : drop-off par restaurant dans le temps
CREATE INDEX IF NOT EXISTS "onboarding_events_restaurant_id_created_at_idx"
    ON "onboarding_events"("restaurant_id", "created_at" DESC);

-- Index pour les requêtes agrégées par type d'event
CREATE INDEX IF NOT EXISTS "onboarding_events_event_created_at_idx"
    ON "onboarding_events"("event", "created_at" DESC);

-- FK vers restaurants (cascade si restaurant supprimé)
ALTER TABLE "onboarding_events"
    ADD CONSTRAINT "onboarding_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE;
