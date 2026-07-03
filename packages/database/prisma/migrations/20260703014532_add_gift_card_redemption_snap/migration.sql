-- Ajoute le snapshot de redemption carte cadeau sur Reservation (P1).
ALTER TABLE "reservations" ADD COLUMN "gift_card_redemption_snap" JSONB;
