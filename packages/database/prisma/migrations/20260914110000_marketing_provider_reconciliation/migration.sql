-- Durable inbox for signed provider callbacks that cannot be matched at
-- receipt time. Only provider metadata and a payload hash are retained.
CREATE TYPE "MarketingProviderReconciliationStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

CREATE TABLE "marketing_provider_reconciliations" (
    "id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_status" TEXT,
    "error_code" TEXT,
    "payload_hash" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "status" "MarketingProviderReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "restaurant_id" TEXT,
    "campaign_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_provider_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_provider_reconciliations_event_key_key"
  ON "marketing_provider_reconciliations"("event_key");
CREATE INDEX "marketing_provider_reconciliation_status_seen_idx"
  ON "marketing_provider_reconciliations"("status", "last_seen_at");
CREATE INDEX "marketing_provider_reconciliation_provider_message_idx"
  ON "marketing_provider_reconciliations"("provider", "provider_message_id");
CREATE INDEX "marketing_provider_reconciliation_restaurant_status_idx"
  ON "marketing_provider_reconciliations"("restaurant_id", "status", "last_seen_at");

ALTER TABLE "marketing_provider_reconciliations"
  ADD CONSTRAINT "marketing_provider_reconciliations_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_provider_reconciliations"
  ADD CONSTRAINT "marketing_provider_reconciliations_campaign_message_id_fkey"
  FOREIGN KEY ("campaign_message_id") REFERENCES "campaign_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
