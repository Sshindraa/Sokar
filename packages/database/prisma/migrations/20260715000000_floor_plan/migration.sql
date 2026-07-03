-- CreateTable
CREATE TABLE "floor_plans" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Salle principale',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "floor_plans_restaurant_id_key" ON "floor_plans"("restaurant_id");

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "floor_plan_sections" (
    "id" TEXT NOT NULL,
    "floor_plan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plan_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "floor_plan_sections_floor_plan_id_position_idx" ON "floor_plan_sections"("floor_plan_id", "position");

-- AddForeignKey
ALTER TABLE "floor_plan_sections" ADD CONSTRAINT "floor_plan_sections_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "floor_plan_tables" (
    "id" TEXT NOT NULL,
    "floor_plan_id" TEXT NOT NULL,
    "section_id" TEXT,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "min_capacity" INTEGER NOT NULL DEFAULT 1,
    "position_x" INTEGER,
    "position_y" INTEGER,
    "shape" TEXT NOT NULL DEFAULT 'rect',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plan_tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "floor_plan_tables_floor_plan_id_is_active_idx" ON "floor_plan_tables"("floor_plan_id", "is_active");
CREATE INDEX "floor_plan_tables_floor_plan_id_is_active_capacity_idx" ON "floor_plan_tables"("floor_plan_id", "is_active", "capacity");
CREATE INDEX "floor_plan_tables_section_id_idx" ON "floor_plan_tables"("section_id");

-- AddForeignKey
ALTER TABLE "floor_plan_tables" ADD CONSTRAINT "floor_plan_tables_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "floor_plan_tables" ADD CONSTRAINT "floor_plan_tables_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "floor_plan_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN "table_id" TEXT;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "floor_plan_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "reservations_restaurant_id_table_id_starts_at_idx" ON "reservations"("restaurant_id", "table_id", "starts_at");
CREATE INDEX "reservations_table_id_starts_at_idx" ON "reservations"("table_id", "starts_at");

-- AlterTable
ALTER TABLE "agentic_holds" ADD COLUMN "table_id" TEXT;

-- AddForeignKey
ALTER TABLE "agentic_holds" ADD CONSTRAINT "agentic_holds_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "floor_plan_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "agentic_holds_table_id_slot_start_idx" ON "agentic_holds"("table_id", "slot_start");
