-- CRM core M03: additive customer identities, timeline events and metric snapshots.
-- Existing Customer columns and reservation/call data stay intact. The new
-- projections are populated by the application backfill and dual-write paths.

ALTER TABLE "customers"
  ADD COLUMN "email_normalized" TEXT,
  ADD COLUMN "birth_month" INTEGER,
  ADD COLUMN "birth_day" INTEGER,
  ADD COLUMN "preferred_locale" TEXT,
  ADD COLUMN "merged_into_id" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_merged_into_id_fkey"
  FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "customers_restaurant_email_normalized_idx"
  ON "customers"("restaurant_id", "email_normalized");
CREATE INDEX "customers_restaurant_archived_at_idx"
  ON "customers"("restaurant_id", "archived_at");

CREATE TYPE "CustomerIdentityType" AS ENUM (
  'PHONE',
  'EMAIL',
  'POS_CUSTOMER_ID'
);

CREATE TABLE "customer_identities" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "type" "CustomerIdentityType" NOT NULL,
  "value" TEXT NOT NULL,
  "normalized_value" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3),
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_identities_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_identities_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_identities_restaurant_type_value_key"
  ON "customer_identities"("restaurant_id", "type", "normalized_value");
CREATE INDEX "customer_identities_customer_type_idx"
  ON "customer_identities"("customer_id", "type");

CREATE TABLE "customer_timeline_events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "summary_code" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_timeline_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_timeline_events_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_timeline_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_timeline_events_dedupe_key_key"
  ON "customer_timeline_events"("dedupe_key");
CREATE INDEX "customer_timeline_restaurant_occurred_idx"
  ON "customer_timeline_events"("restaurant_id", "occurred_at" DESC);
CREATE INDEX "customer_timeline_customer_occurred_idx"
  ON "customer_timeline_events"("customer_id", "occurred_at" DESC);
CREATE INDEX "customer_timeline_event_type_occurred_idx"
  ON "customer_timeline_events"("event_type", "occurred_at");

CREATE TABLE "customer_metric_snapshots" (
  "customer_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "last_honored_at" TIMESTAMP(3),
  "next_reservation_at" TIMESTAMP(3),
  "honored_30d" INTEGER NOT NULL DEFAULT 0,
  "honored_90d" INTEGER NOT NULL DEFAULT 0,
  "honored_365d" INTEGER NOT NULL DEFAULT 0,
  "cancelled_365d" INTEGER NOT NULL DEFAULT 0,
  "no_show_365d" INTEGER NOT NULL DEFAULT 0,
  "covers_365d" INTEGER NOT NULL DEFAULT 0,
  "estimated_spend_365d" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "actual_spend_365d" DECIMAL(12,2),
  "actual_lifetime_spend" DECIMAL(12,2),
  "projection_version" INTEGER NOT NULL DEFAULT 1,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_metric_snapshots_pkey" PRIMARY KEY ("customer_id"),
  CONSTRAINT "customer_metric_snapshots_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_metric_snapshots_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "customer_metrics_restaurant_last_honored_idx"
  ON "customer_metric_snapshots"("restaurant_id", "last_honored_at");
CREATE INDEX "customer_metrics_restaurant_honored_idx"
  ON "customer_metric_snapshots"("restaurant_id", "honored_365d");
CREATE INDEX "customer_metrics_restaurant_lifetime_spend_idx"
  ON "customer_metric_snapshots"("restaurant_id", "actual_lifetime_spend");
