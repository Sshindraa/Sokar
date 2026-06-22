-- Agentic reservations P0 -- contraintes et triggers

-- Partial unique index : un seul hold actif par (restaurant, slot, party_size)
CREATE UNIQUE INDEX "one_active_hold_per_slot"
ON "agentic_holds" ("restaurant_id", "slot_start", "party_size")
WHERE "status" = 'ACTIVE' AND "type" = 'HOLD';

-- Trigger append-only sur reservation_audit_log
CREATE OR REPLACE FUNCTION disallow_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'reservation_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reservation_audit_log_append_only"
BEFORE UPDATE OR DELETE ON "reservation_audit_log"
FOR EACH ROW EXECUTE FUNCTION disallow_audit_modification();
