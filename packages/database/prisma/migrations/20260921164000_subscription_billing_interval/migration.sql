-- Preserve the recurring cadence independently from the mutable Stripe price
-- configuration. Existing subscriptions may remain attached to a historical
-- price after the commercial catalogue moves to a new immutable Price.
ALTER TABLE "restaurant_billing"
ADD COLUMN "subscription_billing_interval" TEXT;

ALTER TABLE "restaurant_account_billing"
ADD COLUMN "subscription_billing_interval" TEXT;
