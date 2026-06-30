-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'CANCELLED', 'NO_REPLY');

-- AddColumn
ALTER TABLE "reservations" ADD COLUMN "confirmation_status" "ConfirmationStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- AddColumn
ALTER TABLE "reservations" ADD COLUMN "confirmation_sent_at" TIMESTAMP(3);

-- AddColumn
ALTER TABLE "reservations" ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "reservations_confirmation_status_reserved_at_idx" ON "reservations"("confirmation_status", "reserved_at");
