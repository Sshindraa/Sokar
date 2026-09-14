-- P3-03: bounded, tenant-scoped marketing automations and durable claims.
-- The feature remains disabled by default; this migration only adds storage.

CREATE TYPE "MarketingAutomationType" AS ENUM (
  'AFTER_FIRST_HONORED',
  'DORMANT',
  'BIRTHDAY'
);

CREATE TYPE "MarketingAutomationDispatchStatus" AS ENUM (
  'QUEUED',
  'SENT',
  'SKIPPED',
  'FAILED'
);

CREATE TABLE "marketing_automations" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "type" "MarketingAutomationType" NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "config" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "last_evaluated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_automations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_automations_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_automations_restaurant_type_key"
  ON "marketing_automations"("restaurant_id", "type");
CREATE INDEX "marketing_automations_enabled_type_idx"
  ON "marketing_automations"("enabled", "type");
CREATE INDEX "marketing_automations_restaurant_enabled_idx"
  ON "marketing_automations"("restaurant_id", "enabled");

CREATE TABLE "marketing_automation_dispatches" (
  "id" TEXT NOT NULL,
  "automation_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "trigger_key" TEXT NOT NULL,
  "campaign_id" TEXT,
  "status" "MarketingAutomationDispatchStatus" NOT NULL DEFAULT 'QUEUED',
  "reason_code" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_automation_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_automation_dispatches_automation_id_fkey"
    FOREIGN KEY ("automation_id") REFERENCES "marketing_automations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_automation_dispatches_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_automation_dispatches_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_automation_dispatches_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_automation_dispatches_dedupe_key"
  ON "marketing_automation_dispatches"("automation_id", "customer_id", "trigger_key");
CREATE INDEX "marketing_automation_dispatches_restaurant_status_idx"
  ON "marketing_automation_dispatches"("restaurant_id", "status", "created_at");
CREATE INDEX "marketing_automation_dispatches_campaign_idx"
  ON "marketing_automation_dispatches"("campaign_id");
