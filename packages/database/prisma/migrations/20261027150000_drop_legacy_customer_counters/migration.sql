-- Retrait des compteurs clients hérités `visit_count` et `loyalty_score` (audit CRM du 27/10/2026).
-- Les visites se calculent désormais depuis les réservations (summarizeLifecycleReservations) et
-- le score de fidélité n'est lu nulle part.
-- sokar:destructive-ok — décision Hamza du 27/10 ; diff = ces 2 colonnes et leur index (prisma migrate diff), plus aucun code ne les lit ni ne les écrit ; sauvegarde Postgres prise par le déploiement.
DROP INDEX IF EXISTS "customers_restaurant_visit_count_idx";

ALTER TABLE "customers" DROP COLUMN "visit_count",
DROP COLUMN "loyalty_score";
