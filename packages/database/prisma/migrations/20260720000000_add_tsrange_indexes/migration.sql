-- GiST expression indexes on table time ranges to speed up overlap checks
-- in TableAllocationService (reservations and active agentic_holds).
-- Note: expires_at > NOW() is intentionally evaluated only at query time,
-- not in the partial index predicate, to avoid unsafe time-based filtering.

-- CreateIndex
CREATE INDEX "reservations_table_tsrange_idx"
  ON "reservations" USING GIST (tsrange("starts_at", "ends_at"))
  WHERE "table_id" IS NOT NULL
    AND "starts_at" IS NOT NULL
    AND "ends_at" IS NOT NULL
    AND "state" IN ('PENDING', 'CONFIRMED', 'SEATED');

-- CreateIndex
CREATE INDEX "agentic_holds_table_tsrange_idx"
  ON "agentic_holds" USING GIST (tsrange("slot_start", "slot_end"))
  WHERE "table_id" IS NOT NULL
    AND "status" = 'ACTIVE';
