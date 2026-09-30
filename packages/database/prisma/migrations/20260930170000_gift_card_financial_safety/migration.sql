-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "gift_card_stripe_account_id" TEXT;

-- AlterTable
ALTER TABLE "gift_cards" ADD COLUMN     "pack_snapshot" JSONB;

-- CreateTable
CREATE TABLE "gift_card_checkouts" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "gift_card_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "stripe_account_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "access_token_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_payment_entries" (
    "payment_intent_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "contribution_id" TEXT,
    "kind" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "pending_refund" BOOLEAN NOT NULL DEFAULT false,
    "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "stripe_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_payment_entries_pkey" PRIMARY KEY ("payment_intent_id")
);

-- CreateTable
CREATE TABLE "gift_card_refund_requests" (
    "id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "stripe_account_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "stripe_refund_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'CANCELLATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_checkouts_idempotency_key_key" ON "gift_card_checkouts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_checkouts_stripe_payment_intent_id_key" ON "gift_card_checkouts"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "gift_card_checkouts_restaurant_id_created_at_idx" ON "gift_card_checkouts"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "gift_card_checkouts_status_updated_at_idx" ON "gift_card_checkouts"("status", "updated_at");

-- CreateIndex
CREATE INDEX "gift_card_payment_entries_gift_card_id_idx" ON "gift_card_payment_entries"("gift_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_refund_requests_idempotency_key_key" ON "gift_card_refund_requests"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_refund_requests_stripe_refund_id_key" ON "gift_card_refund_requests"("stripe_refund_id");

-- CreateIndex
CREATE INDEX "gift_card_refund_requests_status_updated_at_idx" ON "gift_card_refund_requests"("status", "updated_at");

-- CreateIndex
CREATE INDEX "gift_card_refund_requests_gift_card_id_idx" ON "gift_card_refund_requests"("gift_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_gift_card_stripe_account_id_key" ON "restaurants"("gift_card_stripe_account_id");

-- Monetary invariants apply only to the new financial tables; legacy rows are unchanged.
ALTER TABLE "gift_card_checkouts" ADD CONSTRAINT "gift_card_checkout_amount_positive" CHECK (amount_cents > 0);
ALTER TABLE "gift_card_checkouts" ADD CONSTRAINT "gift_card_checkout_commission_range" CHECK (commission_rate >= 0 AND commission_rate <= 1);
ALTER TABLE "gift_card_payment_entries" ADD CONSTRAINT "gift_card_payment_amounts_valid" CHECK (amount_cents > 0 AND refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents);
ALTER TABLE "gift_card_refund_requests" ADD CONSTRAINT "gift_card_refund_amount_positive" CHECK (amount_cents > 0);
