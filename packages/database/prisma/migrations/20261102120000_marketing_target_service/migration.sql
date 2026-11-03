-- Remplissage d'un service creux : service visé par une campagne (additif, nullable).
ALTER TABLE "marketing_campaigns"
  ADD COLUMN "target_service_start" TIMESTAMP(3),
  ADD COLUMN "target_service_end" TIMESTAMP(3);
