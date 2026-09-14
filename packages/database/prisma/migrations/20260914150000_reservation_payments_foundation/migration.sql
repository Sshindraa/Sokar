-- P5 local foundation: versioned reservation protection policies, idempotent
-- payment attempts and hashed provider events. No card data or raw webhook
-- payload is persisted; provider activation remains behind a feature flag.

CREATE TYPE "ReservationPaymentType" AS ENUM (
  'CARD_GUARANTEE',
  'DEPOSIT',
  'PREPAYMENT'
);

CREATE TYPE "ReservationPaymentStatus" AS ENUM (
  'REQUIRES_PAYMENT_METHOD',
  'REQUIRES_ACTION',
  'AUTHORIZED',
  'CAPTURED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE "reservation_payment_policies" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "type" "ReservationPaymentType" NOT NULL,
  "amount_mode" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "min_party_size" INTEGER,
  "cancellation_hours" INTEGER NOT NULL DEFAULT 24,
  "rules" JSONB NOT NULL DEFAULT '{}',
  "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reservation_payment_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_payment_policies_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_payment_policies_amount_mode_check"
    CHECK ("amount_mode" IN ('FIXED', 'PER_PERSON')),
  CONSTRAINT "reservation_payment_policies_amount_check"
    CHECK ("amount" > 0 AND "amount" < 100000),
  CONSTRAINT "reservation_payment_policies_party_size_check"
    CHECK ("min_party_size" IS NULL OR ("min_party_size" >= 1 AND "min_party_size" <= 100)),
  CONSTRAINT "reservation_payment_policies_cancellation_hours_check"
    CHECK ("cancellation_hours" >= 0 AND "cancellation_hours" <= 720),
  CONSTRAINT "reservation_payment_policies_active_window_check"
    CHECK ("active_until" IS NULL OR "active_until" > "active_from")
);

CREATE UNIQUE INDEX "reservation_payment_policies_restaurant_version_key"
  ON "reservation_payment_policies"("restaurant_id", "version");
CREATE INDEX "reservation_payment_policies_active_idx"
  ON "reservation_payment_policies"("restaurant_id", "active_from", "active_until");

CREATE TABLE "reservation_payments" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "status" "ReservationPaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT_METHOD',
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "stripe_account_id" TEXT,
  "stripe_setup_intent_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "last_provider_event_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reservation_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_payments_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_payments_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_payments_policy_id_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "reservation_payment_policies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reservation_payments_amount_check"
    CHECK ("amount" > 0 AND "amount" < 100000),
  CONSTRAINT "reservation_payments_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "reservation_payments_stripe_setup_intent_id_key"
  ON "reservation_payments"("stripe_setup_intent_id");
CREATE UNIQUE INDEX "reservation_payments_stripe_payment_intent_id_key"
  ON "reservation_payments"("stripe_payment_intent_id");
CREATE UNIQUE INDEX "reservation_payments_idempotency_key_key"
  ON "reservation_payments"("idempotency_key");
CREATE INDEX "reservation_payments_restaurant_status_created_idx"
  ON "reservation_payments"("restaurant_id", "status", "created_at");
CREATE INDEX "reservation_payments_reservation_created_idx"
  ON "reservation_payments"("reservation_id", "created_at");

CREATE TABLE "reservation_payment_events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "resulting_status" "ReservationPaymentStatus",
  "payload_hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_payment_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_payment_events_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "reservation_payments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reservation_payment_events_provider_event_id_key"
  ON "reservation_payment_events"("provider_event_id");
CREATE UNIQUE INDEX "reservation_payment_events_payment_provider_key"
  ON "reservation_payment_events"("payment_id", "provider_event_id");
CREATE INDEX "reservation_payment_events_restaurant_occurred_idx"
  ON "reservation_payment_events"("restaurant_id", "occurred_at");
