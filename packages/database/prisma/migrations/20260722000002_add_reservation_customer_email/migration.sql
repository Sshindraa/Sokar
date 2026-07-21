-- Add customer email to reservations (populated when promoting from waiting list).
ALTER TABLE "reservations" ADD COLUMN "customer_email" TEXT;
