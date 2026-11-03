-- Retrait complet de l'intégration Google Agenda (décision du 25/10/2026).
-- Efface définitivement les jetons OAuth et les identifiants d'événements Google.
-- sokar:destructive-ok — retrait de Google Agenda validé par Hamza le 25/10 ; diff = ces 3 colonnes (prisma migrate diff), plus aucun code ne les lit ; sauvegarde Postgres prise par le déploiement.
ALTER TABLE "restaurants" DROP COLUMN "google_calendar_id",
DROP COLUMN "google_refresh_token";

ALTER TABLE "reservations" DROP COLUMN "google_event_id";
