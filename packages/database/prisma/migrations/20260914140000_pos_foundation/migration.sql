-- P6-02/P6-03: provider-neutral POS connection, ticket projection and
-- explainable reservation matching. No provider credentials or raw payloads
-- are stored by this migration.

CREATE TYPE "PosConnectionStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'DISCONNECTED'
);

CREATE TABLE "pos_connections" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_location_id" TEXT NOT NULL,
  "credential_reference" TEXT NOT NULL,
  "status" "PosConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "cursor" TEXT,
  "last_success_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_connections_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pos_connections_restaurant_provider_key"
  ON "pos_connections"("restaurant_id", "provider");
CREATE INDEX "pos_connections_status_last_success_idx"
  ON "pos_connections"("status", "last_success_at");

CREATE TABLE "pos_checks" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "external_revision" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL,
  "closed_at" TIMESTAMP(3),
  "table_reference" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax" DECIMAL(12,2) NOT NULL,
  "tip" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL,
  "raw_payload_hash" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_checks_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_checks_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "pos_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_checks_amounts_nonnegative_check"
    CHECK ("subtotal" >= 0 AND "tax" >= 0 AND "tip" >= 0 AND "discount" >= 0
      AND "total" >= 0 AND "refunded_amount" >= 0),
  CONSTRAINT "pos_checks_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "pos_checks_connection_external_key"
  ON "pos_checks"("connection_id", "external_id");
CREATE INDEX "pos_checks_restaurant_closed_idx"
  ON "pos_checks"("restaurant_id", "closed_at");

CREATE TABLE "reservation_check_matches" (
  "restaurant_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "pos_check_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "status" TEXT NOT NULL,
  "reviewed_by_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reservation_check_matches_pkey" PRIMARY KEY ("reservation_id", "pos_check_id"),
  CONSTRAINT "reservation_check_matches_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_check_matches_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_check_matches_pos_check_id_fkey"
    FOREIGN KEY ("pos_check_id") REFERENCES "pos_checks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_check_matches_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "reservation_check_matches_status_check"
    CHECK ("status" IN ('MATCHED', 'REVIEW', 'UNMATCHED'))
);

CREATE INDEX "reservation_check_matches_status_confidence_idx"
  ON "reservation_check_matches"("status", "confidence");
CREATE INDEX "reservation_check_matches_restaurant_status_idx"
  ON "reservation_check_matches"("restaurant_id", "status");
