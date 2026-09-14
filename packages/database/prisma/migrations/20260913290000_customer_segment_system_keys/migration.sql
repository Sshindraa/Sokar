-- CRM P3-01: stable keys for tenant-scoped system segments.

ALTER TABLE "customer_segments"
  ADD COLUMN "system_key" TEXT;

CREATE UNIQUE INDEX "customer_segments_restaurant_system_key_key"
  ON "customer_segments"("restaurant_id", "system_key");
