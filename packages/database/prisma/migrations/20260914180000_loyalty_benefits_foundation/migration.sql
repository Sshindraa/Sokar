-- P8 local foundation: bounded operational loyalty benefits.
-- No points ledger or provider integration is introduced here. Redemption
-- codes are opaque and only their SHA-256 hashes are stored.

CREATE TYPE "LoyaltyBenefitRule" AS ENUM (
  'ANY',
  'VIP',
  'MIN_VISITS',
  'BIRTHDAY_MONTH',
  'MIN_ESTIMATED_SPEND'
);

CREATE TYPE "LoyaltyBenefitStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE "LoyaltyGrantStatus" AS ENUM (
  'ISSUED',
  'REDEEMED',
  'VOID',
  'EXPIRED'
);

CREATE TABLE "loyalty_benefits" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rule" "LoyaltyBenefitRule" NOT NULL DEFAULT 'ANY',
  "rule_value" INTEGER,
  "cost_cents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "validity_days" INTEGER NOT NULL DEFAULT 30,
  "max_uses_per_customer" INTEGER NOT NULL DEFAULT 1,
  "status" "LoyaltyBenefitStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loyalty_benefits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_benefits_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_benefits_cost_check"
    CHECK ("cost_cents" IS NULL OR ("cost_cents" >= 0 AND "cost_cents" <= 1000000)),
  CONSTRAINT "loyalty_benefits_validity_check"
    CHECK ("validity_days" BETWEEN 1 AND 365),
  CONSTRAINT "loyalty_benefits_max_uses_check"
    CHECK ("max_uses_per_customer" BETWEEN 1 AND 100),
  CONSTRAINT "loyalty_benefits_currency_check"
    CHECK ("currency" = 'EUR'),
  CONSTRAINT "loyalty_benefits_rule_value_check"
    CHECK (
      ("rule" IN ('ANY', 'VIP', 'BIRTHDAY_MONTH') AND "rule_value" IS NULL)
      OR ("rule" = 'MIN_VISITS' AND "rule_value" BETWEEN 1 AND 1000)
      OR ("rule" = 'MIN_ESTIMATED_SPEND' AND "rule_value" BETWEEN 1 AND 5000000)
    )
);

CREATE UNIQUE INDEX "loyalty_benefits_restaurant_key_key"
  ON "loyalty_benefits"("restaurant_id", "key");
CREATE INDEX "loyalty_benefits_restaurant_status_updated_idx"
  ON "loyalty_benefits"("restaurant_id", "status", "updated_at");

CREATE TABLE "loyalty_grants" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "benefit_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "reservation_id" TEXT,
  "idempotency_key" TEXT,
  "code_hash" TEXT NOT NULL,
  "status" "LoyaltyGrantStatus" NOT NULL DEFAULT 'ISSUED',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "redeemed_at" TIMESTAMP(3),
  "voided_at" TIMESTAMP(3),
  "issued_by_hash" TEXT NOT NULL,
  "redeemed_by_hash" TEXT,
  "redemption_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loyalty_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_grants_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_grants_benefit_id_fkey"
    FOREIGN KEY ("benefit_id") REFERENCES "loyalty_benefits"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_grants_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loyalty_grants_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "loyalty_grants_code_hash_check"
    CHECK (length("code_hash") = 64),
  CONSTRAINT "loyalty_grants_note_length_check"
    CHECK ("redemption_note" IS NULL OR length("redemption_note") <= 1000)
);

CREATE UNIQUE INDEX "loyalty_grants_idempotency_key_key"
  ON "loyalty_grants"("idempotency_key");
CREATE UNIQUE INDEX "loyalty_grants_code_hash_key"
  ON "loyalty_grants"("code_hash");
CREATE INDEX "loyalty_grants_restaurant_status_expiry_idx"
  ON "loyalty_grants"("restaurant_id", "status", "expires_at");
CREATE INDEX "loyalty_grants_customer_benefit_status_idx"
  ON "loyalty_grants"("restaurant_id", "customer_id", "benefit_id", "status");
CREATE INDEX "loyalty_grants_reservation_idx"
  ON "loyalty_grants"("restaurant_id", "reservation_id");
