-- Additive: preserve the previously universal Copilot access at rollout.
-- New restaurants default to the commercial plan's capability; no plan is changed.
BEGIN;
ALTER TABLE "restaurants" ADD COLUMN "service_copilot_legacy_access" BOOLEAN NOT NULL DEFAULT false;
UPDATE "restaurants" SET "service_copilot_legacy_access" = true;
COMMIT;
