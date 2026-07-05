/*
  Warnings:

  - A unique constraint covering the columns `[short_code]` on the table `gift_cards` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "gift_cards" ADD COLUMN     "short_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_short_code_key" ON "gift_cards"("short_code");

-- CreateIndex
CREATE INDEX "gift_cards_short_code_idx" ON "gift_cards"("short_code");
