-- Additive finance review record. It is deliberately separate from the
-- immutable usage ledger and never changes UsageEvent or rollup quantities.
CREATE TYPE "UsageAdjustmentStatus" AS ENUM (
  'OPEN',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "usage_reconciliation_adjustments" (
  "id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "report_hash" TEXT NOT NULL,
  "evidence_ref" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "restaurant_id" TEXT,
  "category" "UsageCategory" NOT NULL,
  "provider" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "quantity_delta" DECIMAL(18,6) NOT NULL,
  "cost_delta_eur" DECIMAL(18,6) NOT NULL,
  "status" "UsageAdjustmentStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "decision_reason" TEXT,
  "created_by_hash" TEXT NOT NULL,
  "decided_by_hash" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_reconciliation_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_reconciliation_adjustments_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "usage_adjustments_report_dimension_period_key"
  ON "usage_reconciliation_adjustments"(
    "report_hash", "scope_key", "category", "provider", "unit", "period_start", "period_end"
  );
CREATE UNIQUE INDEX "usage_reconciliation_adjustments_idempotency_key_key"
  ON "usage_reconciliation_adjustments"("idempotency_key");
CREATE INDEX "usage_adjustments_status_created_idx"
  ON "usage_reconciliation_adjustments"("status", "created_at");
CREATE INDEX "usage_adjustments_restaurant_period_idx"
  ON "usage_reconciliation_adjustments"("restaurant_id", "period_start", "period_end");
