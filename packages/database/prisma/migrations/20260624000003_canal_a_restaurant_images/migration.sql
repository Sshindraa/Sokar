-- Canal A — table restaurant_images (galerie + cover)
-- URLs externes uniquement en P0 (Cloudinary, S3, ou URL fournie par le restaurateur).
-- Pas d'upload handler custom, ticket Phase 2 si besoin.

CREATE TABLE "restaurant_images" (
  "id"            TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "url"           TEXT NOT NULL,
  "alt"           TEXT,
  "is_cover"      BOOLEAN NOT NULL DEFAULT false,
  "position"      INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "restaurant_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_images_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id")
    REFERENCES "restaurants"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "restaurant_images_restaurant_id_is_cover_position_idx"
  ON "restaurant_images" ("restaurant_id", "is_cover", "position");
