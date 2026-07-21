-- Enable btree_gist extension required for exclusion constraints using uuid equality.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Exclusion constraint to prevent overlapping active reservations on the same table.
-- Wrapped in a DO block so it is idempotent (migration 20260722000000 may have
-- already created it before it was split out into its own migration).
DO $$
BEGIN
  ALTER TABLE "reservations"
    ADD CONSTRAINT "reservations_no_overlap_active"
    EXCLUDE USING gist (
      "table_id" WITH =,
      tsrange("starts_at", "ends_at", '[)') WITH &&
    )
    WHERE (
      "state" IN ('PENDING', 'CONFIRMED', 'SEATED')
      AND "table_id" IS NOT NULL
      AND "starts_at" IS NOT NULL
      AND "ends_at" IS NOT NULL
    );
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN
    -- Constraint/index already exists; nothing to do.
    NULL;
END $$;
