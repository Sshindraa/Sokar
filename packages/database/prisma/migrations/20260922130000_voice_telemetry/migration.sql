-- Additive voice observability model.
-- The legacy latency_traces row stays in place for existing consumers;
-- these tables retain every turn and the call-level rollup independently.

CREATE TABLE "voice_call_telemetry" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "llm_provider" TEXT,
    "llm_model" TEXT,
    "total_speech_ms" INTEGER,
    "total_transcription_ms" INTEGER,
    "total_llm_ms" INTEGER,
    "total_availability_ms" INTEGER,
    "total_tts_ms" INTEGER,
    "first_llm_first_token_ms" INTEGER,
    "first_llm_first_phrase_ms" INTEGER,
    "first_tts_first_audio_ms" INTEGER,
    "first_stt_final_to_audio_ms" INTEGER,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "llm_turn_count" INTEGER NOT NULL DEFAULT 0,
    "deterministic_turn_count" INTEGER NOT NULL DEFAULT 0,
    "fallback_turn_count" INTEGER NOT NULL DEFAULT 0,
    "availability_search_count" INTEGER NOT NULL DEFAULT 0,
    "availability_failure_count" INTEGER NOT NULL DEFAULT 0,
    "loop_count" INTEGER NOT NULL DEFAULT 0,
    "reservation_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "reservation_intent_abandoned" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_call_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_call_telemetry_call_id_key"
    ON "voice_call_telemetry"("call_id");

ALTER TABLE "voice_call_telemetry"
    ADD CONSTRAINT "voice_call_telemetry_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "voice_turn_telemetry" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "path" TEXT NOT NULL DEFAULT 'unknown',
    "transcript_length" INTEGER NOT NULL DEFAULT 0,
    "transcript_fingerprint" TEXT,
    "speech_duration_ms" INTEGER,
    "transcription_duration_ms" INTEGER,
    "speech_to_stt_final_ms" INTEGER,
    "llm_first_token_ms" INTEGER,
    "llm_first_phrase_ms" INTEGER,
    "llm_duration_ms" INTEGER,
    "availability_duration_ms" INTEGER,
    "tts_first_byte_ms" INTEGER,
    "stt_final_to_audio_ms" INTEGER,
    "tts_duration_ms" INTEGER,
    "total_e2e_ms" INTEGER,
    "stt_provider" TEXT,
    "llm_provider" TEXT,
    "llm_model" TEXT,
    "tts_provider" TEXT,
    "availability_searches" INTEGER NOT NULL DEFAULT 0,
    "availability_failures" INTEGER NOT NULL DEFAULT 0,
    "loop_detected" BOOLEAN NOT NULL DEFAULT false,
    "interrupted" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_turn_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_turn_telemetry_call_turn_key"
    ON "voice_turn_telemetry"("call_id", "turn_id");

CREATE INDEX "voice_turn_telemetry_call_sequence_idx"
    ON "voice_turn_telemetry"("call_id", "sequence");

CREATE INDEX "voice_turn_telemetry_call_path_idx"
    ON "voice_turn_telemetry"("call_id", "path");

ALTER TABLE "voice_turn_telemetry"
    ADD CONSTRAINT "voice_turn_telemetry_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
