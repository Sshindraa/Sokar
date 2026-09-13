-- Additive usage ledger. Raw events are immutable application-side and
-- source_event_key provides provider/business idempotency.
CREATE TYPE "UsageCategory" AS ENUM (
  'TELEPHONY_SECONDS',
  'STT_SECONDS',
  'TTS_CHARACTERS',
  'LLM_INPUT_TOKENS',
  'LLM_OUTPUT_TOKENS',
  'SMS_SEGMENTS',
  'WHATSAPP_MESSAGES',
  'EMAIL_MESSAGES',
  'RECORDING_BYTE_DAYS'
);

CREATE TABLE "usage_events" (
  "id" UUID NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "account_id" TEXT,
  "category" "UsageCategory" NOT NULL,
  "provider" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "estimated_cost" DECIMAL(18,6) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_event_key" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_events_source_event_key_key"
  ON "usage_events"("source_event_key");
CREATE INDEX "usage_events_restaurant_occurred_at_idx"
  ON "usage_events"("restaurant_id", "occurred_at");
CREATE INDEX "usage_events_restaurant_category_occurred_at_idx"
  ON "usage_events"("restaurant_id", "category", "occurred_at");
CREATE INDEX "usage_events_account_occurred_at_idx"
  ON "usage_events"("account_id", "occurred_at");

CREATE TABLE "usage_monthly_rollups" (
  "restaurant_id" TEXT NOT NULL,
  "month_key" TEXT NOT NULL,
  "category" "UsageCategory" NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "estimated_cost" DECIMAL(18,6) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_monthly_rollups_pkey"
    PRIMARY KEY ("restaurant_id", "month_key", "category"),
  CONSTRAINT "usage_monthly_rollups_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "usage_monthly_rollups_month_category_idx"
  ON "usage_monthly_rollups"("month_key", "category");
