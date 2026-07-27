-- Add reminderSentAt to track when expiration reminder was sent
ALTER TABLE "gift_cards" ADD COLUMN "reminder_sent_at" TIMESTAMP;
