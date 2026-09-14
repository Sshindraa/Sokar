-- P9 local foundation: provider-neutral experiences and scheduled sessions.
-- Prices are snapshots for quoting/reporting only; this migration creates no
-- payment intent, ticketing provider link or public distribution channel.

CREATE TYPE "ExperienceStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "ExperienceSessionStatus" AS ENUM (
  'OPEN',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE "ExperienceReservationStatus" AS ENUM (
  'CONFIRMED',
  'CANCELLED'
);

CREATE TABLE "experiences" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "duration_minutes" INTEGER NOT NULL,
  "price_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "capacity" INTEGER NOT NULL,
  "status" "ExperienceStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "experiences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experiences_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experiences_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT "experiences_name_length_check"
    CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT "experiences_description_length_check"
    CHECK ("description" IS NULL OR length("description") <= 1000),
  CONSTRAINT "experiences_duration_check"
    CHECK ("duration_minutes" BETWEEN 15 AND 1440),
  CONSTRAINT "experiences_price_check"
    CHECK ("price_cents" BETWEEN 0 AND 1000000),
  CONSTRAINT "experiences_currency_check"
    CHECK ("currency" = 'EUR'),
  CONSTRAINT "experiences_capacity_check"
    CHECK ("capacity" BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX "experiences_restaurant_key_key"
  ON "experiences"("restaurant_id", "key");
CREATE INDEX "experiences_restaurant_status_updated_idx"
  ON "experiences"("restaurant_id", "status", "updated_at");

CREATE TABLE "experience_sessions" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "capacity_override" INTEGER,
  "status" "ExperienceSessionStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "experience_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_sessions_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_sessions_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_sessions_time_check"
    CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "experience_sessions_capacity_check"
    CHECK ("capacity_override" IS NULL OR "capacity_override" BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX "experience_sessions_experience_starts_key"
  ON "experience_sessions"("experience_id", "starts_at");
CREATE INDEX "experience_sessions_restaurant_status_starts_idx"
  ON "experience_sessions"("restaurant_id", "status", "starts_at");

CREATE TABLE "experience_reservations" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "reservation_id" TEXT,
  "idempotency_key" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price_cents" INTEGER NOT NULL,
  "total_price_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "ExperienceReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "created_by_hash" TEXT NOT NULL,
  "cancelled_by_hash" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "experience_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_reservations_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_reservations_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_reservations_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "experience_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_reservations_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "experience_reservations_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "experience_reservations_idempotency_key_check"
    CHECK ("idempotency_key" IS NULL OR length("idempotency_key") = 64),
  CONSTRAINT "experience_reservations_quantity_check"
    CHECK ("quantity" BETWEEN 1 AND 1000),
  CONSTRAINT "experience_reservations_unit_price_check"
    CHECK ("unit_price_cents" BETWEEN 0 AND 1000000),
  CONSTRAINT "experience_reservations_total_price_check"
    CHECK ("total_price_cents" BETWEEN 0 AND 1000000000),
  CONSTRAINT "experience_reservations_currency_check"
    CHECK ("currency" = 'EUR')
);

CREATE UNIQUE INDEX "experience_reservations_idempotency_key_key"
  ON "experience_reservations"("idempotency_key");
CREATE INDEX "experience_reservations_restaurant_status_created_idx"
  ON "experience_reservations"("restaurant_id", "status", "created_at");
CREATE INDEX "experience_reservations_session_status_idx"
  ON "experience_reservations"("session_id", "status");
CREATE INDEX "experience_reservations_customer_created_idx"
  ON "experience_reservations"("restaurant_id", "customer_id", "created_at");
