-- Ajoute les colonnes Google Places au restaurant (Phase 3).
ALTER TABLE "restaurants" ADD COLUMN     "google_place_id" TEXT,
ADD COLUMN     "google_rating" DOUBLE PRECISION,
ADD COLUMN     "google_rating_synced_at" TIMESTAMP(3),
ADD COLUMN     "google_review_count" INTEGER;
