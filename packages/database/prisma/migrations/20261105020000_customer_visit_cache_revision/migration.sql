CREATE TABLE "customer_visit_cache_revisions" (
  "customer_id" TEXT NOT NULL,
  -- Une séquence évite de réutiliser une ancienne clé après suppression/recréation du client.
  "version" BIGSERIAL NOT NULL,
  CONSTRAINT "customer_visit_cache_revisions_pkey" PRIMARY KEY ("customer_id"),
  CONSTRAINT "customer_visit_cache_revisions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE FUNCTION invalidate_customer_visit_cache() RETURNS trigger AS $$
DECLARE
  affected_ids TEXT[];
BEGIN
  IF TG_OP = 'UPDATE' AND
     ROW(OLD.customer_id, OLD.restaurant_id, OLD.state, OLD.status, OLD.starts_at, OLD.reserved_at, OLD.is_test)
     IS NOT DISTINCT FROM
     ROW(NEW.customer_id, NEW.restaurant_id, NEW.state, NEW.status, NEW.starts_at, NEW.reserved_at, NEW.is_test) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    affected_ids := ARRAY[NEW.customer_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected_ids := ARRAY[OLD.customer_id];
  ELSE
    affected_ids := ARRAY[OLD.customer_id, NEW.customer_id];
  END IF;

  INSERT INTO "customer_visit_cache_revisions" ("customer_id")
  SELECT id FROM "customers" WHERE id = ANY(affected_ids) ORDER BY id
  ON CONFLICT ("customer_id") DO UPDATE
    SET "version" = EXCLUDED."version";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reservation_visit_cache_revision"
AFTER INSERT OR UPDATE OR DELETE ON "reservations"
FOR EACH ROW EXECUTE FUNCTION invalidate_customer_visit_cache();
