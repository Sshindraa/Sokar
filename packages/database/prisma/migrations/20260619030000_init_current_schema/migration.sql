-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('ESSENTIAL', 'STARTER', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "CallIntent" AS ENUM ('RESERVATION', 'HOURS', 'MENU', 'CANCEL', 'OTHER');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('RESERVED', 'INFO', 'NO_ACTION', 'HANDOFF', 'ERROR');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'NO_SHOW', 'SEATED');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('BISTROT_BRASSERIE', 'GASTRONOMIQUE', 'SEMI_GASTRO');

-- CreateEnum
CREATE TYPE "FillerStyle" AS ENUM ('CASUAL', 'FORMAL', 'WARM');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'STARTER',
    "manager_phone" TEXT NOT NULL,
    "manager_email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "opening_hours" JSONB NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT 'vapi',
    "sms_confirm_enabled" BOOLEAN NOT NULL DEFAULT true,
    "thefork_savings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "google_calendar_id" TEXT,
    "google_refresh_token" TEXT,
    "onboarding_tasks" JSONB NOT NULL DEFAULT '{}',
    "onboarding_done" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_completed_at" TIMESTAMP(3),
    "onboarding_activated_at" TIMESTAMP(3),
    "onboarding_last_seen_at" TIMESTAMP(3),
    "first_call_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "call_sid" TEXT NOT NULL,
    "duration_sec" INTEGER,
    "transcript" TEXT,
    "intent" "CallIntent",
    "outcome" "CallOutcome",
    "stt_provider" TEXT,
    "llm_provider" TEXT,
    "tts_provider" TEXT,
    "carrier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "call_id" TEXT,
    "customer_id" TEXT,
    "reserved_at" TIMESTAMP(3) NOT NULL,
    "party_size" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "estimated_revenue" DECIMAL(10,2),
    "confirmed_revenue" DECIMAL(10,2),
    "google_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_personalities" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "profile_type" "ProfileType" NOT NULL DEFAULT 'BISTROT_BRASSERIE',
    "speaking_rate" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "pitch_shift" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "filler_style" "FillerStyle" NOT NULL DEFAULT 'CASUAL',
    "microphone_threshold" INTEGER NOT NULL DEFAULT -42,
    "target_latency_ms" INTEGER NOT NULL DEFAULT 140,
    "system_prompt_extra" TEXT,
    "voice_id_ca" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_personalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_quotas" (
    "restaurant_id" TEXT NOT NULL,
    "month_key" TEXT NOT NULL,
    "call_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "call_quotas_pkey" PRIMARY KEY ("restaurant_id","month_key")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "loyalty_score" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_vip" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "special_occasion" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "latency_traces" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "vad_end_ms" INTEGER,
    "stt_final_ms" INTEGER,
    "llm_first_token_ms" INTEGER,
    "tts_first_byte_ms" INTEGER,
    "audio_playing_ms" INTEGER,
    "total_e2e_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "latency_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_phone_number_key" ON "restaurants"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "calls_call_sid_key" ON "calls"("call_sid");

-- CreateIndex
CREATE INDEX "calls_restaurant_id_created_at_idx" ON "calls"("restaurant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_call_id_key" ON "reservations"("call_id");

-- CreateIndex
CREATE INDEX "reservations_restaurant_id_created_at_idx" ON "reservations"("restaurant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reservations_restaurant_id_status_created_at_idx" ON "reservations"("restaurant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reservations_restaurant_id_reserved_at_idx" ON "reservations"("restaurant_id", "reserved_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_personalities_restaurant_id_key" ON "agent_personalities"("restaurant_id");

-- CreateIndex
CREATE INDEX "customers_restaurant_id_is_vip_idx" ON "customers"("restaurant_id", "is_vip");

-- CreateIndex
CREATE UNIQUE INDEX "customers_restaurant_id_phone_key" ON "customers"("restaurant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "latency_traces_call_id_key" ON "latency_traces"("call_id");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_personalities" ADD CONSTRAINT "agent_personalities_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_quotas" ADD CONSTRAINT "call_quotas_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "latency_traces" ADD CONSTRAINT "latency_traces_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

