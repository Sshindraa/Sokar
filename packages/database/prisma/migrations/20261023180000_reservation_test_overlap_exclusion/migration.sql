-- Les réservations test ne doivent pas occuper une table réelle.
-- Installer d'abord la protection équivalente pour les réservations normales,
-- puis remplacer l'ancienne contrainte dans la même transaction : aucune fenêtre
-- sans protection et aucune ligne modifiée ou supprimée.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap_active_real"
  EXCLUDE USING gist (
    "table_id" WITH =,
    tsrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE (
    "state" IN ('PENDING', 'CONFIRMED', 'SEATED')
    AND "table_id" IS NOT NULL
    AND "starts_at" IS NOT NULL
    AND "ends_at" IS NOT NULL
    AND "is_test" = false
  );

ALTER TABLE "reservations" DROP CONSTRAINT "reservations_no_overlap_active";
ALTER TABLE "reservations"
  RENAME CONSTRAINT "reservations_no_overlap_active_real" TO "reservations_no_overlap_active";
COMMIT;
