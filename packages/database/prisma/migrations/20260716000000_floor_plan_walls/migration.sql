-- AlterTable
ALTER TABLE "floor_plans" ADD COLUMN "width" INTEGER NOT NULL DEFAULT 1400;

-- AlterTable
ALTER TABLE "floor_plans" ADD COLUMN "height" INTEGER NOT NULL DEFAULT 900;

-- CreateTable
CREATE TABLE "floor_plan_walls" (
    "id" TEXT NOT NULL,
    "floor_plan_id" TEXT NOT NULL,
    "x1" INTEGER NOT NULL,
    "y1" INTEGER NOT NULL,
    "x2" INTEGER NOT NULL,
    "y2" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'wall',
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plan_walls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "floor_plan_walls_floor_plan_id_idx" ON "floor_plan_walls"("floor_plan_id");

-- AddForeignKey
ALTER TABLE "floor_plan_walls" ADD CONSTRAINT "floor_plan_walls_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
