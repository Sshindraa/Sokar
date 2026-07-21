-- Backfill waiting list positions for existing entries.
-- Pending entries are ordered per (restaurant, slot) by creation time; other
-- statuses keep their current value (0) because they are no longer queue candidates.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "restaurant_id", "slot_start"
      ORDER BY "created_at"
    ) AS "rn"
  FROM "waiting_list_entries"
  WHERE "status" = 'PENDING'
)
UPDATE "waiting_list_entries"
SET "position" = ranked."rn"
FROM ranked
WHERE "waiting_list_entries"."id" = ranked."id";
