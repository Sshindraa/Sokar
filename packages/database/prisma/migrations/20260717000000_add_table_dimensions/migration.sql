-- AlterTable
ALTER TABLE "floor_plan_tables" ADD COLUMN "width" INTEGER;

-- AlterTable
ALTER TABLE "floor_plan_tables" ADD COLUMN "height" INTEGER;

-- AlterTable
ALTER TABLE "floor_plan_tables" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;
