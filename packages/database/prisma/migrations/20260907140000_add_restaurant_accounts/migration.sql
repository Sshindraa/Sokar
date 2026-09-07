-- Additive foundation for multi-site accounts.
-- Existing restaurants remain valid with account_id NULL until the explicit
-- backfill/provisioning step. No existing tenant data is rewritten here.

CREATE TABLE "restaurant_accounts" (
  "id" TEXT NOT NULL,
  "clerk_organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "restaurant_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "restaurant_accounts_clerk_organization_id_key"
  ON "restaurant_accounts"("clerk_organization_id");

ALTER TABLE "restaurants"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "site_status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "restaurants_account_site_status_idx"
  ON "restaurants"("account_id", "site_status");

ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "restaurant_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "restaurant_account_memberships" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "restaurant_id" TEXT,
  "clerk_user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'STAFF',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "restaurant_account_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "restaurant_account_memberships_scope_user_key"
  ON "restaurant_account_memberships"("account_id", "restaurant_id", "clerk_user_id");
-- PostgreSQL treats NULLs as distinct in a regular unique index. The
-- account-level scope uses restaurant_id = NULL, so keep one membership per
-- account/user even when two auth sync requests race.
CREATE UNIQUE INDEX "restaurant_account_memberships_account_scope_user_key"
  ON "restaurant_account_memberships"("account_id", "clerk_user_id")
  WHERE "restaurant_id" IS NULL;
CREATE INDEX "restaurant_account_memberships_account_user_idx"
  ON "restaurant_account_memberships"("account_id", "clerk_user_id");
CREATE INDEX "restaurant_account_memberships_site_user_idx"
  ON "restaurant_account_memberships"("restaurant_id", "clerk_user_id");

ALTER TABLE "restaurant_account_memberships"
  ADD CONSTRAINT "restaurant_account_memberships_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "restaurant_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "restaurant_account_memberships"
  ADD CONSTRAINT "restaurant_account_memberships_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "restaurant_account_billing" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "subscription_status" TEXT,
  "subscription_price_id" TEXT,
  "entitled_site_count" INTEGER NOT NULL DEFAULT 1,
  "entitlement_source" TEXT,
  "subscription_current_period_end" TIMESTAMP(3),
  "subscription_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "last_stripe_event_created" INTEGER,
  "last_stripe_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "restaurant_account_billing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "restaurant_account_billing_account_id_key"
  ON "restaurant_account_billing"("account_id");
CREATE UNIQUE INDEX "restaurant_account_billing_stripe_customer_id_key"
  ON "restaurant_account_billing"("stripe_customer_id");
CREATE UNIQUE INDEX "restaurant_account_billing_stripe_subscription_id_key"
  ON "restaurant_account_billing"("stripe_subscription_id");

ALTER TABLE "restaurant_account_billing"
  ADD CONSTRAINT "restaurant_account_billing_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "restaurant_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
