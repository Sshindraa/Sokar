-- Ajoute les tables de cartes cadeaux (P1).

CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "remaining_amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "sender_name" TEXT,
    "sender_email" TEXT,
    "sender_phone" TEXT,
    "recipient_name" TEXT,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "message" TEXT,
    "voice_message_url" TEXT,
    "occasion" TEXT,
    "customer_id" TEXT,
    "created_by" TEXT NOT NULL DEFAULT 'CLIENT',
    "purchase_reference" TEXT,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gift_card_redemptions" (
    "id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gift_card_contributions" (
    "id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "contributor_name" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "contributed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");
CREATE INDEX "gift_cards_restaurant_id_status_idx" ON "gift_cards"("restaurant_id", "status");
CREATE INDEX "gift_cards_code_idx" ON "gift_cards"("code");
CREATE INDEX "gift_card_redemptions_gift_card_id_idx" ON "gift_card_redemptions"("gift_card_id");
CREATE INDEX "gift_card_contributions_gift_card_id_idx" ON "gift_card_contributions"("gift_card_id");

ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_card_contributions" ADD CONSTRAINT "gift_card_contributions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
