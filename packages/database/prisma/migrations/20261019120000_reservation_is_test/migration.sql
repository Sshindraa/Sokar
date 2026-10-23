-- Réservations test lancées depuis le tableau de bord (parcours client réel, sans effet sur le restaurant).
--
-- Migration additive uniquement : une colonne booléenne avec valeur par défaut `false`, donc aucune
-- réservation existante n'est modifiée ni relue. L'index partiel ne couvre que les lignes de test,
-- pour que la purge horaire (réservations test créées il y a plus de 24 h) reste bon marché.

ALTER TABLE "reservations" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "reservations_test_created_at_idx" ON "reservations" ("created_at") WHERE "is_test";
