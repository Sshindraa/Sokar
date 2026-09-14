-- P7 local foundation: explicit account-level customer identity links.
-- Existing per-site Customer rows remain the source projection; consent and
-- membership are additive and can be removed without rewriting them.

CREATE TYPE "CustomerGroupConsentStatus" AS ENUM (
  'UNKNOWN',
  'OPTED_IN',
  'OPTED_OUT'
);

CREATE TABLE "customer_group_profiles" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "name" TEXT NOT NULL,
  "consent_status" "CustomerGroupConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "consented_at" TIMESTAMP(3),
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_group_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_group_profiles_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "restaurant_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_group_profiles_consent_date_check"
    CHECK (("consent_status" = 'OPTED_IN' AND "consented_at" IS NOT NULL)
      OR ("consent_status" <> 'OPTED_IN'))
);

CREATE INDEX "customer_group_profiles_account_updated_idx"
  ON "customer_group_profiles"("account_id", "updated_at" DESC);
CREATE UNIQUE INDEX "customer_group_profiles_idempotency_key_key"
  ON "customer_group_profiles"("idempotency_key");

CREATE TABLE "customer_group_memberships" (
  "account_id" TEXT NOT NULL,
  "group_profile_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_group_memberships_pkey"
    PRIMARY KEY ("group_profile_id", "restaurant_id", "customer_id"),
  CONSTRAINT "customer_group_memberships_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "restaurant_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_group_memberships_group_profile_id_fkey"
    FOREIGN KEY ("group_profile_id") REFERENCES "customer_group_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_group_memberships_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_group_memberships_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_group_memberships_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE UNIQUE INDEX "customer_group_memberships_account_customer_key"
  ON "customer_group_memberships"("account_id", "customer_id");
CREATE INDEX "customer_group_memberships_account_restaurant_idx"
  ON "customer_group_memberships"("account_id", "restaurant_id");
