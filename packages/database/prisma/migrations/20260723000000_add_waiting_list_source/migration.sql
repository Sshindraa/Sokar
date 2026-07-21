-- Add source column to waiting list entries for audit/tracking.
ALTER TABLE "waiting_list_entries"
  ADD COLUMN IF NOT EXISTS "source" TEXT;
