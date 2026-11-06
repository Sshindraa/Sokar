CREATE OR REPLACE FUNCTION invalidate_customer_visit_cache() RETURNS trigger AS $$
DECLARE
  affected_ids TEXT[];
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_test) OR
     (TG_OP = 'DELETE' AND OLD.is_test) OR
     (TG_OP = 'UPDATE' AND OLD.is_test AND NEW.is_test) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND
     ROW(OLD.customer_id, OLD.restaurant_id, OLD.state, OLD.status, OLD.starts_at, OLD.reserved_at, OLD.is_test)
     IS NOT DISTINCT FROM
     ROW(NEW.customer_id, NEW.restaurant_id, NEW.state, NEW.status, NEW.starts_at, NEW.reserved_at, NEW.is_test) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    affected_ids := ARRAY[CASE WHEN NOT NEW.is_test THEN NEW.customer_id END];
  ELSIF TG_OP = 'DELETE' THEN
    affected_ids := ARRAY[CASE WHEN NOT OLD.is_test THEN OLD.customer_id END];
  ELSE
    affected_ids := ARRAY[
      CASE WHEN NOT OLD.is_test THEN OLD.customer_id END,
      CASE WHEN NOT NEW.is_test THEN NEW.customer_id END
    ];
  END IF;

  INSERT INTO "customer_visit_cache_revisions" ("customer_id")
  SELECT id FROM "customers" WHERE id = ANY(affected_ids) ORDER BY id
  ON CONFLICT ("customer_id") DO UPDATE
    SET "version" = EXCLUDED."version";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
