-- Service Copilot V1 quality loop: recommendation occurrences and append-only
-- telemetry events. This migration is additive and does not alter reservations.
CREATE TYPE "CopilotOccurrenceStatus" AS ENUM (
  'OBSERVED',
  'OPENED',
  'APPLIED',
  'REVERTED',
  'CONFLICTED',
  'EXPIRED',
  'IGNORED'
);

CREATE TYPE "CopilotTelemetryEventType" AS ENUM (
  'VIEWED',
  'OPENED',
  'APPLIED',
  'REVERTED',
  'CONFLICTED',
  'EXPIRED',
  'IGNORED'
);

CREATE TABLE "copilot_occurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "restaurant_id" TEXT NOT NULL,
  "occurrence_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "entity_id" TEXT,
  "rule_version" TEXT NOT NULL,
  "is_shadow" BOOLEAN NOT NULL DEFAULT true,
  "status" "CopilotOccurrenceStatus" NOT NULL DEFAULT 'OBSERVED',
  "eligible_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "copilot_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_occurrences_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "copilot_telemetry_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "occurrence_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "event" "CopilotTelemetryEventType" NOT NULL,
  "reason_code" TEXT,
  "actor_hash" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "client_time" TIMESTAMP(3),
  "server_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_telemetry_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_telemetry_events_occurrence_id_fkey"
    FOREIGN KEY ("occurrence_id") REFERENCES "copilot_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "copilot_occurrences_restaurant_id_occurrence_key_key"
  ON "copilot_occurrences"("restaurant_id", "occurrence_key");
CREATE INDEX "copilot_occurrences_restaurant_id_kind_status_idx"
  ON "copilot_occurrences"("restaurant_id", "kind", "status");
CREATE INDEX "copilot_occurrences_restaurant_id_expires_at_idx"
  ON "copilot_occurrences"("restaurant_id", "expires_at");
CREATE UNIQUE INDEX "copilot_telemetry_events_idempotency_key_key"
  ON "copilot_telemetry_events"("idempotency_key");
CREATE INDEX "copilot_telemetry_events_occurrence_id_event_idx"
  ON "copilot_telemetry_events"("occurrence_id", "event");
CREATE INDEX "copilot_telemetry_events_server_time_idx"
  ON "copilot_telemetry_events"("server_time");
