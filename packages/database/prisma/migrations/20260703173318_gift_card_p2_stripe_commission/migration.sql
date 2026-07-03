/*
  Warnings:

  - Added the required column `sokar_commission_amount` to the `gift_cards` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "gift_cards" ADD COLUMN     "custom_image_url" TEXT,
ADD COLUMN     "sokar_commission_amount" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "stripe_payment_intent_id" TEXT,
ADD COLUMN     "stripe_payment_status" TEXT DEFAULT 'pending',
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "gift_card_commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.05;
