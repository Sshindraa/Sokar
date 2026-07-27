-- Add soft-delete column to GiftCardPack
ALTER TABLE "gift_card_packs" ADD COLUMN "deleted_at" TIMESTAMP;

-- Add giftCardEnabled flag to Restaurant
ALTER TABLE "restaurants" ADD COLUMN "gift_card_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Update composite index to include deletedAt
DROP INDEX IF EXISTS "gift_card_packs_restaurant_id_is_active_idx";
CREATE INDEX "gift_card_packs_restaurant_id_is_active_deleted_at_idx" ON "gift_card_packs"("restaurant_id", "is_active", "deleted_at");
