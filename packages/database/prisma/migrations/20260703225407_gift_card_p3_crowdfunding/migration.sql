-- AlterTable
ALTER TABLE "gift_card_contributions" ADD COLUMN     "contributor_email" TEXT,
ADD COLUMN     "is_public_name" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "stripe_payment_intent_id" TEXT;

-- AlterTable
ALTER TABLE "gift_cards" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "crowdfunded_until" TIMESTAMP(3),
ADD COLUMN     "target_amount" DECIMAL(10,2),
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'SINGLE';
