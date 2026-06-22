-- Agentic reservations P0 — colonnes Restaurant + Reservation + enums

-- Extensions d'énum d'état legacy conservées. On ajoute les nouveaux enums.
CREATE TYPE "ReservationState" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'SEATED',
  'HONORED',
  'CANCELLED',
  'NO_SHOW',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "ReservationChannel" AS ENUM (
  'PHONE',
  'WEB',
  'MCP',
  'OPENAI_RESERVE',
  'ADMIN',
  'API'
);

CREATE TYPE "HoldType" AS ENUM (
  'QUOTE',
  'HOLD'
);

CREATE TYPE "HoldStatus" AS ENUM (
  'ACTIVE',
  'CONSUMED',
  'EXPIRED',
  'RELEASED'
);

CREATE TYPE "NoiseLevel" AS ENUM (
  'CALME',
  'MODERE',
  'ANIME'
);

-- Colonnes Restaurant
ALTER TABLE "restaurants"
  ADD COLUMN "slug" TEXT UNIQUE,
  ADD COLUMN "canonical_url" TEXT,
  ADD COLUMN "website_url" TEXT,
  ADD COLUMN "platform_url" TEXT,
  ADD COLUMN "lat" DECIMAL(9, 6),
  ADD COLUMN "lng" DECIMAL(9, 6),
  ADD COLUMN "formatted_address" TEXT,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  ADD COLUMN "phone_e164" TEXT,
  ADD COLUMN "cuisine_type" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "price_range" INTEGER,
  ADD COLUMN "ambiance" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "noise_level" "NoiseLevel",
  ADD COLUMN "dietary" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "attribute_confidence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "agentic_opt_in" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "openai_reserve_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "policy_version" TEXT NOT NULL DEFAULT '2026-06-20';

-- Colonnes Reservation
ALTER TABLE "reservations"
  ADD COLUMN "channel" "ReservationChannel" NOT NULL DEFAULT 'PHONE',
  ADD COLUMN "state" "ReservationState" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "starts_at" TIMESTAMP(3),
  ADD COLUMN "ends_at" TIMESTAMP(3),
  ADD COLUMN "special_requests" TEXT,
  ADD COLUMN "created_by_client" TEXT,
  ADD COLUMN "cancellation_policy_snap" JSONB,
  ADD COLUMN "no_show_policy_snap" JSONB,
  ADD COLUMN "consents" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "privacy_policy_version" TEXT NOT NULL DEFAULT '2026-06-20',
  ADD COLUMN "idempotency_scope" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "idempotency_payload_hash" TEXT,
  ADD COLUMN "consumed_hold_id" TEXT UNIQUE;

CREATE UNIQUE INDEX "reservations_idempotency_scope_idempotency_key_key"
ON "reservations"("idempotency_scope", "idempotency_key")
WHERE "idempotency_scope" IS NOT NULL AND "idempotency_key" IS NOT NULL;
