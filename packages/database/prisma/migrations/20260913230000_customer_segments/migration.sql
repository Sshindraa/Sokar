-- CRM P3-01: bounded, versioned segment definitions.

CREATE TABLE "customer_segments" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "definition_version" INTEGER NOT NULL DEFAULT 1,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "last_count" INTEGER,
  "last_evaluated_at" TIMESTAMP(3),
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_segments_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "customer_segments_restaurant_updated_idx"
  ON "customer_segments"("restaurant_id", "updated_at" DESC);
