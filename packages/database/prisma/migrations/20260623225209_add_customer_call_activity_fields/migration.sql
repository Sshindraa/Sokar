-- Customer call activity tracking
-- Adds lastCallAt (DateTime?) and partySizeTypical (Decimal?) for use by
-- CustomerService.recordCallActivity (telnyx.pipeline.ts:180) and the
-- VIP prompt builder. Both nullable: no backfill required.

ALTER TABLE "customers"
  ADD COLUMN "last_call_at"      TIMESTAMP(3),
  ADD COLUMN "party_size_typical" DECIMAL(5, 2);

-- Lookup pattern: recent activity per restaurant (powers "recents VIP" /
-- dashboard recency widgets). Nullable column → NULLs sort last in DESC by default.
CREATE INDEX "customers_restaurant_last_call_at_idx"
  ON "customers" ("restaurant_id", "last_call_at" DESC);
