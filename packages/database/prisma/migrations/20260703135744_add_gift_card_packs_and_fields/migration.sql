-- Ajoute GiftCardPack et les champs packs + réservation clé en main sur GiftCard.
-- Supprime voice_message_url (reporté en P3).

ALTER TABLE "gift_cards" DROP COLUMN "voice_message_url";
ALTER TABLE "gift_cards" ADD COLUMN "pack_id" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "preferred_date" TIMESTAMP(3);
ALTER TABLE "gift_cards" ADD COLUMN "preferred_party_size" INTEGER;
ALTER TABLE "gift_cards" ADD COLUMN "preferred_time" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "validity_months" INTEGER NOT NULL DEFAULT 12;

ALTER TABLE "reservations" ADD COLUMN "gift_card_complement_amount" DECIMAL(10,2);

CREATE TABLE "gift_card_packs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "min_party_size" INTEGER NOT NULL DEFAULT 1,
    "max_party_size" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gift_card_packs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gift_card_packs_restaurant_id_is_active_idx" ON "gift_card_packs"("restaurant_id", "is_active");

ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "gift_card_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_card_packs" ADD CONSTRAINT "gift_card_packs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
