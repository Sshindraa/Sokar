-- P2-01/P2-05: append-only, tenant-scoped proof for manual customer merges.
-- Source profiles remain archived; this table contains only identifiers, hashes
-- and aggregate counters so the operation is reviewable without duplicating PII.

CREATE TABLE "customer_merge_audits" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "target_customer_id" TEXT NOT NULL,
  "source_customer_ids" TEXT[] NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "actor_hash" TEXT NOT NULL,
  "preference_resolution" JSONB NOT NULL DEFAULT '{}',
  "summary" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_merge_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_merge_audits_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_merge_audits_target_customer_id_fkey"
    FOREIGN KEY ("target_customer_id") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_merge_audits_idempotency_key_key"
  ON "customer_merge_audits"("idempotency_key");
CREATE INDEX "customer_merge_audits_restaurant_created_idx"
  ON "customer_merge_audits"("restaurant_id", "created_at" DESC);
CREATE INDEX "customer_merge_audits_target_created_idx"
  ON "customer_merge_audits"("restaurant_id", "target_customer_id", "created_at" DESC);
