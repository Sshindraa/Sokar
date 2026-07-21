-- AlterTable
ALTER TABLE "floor_plans" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "floor_plans" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Backfill existing rows (safety net in case defaults were not applied)
UPDATE "floor_plans" SET "is_default" = true, "is_active" = true WHERE "is_default" IS NULL;

-- CreatePartialUniqueIndex
CREATE UNIQUE INDEX "floor_plans_restaurant_id_default_unique" ON "floor_plans"("restaurant_id") WHERE "is_default" = true;

-- CreateIndex
CREATE INDEX "floor_plans_restaurant_id_is_default_idx" ON "floor_plans"("restaurant_id", "is_default");

-- CreateIndex
CREATE INDEX "floor_plans_restaurant_id_is_active_idx" ON "floor_plans"("restaurant_id", "is_active");

-- DropIndex
DROP INDEX "floor_plans_restaurant_id_key";
