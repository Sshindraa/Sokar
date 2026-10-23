-- Le journal normal reste append-only. Seule la purge des réservations test
-- expirées (plus de 24 h) peut effacer leurs propres lignes d'audit.
-- Aucun audit existant n'est modifié ou supprimé par cette migration.
CREATE OR REPLACE FUNCTION disallow_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "reservations"
    WHERE "id" = OLD."reservation_id"
      AND "is_test" = true
      AND "created_at" < CURRENT_TIMESTAMP - INTERVAL '24 hours'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'reservation_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
