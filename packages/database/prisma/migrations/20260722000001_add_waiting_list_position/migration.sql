-- Add position to waiting list entries for deterministic ordering/display.
ALTER TABLE "waiting_list_entries" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Update existing entries to a placeholder; the service sets real positions on new entries.
UPDATE "waiting_list_entries" SET "position" = 0;
