-- Additive Stripe Billing state for recurring restaurant subscriptions.
CREATE TABLE "restaurant_billing" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "subscription_status" TEXT,
  "subscription_price_id" TEXT,
  "subscription_current_period_end" TIMESTAMP(3),
  "subscription_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "restaurant_billing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "restaurant_billing_restaurant_id_key" ON "restaurant_billing"("restaurant_id");
CREATE UNIQUE INDEX "restaurant_billing_stripe_customer_id_key" ON "restaurant_billing"("stripe_customer_id");
CREATE UNIQUE INDEX "restaurant_billing_stripe_subscription_id_key" ON "restaurant_billing"("stripe_subscription_id");

ALTER TABLE "restaurant_billing"
  ADD CONSTRAINT "restaurant_billing_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
