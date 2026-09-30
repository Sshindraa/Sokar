-- CreateTable
CREATE TABLE "gift_card_deliveries" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "started_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_deliveries_idempotency_key_key" ON "gift_card_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "gift_card_deliveries_restaurant_id_status_created_at_idx" ON "gift_card_deliveries"("restaurant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "gift_card_deliveries_gift_card_id_created_at_idx" ON "gift_card_deliveries"("gift_card_id", "created_at");

-- Reject unsupported states and impossible attempt counts.
ALTER TABLE "gift_card_deliveries" ADD CONSTRAINT "gift_card_delivery_state_check"
CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'SENT', 'FAILED', 'UNKNOWN', 'SKIPPED')
  AND "channel" IN ('email', 'sms', 'whatsapp') AND "attempts" >= 0
  AND ("status" <> 'IN_PROGRESS' OR "started_at" IS NOT NULL));
