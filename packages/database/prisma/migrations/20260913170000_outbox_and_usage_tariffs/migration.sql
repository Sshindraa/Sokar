-- Durable transactional-outbox foundation and versioned usage tariff catalog.
-- Both tables are additive. Existing usage rows remain unchanged and providers
-- without a configured tariff continue to be recorded as UNPRICED.

CREATE TYPE "OutboxStatus" AS ENUM (
  'PENDING',
  'DISPATCHING',
  'DISPATCHED',
  'FAILED'
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "restaurant_id" TEXT,
  "topic" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "dispatched_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "outbox_events_idempotency_key_key"
  ON "outbox_events"("idempotency_key");
CREATE INDEX "outbox_events_dispatch_idx"
  ON "outbox_events"("status", "available_at", "created_at");
CREATE INDEX "outbox_events_aggregate_idx"
  ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "outbox_events_restaurant_created_idx"
  ON "outbox_events"("restaurant_id", "created_at");

CREATE TABLE "usage_tariffs" (
  "id" UUID NOT NULL,
  "category" "UsageCategory" NOT NULL,
  "provider" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "price_per_unit" DECIMAL(18,9) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_tariffs_dimension_version_key"
  ON "usage_tariffs"("category", "provider", "unit", "version");
CREATE INDEX "usage_tariffs_lookup_idx"
  ON "usage_tariffs"("category", "provider", "unit", "effective_from");
