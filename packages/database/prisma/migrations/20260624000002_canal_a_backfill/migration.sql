-- Canal A — backfill des champs structurés pour le seed "Chez Sokar"
-- Additive: ne force aucune valeur sur les autres restos, ne publie rien.
-- La publication explicite (canal_a_published = true) reste un acte
-- séparé, soit par le seed en NODE_ENV != production, soit par le
-- dashboard en production.

UPDATE "restaurants"
SET
  "description" = 'Cuisine bistrot française soignée, dans une ambiance chaleureuse et branchée. Réservation en ligne via Sokar.',
  "city"        = 'Lyon',
  "postal_code" = '69001',
  "country"     = COALESCE("country", 'FR')
WHERE "slug" = 'chez-sokar-demo';
