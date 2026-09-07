-- Harden recurring Stripe billing for the first production restaurants.
ALTER TABLE "restaurant_billing"
  ADD COLUMN "checkout_idempotency_key" TEXT,
  ADD COLUMN "checkout_session_id" TEXT,
  ADD COLUMN "checkout_session_url" TEXT,
  ADD COLUMN "checkout_plan" TEXT,
  ADD COLUMN "checkout_billing_interval" TEXT,
  ADD COLUMN "checkout_site_count" INTEGER,
  ADD COLUMN "checkout_created_at" TIMESTAMP(3),
  ADD COLUMN "last_stripe_event_created" INTEGER,
  ADD COLUMN "last_stripe_event_id" TEXT;

CREATE UNIQUE INDEX "restaurant_billing_checkout_idempotency_key_key"
  ON "restaurant_billing"("checkout_idempotency_key");
CREATE UNIQUE INDEX "restaurant_billing_checkout_session_id_key"
  ON "restaurant_billing"("checkout_session_id");

CREATE TABLE "stripe_webhook_events" (
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_created" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "stripe_webhook_events_status_event_created_idx"
  ON "stripe_webhook_events"("status", "event_created");
