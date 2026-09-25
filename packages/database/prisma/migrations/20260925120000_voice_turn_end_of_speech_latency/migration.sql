ALTER TABLE "voice_turn_telemetry"
  ADD COLUMN "end_of_speech_to_stt_final_ms" INTEGER,
  ADD COLUMN "hold_ms" INTEGER,
  ADD COLUMN "end_of_speech_to_first_audio_ms" INTEGER,
  ADD COLUMN "first_audio_is_filler" BOOLEAN,
  ADD COLUMN "speech_end_at" TIMESTAMP(3);
