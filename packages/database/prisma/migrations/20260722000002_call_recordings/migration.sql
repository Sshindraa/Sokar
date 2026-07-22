CREATE TYPE "CallRecordingStatus" AS ENUM (
  'NOT_REQUESTED',
  'PENDING',
  'AVAILABLE',
  'FAILED',
  'DELETED'
);

ALTER TABLE "calls"
  ADD COLUMN "recording_status" "CallRecordingStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "recording_provider_id" TEXT,
  ADD COLUMN "recording_storage_key" TEXT,
  ADD COLUMN "recording_content_type" TEXT,
  ADD COLUMN "recording_size_bytes" INTEGER,
  ADD COLUMN "recording_consent_announced_at" TIMESTAMP(3),
  ADD COLUMN "recording_started_at" TIMESTAMP(3),
  ADD COLUMN "recording_ended_at" TIMESTAMP(3),
  ADD COLUMN "recording_expires_at" TIMESTAMP(3),
  ADD COLUMN "recording_error" TEXT;

CREATE INDEX "calls_recording_status_expires_at_idx"
  ON "calls"("recording_status", "recording_expires_at");
