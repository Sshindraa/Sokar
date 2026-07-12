-- Add a non-negative check on gift_cards.remaining_amount as a defense-in-depth
-- against concurrent over-application of gift cards (P0 RES-006).
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_card_remaining_amount_nonnegative" CHECK (remaining_amount >= 0);