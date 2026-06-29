-- Rename Canal A -> Sokar Connect: colonnes de gating sur restaurant_exposure_settings
-- Les anciennes colonnes canal_a_* deviennent connect_*.
-- Idempotent via DO $$ / EXCEPTION WHEN undefined_column.

DO $$
BEGIN
  ALTER TABLE "restaurant_exposure_settings" RENAME COLUMN "canal_a_published"      TO "connect_published";
  ALTER TABLE "restaurant_exposure_settings" RENAME COLUMN "canal_a_agentic"        TO "connect_agentic";
  ALTER TABLE "restaurant_exposure_settings" RENAME COLUMN "canal_a_published_at"   TO "connect_published_at";
  ALTER TABLE "restaurant_exposure_settings" RENAME COLUMN "canal_a_description"    TO "connect_description";
EXCEPTION WHEN undefined_column THEN
  -- Colonnes déjà renommées (re-run) : ne rien faire.
  NULL;
END $$;
