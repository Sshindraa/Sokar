-- Retrait complet de l'intégration Google Agenda (décision du 25/10/2026).
-- Efface définitivement les jetons OAuth et les identifiants d'événements Google.
ALTER TABLE "restaurants" DROP COLUMN "google_calendar_id",
DROP COLUMN "google_refresh_token";

ALTER TABLE "reservations" DROP COLUMN "google_event_id";
