-- P9-03 local foundation: provider-neutral distribution contracts.
-- No Google, Meta or partner API is called by this migration or its local
-- services. Sokar remains the source of reservation capacity.

CREATE TYPE "DistributionProvider" AS ENUM ('GOOGLE_RESERVE', 'META_RESERVE', 'PUBLIC_API');
CREATE TYPE "DistributionConnectionStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'ACTIVE', 'PAUSED', 'ERROR');
CREATE TYPE "DistributionSyncDirection" AS ENUM ('PUSH', 'PULL', 'BIDIRECTIONAL');
CREATE TYPE "DistributionSyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "DistributionReservationLinkStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'NEEDS_REVIEW');
CREATE TYPE "DistributionWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "distribution_connections" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "provider" "DistributionProvider" NOT NULL,
  "external_account_hash" TEXT,
  "external_account_last4" TEXT,
  "credential_ref" TEXT,
  "config_hash" TEXT NOT NULL,
  "status" "DistributionConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "cursor" TEXT,
  "last_sync_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "connected_at" TIMESTAMP(3),
  "disconnected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_connections_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_connections_external_hash_check"
    CHECK ("external_account_hash" IS NULL OR length("external_account_hash") = 64),
  CONSTRAINT "distribution_connections_external_last4_check"
    CHECK ("external_account_last4" IS NULL OR length("external_account_last4") = 4),
  CONSTRAINT "distribution_connections_config_hash_check"
    CHECK (length("config_hash") = 64),
  CONSTRAINT "distribution_connections_credential_ref_check"
    CHECK ("credential_ref" IS NULL OR length("credential_ref") BETWEEN 1 AND 200),
  CONSTRAINT "distribution_connections_error_code_check"
    CHECK ("last_error_code" IS NULL OR length("last_error_code") BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX "distribution_connections_restaurant_provider_key"
  ON "distribution_connections"("restaurant_id", "provider");
CREATE INDEX "distribution_connections_restaurant_status_updated_idx"
  ON "distribution_connections"("restaurant_id", "status", "updated_at");

CREATE TABLE "distribution_sync_runs" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "direction" "DistributionSyncDirection" NOT NULL,
  "status" "DistributionSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotency_key" TEXT NOT NULL,
  "actor_hash" TEXT,
  "window_start" TIMESTAMP(3),
  "window_end" TIMESTAMP(3),
  "source_cursor" TEXT,
  "target_cursor" TEXT,
  "pushed_count" INTEGER NOT NULL DEFAULT 0,
  "pulled_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "payload_hash" TEXT,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_sync_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_sync_runs_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_sync_runs_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "distribution_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_sync_runs_idempotency_check"
    CHECK (length("idempotency_key") = 64),
  CONSTRAINT "distribution_sync_runs_actor_hash_check"
    CHECK ("actor_hash" IS NULL OR length("actor_hash") = 64),
  CONSTRAINT "distribution_sync_runs_payload_hash_check"
    CHECK ("payload_hash" IS NULL OR length("payload_hash") = 64),
  CONSTRAINT "distribution_sync_runs_window_check"
    CHECK ("window_start" IS NULL OR "window_end" IS NULL OR "window_end" > "window_start"),
  CONSTRAINT "distribution_sync_runs_counts_check"
    CHECK ("pushed_count" >= 0 AND "pulled_count" >= 0 AND "failed_count" >= 0),
  CONSTRAINT "distribution_sync_runs_finished_check"
    CHECK ("finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at")
);
CREATE UNIQUE INDEX "distribution_sync_runs_idempotency_key_key"
  ON "distribution_sync_runs"("idempotency_key");
CREATE INDEX "distribution_sync_runs_restaurant_created_idx"
  ON "distribution_sync_runs"("restaurant_id", "created_at" DESC);
CREATE INDEX "distribution_sync_runs_connection_status_created_idx"
  ON "distribution_sync_runs"("connection_id", "status", "created_at" DESC);

CREATE TABLE "distribution_availability_snapshots" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "slot_key" TEXT NOT NULL,
  "service_date" DATE NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "party_size" INTEGER NOT NULL,
  "available" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "source_revision" TEXT,
  "payload_hash" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_availability_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_availability_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_availability_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "distribution_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_availability_slot_key_check"
    CHECK (length("slot_key") BETWEEN 1 AND 160),
  CONSTRAINT "distribution_availability_time_check"
    CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "distribution_availability_party_size_check"
    CHECK ("party_size" BETWEEN 1 AND 100),
  CONSTRAINT "distribution_availability_capacity_check"
    CHECK ("capacity" BETWEEN 0 AND 10000 AND "available" BETWEEN 0 AND "capacity"),
  CONSTRAINT "distribution_availability_payload_hash_check"
    CHECK (length("payload_hash") = 64)
);
CREATE UNIQUE INDEX "distribution_availability_connection_slot_key"
  ON "distribution_availability_snapshots"("connection_id", "slot_key");
CREATE INDEX "distribution_availability_restaurant_date_starts_idx"
  ON "distribution_availability_snapshots"("restaurant_id", "service_date", "starts_at");
CREATE INDEX "distribution_availability_connection_observed_idx"
  ON "distribution_availability_snapshots"("connection_id", "observed_at");

CREATE TABLE "distribution_reservation_links" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "external_id_hash" TEXT NOT NULL,
  "external_id_last4" TEXT NOT NULL,
  "status" "DistributionReservationLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unlinked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_reservation_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_reservation_links_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_reservation_links_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "distribution_connections"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_reservation_links_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_reservation_links_external_hash_check"
    CHECK (length("external_id_hash") = 64),
  CONSTRAINT "distribution_reservation_links_external_last4_check"
    CHECK (length("external_id_last4") = 4),
  CONSTRAINT "distribution_reservation_links_source_check"
    CHECK (length("source") BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "distribution_reservation_links_connection_external_key"
  ON "distribution_reservation_links"("connection_id", "external_id_hash");
CREATE UNIQUE INDEX "distribution_reservation_links_connection_reservation_key"
  ON "distribution_reservation_links"("connection_id", "reservation_id");
CREATE INDEX "distribution_reservation_links_restaurant_status_updated_idx"
  ON "distribution_reservation_links"("restaurant_id", "status", "updated_at");

CREATE TABLE "distribution_webhook_events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "connection_id" TEXT,
  "provider" "DistributionProvider" NOT NULL,
  "external_event_hash" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "status" "DistributionWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "error_code" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "distribution_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_webhook_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_webhook_events_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "distribution_connections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "distribution_webhook_events_external_hash_check"
    CHECK (length("external_event_hash") = 64),
  CONSTRAINT "distribution_webhook_events_type_check"
    CHECK (length("event_type") BETWEEN 1 AND 120),
  CONSTRAINT "distribution_webhook_events_payload_hash_check"
    CHECK (length("payload_hash") = 64),
  CONSTRAINT "distribution_webhook_events_error_code_check"
    CHECK ("error_code" IS NULL OR length("error_code") BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX "distribution_webhooks_restaurant_provider_external_key"
  ON "distribution_webhook_events"("restaurant_id", "provider", "external_event_hash");
CREATE INDEX "distribution_webhooks_restaurant_status_received_idx"
  ON "distribution_webhook_events"("restaurant_id", "status", "received_at");
