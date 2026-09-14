-- CRM P2-03: structured preferences and auditable customer tags.
-- Additive migration; legacy Customer fields and reservation paths remain valid.

CREATE TYPE "CustomerDataSource" AS ENUM (
  'MANUAL',
  'RESERVATION',
  'VOICE_SUGGESTION',
  'POS',
  'IMPORT'
);

CREATE TABLE "customer_preferences" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "source" "CustomerDataSource" NOT NULL,
  "confidence" DECIMAL(4,3),
  "confirmed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_preferences_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_preferences_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_preferences_customer_key_key"
  ON "customer_preferences"("customer_id", "key");
CREATE INDEX "customer_preferences_restaurant_key_idx"
  ON "customer_preferences"("restaurant_id", "key");
CREATE INDEX "customer_preferences_customer_expires_idx"
  ON "customer_preferences"("customer_id", "expires_at");

CREATE TABLE "customer_tags" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "color_token" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_tags_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_tags_restaurant_key_key"
  ON "customer_tags"("restaurant_id", "key");
CREATE INDEX "customer_tags_restaurant_updated_idx"
  ON "customer_tags"("restaurant_id", "updated_at" DESC);

CREATE TABLE "customer_tag_assignments" (
  "customer_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "source" "CustomerDataSource" NOT NULL,
  "rule_id" TEXT,
  "rule_version" INTEGER,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tag_assignments_pkey" PRIMARY KEY ("customer_id", "tag_id"),
  CONSTRAINT "customer_tag_assignments_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_tag_assignments_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "customer_tags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "customer_tag_assignments_tag_assigned_idx"
  ON "customer_tag_assignments"("tag_id", "assigned_at");
CREATE INDEX "customer_tag_assignments_customer_assigned_idx"
  ON "customer_tag_assignments"("customer_id", "assigned_at");
