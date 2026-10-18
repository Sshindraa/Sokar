-- Public experience checkout holds and Stripe Connect references.
ALTER TABLE "experience_reservations"
  ADD COLUMN "customer_name" TEXT,
  ADD COLUMN "customer_email" TEXT,
  ADD COLUMN "customer_phone" TEXT;

ALTER TABLE "restaurants"
  ADD COLUMN "experience_stripe_account_id" TEXT,
  ADD COLUMN "experience_commission_rate" DECIMAL(5,4);

-- Reuse an already connected merchant account without disrupting gift-card flows.
UPDATE "restaurants"
SET "experience_stripe_account_id" = "gift_card_stripe_account_id"
WHERE "gift_card_stripe_account_id" IS NOT NULL;

CREATE UNIQUE INDEX "restaurants_experience_stripe_account_id_key"
  ON "restaurants"("experience_stripe_account_id");
ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_experience_commission_rate_check"
  CHECK ("experience_commission_rate" IS NULL OR "experience_commission_rate" BETWEEN 0 AND 1);

CREATE TYPE "ExperienceCheckoutStatus" AS ENUM (
  'OPEN', 'PAID', 'FREE', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'
);

CREATE TABLE "experience_checkouts" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "reservation_id" TEXT,
  "quantity" INTEGER NOT NULL,
  "unit_price_cents" INTEGER NOT NULL,
  "total_price_cents" INTEGER NOT NULL,
  "sokar_fee_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "ExperienceCheckoutStatus" NOT NULL DEFAULT 'OPEN',
  "stripe_account_id" TEXT NOT NULL,
  "stripe_checkout_session_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "stripe_refund_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "experience_checkouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_checkouts_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000),
  CONSTRAINT "experience_checkouts_unit_price_check" CHECK ("unit_price_cents" BETWEEN 0 AND 1000000),
  CONSTRAINT "experience_checkouts_total_price_check" CHECK ("total_price_cents" = "unit_price_cents" * "quantity"),
  CONSTRAINT "experience_checkouts_fee_check" CHECK ("sokar_fee_cents" BETWEEN 0 AND "total_price_cents"),
  CONSTRAINT "experience_checkouts_currency_check" CHECK ("currency" = 'EUR'),
  CONSTRAINT "experience_checkouts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_checkouts_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_checkouts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "experience_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_checkouts_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "experience_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "experience_checkouts_reservation_id_key" ON "experience_checkouts"("reservation_id");
CREATE UNIQUE INDEX "experience_checkouts_stripe_checkout_session_id_key" ON "experience_checkouts"("stripe_checkout_session_id");
CREATE UNIQUE INDEX "experience_checkouts_stripe_payment_intent_id_key" ON "experience_checkouts"("stripe_payment_intent_id");
CREATE UNIQUE INDEX "experience_checkouts_stripe_refund_id_key" ON "experience_checkouts"("stripe_refund_id");
CREATE UNIQUE INDEX "experience_checkouts_idempotency_key_key" ON "experience_checkouts"("idempotency_key");
CREATE INDEX "experience_checkouts_restaurant_status_expires_idx" ON "experience_checkouts"("restaurant_id", "status", "expires_at");
CREATE INDEX "experience_checkouts_session_status_expires_idx" ON "experience_checkouts"("session_id", "status", "expires_at");

CREATE TABLE "experience_payment_events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "checkout_id" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experience_payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_payment_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_payment_events_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "experience_checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "experience_payment_events_provider_event_id_key" ON "experience_payment_events"("provider_event_id");
CREATE UNIQUE INDEX "experience_payment_events_checkout_provider_event_id_key" ON "experience_payment_events"("checkout_id", "provider_event_id");
CREATE INDEX "experience_payment_events_restaurant_occurred_idx" ON "experience_payment_events"("restaurant_id", "occurred_at");
