ALTER TABLE "restaurants" ADD COLUMN "gift_card_stripe_pending_account_id" TEXT;
CREATE UNIQUE INDEX "restaurants_gift_card_stripe_pending_account_id_key" ON "restaurants"("gift_card_stripe_pending_account_id");
