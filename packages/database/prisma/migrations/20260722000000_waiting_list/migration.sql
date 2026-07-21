-- Waiting list (P3.2)

-- CreateEnum
CREATE TYPE "WaitingListStatus" AS ENUM (
  'PENDING',
  'PROMOTED',
  'CANCELLED',
  'EXPIRED'
);

-- CreateTable
CREATE TABLE "waiting_list_entries" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "party_size" INTEGER NOT NULL,
  "customer_first_name" TEXT NOT NULL,
  "customer_last_name" TEXT,
  "customer_phone" TEXT NOT NULL,
  "customer_phone_normalized" TEXT NOT NULL,
  "customer_email" TEXT,
  "slot_start" TIMESTAMP(3) NOT NULL,
  "slot_end" TIMESTAMP(3) NOT NULL,
  "preferred_section_id" TEXT,
  "status" "WaitingListStatus" NOT NULL DEFAULT 'PENDING',
  "action_token_hash" TEXT NOT NULL UNIQUE,
  "promoted_reservation_id" TEXT UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "promoted_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "waiting_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waiting_list_entries_restaurant_id_status_slot_start_created_at_idx" ON "waiting_list_entries"("restaurant_id", "status", "slot_start", "created_at");
CREATE INDEX "waiting_list_entries_restaurant_id_customer_phone_normalized_idx" ON "waiting_list_entries"("restaurant_id", "customer_phone_normalized");
CREATE INDEX "waiting_list_entries_expires_at_idx" ON "waiting_list_entries"("expires_at");

-- CreatePartialUniqueIndex
CREATE UNIQUE INDEX "waiting_list_pending_unique_phone_slot"
  ON "waiting_list_entries"("restaurant_id", "customer_phone_normalized", "slot_start")
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "waiting_list_entries"
  ADD CONSTRAINT "waiting_list_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "waiting_list_entries_preferred_section_id_fkey" FOREIGN KEY ("preferred_section_id") REFERENCES "floor_plan_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "waiting_list_entries_promoted_reservation_id_fkey" FOREIGN KEY ("promoted_reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exclusion constraint on reservations is added in a dedicated migration
-- (20260723000001_reservation_overlap_exclusion) to keep change management clean.
