-- Spatial semantics for the floor-plan editor.
-- Zones describe the room areas visible on the plan. Table combinations keep
-- operationally combinable tables together without duplicating table records.

CREATE TABLE "floor_plan_zones" (
  "id" TEXT NOT NULL,
  "floor_plan_id" TEXT NOT NULL,
  "section_id" TEXT,
  "name" TEXT NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "floor_plan_zones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "floor_plan_zones_floor_plan_id_fkey"
    FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "floor_plan_zones_section_id_fkey"
    FOREIGN KEY ("section_id") REFERENCES "floor_plan_sections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "floor_plan_zones_name_check"
    CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT "floor_plan_zones_dimensions_check"
    CHECK ("width" > 0 AND "height" > 0)
);

CREATE INDEX "floor_plan_zones_floor_plan_id_idx"
  ON "floor_plan_zones"("floor_plan_id");
CREATE INDEX "floor_plan_zones_section_id_idx"
  ON "floor_plan_zones"("section_id");

CREATE TABLE "floor_plan_table_combinations" (
  "id" TEXT NOT NULL,
  "floor_plan_id" TEXT NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "floor_plan_table_combinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "floor_plan_table_combinations_floor_plan_id_fkey"
    FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "floor_plan_table_combinations_name_check"
    CHECK ("name" IS NULL OR length("name") BETWEEN 1 AND 120)
);

CREATE INDEX "floor_plan_table_combinations_floor_plan_id_idx"
  ON "floor_plan_table_combinations"("floor_plan_id");

CREATE TABLE "floor_plan_table_combination_members" (
  "combination_id" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  CONSTRAINT "floor_plan_table_combination_members_pkey"
    PRIMARY KEY ("combination_id", "table_id"),
  CONSTRAINT "floor_plan_table_combination_members_combination_id_fkey"
    FOREIGN KEY ("combination_id") REFERENCES "floor_plan_table_combinations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "floor_plan_table_combination_members_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "floor_plan_tables"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "floor_plan_table_combination_members_table_id_idx"
  ON "floor_plan_table_combination_members"("table_id");
