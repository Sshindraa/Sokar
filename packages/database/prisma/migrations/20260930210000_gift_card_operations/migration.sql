-- AlterTable
ALTER TABLE "gift_card_redemptions" ADD COLUMN     "actor" TEXT,
ADD COLUMN     "balance_after" DECIMAL(10,2),
ADD COLUMN     "bill_amount" DECIMAL(10,2),
ADD COLUMN     "complement_amount" DECIMAL(10,2),
ADD COLUMN     "operation_key" TEXT,
ADD COLUMN     "restaurant_id" TEXT,
ADD COLUMN     "ticket_reference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_redemptions_operation_key_key" ON "gift_card_redemptions"("operation_key");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_redemptions_restaurant_id_ticket_reference_key" ON "gift_card_redemptions"("restaurant_id", "ticket_reference");


-- Only new operational receipts are constrained; historical rows remain unchanged.
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_operational_receipt_check"
CHECK ("operation_key" IS NULL OR (
  "restaurant_id" IS NOT NULL AND "ticket_reference" IS NOT NULL AND length("ticket_reference") > 0
  AND "bill_amount" IS NOT NULL AND "balance_after" IS NOT NULL AND "complement_amount" IS NOT NULL
  AND "bill_amount" > 0 AND "amount" > 0 AND "balance_after" >= 0 AND "complement_amount" >= 0
  AND "bill_amount" = "amount" + "complement_amount"
));
