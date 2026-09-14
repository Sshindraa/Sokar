-- Additive campaign execution state. Existing rows remain valid and keep their
-- current status; the new worker only claims PENDING messages.
ALTER TYPE "MarketingMessageStatus" ADD VALUE IF NOT EXISTS 'SENDING';

ALTER TABLE "marketing_campaigns"
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error_code" TEXT;

CREATE INDEX IF NOT EXISTS "marketing_campaigns_restaurant_status_started_idx"
  ON "marketing_campaigns" ("restaurant_id", "status", "started_at");
