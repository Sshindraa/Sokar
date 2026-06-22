-- Agentic reservations P0 — nouveaux modèles

CREATE TABLE "agentic_holds" (
  "id"              TEXT NOT NULL,
  "restaurant_id"   TEXT NOT NULL,
  "type"            "HoldType" NOT NULL,
  "party_size"      INTEGER NOT NULL,
  "slot_start"      TIMESTAMP(3) NOT NULL,
  "slot_end"        TIMESTAMP(3) NOT NULL,
  "channel"         "ReservationChannel" NOT NULL,
  "quote_token"     TEXT UNIQUE,
  "hold_token"      TEXT UNIQUE,
  "expires_at"      TIMESTAMP(3) NOT NULL,
  "consumed_at"     TIMESTAMP(3),
  "status"          "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "policy_version"  TEXT NOT NULL,
  "reservation_id"  TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agentic_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agentic_holds_restaurant_id_slot_start_idx" ON "agentic_holds"("restaurant_id", "slot_start");
CREATE INDEX "agentic_holds_expires_at_idx" ON "agentic_holds"("expires_at");

ALTER TABLE "agentic_holds"
  ADD CONSTRAINT "agentic_holds_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reservation_audit_log" (
  "id"              TEXT NOT NULL,
  "reservation_id"  TEXT,
  "hold_id"         TEXT,
  "actor"           TEXT NOT NULL,
  "actor_hash"      TEXT,
  "event"           TEXT NOT NULL,
  "from_state"      TEXT,
  "to_state"        TEXT,
  "metadata"        JSONB NOT NULL DEFAULT '{}',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reservation_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reservation_audit_log_reservation_id_created_at_idx" ON "reservation_audit_log"("reservation_id", "created_at");
CREATE INDEX "reservation_audit_log_created_at_idx" ON "reservation_audit_log"("created_at");

ALTER TABLE "reservation_audit_log"
  ADD CONSTRAINT "reservation_audit_log_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "idempotency_records" (
  "scope"           TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "payload_hash"    TEXT NOT NULL,
  "reservation_id"  TEXT,
  "status"          TEXT NOT NULL,
  "response_hash"   TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope", "key")
);

CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

CREATE TABLE "customer_consents" (
  "id"                       TEXT NOT NULL,
  "restaurant_id"            TEXT NOT NULL,
  "customer_id"              TEXT,
  "reservation_id"           TEXT,
  "subject_hash"             TEXT NOT NULL,
  "channel"                  "ReservationChannel" NOT NULL,
  "context"                  TEXT NOT NULL,
  "reservation_processing"   BOOLEAN NOT NULL,
  "transactional_sms"        BOOLEAN NOT NULL,
  "transactional_email"      BOOLEAN NOT NULL,
  "marketing_opt_in"         BOOLEAN NOT NULL,
  "privacy_policy_version"   TEXT NOT NULL,
  "consented_at"             TIMESTAMP(3) NOT NULL,
  "consent_ip_hash"          TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_consents_restaurant_id_subject_hash_idx" ON "customer_consents"("restaurant_id", "subject_hash");
CREATE INDEX "customer_consents_reservation_id_idx" ON "customer_consents"("reservation_id");
CREATE INDEX "customer_consents_created_at_idx" ON "customer_consents"("created_at");

CREATE TABLE "restaurant_exposure_settings" (
  "restaurant_id"              TEXT NOT NULL,
  "mcp_enabled"                BOOLEAN NOT NULL DEFAULT false,
  "openai_reserve_enabled"     BOOLEAN NOT NULL DEFAULT false,
  "exposed_creneaux"           JSONB NOT NULL DEFAULT '[]',
  "max_party_size"             INTEGER NOT NULL DEFAULT 12,
  "min_lead_time_minutes"      INTEGER NOT NULL DEFAULT 30,
  "require_manual_validation"  BOOLEAN NOT NULL DEFAULT false,
  "quote_ttl_seconds"          INTEGER NOT NULL DEFAULT 300,
  "hold_ttl_seconds"           INTEGER NOT NULL DEFAULT 420,
  "no_show_policy"             TEXT NOT NULL DEFAULT 'warning',
  "notification_channels"      TEXT[] NOT NULL DEFAULT '{"sms","email"}',
  "capacity_specials"          JSONB NOT NULL DEFAULT '{}',
  "updated_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "restaurant_exposure_settings_pkey" PRIMARY KEY ("restaurant_id")
);

ALTER TABLE "restaurant_exposure_settings"
  ADD CONSTRAINT "restaurant_exposure_settings_restaurant_id_fkey"
  FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
