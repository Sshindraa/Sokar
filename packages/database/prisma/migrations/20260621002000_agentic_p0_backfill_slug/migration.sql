-- Agentic reservations P0 — backfill Restaurant.slug

-- Génère un slug unique à partir du nom + des 8 premiers caractères de l'id.
-- En cas de collision, ajoute un suffixe numérique.
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR rec IN
    SELECT "id", "name"
    FROM "restaurants"
    WHERE "slug" IS NULL
  LOOP
    base_slug := lower(regexp_replace(rec."name", '[^a-zA-Z0-9]+', '-', 'g'));
    base_slug := regexp_replace(base_slug, '^-|-$', '', 'g');
    IF length(base_slug) = 0 THEN
      base_slug := 'restaurant';
    END IF;
    base_slug := base_slug || '-' || substring(rec."id" from 1 for 8);

    candidate := base_slug;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "restaurants" WHERE "slug" = candidate) LOOP
      candidate := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE "restaurants"
    SET "slug" = candidate
    WHERE "id" = rec."id";
  END LOOP;
END $$;
