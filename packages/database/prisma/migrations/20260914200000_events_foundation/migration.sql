-- P9-02 local foundation: provider-neutral event ticketing.
-- Orders reserve one shared session capacity; payment and distribution remain
-- deliberately outside this migration.

CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "EventSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE "EventTicketTypeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "EventOrderStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "EventTicketStatus" AS ENUM ('ISSUED', 'CHECKED_IN', 'CANCELLED', 'REFUNDED');
CREATE TYPE "EventWaitlistStatus" AS ENUM ('WAITING', 'PROMOTED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "events_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT "events_name_length_check"
    CHECK (length("name") BETWEEN 1 AND 160),
  CONSTRAINT "events_description_length_check"
    CHECK ("description" IS NULL OR length("description") <= 2000),
  CONSTRAINT "events_timezone_length_check"
    CHECK (length("timezone") BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX "events_restaurant_key_key"
  ON "events"("restaurant_id", "key");
CREATE INDEX "events_restaurant_status_updated_idx"
  ON "events"("restaurant_id", "status", "updated_at");

CREATE TABLE "event_sessions" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER NOT NULL,
  "status" "EventSessionStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_sessions_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_sessions_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_sessions_time_check"
    CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "event_sessions_capacity_check"
    CHECK ("capacity" BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX "event_sessions_event_starts_key"
  ON "event_sessions"("event_id", "starts_at");
CREATE INDEX "event_sessions_restaurant_status_starts_idx"
  ON "event_sessions"("restaurant_id", "status", "starts_at");

CREATE TABLE "event_ticket_types" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "max_per_order" INTEGER NOT NULL DEFAULT 10,
  "status" "EventTicketTypeStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_ticket_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_ticket_types_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_ticket_types_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_ticket_types_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9_.-]{1,47}$'),
  CONSTRAINT "event_ticket_types_name_length_check"
    CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT "event_ticket_types_price_check"
    CHECK ("price_cents" BETWEEN 0 AND 1000000),
  CONSTRAINT "event_ticket_types_currency_check"
    CHECK ("currency" = 'EUR'),
  CONSTRAINT "event_ticket_types_max_per_order_check"
    CHECK ("max_per_order" BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX "event_ticket_types_event_key_key"
  ON "event_ticket_types"("event_id", "key");
CREATE INDEX "event_ticket_types_restaurant_event_status_idx"
  ON "event_ticket_types"("restaurant_id", "event_id", "status");

CREATE TABLE "event_orders" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "ticket_type_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "reservation_id" TEXT,
  "idempotency_key" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price_cents" INTEGER NOT NULL,
  "total_price_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "EventOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
  "invoice_number" TEXT,
  "invoiced_at" TIMESTAMP(3),
  "refund_idempotency_key" TEXT,
  "refund_reason" TEXT,
  "refunded_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_orders_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_orders_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_orders_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_orders_ticket_type_id_fkey"
    FOREIGN KEY ("ticket_type_id") REFERENCES "event_ticket_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "event_orders_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "event_orders_quantity_check"
    CHECK ("quantity" BETWEEN 1 AND 100),
  CONSTRAINT "event_orders_unit_price_check"
    CHECK ("unit_price_cents" BETWEEN 0 AND 1000000),
  CONSTRAINT "event_orders_total_price_check"
    CHECK ("total_price_cents" BETWEEN 0 AND 100000000),
  CONSTRAINT "event_orders_currency_check"
    CHECK ("currency" = 'EUR'),
  CONSTRAINT "event_orders_refund_reason_length_check"
    CHECK ("refund_reason" IS NULL OR length("refund_reason") <= 1000)
);

CREATE UNIQUE INDEX "event_orders_idempotency_key_key"
  ON "event_orders"("idempotency_key");
CREATE UNIQUE INDEX "event_orders_invoice_number_key"
  ON "event_orders"("invoice_number");
CREATE UNIQUE INDEX "event_orders_refund_idempotency_key_key"
  ON "event_orders"("refund_idempotency_key");
CREATE INDEX "event_orders_restaurant_status_created_idx"
  ON "event_orders"("restaurant_id", "status", "created_at");
CREATE INDEX "event_orders_session_status_idx"
  ON "event_orders"("session_id", "status");
CREATE INDEX "event_orders_customer_created_idx"
  ON "event_orders"("restaurant_id", "customer_id", "created_at");

CREATE TABLE "event_tickets" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "ticket_type_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "code_last4" TEXT NOT NULL,
  "status" "EventTicketStatus" NOT NULL DEFAULT 'ISSUED',
  "checked_in_at" TIMESTAMP(3),
  "checked_in_by_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_tickets_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_tickets_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_tickets_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_tickets_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "event_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_tickets_ticket_type_id_fkey"
    FOREIGN KEY ("ticket_type_id") REFERENCES "event_ticket_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_tickets_code_hash_check"
    CHECK (length("code_hash") = 64),
  CONSTRAINT "event_tickets_code_last4_check"
    CHECK (length("code_last4") = 4)
);

CREATE UNIQUE INDEX "event_tickets_code_hash_key"
  ON "event_tickets"("code_hash");
CREATE INDEX "event_tickets_restaurant_session_status_idx"
  ON "event_tickets"("restaurant_id", "session_id", "status");
CREATE INDEX "event_tickets_order_idx"
  ON "event_tickets"("order_id");

CREATE TABLE "event_waitlist_entries" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" TEXT,
  "status" "EventWaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "promoted_at" TIMESTAMP(3),
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_waitlist_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_waitlist_entries_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_waitlist_entries_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_waitlist_entries_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_waitlist_entries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "event_waitlist_entries_quantity_check"
    CHECK ("quantity" BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX "event_waitlist_entries_idempotency_key_key"
  ON "event_waitlist_entries"("idempotency_key");
CREATE INDEX "event_waitlist_session_status_created_idx"
  ON "event_waitlist_entries"("restaurant_id", "session_id", "status", "created_at");
CREATE INDEX "event_waitlist_customer_created_idx"
  ON "event_waitlist_entries"("restaurant_id", "customer_id", "created_at");

ALTER TABLE "marketing_campaigns"
  ADD COLUMN "event_id" TEXT;
ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "marketing_campaigns_event_idx"
  ON "marketing_campaigns"("event_id");
