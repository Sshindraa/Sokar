-- Scale indexes for tenant-scoped dashboard/analytics queries.
-- Keep names explicit so Prisma schema and production DB stay aligned.

CREATE INDEX IF NOT EXISTS "calls_restaurant_outcome_created_at_idx"
  ON "calls" ("restaurant_id", "outcome", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "reservations_restaurant_status_reserved_at_idx"
  ON "reservations" ("restaurant_id", "status", "reserved_at");

CREATE INDEX IF NOT EXISTS "reservations_customer_id_idx"
  ON "reservations" ("customer_id");

CREATE INDEX IF NOT EXISTS "reservations_restaurant_customer_id_idx"
  ON "reservations" ("restaurant_id", "customer_id");

CREATE INDEX IF NOT EXISTS "customers_restaurant_visit_count_idx"
  ON "customers" ("restaurant_id", "visit_count" DESC);
